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


/** Server-side page for the active branch worklist; cancelled visits/tests are excluded. */
export async function listBranchWorkPage({ tenantId, branchId, page = 0, pageSize = 25 } = {}) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required.');
  const safePage = Math.max(0, Math.floor(Number(page) || 0));
  const safeSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 25)));
  const from = safePage * safeSize;
  const { data, error, count } = await db().from(TABLES.visitTests)
    .select('id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, visits!inner(visit_number, visit_work_date, status, is_published, patients!inner(full_name, patient_number))', { count: 'exact' })
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .neq('status', 'cancelled').neq('visits.status', 'cancelled')
    .order('created_at').order('id').range(from, from + safeSize - 1);
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0, page: safePage, pageSize: safeSize };
}


/** Complete, branch-scoped test list for a single approved visit report. */
export async function listVisitWorkForReport({ tenantId, branchId, visitId } = {}) {
  if (!tenantId || !branchId || !visitId) throw new Error('tenantId, branchId and visitId are required.');
  const { data, error } = await db().from(TABLES.visitTests)
    .select('id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, visits!inner(visit_number, visit_work_date, status, is_published, patients!inner(full_name, patient_number))')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('visit_id', visitId)
    .neq('status', 'cancelled').neq('visits.status', 'cancelled')
    .order('created_at').order('id');
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
