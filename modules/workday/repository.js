import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES, RPC } from '../../core/data/schema-contract.js';
import { enqueueOperation } from '../../offline/outbox.js';
import { offlineDb } from '../../offline/database.js';
import { cacheRows, getCachedRows } from '../../offline/cache.js';
import { listExpenseCategories as listActiveExpenseCategories } from '../expenses/repository.js';
const db = () => getSupabaseClient();
const required = (value, name) => { if (!value) throw new Error(`${name} is required.`); };
const isNetworkError = error => /fetch|network|offline/i.test(error?.message || '');
const newId = () => crypto.randomUUID();

export async function getCurrentWorkday({ tenantId, branchId } = {}) {
  required(tenantId,'tenantId'); required(branchId,'branchId');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('workdays', { tenantId, branchId })).find(row => row.status === 'open') ?? null;
  const {data,error}=await db().from(TABLES.workdays).select('id, tenant_id, branch_id, work_date, status, opened_at, opened_by_staff_id').eq('tenant_id',tenantId).eq('branch_id',branchId).eq('status','open').maybeSingle();
  if(error) { if (isNetworkError(error)) return (await getCachedRows('workdays', { tenantId, branchId })).find(row => row.status === 'open') ?? null; throw error; }
  if(data) await cacheRows('workdays', [data]); return data;
}

async function queueWorkdayOpen({tenantId,branchId,workDate,staffId}={}) {
  const operationId=newId(), localWorkdayId=newId(), openedAt=new Date().toISOString();
  const payload={work_date:workDate,staff_id:staffId,local_workday_id:localWorkdayId};
  const dependsOn=await pendingBranchOperationIds(tenantId,branchId);
  await enqueueOperation({tenantId,branchId,entityType:'workday_open',action:'open',operationId,payload,dependsOn,priority:0});
  const row={id:localWorkdayId,tenant_id:tenantId,branch_id:branchId,work_date:workDate,status:'open',
    opened_at:openedAt,opened_by_staff_id:staffId,local_open_operation_id:operationId,local_offline:true};
  await cacheRows('workdays',[row]);
  return {...row,queued:true,operationId};
}

export async function openWorkday({tenantId,branchId,workDate,staffId}={}) {
  required(tenantId,'tenantId'); required(branchId,'branchId'); required(workDate,'workDate'); required(staffId,'staffId');
  const current=await getCurrentWorkday({tenantId,branchId});
  if(current&&current.work_date!==workDate)throw new Error('أغلق يوم العمل المفتوح أولًا قبل فتح تاريخ آخر.');
  if(current&&current.work_date===workDate)return current;
  const priorClosing=(await getCachedRows('daily_closings',{tenantId,branchId})).find(row=>row.work_date===workDate);
  if(priorClosing)throw new Error('يوم العمل هذا مغلق بالفعل أو ينتظر تأكيد الإغلاق؛ لا يمكن فتح التاريخ نفسه مرة أخرى.');
  if (globalThis.navigator?.onLine === false) return queueWorkdayOpen({tenantId,branchId,workDate,staffId});
  const {data,error}=await db().rpc(RPC.openBranchWorkday,{p_tenant_id:tenantId,p_branch_id:branchId,p_work_date:workDate,p_staff_id:staffId});
  if(error) { if(isNetworkError(error)) return queueWorkdayOpen({tenantId,branchId,workDate,staffId}); throw error; }
  const current=await getCurrentWorkday({tenantId,branchId});
  return current ?? data;
}

async function pendingBranchOperationIds(tenantId,branchId) {
  const rows=await offlineDb.outbox.where('[tenant_id+branch_id]').equals([tenantId,branchId]).toArray();
  return rows.map(row=>row.operation_id);
}

