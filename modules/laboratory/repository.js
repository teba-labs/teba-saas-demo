import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES } from '../../core/data/schema-contract.js';
const db = () => getSupabaseClient();

export async function listBranchWork({ tenantId, branchId } = {}) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required.');
  const { data, error } = await db().from(TABLES.visitTests)
    .select('id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, visits!inner(visit_number, visit_work_date, status, is_published, patients!inner(full_name, patient_number))')
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .neq('status', 'cancelled').order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function setVisitTestStatus({ tenantId, branchId, visitTestId, status } = {}) {
  if (!tenantId || !branchId || !visitTestId) throw new Error('tenantId, branchId and visitTestId are required.');
  if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) throw new Error('Unsupported visit-test status.');
  const { data, error } = await db().from(TABLES.visitTests)
    .update({ status }).eq('tenant_id', tenantId).eq('branch_id', branchId).eq('id', visitTestId)
    .select().single();
  if (error) throw error;
  return data;
}
