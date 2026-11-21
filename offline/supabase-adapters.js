import { offlineDb } from './database.js';
import { getSupabaseClient } from '../core/supabase-client.js';

const db = () => getSupabaseClient();
const isBusinessConflict = (error, pattern) => pattern.test(String(error?.message || error || ''));
const throwUnlessConflict = (error, pattern) => {
  if (isBusinessConflict(error, pattern)) return { conflict: true, reason: String(error.message || error) };
  throw error;
};

/** Only operations backed by server-side idempotency RPCs are enabled here. */
export function createSupabaseSyncHandlers() {
  return {
    draft_results: async operation => {
      const p = operation.payload;
      let visitTestId = p.visit_test_id;
      for (const dependency of operation.depends_on || []) {
        const mapping = await offlineDb.sync_meta.get(`visit-map:${dependency}`);
        if (mapping?.visit_test_ids?.[visitTestId]) { visitTestId = mapping.visit_test_ids[visitTestId]; break; }
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
        .select('id,test_id,visit_id,tenant_id,branch_id,status,test_code_snapshot,test_name_snapshot,technical_snapshot,created_at')
        .eq('tenant_id', operation.tenant_id).eq('branch_id', operation.branch_id).eq('visit_id', data);
      if (testsError) throw testsError;
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
      if (p.local_visit_id) await offlineDb.visits.delete(p.local_visit_id);
      for (const local of localRows) await offlineDb.visit_tests.delete(local.id);
      return { acknowledged: true, resultId: data };
    },
    payment: async operation => {
      const p = operation.payload;
      const { data, error } = await db().rpc('record_patient_payment', {
        p_tenant_id: operation.tenant_id, p_visit_id: p.visit_id,
        p_amount: p.amount, p_payment_method: p.payment_method ?? 'cash',
        p_idempotency_key: operation.operation_id, p_staff_id: p.staff_id,
        p_notes: p.notes ?? null,
      });
      if (error) return throwUnlessConflict(error, /open the (?:collecting )?branch workday|workday.*open|remaining balance|active staff|invalid payment amount|visit not accessible|visit not found for this tenant|visit billing not found|idempotency key reused|payment collection branch is not accessible|branch not accessible/i);
      if (!data) throw new Error('Server returned no payment ID.');
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
      return { acknowledged: true, resultId: data };
    },
  };
}