async function queueWorkdayClose({tenantId,branchId,workDate,staffId}={}) {
  const workday=await getCurrentWorkday({tenantId,branchId});
  if(!workday||workday.work_date!==workDate) throw new Error('لا يوجد يوم عمل مفتوح مطابق محفوظ محليًا لهذا الفرع.');
  const summary=await getWorkdayCashSummary({tenantId,branchId,workDate});
  const operationId=newId(), localClosingId=newId();
  const expectedSnapshot={collected:summary.collected,expenses:summary.expenses,net_cash:summary.netCash,movement_count:summary.rows.length};
  const dependsOn=await pendingBranchOperationIds(tenantId,branchId);
  if(workday.local_open_operation_id&&!dependsOn.includes(workday.local_open_operation_id))dependsOn.push(workday.local_open_operation_id);
  const payload={work_date:workDate,staff_id:staffId,local_workday_id:workday.id,local_closing_id:localClosingId,expected_snapshot:expectedSnapshot};
  await enqueueOperation({tenantId,branchId,entityType:'workday_close',action:'close',operationId,payload,dependsOn,priority:90});
  await offlineDb.workdays.put({...workday,status:'closed',closed_at:new Date().toISOString(),local_close_operation_id:operationId,local_offline:true});
  const closing={id:localClosingId,tenant_id:tenantId,branch_id:branchId,work_date:workDate,closing_snapshot:expectedSnapshot,
    closed_at:new Date().toISOString(),status:'pending_sync',local_offline:true,operation_id:operationId};
  await cacheRows('daily_closings',[closing]);
  return {...closing,queued:true,operationId};
}

export async function closeWorkday({tenantId,branchId,workDate,staffId}={}) {
  required(tenantId,'tenantId'); required(branchId,'branchId'); required(workDate,'workDate'); required(staffId,'staffId');
  if (globalThis.navigator?.onLine === false) return queueWorkdayClose({tenantId,branchId,workDate,staffId});
  const pending=await pendingBranchOperationIds(tenantId,branchId);
  if(pending.length) throw new Error('لا يمكن إغلاق اليوم قبل مزامنة العمليات المحلية المعلقة.');
  const {data,error}=await db().rpc(RPC.closeBranchWorkday,{p_tenant_id:tenantId,p_branch_id:branchId,p_work_date:workDate,p_staff_id:staffId});
  if(error) { if(isNetworkError(error)) return queueWorkdayClose({tenantId,branchId,workDate,staffId}); throw error; }
  const latest=await getLatestClosing({tenantId,branchId});
  return latest ?? data;
}

export async function listExpenseCategories({tenantId}={}) {
  required(tenantId,'tenantId');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('expense_categories', { tenantId })).filter(row => row.is_active);
  try {
    const rows = await listActiveExpenseCategories({ tenantId });
    await cacheRows('expense_categories', rows);
    return rows;
  } catch (error) {
    if (isNetworkError(error)) return (await getCachedRows('expense_categories', { tenantId })).filter(row => row.is_active);
    throw error;
  }
}

async function queueWorkdayExpense({tenantId,branchId,categoryId,amount,description,staffId,operationId=newId()}={}) {
  const workday=await getCurrentWorkday({tenantId,branchId});
  if(!workday) throw new Error('افتح يوم العمل أولًا أو جهّز يومًا مفتوحًا قبل تسجيل المصروف أوف لاين.');
  const payload={category_id:categoryId,amount,description:description?.trim()||null,staff_id:staffId,
    work_date:workday.work_date,local_ledger_id:newId()};
  const dependsOn=workday.local_open_operation_id?[workday.local_open_operation_id]:[];
  await enqueueOperation({tenantId,branchId,entityType: 'expense', action: 'create', operationId, payload, dependsOn, priority: 20});
  await cacheRows('financial_ledger',[{id:payload.local_ledger_id,tenant_id:tenantId,branch_id:branchId,work_date:workday.work_date,
    source_type:'expense',direction:'outflow',amount,movement_at:new Date().toISOString(),description:payload.description,
    local_operation_id:operationId,local_offline:true}]);
  return {queued:true,operationId};
}

