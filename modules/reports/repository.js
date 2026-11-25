import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES } from '../../core/data/schema-contract.js';
import { getCurrentSession } from '../../core/auth/session.js';
import { enqueueOperation } from '../../offline/outbox.js';
import { offlineDb } from '../../offline/database.js';
import { cacheRows, getCachedRows } from '../../offline/cache.js';
const db = () => getSupabaseClient();
const need = (v, n) => { if (!v) throw new Error(`${n} is required.`); };

export async function recordLocalWorkCopyDelivery({tenantId,branchId,visitId,staffId,deliveryMethod='printed_work_copy'}={}){
  if(!tenantId||!branchId||!visitId||!staffId)throw new Error('Tenant, branch, visit and staff are required to record delivery.');
  if(deliveryMethod!=='printed_work_copy')throw new Error('Only a printed work-copy handoff can be recorded from this workflow.');
  const session=await getCurrentSession();
  if(!session?.user?.id)throw new Error('تعذر تحديد المستخدم الذي سجل التسليم.');
  let visit=(await getCachedRows('visits',{tenantId,branchId})).find(row=>row.id===visitId);
  if(!visit&&globalThis.navigator?.onLine!==false){
    const {data,error}=await db().from(TABLES.visits).select('id,tenant_id,branch_id,status,is_published')
      .eq('tenant_id',tenantId).eq('branch_id',branchId).eq('id',visitId).maybeSingle();
    if(error)throw error;
    visit=data;
    if(visit)await cacheRows('visits',[visit]);
  }
  if(!visit)throw new Error('بيانات الزيارة غير محفوظة محليًا؛ افتح الزيارة أثناء الاتصال أولًا.');
  const operationId=crypto.randomUUID(),deliveredAt=new Date().toISOString();
  const payload={visit_id:visitId,local_visit_id:visitId,local_visit_pending:Boolean(visit.local_intake_operation_id),
    staff_id:staffId,actor_user_id:session.user.id,delivery_method:deliveryMethod,delivered_at:deliveredAt};
  const queue=async()=>{
    const pending=await offlineDb.outbox.where('[tenant_id+branch_id]').equals([tenantId,branchId]).toArray();
    const dependsOn=pending.map(row=>row.operation_id);
    if(visit.local_intake_operation_id&&!dependsOn.includes(visit.local_intake_operation_id))dependsOn.push(visit.local_intake_operation_id);
    await enqueueOperation({tenantId,branchId,entityType:'report_delivery',action:'record',operationId,payload,dependsOn,priority:80});
    await offlineDb.sync_meta.put({key:`delivery:${tenantId}:${branchId}:${visitId}`,tenant_id:tenantId,branch_id:branchId,visit_id:visitId,
      operation_id:operationId,delivery_status:'pending_sync',delivery_method:deliveryMethod,delivered_at:deliveredAt,staff_id:staffId});
    await cacheRows('visits',[{...visit,local_delivery_status:'pending_sync',local_delivery_method:deliveryMethod,local_delivery_at:deliveredAt}]);
    return {queued:true,operationId,deliveredAt};
  };
  if(globalThis.navigator?.onLine===false||visit.local_intake_operation_id)return queue();
  const {data,error}=await db().functions.invoke('record-local-delivery',{body:{...payload,operation_id:operationId,tenant_id:tenantId,branch_id:branchId}});
  if(error){
    if(/fetch|network|offline/i.test(error.message||'')||globalThis.navigator?.onLine===false)return queue();
    throw error;
  }
  await offlineDb.sync_meta.put({key:`delivery:${tenantId}:${branchId}:${visitId}`,tenant_id:tenantId,branch_id:branchId,visit_id:visitId,
    operation_id:operationId,delivery_status:'synced',delivery_method:deliveryMethod,delivered_at:deliveredAt,staff_id:staffId,
    server_event_id:data?.event_id||operationId,copy_type:data?.copy_type||null});
  await cacheRows('visits',[{...visit,local_delivery_status:'synced',local_delivery_method:deliveryMethod,local_delivery_at:deliveredAt}]);
  return data;
}

