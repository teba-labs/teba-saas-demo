import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES, RPC } from '../../core/data/schema-contract.js';
import { enqueueOperation } from '../../offline/outbox.js';
import { cacheRows, getCachedRows } from '../../offline/cache.js';
const db = () => getSupabaseClient();
const required = (value, name) => { if (!value) throw new Error(`${name} is required.`); };
export async function getCurrentWorkday({ tenantId, branchId } = {}) {
  required(tenantId,'tenantId'); required(branchId,'branchId');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('workdays', { tenantId, branchId })).find(row => row.status === 'open') ?? null;
  const {data,error}=await db().from(TABLES.workdays).select('id, tenant_id, branch_id, work_date, status, opened_at, opened_by_staff_id').eq('tenant_id',tenantId).eq('branch_id',branchId).eq('status','open').maybeSingle();
  if(error) { if (/fetch|network|offline/i.test(error.message || '')) return (await getCachedRows('workdays', { tenantId, branchId })).find(row => row.status === 'open') ?? null; throw error; }
  if(data) await cacheRows('workdays', [data]); return data;
}
export async function openWorkday({tenantId,branchId,workDate,staffId}={}) {
  required(tenantId,'tenantId'); required(branchId,'branchId'); required(workDate,'workDate'); required(staffId,'staffId');
  const {data,error}=await db().rpc(RPC.openBranchWorkday,{p_tenant_id:tenantId,p_branch_id:branchId,p_work_date:workDate,p_staff_id:staffId});
  if(error) throw error; return data;
}
export async function closeWorkday({tenantId,branchId,workDate,staffId}={}) {
  required(tenantId,'tenantId'); required(branchId,'branchId'); required(workDate,'workDate'); required(staffId,'staffId');
  const {data,error}=await db().rpc(RPC.closeBranchWorkday,{p_tenant_id:tenantId,p_branch_id:branchId,p_work_date:workDate,p_staff_id:staffId});
  if(error) throw error; return data;
}
export async function listExpenseCategories({tenantId}={}) {
  required(tenantId,'tenantId');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('expense_categories', { tenantId })).filter(row => row.is_active);
  const {data,error}=await db().from(TABLES.expenseCategories).select('id,tenant_id,name,is_active').eq('tenant_id',tenantId).eq('is_active',true).order('name');
  if(error) { if (/fetch|network|offline/i.test(error.message || '')) return (await getCachedRows('expense_categories', { tenantId })).filter(row => row.is_active); throw error; }
  await cacheRows('expense_categories', data ?? []); return data??[];
}
export async function addWorkdayExpense({tenantId,branchId,categoryId,amount,description,staffId}={}) {
  for(const [v,n] of [[tenantId,'tenantId'],[branchId,'branchId'],[categoryId,'categoryId'],[staffId,'staffId']]) required(v,n);
  const value=Number(amount); if(!Number.isFinite(value)||value<=0) throw new Error('Expense amount must be greater than zero.');
  const operationId = crypto.randomUUID();
  const payload = { category_id: categoryId, amount: value, description: description?.trim() || null, staff_id: staffId };
  if (globalThis.navigator?.onLine === false) {
    await enqueueOperation({ tenantId, branchId, entityType: 'expense', action: 'create', operationId, payload });
    return { queued: true, operationId };
  }
  const {data,error}=await db().rpc(RPC.recordBranchExpense,{p_tenant_id:tenantId,p_branch_id:branchId,p_category_id:categoryId,p_amount:value,p_description:description?.trim()||null,p_idempotency_key:operationId,p_staff_id:staffId});
  if(error) { if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) { await enqueueOperation({ tenantId, branchId, entityType: 'expense', action: 'create', operationId, payload }); return { queued: true, operationId }; } throw error; }
  return data;
}
export async function getWorkdayCashSummary({tenantId,branchId,workDate}={}) {
  required(tenantId,'tenantId'); required(branchId,'branchId'); required(workDate,'workDate');
  let rows;
  if (globalThis.navigator?.onLine === false) rows = (await getCachedRows('financial_ledger', { tenantId, branchId })).filter(row => row.work_date === workDate);
  else { const {data,error}=await db().from(TABLES.ledger).select('id,tenant_id,branch_id,work_date,source_type,direction,amount,movement_at,description').eq('tenant_id',tenantId).eq('branch_id',branchId).eq('work_date',workDate).order('movement_at',{ascending:true}); if(error) { if (/fetch|network|offline/i.test(error.message || '')) rows=(await getCachedRows('financial_ledger',{tenantId,branchId})).filter(row=>row.work_date===workDate); else throw error; } else { rows=data??[]; await cacheRows('financial_ledger', rows); } }
  rows = rows ?? [];
  const collected=rows.filter(x=>x.direction==='inflow').reduce((s,x)=>s+Number(x.amount),0);
  const expenses=rows.filter(x=>x.direction==='outflow').reduce((s,x)=>s+Number(x.amount),0);
  return {rows,collected,expenses,netCash:collected-expenses};
}
export async function getLatestClosing({tenantId,branchId}={}) {
  required(tenantId,'tenantId'); required(branchId,'branchId');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('daily_closings',{tenantId,branchId})).sort((a,b)=>String(b.work_date).localeCompare(String(a.work_date)))[0] ?? null;
  const {data,error}=await db().from('daily_closings').select('id,tenant_id,branch_id,work_date,closing_snapshot,closed_at,status').eq('tenant_id',tenantId).eq('branch_id',branchId).order('work_date',{ascending:false}).limit(1).maybeSingle();
  if(error) { if (/fetch|network|offline/i.test(error.message || '')) return (await getCachedRows('daily_closings',{tenantId,branchId})).sort((a,b)=>String(b.work_date).localeCompare(String(a.work_date)))[0] ?? null; throw error; }
  if(data) await cacheRows('daily_closings',[data]); return data;
}