export async function addWorkdayExpense({tenantId,branchId,categoryId,amount,description,staffId}={}) {
  for(const [v,n] of [[tenantId,'tenantId'],[branchId,'branchId'],[categoryId,'categoryId'],[staffId,'staffId']]) required(v,n);
  const value=Number(amount); if(!Number.isFinite(value)||value<=0) throw new Error('Expense amount must be greater than zero.');
  const operationId=newId();
  if (globalThis.navigator?.onLine === false) return queueWorkdayExpense({tenantId,branchId,categoryId,amount:value,description,staffId,operationId});
  const {data,error}=await db().rpc(RPC.recordBranchExpense,{p_tenant_id:tenantId,p_branch_id:branchId,p_category_id:categoryId,p_amount:value,p_description:description?.trim()||null,p_idempotency_key:operationId,p_staff_id:staffId});
  if(error) { if(isNetworkError(error)) return queueWorkdayExpense({tenantId,branchId,categoryId,amount:value,description,staffId,operationId}); throw error; }
  return data;
}

export async function warmBranchFinancialLedger({tenantId,branchId,fromDate,toDate,maxRows=5000}={}){
  required(tenantId,'tenantId');required(branchId,'branchId');required(fromDate,'fromDate');required(toDate,'toDate');
  if(globalThis.navigator?.onLine===false)throw new Error('تحميل سجل الحركة المالية يحتاج اتصالًا بالإنترنت.');
  const limit=Math.min(10000,Math.max(1,Math.floor(Number(maxRows)||5000)));
  const {data,error,count}=await db().from('financial_ledger')
    .select('id,tenant_id,branch_id,source_type,source_id,direction,amount,movement_at,work_date,description,created_by,created_at',{count:'exact'})
    .eq('tenant_id',tenantId).eq('branch_id',branchId)
    .gte('work_date',fromDate).lt('work_date',toDate)
    .order('work_date',{ascending:false}).order('created_at',{ascending:false}).limit(limit);
  if(error)throw error;
  await cacheRows('financial_ledger',data||[]);
  return {cachedRows:(data||[]).length,totalRows:count??(data||[]).length,truncated:(count??0)>(data||[]).length};
}

export async function getWorkdayCashSummary({tenantId,branchId,workDate}={}) {
  required(tenantId,'tenantId'); required(branchId,'branchId'); required(workDate,'workDate');
  let rows;
  if (globalThis.navigator?.onLine === false) rows = (await getCachedRows('financial_ledger', { tenantId, branchId })).filter(row => row.work_date === workDate);
  else { const {data,error}=await db().from(TABLES.ledger).select('id,tenant_id,branch_id,work_date,source_type,direction,amount,movement_at,description').eq('tenant_id',tenantId).eq('branch_id',branchId).eq('work_date',workDate).order('movement_at',{ascending:true}); if(error) { if (isNetworkError(error)) rows=(await getCachedRows('financial_ledger',{tenantId,branchId})).filter(row=>row.work_date===workDate); else throw error; } else { rows=data??[]; await cacheRows('financial_ledger', rows); } }
  rows = rows ?? [];
  const collected=rows.filter(x=>x.direction==='inflow').reduce((s,x)=>s+Number(x.amount),0);
  const expenses=rows.filter(x=>x.direction==='outflow').reduce((s,x)=>s+Number(x.amount),0);
  return {rows,collected,expenses,netCash:collected-expenses};
}

export async function getLatestClosing({tenantId,branchId}={}) {
  required(tenantId,'tenantId'); required(branchId,'branchId');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('daily_closings',{tenantId,branchId})).sort((a,b)=>String(b.work_date).localeCompare(String(a.work_date)))[0] ?? null;
  const {data,error}=await db().from('daily_closings').select('id,tenant_id,branch_id,work_date,closing_snapshot,closed_at,status').eq('tenant_id',tenantId).eq('branch_id',branchId).order('work_date',{ascending:false}).limit(1).maybeSingle();
  if(error) { if (isNetworkError(error)) return (await getCachedRows('daily_closings',{tenantId,branchId})).sort((a,b)=>String(b.work_date).localeCompare(String(a.work_date)))[0] ?? null; throw error; }
  if(data) await cacheRows('daily_closings',[data]); return data;
}
