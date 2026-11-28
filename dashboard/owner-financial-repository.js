import {getSupabaseClient} from '../core/supabase-client.js';
const db=()=>getSupabaseClient();
const requireValue=(v,n)=>{if(!v)throw new Error(n+' مطلوب.');};
async function pages(query,pageSize=500){const out=[];for(let offset=0;;offset+=pageSize){const {data,error}=await query().range(offset,offset+pageSize-1);if(error)throw error;const batch=data||[];out.push(...batch);if(batch.length<pageSize)return out;}}
export async function listOwnerFinancialBatches(tenantId){requireValue(tenantId,'tenantId');return pages(()=>db().from('owner_financial_import_batches').select('id,tenant_id,file_name,file_sha256,source_label,period_start,period_end,status,rows_total,rows_imported,rows_skipped,created_at').eq('tenant_id',tenantId).order('created_at',{ascending:false}));}
export async function listOwnerFinancialRows({tenantId,from=null,to=null,branchId=null,includePending=false}={}){
 requireValue(tenantId,'tenantId');
 return pages(()=>{
  let q=db().from('owner_financial_import_rows')
   .select('id,tenant_id,batch_id,branch_id,sheet_name,row_number,period_date,metric_key,amount,quantity,item_name,category_name,unit_cost,selling_price,weight,currency_code,original_row,row_fingerprint,is_active,pending_approval,created_at')
   .eq('tenant_id',tenantId).order('created_at').order('id');
  if(includePending){
   let alternatives=[];
   if(!from&&!to)alternatives=['is_active.eq.true','pending_approval.eq.true'];
   else{
    const activePeriod=from&&to?'and(is_active.eq.true,period_date.gte.'+from+',period_date.lte.'+to+')':from?'and(is_active.eq.true,period_date.gte.'+from+')':'and(is_active.eq.true,period_date.lte.'+to+')';
    const pendingPeriod=from&&to?'and(pending_approval.eq.true,period_date.gte.'+from+',period_date.lte.'+to+')':from?'and(pending_approval.eq.true,period_date.gte.'+from+')':'and(pending_approval.eq.true,period_date.lte.'+to+')';
    alternatives=['and(is_active.eq.true,period_date.is.null)',activePeriod,pendingPeriod];
   }
   q=q.or(alternatives.join(','));
  }else{
   q=q.eq('is_active',true);
   if(from&&to)q=q.or('period_date.is.null,and(period_date.gte.'+from+',period_date.lte.'+to+')');
   else if(from)q=q.or('period_date.is.null,period_date.gte.'+from);
   else if(to)q=q.or('period_date.is.null,period_date.lte.'+to);
  }
  return q;
 });
}
export async function createOwnerFinancialBatch({tenantId,fileName,fileSha256,file,sourceLabel,periodStart,periodEnd,mappingSnapshot,sheetSummary,rows}={}){
 requireValue(tenantId,'tenantId');requireValue(fileName,'اسم الملف');requireValue(fileSha256,'بصمة الملف');requireValue(file,'الملف الأصلي');if(!Array.isArray(rows)||!rows.length)throw new Error('لا توجد صفوف صالحة للاستيراد.');
 const existing=await db().from('owner_financial_import_batches').select('id').eq('tenant_id',tenantId).eq('file_sha256',fileSha256).maybeSingle();if(existing.error)throw existing.error;if(existing.data)throw new Error('هذا الملف وهذه الورقة سبق استيرادهما إلى هذا المعمل. لم نكرر بياناتهما.');
 const session=await db().auth.getUser();if(session.error)throw session.error;
 const {data:batch,error}=await db().from('owner_financial_import_batches').insert({tenant_id:tenantId,file_name:fileName,file_sha256:fileSha256,source_label:sourceLabel||null,period_start:periodStart||null,period_end:periodEnd||null,mapping_snapshot:mappingSnapshot||{},sheet_summary:sheetSummary||[],status:'completed',rows_total:rows.length,rows_imported:rows.length,rows_skipped:0,created_by:session.data.user?.id||null}).select('id').single();if(error)throw error;
 let storagePath=null;
 try{
  const safeName=String(fileName||'workbook.xlsx').replace(/[^A-Za-z0-9._-]+/g,'_');
  storagePath=tenantId+'/owner-financial/'+fileSha256.replace(/[^A-Za-z0-9_-]+/g,'-')+'/'+safeName;
  const upload=await db().storage.from('tenant-backups').upload(storagePath,file,{upsert:false,contentType:file.type||'application/octet-stream'});if(upload.error)throw upload.error;
  const pathUpdate=await db().from('owner_financial_import_batches').update({storage_path:storagePath}).eq('id',batch.id).eq('tenant_id',tenantId);if(pathUpdate.error)throw pathUpdate.error;
  for(let offset=0;offset<rows.length;offset+=250){const payload=rows.slice(offset,offset+250).map(row=>({...row,tenant_id:tenantId,batch_id:batch.id,is_active:row.metric_key==='test_price',pending_approval:row.metric_key!=='test_price'}));const result=await db().from('owner_financial_import_rows').insert(payload);if(result.error)throw result.error;}
 }catch(error){
  await db().from('owner_financial_import_rows').delete().eq('batch_id',batch.id).eq('tenant_id',tenantId);
  await db().from('owner_financial_import_batches').delete().eq('id',batch.id).eq('tenant_id',tenantId);
  if(storagePath)await db().storage.from('tenant-backups').remove([storagePath]);
  throw new Error('فشل الاستيراد وتم التراجع عن دفعة البيانات والملف لتجنب حفظ جزء منها. '+(error.message||''));
 }
 return batch;
}
export async function getOwnerDashboardSources(tenantId){requireValue(tenantId,'tenantId');const {data,error}=await db().from('owner_dashboard_source_settings').select('metric_key,source').eq('tenant_id',tenantId);if(error)throw error;return Object.fromEntries((data||[]).map(x=>[x.metric_key,x.source]));}
export async function saveOwnerDashboardSources(tenantId,choices){requireValue(tenantId,'tenantId');const user=await db().auth.getUser();if(user.error)throw user.error;const rows=Object.entries(choices||{}).map(([metric_key,source])=>({tenant_id:tenantId,metric_key,source,updated_by:user.data.user?.id||null}));if(!rows.length)return;const {error}=await db().from('owner_dashboard_source_settings').upsert(rows,{onConflict:'tenant_id,metric_key'});if(error)throw error;}
export async function saveOwnerMonthApproval({tenantId,month,branchId=null,sourceChoices={},reconciliation={},notes=''}={}){requireValue(tenantId,'tenantId');requireValue(month,'الشهر');const user=await db().auth.getUser();if(user.error)throw user.error;let existingQuery=db().from('owner_dashboard_month_approvals').select('approved_at,approved_by,source_choices,reconciliation_snapshot,notes').eq('tenant_id',tenantId).eq('period_month',month+'-01');if(branchId)existingQuery=existingQuery.eq('branch_id',branchId);else existingQuery=existingQuery.is('branch_id',null);const existing=await existingQuery.maybeSingle();if(existing.error)throw existing.error;const previous=existing.data;const history=[...(previous?.reconciliation_snapshot?.approvalHistory||[])];if(previous?.approved_at)history.push({approved_at:previous.approved_at,approved_by:previous.approved_by,source_choices:previous.source_choices||{},reconciliation_snapshot:previous.reconciliation_snapshot||{},notes:previous.notes||''});const snapshot={...reconciliation,approvalHistory:history.slice(-20)};const {data,error}=await db().from('owner_dashboard_month_approvals').upsert({tenant_id:tenantId,period_month:month+'-01',branch_id:branchId,source_choices:sourceChoices,reconciliation_snapshot:snapshot,notes,approved_by:user.data.user?.id||null,approved_at:new Date().toISOString()},{onConflict:'tenant_id,period_month,branch_id'}).select('id,approved_at').single();if(error)throw error;return data;}
export async function listOwnerMonthApprovals({tenantId,month,branchId=null}={}){requireValue(tenantId,'tenantId');let q=db().from('owner_dashboard_month_approvals').select('*').eq('tenant_id',tenantId);if(month)q=q.eq('period_month',month+'-01');if(branchId)q=q.eq('branch_id',branchId);const {data,error}=await q.order('approved_at',{ascending:false});if(error)throw error;return data||[];}

export async function activateOwnerFinancialPeriod({tenantId,month,branchId=null,replacePeriod=false}={}){
 requireValue(tenantId,'tenantId');requireValue(month,'الشهر');
 const {data,error}=await db().rpc('activate_owner_financial_import_period',{p_tenant_id:tenantId,p_period_month:month+'-01',p_branch_id:branchId,p_replace_period:replacePeriod});
 if(error)throw error;
 return Number(data||0);
}