export async function listReportVersions({ tenantId, visitId } = {}) {
  need(tenantId, 'tenantId'); need(visitId, 'visitId');
  const { data, error } = await db().from('report_versions')
    .select('id, tenant_id, branch_id, visit_id, version_number, storage_path, change_reason, published_by_staff_id, created_at, is_published, published_at')
    .eq('tenant_id', tenantId).eq('visit_id', visitId).order('version_number', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Uploads the PDF through the authenticated server workflow; never inserts a report row directly. */
export async function publishReportVersion({ tenantId, branchId, visitId, staffId, file, changeReason = '', isPartial = false } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(visitId, 'visitId');
  need(staffId, 'staffId'); need(file, 'file');
  if (!(file instanceof File) || file.type !== 'application/pdf') throw new Error('A PDF report file is required.');
  if (file.size > 10 * 1024 * 1024) throw new Error('PDF must not exceed 10 MB.');
  const form = new FormData();
  form.set('tenantId', tenantId);
  form.set('branchId', branchId);
  form.set('visitId', visitId);
  form.set('staffId', staffId);
  form.set('changeReason', String(changeReason).trim());
  form.set('partial', isPartial ? 'true' : 'false');
  form.set('report', file, file.name || 'report.pdf');
  const { data, error } = await db().functions.invoke('publish-report', { body: form });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || 'Report publication failed.');
  return data;
}

/** Audited clinical correction. A new PDF version must be published after the correction. */
export async function correctPublishedResult({ tenantId, branchId, visitId, resultId, valueNumeric = null, valueText = null, reason, staffId } = {}) {
  for (const [v, n] of [[tenantId,'tenantId'],[branchId,'branchId'],[visitId,'visitId'],[resultId,'resultId'],[reason,'reason'],[staffId,'staffId']]) need(v, n);
  const numeric = valueNumeric === '' || valueNumeric === null || valueNumeric === undefined ? null : Number(valueNumeric);
  const textValue = valueText === '' || valueText === null || valueText === undefined ? null : String(valueText);
  if ((numeric === null) === (textValue === null)) throw new Error('Provide exactly one numeric or text result value.');
  if (numeric !== null && !Number.isFinite(numeric)) throw new Error('Numeric result is invalid.');
  const { data, error } = await db().rpc('correct_published_result', {
    p_tenant_id: tenantId, p_branch_id: branchId, p_visit_id: visitId,
    p_result_id: resultId, p_value_numeric: numeric, p_value_text: textValue,
    p_reason: String(reason).trim(), p_staff_id: staffId,
  });
  if (error) throw error;
  return data;
}

/** Authenticated staff download; storage bucket is private and RLS checks tenant/visit path. */
export async function createReportDownloadUrl({ storagePath, expiresIn = 90 } = {}) {
  need(storagePath, 'storagePath');
  const seconds = Math.min(Math.max(Number(expiresIn) || 90, 30), 300);
  const { data, error } = await db().storage.from('tenant-reports').createSignedUrl(storagePath, seconds);
  if (error) throw error;
  return data.signedUrl;
}

export function publicationRequiresServerWorkflow() {
  return {
    ready: false,
    implementationReady: true,
    deployedToTest: true,
    endpoint: 'publish-report',
    atomicDatabasePublication: true,
    auditedCorrections: true,
    requiredSecrets: ['REPORT_ALLOWED_ORIGINS'],
    reason: 'The Edge Function is deployed to TEST. Configure REPORT_ALLOWED_ORIGINS, then complete authenticated PDF upload and publication tests.',
  };
}

/** Correct a completed result before approval; the visit and all other visits remain unchanged. */
export async function correctCompletedVisitResult({tenantId,branchId,visitTestId,resultId,valueNumeric,valueText,reason,staffId}={}) {
  if(!tenantId||!branchId||!visitTestId||!resultId||!staffId||!String(reason||'').trim()) throw new Error('بيانات تصحيح النتيجة غير مكتملة.');
  if((valueNumeric==null)===(valueText==null)) throw new Error('أدخل قيمة رقمية أو نصية واحدة فقط.');
  if(globalThis.navigator?.onLine===false) throw new Error('تصحيح نتيجة محفوظة يحتاج اتصالًا بالإنترنت.');
  const {data,error}=await getSupabaseClient().rpc('correct_completed_visit_result',{
    p_tenant_id:tenantId,p_branch_id:branchId,p_visit_test_id:visitTestId,p_result_id:resultId,
    p_value_numeric:valueNumeric,p_value_text:valueText,p_reason:String(reason).trim(),p_staff_id:staffId,
  });
  if(error)throw error;return data;
}

/** Correct one completed result with its recalculated flag; preserves the previous published report version. */
export async function correctVisitResultWithFlag({tenantId,branchId,visitTestId,resultId,valueNumeric,valueText,flag,reason,staffId}={}) {
  if(!tenantId||!branchId||!visitTestId||!resultId||!staffId||!String(reason||'').trim()) throw new Error('بيانات تصحيح النتيجة غير مكتملة.');
  if((valueNumeric==null)===(valueText==null)) throw new Error('أدخل قيمة رقمية أو نصية واحدة فقط.');
  if(globalThis.navigator?.onLine===false) throw new Error('تصحيح نتيجة محفوظة يحتاج اتصالًا بالإنترنت.');
  const {data,error}=await getSupabaseClient().rpc('correct_visit_result_with_flag',{
    p_tenant_id:tenantId,p_branch_id:branchId,p_visit_test_id:visitTestId,p_result_id:resultId,
    p_value_numeric:valueNumeric,p_value_text:valueText,p_flag:flag??null,p_reason:String(reason).trim(),p_staff_id:staffId,
  });
  if(error)throw error;return data;
}
