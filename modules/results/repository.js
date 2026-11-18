import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES } from '../../core/data/schema-contract.js';
const db = () => getSupabaseClient();

export async function listResults({ tenantId, visitTestId } = {}) {
  if (!tenantId || !visitTestId) throw new Error('tenantId and visitTestId are required.');
  const { data, error } = await db().from(TABLES.results)
    .select('id, parameter_code, parameter_name_snapshot, value_numeric, value_text, unit_snapshot, reference_range_snapshot, flag, entered_at')
    .eq('tenant_id', tenantId).eq('visit_test_id', visitTestId).order('entered_at');
  if (error) throw error;
  return data ?? [];
}

/** Draft-only batch save. Published visits must use the audited report-correction workflow. The database RPC commits every supplied parameter or none. */
export async function saveDraftResults({ tenantId, branchId, visitTestId, results, staffId } = {}) {
  if (!tenantId || !branchId || !visitTestId || !staffId || !Array.isArray(results) || !results.length) {
    throw new Error('tenantId, branchId, visitTestId, staffId and at least one result are required.');
  }
  const prepared = results.map(({ parameter, value, flag = null }) => {
    if (!parameter?.code) throw new Error('Every result must identify its parameter code.');
    const rawValue = value === null || value === undefined ? '' : String(value).trim();
    if (!rawValue) throw new Error('A result value is required.');
    const valueType = parameter.valueType ?? 'numeric';
    if (!['numeric', 'text', 'boolean', 'choice'].includes(valueType)) throw new Error('Unsupported result value type.');
    const isText = valueType !== 'numeric';
    const numeric = isText ? null : Number(rawValue);
    if (!isText && !Number.isFinite(numeric)) throw new Error('Numeric result is invalid.');
    if (valueType === 'boolean' && !['true', 'false'].includes(rawValue)) throw new Error('اختر نعم أو لا للنتيجة المنطقية.');
    if (valueType === 'choice' && (!Array.isArray(parameter.choices) || !parameter.choices.includes(rawValue))) throw new Error('اختر قيمة من القائمة المحددة لهذا البارامتر.');
    return { parameter_code: parameter.code, value_numeric: numeric, value_text: isText ? rawValue : null, flag };
  });
  if (new Set(prepared.map(item => item.parameter_code)).size !== prepared.length) {
    throw new Error('لا يمكن إرسال البارامتر نفسه أكثر من مرة في عملية الحفظ.');
  }
  const { data, error } = await db().rpc('save_draft_results_atomic', {
    p_tenant_id: tenantId, p_branch_id: branchId, p_visit_test_id: visitTestId,
    p_staff_id: staffId, p_results: prepared,
  });
  if (error) throw error;
  return data ?? [];
}

/** Compatibility wrapper for a single parameter; new UI code should use saveDraftResults. */
export async function saveDraftResult({ tenantId, branchId, visitTestId, parameter, value, staffId, flag = null } = {}) {
  return saveDraftResults({ tenantId, branchId, visitTestId, staffId, results: [{ parameter, value, flag }] });
}

export async function completeVisitTest({ tenantId, visitTestId } = {}) {
  if (!tenantId || !visitTestId) throw new Error('tenantId and visitTestId are required.');
  const { data: item, error: itemError } = await db().from(TABLES.visitTests)
    .select('id, technical_snapshot, visits!inner(is_published)')
    .eq('tenant_id', tenantId).eq('id', visitTestId).single();
  if (itemError) throw itemError;
  if (item.visits?.is_published) throw new Error('Published visit cannot be changed through the normal completion flow.');
  const requiredCodes = (item.technical_snapshot?.parameters ?? [])
    .filter(p => p.is_required !== false).map(p => p.code);
  const { data: results, error: resultError } = await db().from(TABLES.results)
    .select('parameter_code').eq('tenant_id', tenantId).eq('visit_test_id', visitTestId);
  if (resultError) throw resultError;
  const present = new Set((results ?? []).map(r => r.parameter_code));
  const missing = requiredCodes.filter(code => !present.has(code));
  if (missing.length) throw new Error(`Required results are missing: ${missing.join(', ')}`);
  const { data, error } = await db().from(TABLES.visitTests)
    .update({ status: 'completed' }).eq('tenant_id', tenantId).eq('id', visitTestId).select().single();
  if (error) throw error;
  return data;
}

export async function approveVisit({ tenantId, branchId, visitId, staffId } = {}) {
  if (!tenantId || !branchId || !visitId || !staffId) throw new Error('tenantId, branchId, visitId and staffId are required.');
  const { data: visit, error: visitError } = await db().from(TABLES.visits)
    .select('id, status, is_published').eq('tenant_id', tenantId).eq('branch_id', branchId).eq('id', visitId).single();
  if (visitError) throw visitError;
  if (visit.is_published) throw new Error('Published visit cannot be re-approved.');
  const { data: tests, error: testsError } = await db().from(TABLES.visitTests)
    .select('id, status').eq('tenant_id', tenantId).eq('branch_id', branchId).eq('visit_id', visitId).neq('status', 'cancelled');
  if (testsError) throw testsError;
  if (!tests?.length || tests.some(test => test.status !== 'completed')) {
    throw new Error('Every requested test must be completed before approval.');
  }
  const { data, error } = await db().from(TABLES.visits).update({
    status: 'approved', approved_by_staff_id: staffId, approved_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('branch_id', branchId).eq('id', visitId).select().single();
  if (error) throw error;
  return data;
}
