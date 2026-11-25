import { offlineDb } from './database.js';
import { cacheRows } from './cache.js';
import { getSupabaseClient } from '../core/supabase-client.js';

const db = () => getSupabaseClient();
async function removeLocalLedgerRow(id) {
  if (id) await offlineDb.financial_ledger.delete(id);
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
      await offlineDb.test_results.where('visit_test_id').equals(p.visit_test_id).delete();
      return { acknowledged: true, resultId: operation.operation_id };
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
      const { data, error } = await db().rpc('create_visit_intake_idempotent', {
        p_operation_id: operation.operation_id,
        p_tenant_id: operation.tenant_id, p_branch_id: operation.branch_id,
        p_patient_id: p.patient_id, p_visit_number: p.visit_number,
        p_staff_id: p.staff_id, p_test_ids: p.test_ids,
        p_discount_amount: p.discount_amount ?? 0, p_initial_payment: p.initial_payment ?? 0,
        p_payment_method: p.payment_method ?? 'cash', p_referred_by: p.referred_by ?? null,
        p_notes: p.notes ?? null, p_expected_prices: p.expected_prices ?? [],
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
    workday_open: async operation => {
      const p=operation.payload;
      let {data,error}=await db().rpc('open_branch_workday',{
        p_tenant_id:operation.tenant_id,p_branch_id:operation.branch_id,
        p_work_date:p.work_date,p_staff_id:p.staff_id,
      });
      if(error){
        const existing=await getServerWorkday(operation.tenant_id,operation.branch_id,p.work_date);
        if(existing.error)throw error;
        if(!existing.data||existing.data.opened_by_staff_id!==p.staff_id)throw error;
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
