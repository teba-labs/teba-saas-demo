import { offlineDb } from './database.js';
import { getDeviceIdentity } from './device-identity.js';
import { cacheRows } from './cache.js';
import { getSupabaseClient } from '../core/supabase-client.js';
import { getCurrentSession } from '../core/auth/session.js';
import { fingerprintVisitResults } from './result-fingerprint.js';

const db = () => getSupabaseClient();
async function removeLocalLedgerRow(id) {
  if (id) await offlineDb.financial_ledger.delete(id);
}
async function setApprovalMarker(operation,status,serverVisitId=null,reason=null){
  const p=operation.payload||{};
  const localVisitId=p.local_visit_id||p.visit_id;
  const visitId=serverVisitId||localVisitId;
  const localKey=`approval:${operation.tenant_id}:${operation.branch_id}:${localVisitId}`;
  const key=`approval:${operation.tenant_id}:${operation.branch_id}:${visitId}`;
  const existing=await offlineDb.sync_meta.get(localKey)||await offlineDb.sync_meta.get(key);
  await offlineDb.sync_meta.put({...existing,key,tenant_id:operation.tenant_id,branch_id:operation.branch_id,
    visit_id:visitId,operation_id:operation.operation_id,approval_status:status,
    approved_by_staff_id:p.staff_id,approved_at:p.approved_at,server_visit_id:serverVisitId||null,
    ...(reason?{reason}:{}),updated_at:new Date().toISOString()});
  if(localKey!==key)await offlineDb.sync_meta.delete(localKey);
}
async function getServerWorkday(tenantId, branchId, workDate) {
  return db().from('branch_workdays')
    .select('id,tenant_id,branch_id,work_date,status,opened_at,opened_by_staff_id')
    .eq('tenant_id',tenantId).eq('branch_id',branchId).eq('work_date',workDate)
    .eq('status','open').maybeSingle();
}
function sameClosingSnapshot(actual, expected) {
  if (!actual || !expected) return false;
  const close = (a,b) => Math.abs(Number(a ?? 0)-Number(b ?? 0)) < 0.011;
  return close(actual.collected,expected.collected)
    && close(actual.expenses,expected.expenses)
    && close(actual.net_cash,expected.net_cash);
}
const isBusinessConflict = (error, pattern) => pattern.test(String(error?.message || error || ''));
const throwUnlessConflict = (error, pattern) => {
  if (isBusinessConflict(error, pattern)) return { conflict: true, reason: String(error.message || error) };
  throw error;
};

