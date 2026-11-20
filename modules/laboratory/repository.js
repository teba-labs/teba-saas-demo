import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES } from '../../core/data/schema-contract.js';
const db = () => getSupabaseClient();

export async function listBranchWork({ tenantId, branchId } = {}) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required.');
  const { data, error } = await db().from(TABLES.visitTests)
    .select('id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, visits!inner(visit_number, visit_work_date, status, is_published, patients!inner(id, full_name, patient_number))')
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
  let query = db().from(TABLES.visitTests)
    .select('id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, tests_catalog(test_kind), visits!inner(visit_number, visit_work_date, status, is_published, patients!inner(full_name, patient_number, phone, age_years, sex))', { count: 'exact' })
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .neq('status', 'cancelled').neq('visits.status', 'cancelled').is('visits.workbench_hidden_at', null);
  const requestedVisitId = new URLSearchParams(globalThis.location?.search || '').get('visit_id');
  if (requestedVisitId) query = query.eq('visit_id', requestedVisitId);
  const { data, error, count } = await query.order('created_at').order('id').range(from, from + safeSize - 1);
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0, page: safePage, pageSize: safeSize };
}


/** Complete, branch-scoped test list for a single approved visit report. */
export async function listVisitWorkForReport({ tenantId, branchId, visitId } = {}) {
  if (!tenantId || !branchId || !visitId) throw new Error('tenantId, branchId and visitId are required.');
  const { data, error } = await db().from(TABLES.visitTests)
    .select('id, visit_id, test_id, test_code_snapshot, test_name_snapshot, technical_snapshot, status, created_at, tests_catalog(test_kind), visits!inner(visit_number, visit_work_date, status, is_published, patients!inner(full_name, patient_number, age_years, sex))')
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

/** Hidden visits remain in the database and can be restored by an authorized branch member. */
export async function listHiddenWorkbenchVisits({ tenantId, branchId, limit = 100 } = {}) {
  if (!tenantId || !branchId) throw new Error('tenantId and branchId are required.');
  const { data, error } = await db().from(TABLES.visits)
    .select('id, visit_number, visit_work_date, status, workbench_hidden_at, workbench_hidden_reason, patients!inner(full_name,patient_number)')
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .not('workbench_hidden_at', 'is', null)
    .order('workbench_hidden_at', { ascending: false }).limit(Math.min(200, Math.max(1, Number(limit) || 100)));
  if (error) throw error;
  return data ?? [];
}

export async function setVisitWorkbenchHidden({ tenantId, branchId, visitId, staffId, hidden, reason = '' } = {}) {
  if (!tenantId || !branchId || !visitId || !staffId || typeof hidden !== 'boolean') {
    throw new Error('tenantId, branchId, visitId, staffId and hidden are required.');
  }
  if (globalThis.navigator?.onLine === false) throw new Error('إخفاء الحالة أو استعادتها يحتاج اتصالًا بالإنترنت.');
  const { data, error } = await db().rpc('set_visit_workbench_hidden', {
    p_tenant_id: tenantId, p_branch_id: branchId, p_visit_id: visitId,
    p_staff_id: staffId, p_hidden: hidden, p_reason: String(reason || '').trim() || null,
  });
  if (error) throw error;
  return data;
}
