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
    patients: async operation => {
      const p = operation.payload;
      const { data, error } = await db().from('patients').upsert({
        id: p.id, tenant_id: operation.tenant_id, branch_id: operation.branch_id,
        patient_number: p.patient_number ?? null, full_name: p.full_name,
        phone: p.phone ?? null, age_years: p.age_years ?? null,
        sex: p.sex ?? 'unknown', created_by_staff_id: p.created_by_staff_id ?? null,
      }, { onConflict: 'id', ignoreDuplicates: true }).select('id,tenant_id,branch_id').maybeSingle();
      if (error) throw error;
      if (data && data.tenant_id === operation.tenant_id && data.branch_id === operation.branch_id) return { acknowledged: true, resultId: data.id };
      const existing = await db().from('patients').select('id,tenant_id,branch_id,full_name,patient_number,phone,age_years,sex,created_by_staff_id').eq('id', p.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data || existing.data.tenant_id !== operation.tenant_id || existing.data.branch_id !== operation.branch_id
          || existing.data.full_name !== p.full_name
          || (existing.data.patient_number ?? null) !== (p.patient_number ?? null)
          || (existing.data.phone ?? null) !== (p.phone ?? null)
          || (existing.data.age_years ?? null) !== (p.age_years ?? null)
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