/** Only operations backed by server-side idempotency RPCs are enabled here. */
export function createSupabaseSyncHandlers() {
  return {
    culture_isolate: async operation => {
      const p=operation.payload;
      let visitTestId=p.visit_test_id;
      let mappedVisitTest = false;
      for(const dependency of operation.depends_on||[]){
        const mapping=await offlineDb.sync_meta.get(`visit-map:${dependency}`);
        if(mapping?.visit_test_ids?.[visitTestId]){visitTestId=mapping.visit_test_ids[visitTestId];mappedVisitTest=true;break;}
      }
      if(!mappedVisitTest){
        const maps=await offlineDb.sync_meta.toArray();
        const mapping=maps.find(row=>row.tenant_id===operation.tenant_id&&row.branch_id===operation.branch_id&&row.visit_test_ids?.[visitTestId]);
        if(mapping){visitTestId=mapping.visit_test_ids[visitTestId];mappedVisitTest=true;}
      }
      if(visitTestId===p.visit_test_id && (operation.depends_on||[]).length){
        const found=await db().from('visit_tests').select('id').eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id).eq('id',visitTestId).maybeSingle();
        if(found.error)throw found.error;if(!found.data)throw new Error('Culture isolate is waiting for its visit/test mapping.');
        visitTestId=found.data.id;
      }
      const {data,error}=await db().rpc('save_culture_isolate_idempotent',{
        p_operation_id:operation.operation_id,p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,
        p_visit_test_id:visitTestId,p_staff_id:p.staff_id,p_payload:p.values,
      });
      if(error)return throwUnlessConflict(error,/Branch access denied|active staff identity|Visit test was not found|Completed or approved culture results are locked|Invalid isolate number|Organism name is required|idempotency key reused|Authentication required/i);
      if(!data)throw new Error('Server did not acknowledge the culture isolate.');
      await offlineDb.sync_meta.put({key:`isolate-map:${operation.operation_id}`,tenant_id:operation.tenant_id,branch_id:operation.branch_id,
        local_isolate_id:p.local_isolate_id,server_isolate_id:data,acknowledged_at:new Date().toISOString()});
      await cacheRows('culture_isolates',[{id:data,tenant_id:operation.tenant_id,branch_id:operation.branch_id,visit_test_id:visitTestId,
        isolate_number:p.values.isolate_number,organism_name:p.values.organism_name,growth_description:p.values.growth_description,
        colony_count:p.values.colony_count,colony_count_unit:p.values.colony_count_unit,identification_method:p.values.identification_method,
        notes:p.values.notes,created_by_staff_id:p.staff_id,created_at:new Date().toISOString()}]);
      await offlineDb.culture_susceptibilities.where('isolate_id').equals(p.local_isolate_id).modify({isolate_id:data});
      await offlineDb.culture_isolates.delete(p.local_isolate_id);
      return {acknowledged:true,resultId:data};
    },
    culture_susceptibility: async operation => {
      const p=operation.payload;
      let isolateId=p.local_isolate_id;
      let mappedIsolate = false;
      for(const dependency of operation.depends_on||[]){
        const mapping=await offlineDb.sync_meta.get(`isolate-map:${dependency}`);
        if(mapping?.local_isolate_id===isolateId){isolateId=mapping.server_isolate_id;mappedIsolate=true;break;}
      }
      if(!mappedIsolate){
        const maps=await offlineDb.sync_meta.toArray();
        const mapping=maps.find(row=>row.tenant_id===operation.tenant_id&&row.branch_id===operation.branch_id&&row.local_isolate_id===isolateId&&row.server_isolate_id);
        if(mapping){isolateId=mapping.server_isolate_id;mappedIsolate=true;}
      }
      if(p.local_isolate_pending&&!mappedIsolate)throw new Error('Susceptibility is waiting for its isolate to synchronize.');
      const {data,error}=await db().rpc('save_culture_susceptibility_idempotent',{
        p_operation_id:operation.operation_id,p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,
        p_isolate_id:isolateId,p_staff_id:p.staff_id,p_payload:p.values,
      });
      if(error)return throwUnlessConflict(error,/Branch access denied|active staff identity|Culture isolate was not found|Completed or approved culture results are locked|Invalid measured value|Invalid susceptibility interpretation|Invalid breakpoint standard|Invalid susceptibility method|Invalid QC status|idempotency key reused|Authentication required/i);
      if(!data)throw new Error('Server did not acknowledge the susceptibility result.');
      await cacheRows('culture_susceptibilities',[{id:data,tenant_id:operation.tenant_id,branch_id:operation.branch_id,isolate_id:isolateId,
        ...p.values,entered_by_staff_id:p.staff_id,created_at:new Date().toISOString()}]);
      await offlineDb.culture_susceptibilities.delete(p.local_susceptibility_id || '');
      return {acknowledged:true,resultId:data};
    },
    visit_test_add: async operation => {
      const p=operation.payload;
      let visitId=p.visit_id;
      if(p.local_visit_pending){
        let mapping=null;
        for(const dependency of operation.depends_on||[]){const candidate=await offlineDb.sync_meta.get(`visit-map:${dependency}`);if(candidate?.local_visit_id===visitId){mapping=candidate;break;}}
        if(!mapping){const maps=await offlineDb.sync_meta.toArray();mapping=maps.find(row=>row.tenant_id===operation.tenant_id&&row.branch_id===operation.branch_id&&row.local_visit_id===visitId&&row.server_visit_id);}
        if(!mapping?.server_visit_id)throw new Error('Test addition is waiting for its visit to synchronize.');
        visitId=mapping.server_visit_id;
      }
      const {data,error}=await db().rpc('add_test_to_visit_atomic',{
        p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,p_visit_id:visitId,
        p_test_id:p.test_id,p_staff_id:p.staff_id,
      });
      if(error)return throwUnlessConflict(error,/Branch access denied|active staff identity|Visit not found|finalized visit|Active catalog test not found|Authentication required/i);
      if(!data?.id)throw new Error('Server did not confirm the added test.');
      const full=await db().from('visit_tests')
        .select('id,tenant_id,branch_id,visit_id,test_id,test_code_snapshot,test_name_snapshot,technical_snapshot,status,created_at,tests_catalog(test_kind),visits!inner(visit_number,visit_work_date,status,is_published,patients!inner(full_name,patient_number,phone,age_years,sex))')
        .eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id).eq('id',data.id).single();
      if(full.error)throw full.error;
      await cacheRows('visit_tests',[full.data]);
      return {acknowledged:true,resultId:data.id};
    },
    range_override: async operation => {
      const p=operation.payload;
      let visitTestId=p.visit_test_id;
      let mapped=false;
      for(const dependency of operation.depends_on||[]){const m=await offlineDb.sync_meta.get(`visit-map:${dependency}`);if(m?.visit_test_ids?.[visitTestId]){visitTestId=m.visit_test_ids[visitTestId];mapped=true;break;}}
      if(!mapped){const all=await offlineDb.sync_meta.toArray();const m=all.find(x=>x.tenant_id===operation.tenant_id&&x.branch_id===operation.branch_id&&x.visit_test_ids?.[visitTestId]);if(m){visitTestId=m.visit_test_ids[visitTestId];mapped=true;}}
      if(p.visit_test_pending&&!mapped)throw new Error('Range correction is waiting for its visit/test to synchronize.');
      const {data,error}=await db().rpc('set_visit_parameter_range_override_idempotent',{
        p_operation_id:operation.operation_id,p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,
        p_visit_test_id:visitTestId,p_parameter_code:p.parameter_code,p_reference_ranges:p.reference_ranges,p_staff_id:p.staff_id,
      });
      if(error)return throwUnlessConflict(error,/Branch access denied|active staff identity|Visit test not found|Cancelled tests|Cancelled visits|Parameter is not part|Authentication required|operation ID was reused/i);
      if(!data?.visit_test_id)throw new Error('Server did not confirm the visit-specific reference range.');
      const key=`range-override:${p.visit_test_id}:${p.parameter_code}`;
      await offlineDb.sync_meta.put({...data,key:`range-override:${data.visit_test_id}:${p.parameter_code}`,local_pending:false});
      if(key!==`range-override:${data.visit_test_id}:${p.parameter_code}`)await offlineDb.sync_meta.delete(key);
      return {acknowledged:true,resultId:operation.operation_id};
    },
    patient_update: async operation => {
      const p=operation.payload;
      const current=await db().from('patients').select('id,tenant_id,branch_id,full_name,phone,sex,date_of_birth,age_value,age_unit,updated_at')
        .eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id).eq('id',p.patient_id).maybeSingle();
      if(current.error)throw current.error;
      if(!current.data) return {conflict:true,reason:'بيانات المريض غير موجودة في الفرع؛ احتفظنا بالتعديل المحلي.'};
      const same=current.data.full_name===p.full_name&&current.data.phone===(p.phone||null)&&current.data.sex===p.sex
        &&current.data.date_of_birth===(p.date_of_birth||null)&&Number(current.data.age_value??-1)===Number(p.age_value??-1)&&current.data.age_unit===p.age_unit;
      if(!same&&p.expected_updated_at&&current.data.updated_at!==p.expected_updated_at)return {conflict:true,reason:'تغيرت بيانات المريض على جهاز آخر؛ احتفظنا بالنسخة المحلية للمراجعة.'};
      if(!same){
        const {data,error}=await db().rpc('update_patient_demographics',{
          p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,p_patient_id:p.patient_id,p_staff_id:p.staff_id,
          p_full_name:p.full_name,p_phone:p.phone,p_sex:p.sex,p_date_of_birth:p.date_of_birth,
          p_age_value:p.age_value,p_age_unit:p.age_unit,p_expected_updated_at:p.expected_updated_at,
        });
        if(error)return throwUnlessConflict(error,/Branch access denied|Active staff identity|Patient not found|بيانات المريض تغيرت|Authentication/i);
        await cacheRows('patients',[data]);
      }
      return {acknowledged:true,resultId:p.patient_id};
    },
    visit_update: async operation => {
      const p=operation.payload;
      let visitId=p.visit_id;
      if(p.local_visit_pending){
        let mapping=null;
        for(const dependency of operation.depends_on||[]){const m=await offlineDb.sync_meta.get(`visit-map:${dependency}`);if(m?.local_visit_id===visitId){mapping=m;break;}}
        if(!mapping){const all=await offlineDb.sync_meta.toArray();mapping=all.find(x=>x.tenant_id===operation.tenant_id&&x.branch_id===operation.branch_id&&x.local_visit_id===visitId&&x.server_visit_id);}
        if(!mapping?.server_visit_id)throw new Error('Visit details are waiting for the visit to synchronize.');
        visitId=mapping.server_visit_id;
      }
      const current=await db().from('visits').select('id,tenant_id,branch_id,referred_by,notes,updated_at')
        .eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id).eq('id',visitId).maybeSingle();
      if(current.error)throw current.error;
      if(!current.data)return {conflict:true,reason:'الزيارة غير موجودة على السحابة؛ احتفظنا بالتعديل المحلي.'};
      const same=(current.data.referred_by||null)===(p.referred_by||null)&&(current.data.notes||null)===(p.notes||null);
      if(!same&&p.expected_updated_at&&current.data.updated_at!==p.expected_updated_at)return {conflict:true,reason:'تغيرت بيانات الزيارة على جهاز آخر؛ احتفظنا بالتعديل المحلي للمراجعة.'};
      if(!same){
        const {data,error}=await db().rpc('update_visit_details',{
          p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,p_visit_id:visitId,p_staff_id:p.staff_id,
          p_referred_by:p.referred_by,p_notes:p.notes,p_expected_updated_at:p.expected_updated_at,
        });
        if(error)return throwUnlessConflict(error,/Branch access denied|Active staff identity|Active visit not found|بيانات الزيارة تغيرت|Authentication/i);
        await cacheRows('visits',[data]);
      }
      return {acknowledged:true,resultId:visitId};
    },
    visit_cancel: async operation => {
      const p=operation.payload;let visitId=p.visit_id;
      if(p.local_visit_pending){
        let mapping=null;
        for(const dependency of operation.depends_on||[]){const m=await offlineDb.sync_meta.get(`visit-map:${dependency}`);if(m?.local_visit_id===visitId){mapping=m;break;}}
        if(!mapping){const all=await offlineDb.sync_meta.toArray();mapping=all.find(x=>x.tenant_id===operation.tenant_id&&x.branch_id===operation.branch_id&&x.local_visit_id===visitId&&x.server_visit_id);}
        if(!mapping?.server_visit_id)throw new Error('Visit cancellation is waiting for its visit to synchronize.');
        visitId=mapping.server_visit_id;
      }
      const {data,error}=await db().rpc('cancel_visit_atomic',{p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,p_visit_id:visitId,p_staff_id:p.staff_id});
      if(error)return throwUnlessConflict(error,/Branch access denied|Active staff identity|Visit not found|Authentication/i);
      await cacheRows('visits',[data]);return {acknowledged:true,resultId:visitId};
    },
    visit_test_cancel: async operation => {
      const p=operation.payload;let visitTestId=p.visit_test_id;let mappedTest=false;
      for(const dependency of operation.depends_on||[]){const m=await offlineDb.sync_meta.get(`visit-map:${dependency}`);if(m?.visit_test_ids?.[visitTestId]){visitTestId=m.visit_test_ids[visitTestId];mappedTest=true;break;}}
      if(!mappedTest){const all=await offlineDb.sync_meta.toArray();const mapped=all.find(x=>x.tenant_id===operation.tenant_id&&x.branch_id===operation.branch_id&&x.visit_test_ids?.[visitTestId]);if(mapped){visitTestId=mapped.visit_test_ids[visitTestId];mappedTest=true;}}
      if(p.visit_test_pending&&!mappedTest)throw new Error('Removing the test is waiting for the offline visit to synchronize.');
      const {data,error}=await db().rpc('cancel_visit_test_atomic',{p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,p_visit_test_id:visitTestId,p_staff_id:p.staff_id});
      if(error)return throwUnlessConflict(error,/Branch access denied|Active staff identity|Visit test not found|Visit is cancelled|Authentication/i);
      await cacheRows('visit_tests',[data]);return {acknowledged:true,resultId:visitTestId};
    },
    result_correction: async operation => {
      const p=operation.payload;let visitTestId=p.visit_test_id;let mappedTest=false;
      for(const dependency of operation.depends_on||[]){const m=await offlineDb.sync_meta.get(`visit-map:${dependency}`);if(m?.visit_test_ids?.[visitTestId]){visitTestId=m.visit_test_ids[visitTestId];mappedTest=true;break;}}
      if(!mappedTest){const all=await offlineDb.sync_meta.toArray();const mapped=all.find(x=>x.tenant_id===operation.tenant_id&&x.branch_id===operation.branch_id&&x.visit_test_ids?.[visitTestId]);if(mapped){visitTestId=mapped.visit_test_ids[visitTestId];mappedTest=true;}}
      if(p.visit_test_pending&&!mappedTest)throw new Error('Result correction is waiting for the offline visit to synchronize.');
      let resultId=p.result_id;
      if(!resultId||String(resultId).startsWith('local-result:')){
        if(!p.parameter_code)throw new Error('Cannot resolve the synchronized result without its parameter code.');
        const lookup=await db().from('test_results').select('id').eq('tenant_id',operation.tenant_id)
          .eq('visit_test_id',visitTestId).eq('parameter_code',p.parameter_code).maybeSingle();
        if(lookup.error)throw lookup.error;
        if(!lookup.data?.id)throw new Error('The saved result is still synchronizing; correction will retry automatically.');
        resultId=lookup.data.id;
      }
      const {data,error}=await db().rpc('correct_visit_result_with_flag',{
        p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,p_visit_test_id:visitTestId,p_result_id:resultId,
        p_value_numeric:p.value_numeric,p_value_text:p.value_text,p_flag:p.flag??null,p_reason:null,p_staff_id:p.staff_id,
      });
      if(error)return throwUnlessConflict(error,/Branch access denied|active staff identity|Only a completed visit test|Cancelled visits|Result not found|approved unpublished|Authentication required|Unsupported result flag|Provide exactly one/i);
      if(!data?.id)throw new Error('Server did not confirm the corrected result.');
      await cacheRows('test_results',[{...data,branch_id:operation.branch_id}]);
      return {acknowledged:true,resultId:data.id};
    },
    draft_results: async operation => {
      const p = operation.payload;
      let visitTestId = p.visit_test_id;
      let resolvedVisitTestId = false;
      for (const dependency of operation.depends_on || []) {
        const mapping = await offlineDb.sync_meta.get(`visit-map:${dependency}`);
        if (mapping?.visit_test_ids?.[visitTestId]) { visitTestId = mapping.visit_test_ids[visitTestId]; resolvedVisitTestId = true; break; }
      }
      if (!resolvedVisitTestId) {
        const maps = await offlineDb.sync_meta.toArray();
        const mapping = maps.find(row => row.tenant_id === operation.tenant_id && row.branch_id === operation.branch_id && row.visit_test_ids?.[visitTestId]);
        if (mapping) { visitTestId = mapping.visit_test_ids[visitTestId]; resolvedVisitTestId = true; }
      }
      if (visitTestId === p.visit_test_id && (operation.depends_on || []).length) {
        const found = await db().from('visit_tests').select('id').eq('tenant_id', operation.tenant_id)
          .eq('branch_id', operation.branch_id).eq('id', p.visit_test_id).maybeSingle();
        if (found.error) throw found.error;
        if (!found.data) throw new Error('The queued result is waiting for its visit/test mapping; it has been retained.');
        visitTestId = found.data.id;
      }
      const { data, error } = await db().rpc('save_draft_results_idempotent', {
        p_operation_id: operation.operation_id,
        p_tenant_id: operation.tenant_id,
        p_branch_id: operation.branch_id,
        p_visit_test_id: visitTestId,
        p_staff_id: p.staff_id,
        p_results: p.results,
      });
      if (error) return throwUnlessConflict(error, /Branch access denied|active staff identity|Visit test was not found|Completed test results are locked|Approved or published visit results are locked|Cancelled test results cannot be changed|idempotency key reused|Authentication required/i);
      if (!Array.isArray(data) || !data.length) throw new Error('Server did not confirm the saved draft results.');
      const serverRows=await db().from('test_results')
        .select('id,tenant_id,visit_test_id,parameter_code,parameter_name_snapshot,value_numeric,value_text,unit_snapshot,reference_range_snapshot,flag,entered_at')
        .eq('tenant_id',operation.tenant_id).eq('visit_test_id',visitTestId);
      if(serverRows.error)throw serverRows.error;
      await offlineDb.test_results.where('visit_test_id').equals(p.visit_test_id).delete();
      await cacheRows('test_results',(serverRows.data||[]).map(row=>({...row,branch_id:operation.branch_id})));
      return { acknowledged: true, resultId: operation.operation_id };
    },
    catalog_change: async operation => {
      const p = operation.payload || {};
      if (!['test','parameter'].includes(p.kind) || !['create','update'].includes(p.action) || !p.record_id || !p.record_payload) {
        return { conflict: true, reason: 'بيانات تعديل الكتالوج المحلي غير مكتملة؛ احتفظنا بالعملية للمراجعة.' };
      }
      const { data: existing, error: existingError } = await db().from('sync_conflicts')
        .select('id,resolution,local_payload,server_payload').eq('id', operation.operation_id)
        .eq('tenant_id', operation.tenant_id).eq('branch_id', operation.branch_id).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.resolution === 'approved') {
        const approvedTable = p.kind === 'test' ? 'tests_catalog' : 'test_parameters';
        const { data: approvedRecord, error: approvedError } = await db().from(approvedTable).select('*')
          .eq('tenant_id', operation.tenant_id).eq('id', p.record_id).maybeSingle();
        if (approvedError) throw approvedError;
        if (!approvedRecord) throw new Error('تم اعتماد تعديل الكتالوج لكن السجل غير موجود عند إعادة المزامنة.');
        await cacheRows(p.kind === 'test' ? 'catalog' : 'test_parameters', [approvedRecord]);
        return { acknowledged: true, resultId: p.record_id };
      }
      if (existing?.resolution === 'rejected') return { conflict: true, reason: 'تم رفض تعديل الكتالوج من المسؤول؛ احتفظنا بالنسخة المحلية للمراجعة.' };
      if (existing) return { conflict: true, reason: 'تعديل الكتالوج محفوظ في قائمة مراجعة الأجهزة؛ ينتظر قرار المسؤول.', serverSnapshot: existing.server_payload };
      const table = p.kind === 'test' ? 'tests_catalog' : 'test_parameters';
      const currentResult = await db().from(table).select('*').eq('tenant_id', operation.tenant_id).eq('id', p.record_id).maybeSingle();
      if (currentResult.error) throw currentResult.error;
      const localPayload = { ...p };
      const device = await getDeviceIdentity();
      localPayload.device_id = device.device_id;
      // A later edit on the same device is ordered behind the earlier local edit.
      // Once its dependency is acknowledged, the new proposal is based on the now-current server version.
      if (p.base_snapshot?.local_pending && currentResult.data) {
        localPayload.base_updated_at = currentResult.data.updated_at;
        localPayload.base_snapshot = currentResult.data;
      }
      const proposal = await db().from('sync_conflicts').insert({
        id: operation.operation_id, tenant_id: operation.tenant_id, branch_id: operation.branch_id,
        operation_id: operation.operation_id,
        entity_type: p.kind === 'test' ? 'catalog_test_change' : 'catalog_parameter_change',
        entity_id: p.record_id, local_payload: localPayload,
        server_payload: currentResult.data || {},
      }).select('id').single();
      if (proposal.error) {
        if (proposal.error.code === '23505') {
          const retry = await db().from('sync_conflicts').select('resolution,server_payload').eq('id', operation.operation_id)
            .eq('tenant_id', operation.tenant_id).eq('branch_id', operation.branch_id).maybeSingle();
          if (retry.error) throw retry.error;
          if (retry.data?.resolution === 'approved') return { acknowledged: true, resultId: p.record_id };
          if (retry.data) return { conflict: true, reason: 'تعديل الكتالوج محفوظ وينتظر المراجعة.', serverSnapshot: retry.data.server_payload };
        }
        throw proposal.error;
      }
      return { conflict: true, reason: 'تم رفع تعديل الكتالوج من هذا الجهاز إلى قائمة المراجعة. لن يغيّر السجل السحابي قبل اعتماد المسؤول.', serverSnapshot: currentResult.data || {} };
    },
    patients: async operation => {
      const p = operation.payload;
      const { data, error } = await db().from('patients').upsert({
        id: p.id, tenant_id: operation.tenant_id, branch_id: operation.branch_id,
        patient_number: p.patient_number ?? null, full_name: p.full_name,
        phone: p.phone ?? null, age_years: p.age_years ?? null,
        age_value: p.age_value ?? null, age_unit: p.age_unit ?? 'years',
        sex: p.sex ?? 'unknown', created_by_staff_id: p.created_by_staff_id ?? null,
      }, { onConflict: 'id', ignoreDuplicates: true }).select('id,tenant_id,branch_id').maybeSingle();
      if (error) throw error;
      if (data && data.tenant_id === operation.tenant_id && data.branch_id === operation.branch_id) return { acknowledged: true, resultId: data.id };
      const existing = await db().from('patients').select('id,tenant_id,branch_id,full_name,patient_number,phone,age_years,age_value,age_unit,sex,created_by_staff_id').eq('id', p.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data || existing.data.tenant_id !== operation.tenant_id || existing.data.branch_id !== operation.branch_id
          || existing.data.full_name !== p.full_name
          || (existing.data.patient_number ?? null) !== (p.patient_number ?? null)
          || (existing.data.phone ?? null) !== (p.phone ?? null)
          || (existing.data.age_years ?? null) !== (p.age_years ?? null)
          || (existing.data.age_value ?? null) !== (p.age_value ?? null)
          || (existing.data.age_unit ?? 'years') !== (p.age_unit ?? 'years')
          || (existing.data.sex ?? 'unknown') !== (p.sex ?? 'unknown')
          || (existing.data.created_by_staff_id ?? null) !== (p.created_by_staff_id ?? null)) {
        return {
          conflict: true,
          reason: 'Patient ID exists with different or inaccessible data.',
          serverSnapshot: existing.data ?? null,
        };
      }
      return { acknowledged: true, resultId: p.id };
    },
    visit_intake: async operation => {
      const p = operation.payload;
      const expectedPrices = await Promise.all((p.expected_prices || []).map(async snapshot => {
        if (snapshot.price_id) return snapshot;
        if (Number(snapshot.selling_price) !== 0) return snapshot;
        const { data: candidates, error: priceError } = await db().from('test_prices')
          .select('id,branch_id,selling_price').eq('tenant_id', operation.tenant_id)
          .eq('test_id', snapshot.test_id).eq('is_current', true);
        if (priceError) throw priceError;
        const current = (candidates || []).find(row => row.branch_id === operation.branch_id)
          || (candidates || []).find(row => row.branch_id == null);
        // Keep the local zero-price snapshot. If the server price changed, the RPC
        // returns OFFLINE_PRICE_CONFLICT instead of silently charging a new amount.
        return current ? { ...snapshot, price_id: current.id } : snapshot;
      }));
      const { data, error } = await db().rpc('create_visit_intake_idempotent', {
        p_operation_id: operation.operation_id,
        p_tenant_id: operation.tenant_id, p_branch_id: operation.branch_id,
        p_patient_id: p.patient_id, p_visit_number: p.visit_number,
        p_staff_id: p.staff_id, p_test_ids: p.test_ids,
        p_discount_amount: p.discount_amount ?? 0, p_initial_payment: p.initial_payment ?? 0,
        p_payment_method: p.payment_method ?? 'cash', p_referred_by: p.referred_by ?? null,
        p_notes: p.notes ?? null, p_expected_prices: expectedPrices,
      });
      if (error) return throwUnlessConflict(error, /OFFLINE_PRICE_CONFLICT|open the branch workday|registering visits|active staff|patient not found|valid visit number|select at least one test|invalid test selection|duplicate test selection|discount exceeds|payment exceeds|unsupported payment method|idempotency key reused|branch not accessible/i);
      if (!data) throw new Error('Server returned no visit ID.');
      const { data: serverTests, error: testsError } = await db().from('visit_tests')
        .select('id,tenant_id,branch_id,test_id,visit_id,status,test_code_snapshot,test_name_snapshot,technical_snapshot,created_at,tests_catalog(test_kind),visits!inner(visit_number,visit_work_date,status,is_published,workbench_hidden_at,patients!inner(full_name,patient_number,phone,age_years,sex))')
        .eq('tenant_id', operation.tenant_id).eq('branch_id', operation.branch_id).eq('visit_id', data);
      if (testsError) throw testsError;
      await cacheRows('visit_tests', serverTests || []);
      const localRows = Array.isArray(p.local_visit_test_ids) ? p.local_visit_test_ids : [];
      const mapping = {};
      for (const local of localRows) {
        const actual = (serverTests || []).find(row => row.test_id === local.test_id);
        if (!actual) throw new Error('Server visit was created, but a requested test mapping is missing; operation retained for safe recovery.');
        mapping[local.id] = actual.id;
      }
      await offlineDb.sync_meta.put({
        key: `visit-map:${operation.operation_id}`, tenant_id: operation.tenant_id,
        branch_id: operation.branch_id, local_visit_id: p.local_visit_id || null,
        server_visit_id: data, visit_test_ids: mapping, acknowledged_at: new Date().toISOString(),
      });
      // Remap dependent culture drafts before removing local visit/test aliases.
      for (const local of localRows) {
        const serverTestId = mapping[local.id];
        if (serverTestId) await offlineDb.culture_isolates.where('visit_test_id').equals(local.id).modify({ visit_test_id: serverTestId });
      }
      // The full server worklist rows were cached above; local aliases can now be removed safely.
      if (p.local_visit_id) await offlineDb.visits.delete(p.local_visit_id);
      for (const local of localRows) await offlineDb.visit_tests.delete(local.id);
      await removeLocalLedgerRow(p.local_ledger_id);
      return { acknowledged: true, resultId: data };
    },
    report_delivery: async operation => {
      const p=operation.payload;
      const session=await getCurrentSession();
      if(!session?.user?.id||session.user.id!==p.actor_user_id){
        return {conflict:true,reason:'The original staff user must sign in again before this delivery event can synchronize.'};
      }
      let visitId=p.visit_id;
      if(p.local_visit_pending){
        let mapping=null;
        for(const dependency of operation.depends_on||[]){
          const candidate=await offlineDb.sync_meta.get(`visit-map:${dependency}`);
          if(candidate?.local_visit_id===visitId){mapping=candidate;break;}
        }
        if(!mapping){
          const maps=await offlineDb.sync_meta.toArray();
          mapping=maps.find(row=>row.tenant_id===operation.tenant_id&&row.branch_id===operation.branch_id&&row.local_visit_id===visitId&&row.server_visit_id);
        }
        if(!mapping?.server_visit_id)throw new Error('Delivery status is waiting for its local visit to synchronize.');
        visitId=mapping.server_visit_id;
      }
      const {data,error}=await db().functions.invoke('record-local-delivery',{body:{
        ...p,visit_id:visitId,operation_id:operation.operation_id,
        tenant_id:operation.tenant_id,branch_id:operation.branch_id,
      }});
      if(error){
        const status=error.context?.status;
        if(Number.isInteger(status)&&status>=400&&status<500)return {conflict:true,reason:error.message||'The server rejected the delivery event.'};
        throw error;
      }
      const localKey=`delivery:${operation.tenant_id}:${operation.branch_id}:${p.local_visit_id||p.visit_id}`;
      const key=`delivery:${operation.tenant_id}:${operation.branch_id}:${visitId}`;
      const existing=await offlineDb.sync_meta.get(localKey);
      await offlineDb.sync_meta.put({...existing,key,tenant_id:operation.tenant_id,branch_id:operation.branch_id,
        visit_id,operation_id:operation.operation_id,delivery_status:'synced',
        delivery_method:p.delivery_method,delivered_at:p.delivered_at,staff_id:p.staff_id,
        server_event_id:data?.event_id||operation.operation_id,copy_type:data?.copy_type||null});
      if(localKey!==key)await offlineDb.sync_meta.delete(localKey);
      const localVisit=await offlineDb.visits.get(p.local_visit_id||p.visit_id);
      if(localVisit)await offlineDb.visits.put({...localVisit,local_delivery_status:'synced',local_delivery_method:p.delivery_method,local_delivery_at:p.delivered_at});
      return {acknowledged:true,resultId:data?.event_id||operation.operation_id};
    },
    visit_approval: async operation => {
      const p=operation.payload;
      const session=await getCurrentSession();
      if(!session?.user?.id||session.user.id!==p.actor_user_id){
        const reason='The original approving user must sign in again before this local approval can synchronize.';
        await setApprovalMarker(operation,'conflict',null,reason);
        return {conflict:true,reason};
      }
      let visitId=p.visit_id;
      if(p.local_visit_pending){
        let mapping=null;
        for(const dependency of operation.depends_on||[]){
          const candidate=await offlineDb.sync_meta.get(`visit-map:${dependency}`);
          if(candidate?.local_visit_id===visitId){mapping=candidate;break;}
        }
        if(!mapping){
          const maps=await offlineDb.sync_meta.toArray();
          mapping=maps.find(row=>row.tenant_id===operation.tenant_id&&row.branch_id===operation.branch_id&&row.local_visit_id===visitId&&row.server_visit_id);
        }
        if(!mapping?.server_visit_id)throw new Error('Local approval is waiting for its visit to synchronize.');
        visitId=mapping.server_visit_id;
      }
      const visitResult=await db().from('visits')
        .select('id,tenant_id,branch_id,status,is_published,approved_by_staff_id,approved_at')
        .eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id).eq('id',visitId).maybeSingle();
      if(visitResult.error)throw visitResult.error;
      if(!visitResult.data){
        const reason='The visit was not found in the selected tenant and branch.';
        await setApprovalMarker(operation,'conflict',visitId,reason);
        return {conflict:true,reason};
      }
      if(visitResult.data.status==='approved'){
        if(visitResult.data.approved_by_staff_id!==p.staff_id){
          const reason='The visit was approved by another staff member after the local approval was recorded.';
          await setApprovalMarker(operation,'conflict',visitId,reason);
          return {conflict:true,reason};
        }
        await setApprovalMarker(operation,'synced',visitId);
        await cacheRows('visits',[{...visitResult.data,local_approval_status:'synced'}]);
        return {acknowledged:true,resultId:visitId};
      }
      if(visitResult.data.is_published){
        const reason='This visit is already published and cannot be approved again.';
        await setApprovalMarker(operation,'conflict',visitId,reason);
        return {conflict:true,reason};
      }
      if(visitResult.data.status==='cancelled'){
        const reason='A cancelled visit cannot be approved.';
        await setApprovalMarker(operation,'conflict',visitId,reason);
        return {conflict:true,reason};
      }
      const visitTestsResult=await db().from('visit_tests')
        .select('id,test_id,test_code_snapshot,test_name_snapshot')
        .eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id).eq('visit_id',visitId).neq('status','cancelled');
      if(visitTestsResult.error)throw visitTestsResult.error;
      const visitTests=visitTestsResult.data||[];
      const ids=visitTests.map(row=>row.id);
      const localTestIds=new Set(ids);
      const visitMappings=await offlineDb.sync_meta.toArray();
      const visitMapping=visitMappings.find(row=>row.tenant_id===operation.tenant_id&&row.branch_id===operation.branch_id&&row.server_visit_id===visitId);
      for(const localTestId of Object.keys(visitMapping?.visit_test_ids||{}))localTestIds.add(localTestId);
      const newerDrafts=(await offlineDb.outbox.where('[tenant_id+branch_id]').equals([operation.tenant_id,operation.branch_id]).toArray())
        .filter(row=>row.operation_id!==operation.operation_id&&row.entity_type==='draft_results'&&localTestIds.has(row.payload?.visit_test_id));
      if(newerDrafts.some(row=>row.status==='conflict')){
        const reason='A newer result draft has a synchronization conflict. Resolve it and record a fresh local approval.';
        await setApprovalMarker(operation,'conflict',visitId,reason);
        return {conflict:true,reason};
      }
      if(newerDrafts.length)throw new Error('Local approval is waiting for newer result drafts to synchronize before server validation.');
      let results=[];
      if(ids.length){
        const resultsResult=await db().from('test_results')
          .select('id,visit_test_id,parameter_code,value_numeric,value_text,flag,entered_at')
          .eq('tenant_id',operation.tenant_id).in('visit_test_id',ids);
        if(resultsResult.error)throw resultsResult.error;
        results=resultsResult.data||[];
      }
      const serverFingerprint=await fingerprintVisitResults({visitTests,results});
      if(serverFingerprint!==p.result_fingerprint){
        const reason='Clinical results changed after the local approval was recorded. Review the current server results before approving again.';
        await setApprovalMarker(operation,'conflict',visitId,reason);
        return {conflict:true,reason,serverSnapshot:{result_fingerprint:serverFingerprint,tests:visitTests.length,results:results.length}};
      }
      const {data,error}=await db().rpc('approve_visit_with_auto_completion',{
        p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,
        p_visit_id:visitId,p_staff_id:p.staff_id,
      });
      if(error){
        if(/visit is already approved/i.test(error.message||'')){
          const retryVisit=await db().from('visits')
            .select('id,tenant_id,branch_id,status,is_published,approved_by_staff_id,approved_at')
            .eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id).eq('id',visitId).maybeSingle();
          if(retryVisit.error)throw retryVisit.error;
          if(retryVisit.data?.status==='approved'&&retryVisit.data.approved_by_staff_id===p.staff_id){
            await setApprovalMarker(operation,'synced',visitId);
            await cacheRows('visits',[{...retryVisit.data,local_approval_status:'synced'}]);
            return {acknowledged:true,resultId:visitId};
          }
          const reason='The visit was approved by a different actor before this local approval synchronized.';
          await setApprovalMarker(operation,'conflict',visitId,reason);
          return {conflict:true,reason};
        }
        const result=throwUnlessConflict(error,/required results are missing|every requested test must be completed|results? are missing|cancelled visit|published visit|visit not found|branch access denied|active staff identity|an active staff identity/i);
        if(result?.conflict)await setApprovalMarker(operation,'conflict',visitId,result.reason||'The server rejected local approval.');
        return result;
      }
      const approvedResult=await db().from('visits')
        .select('id,tenant_id,branch_id,status,is_published,approved_by_staff_id,approved_at')
        .eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id).eq('id',visitId).single();
      if(approvedResult.error)throw approvedResult.error;
      await setApprovalMarker(operation,'synced',visitId);
      await cacheRows('visits',[{...approvedResult.data,local_approval_status:'synced'}]);
      return {acknowledged:true,resultId:approvedResult.data.id||visitId};
    },
    workday_open: async operation => {
      const p=operation.payload;
      let {data,error}=await db().rpc('open_branch_workday',{
        p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,
        p_work_date:p.work_date,p_staff_id:p.staff_id,
      });
      if(error){
        const existing=await getServerWorkday(operation.tenant_id,operation.branch_id,p.work_date);
        if(existing.error)throw error;
        if(!existing.data)throw error;
        data=existing.data.id;
      }
      const current=await getServerWorkday(operation.tenant_id,operation.branch_id,p.work_date);
      if(current.error)throw current.error;
      if(!current.data)throw new Error('Server did not confirm the opened workday.');
      await cacheRows('workdays',[current.data]);
      if(p.local_workday_id)await offlineDb.workdays.delete(p.local_workday_id);
      return {acknowledged:true,resultId:current.data.id||data};
    },
    workday_close: async operation => {
      const p=operation.payload;
      const {data,error}=await db().rpc('close_branch_workday',{
        p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,
        p_work_date:p.work_date,p_staff_id:p.staff_id,
      });
      const existing=await db().from('daily_closings')
        .select('id,tenant_id,branch_id,work_date,closing_snapshot,closed_at,status')
        .eq('tenant_id',operation.tenant_id).eq('branch_id',operation.branch_id)
        .eq('work_date',p.work_date).maybeSingle();
      if(existing.error)throw error||existing.error;
      if(!existing.data) {
        if(error)throw error;
        throw new Error('The close RPC returned without a confirmed daily closing row.');
      }
      if(!sameClosingSnapshot(existing.data.closing_snapshot,p.expected_snapshot)) {
        return {conflict:true,reason:'The server closing snapshot differs from the locally confirmed cash summary.',serverSnapshot:existing.data.closing_snapshot};
      }
      await cacheRows('daily_closings',[existing.data]);
      if(p.local_closing_id)await offlineDb.daily_closings.delete(p.local_closing_id);
      if(p.local_workday_id)await offlineDb.workdays.delete(p.local_workday_id);
      return {acknowledged:true,resultId:existing.data.id||data};
    },
    payment: async operation => {
      const p = operation.payload;
      let visitId=p.visit_id;
      if(p.local_visit_pending){
        let mapping=null;
        for(const dependency of operation.depends_on||[]){
          const candidate=await offlineDb.sync_meta.get(`visit-map:${dependency}`);
          if(candidate?.local_visit_id===visitId){mapping=candidate;break;}
        }
        if(!mapping){
          const maps=await offlineDb.sync_meta.toArray();
          mapping=maps.find(row=>row.tenant_id===operation.tenant_id&&row.branch_id===operation.branch_id&&row.local_visit_id===visitId&&row.server_visit_id);
        }
        if(!mapping?.server_visit_id)throw new Error('Payment is waiting for its locally created visit to synchronize.');
        visitId=mapping.server_visit_id;
      }
      const { data, error } = await db().rpc('record_patient_payment', {
        p_tenant_id: operation.tenant_id, p_visit_id: visitId,
        p_amount: p.amount, p_payment_method: p.payment_method ?? 'cash',
        p_idempotency_key: operation.operation_id, p_staff_id: p.staff_id,
        p_notes: p.notes ?? null,
      });
      if (error) return throwUnlessConflict(error, /open the (?:collecting )?branch workday|workday.*open|remaining balance|active staff|invalid payment amount|visit not accessible|visit not found for this tenant|visit billing not found|idempotency key reused|payment collection branch is not accessible|branch not accessible/i);
      if (!data) throw new Error('Server returned no payment ID.');
      await removeLocalLedgerRow(p.local_ledger_id);
      return { acknowledged: true, resultId: data };
    },
    expense: async operation => {
      const p = operation.payload;
      const { data, error } = await db().rpc('record_branch_expense', {
        p_tenant_id: operation.tenant_id, p_branch_id: operation.branch_id,
        p_category_id: p.category_id, p_amount: p.amount,
        p_description: p.description ?? null,
        p_idempotency_key: operation.operation_id, p_staff_id: p.staff_id,
      });
      if (error) return throwUnlessConflict(error, /open the branch workday|workday.*open|active staff|expense category unavailable|invalid expense amount|idempotency key reused|branch not accessible/i);
      if (!data) throw new Error('Server returned no expense ID.');
      await removeLocalLedgerRow(p.local_ledger_id);
      return { acknowledged: true, resultId: data };
    },
  };
}
