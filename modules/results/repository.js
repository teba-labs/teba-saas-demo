import { getSupabaseClient } from '../../core/supabase-client.js';
import { prepareResultInput } from './input-mode.js';
import { TABLES } from '../../core/data/schema-contract.js';
import { enqueueOperation } from '../../offline/outbox.js';
import { cacheRows, getCachedRows } from '../../offline/cache.js';
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
export async function saveDraftResults({ tenantId, branchId, visitTestId, results, staffId, dependsOn = [] } = {}) {
  if (!tenantId || !branchId || !visitTestId || !staffId || !Array.isArray(results) || !results.length) {
    throw new Error('tenantId, branchId, visitTestId, staffId and at least one result are required.');
  }
  const prepared = results.map(({ parameter, value, flag = null }) => {
    if (!parameter?.code) throw new Error('Every result must identify its parameter code.');
    return {
      parameter_code: parameter.code,
      ...prepareResultInput(parameter, value),
      flag,
    };
  });
  if (new Set(prepared.map(item => item.parameter_code)).size !== prepared.length) {
    throw new Error('لا يمكن إرسال البارامتر نفسه أكثر من مرة في عملية الحفظ.');
  }
  const operationId = crypto.randomUUID();
  const payload = { visit_test_id: visitTestId, staff_id: staffId, results: prepared };
  const queue = async () => {
    await enqueueOperation({ tenantId, branchId, entityType: 'draft_results', action: 'save', operationId, payload, dependsOn, priority: 3 });
    return { queued: true, operationId };
  };
  if (globalThis.navigator?.onLine === false) return queue();
  const { data, error } = await db().rpc('save_draft_results_idempotent', {
    p_operation_id: operationId, p_tenant_id: tenantId, p_branch_id: branchId,
    p_visit_test_id: visitTestId, p_staff_id: staffId, p_results: prepared,
  });
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return queue();
    throw error;
  }
  return data ?? [];

}

/** Compatibility wrapper for a single parameter; new UI code should use saveDraftResults. */
export async function saveDraftResult({ tenantId, branchId, visitTestId, parameter, value, staffId, flag = null } = {}) {
  return saveDraftResults({ tenantId, branchId, visitTestId, staffId, results: [{ parameter, value, flag }] });
}

export async function completeVisitTest({ tenantId, branchId, visitTestId, staffId } = {}) {
  if (!tenantId || !branchId || !visitTestId || !staffId) {
    throw new Error('tenantId, branchId, visitTestId and staffId are required.');
  }
  const { data, error } = await db().rpc('complete_visit_test_atomic', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_visit_test_id: visitTestId,
    p_staff_id: staffId,
  });
  if (error) throw error;
  return data;
}

export async function approveVisit({ tenantId, branchId, visitId, staffId } = {}) {
  if (!tenantId || !branchId || !visitId || !staffId) {
    throw new Error('tenantId, branchId, visitId and staffId are required.');
  }
  const { data, error } = await db().rpc('approve_visit_atomic', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_visit_id: visitId,
    p_staff_id: staffId,
  });
  if (error) throw error;
  return data;
}

/** Fetch all visible result values for the current worklist in one tenant-scoped query. */
export async function listResultsForVisitTests({ tenantId, visitTestIds } = {}) {
  if (!tenantId || !Array.isArray(visitTestIds)) throw new Error('tenantId and visitTestIds are required.');
  const ids = [...new Set(visitTestIds.filter(Boolean))];
  if (!ids.length) return [];
  if (globalThis.navigator?.onLine === false) {
    const cached = await getCachedRows('test_results', { tenantId });
    return cached.filter(row => ids.includes(row.visit_test_id));
  }
  const rows = [];
  // Chunk IDs and paginate each result set so large parameter panels never hit PostgREST's row cap.
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db().from(TABLES.results)
        .select('id, tenant_id, visit_test_id, parameter_code, parameter_name_snapshot, value_numeric, value_text, unit_snapshot, reference_range_snapshot, flag, entered_at')
        .eq('tenant_id', tenantId).in('visit_test_id', chunk)
        .order('entered_at').order('id').range(offset, offset + 499);
      if (error) {
        if (/fetch|network|offline/i.test(error.message || '')) {
          const cached = await getCachedRows('test_results', { tenantId });
          return cached.filter(row => ids.includes(row.visit_test_id));
        }
        throw error;
      }
      const page = data ?? [];
      const cachedTests = await getCachedRows('visit_tests', { tenantId });
      const branchByVisitTest = new Map(cachedTests.map(test => [test.id, test.branch_id]));
      rows.push(...page.map(row => ({ ...row, branch_id: branchByVisitTest.get(row.visit_test_id) ?? null })));
      if (page.length < 500) break;
    }
  }
  await cacheRows('test_results', rows);
  return rows;
}

/** Visit-only reference range overrides; the master catalog and frozen visit identity remain untouched. */
export async function listVisitParameterRangeOverrides({ tenantId, visitTestIds } = {}) {
  if (!tenantId || !Array.isArray(visitTestIds)) throw new Error('tenantId and visitTestIds are required.');
  const ids=[...new Set(visitTestIds.filter(Boolean))];if(!ids.length||globalThis.navigator?.onLine===false)return [];
  const rows=[];
  for(let start=0;start<ids.length;start+=100){
    const chunk=ids.slice(start,start+100);
    const {data,error}=await db().from('visit_test_parameter_range_overrides')
      .select('visit_test_id,parameter_code,reference_ranges,reason,updated_at')
      .eq('tenant_id',tenantId).in('visit_test_id',chunk);
    if(error)throw error;rows.push(...(data||[]));
  }
  return rows;
}
export async function saveVisitParameterRangeOverride({tenantId,branchId,visitTestId,parameterCode,referenceRanges,staffId,reason}={}) {
  if(!tenantId||!branchId||!visitTestId||!parameterCode||!staffId||!referenceRanges||!reason)throw new Error('بيانات تعديل المدى المرجعي غير مكتملة.');
  if(globalThis.navigator?.onLine===false)throw new Error('تعديل المدى المرجعي يحتاج اتصالًا بالإنترنت لحفظ أثر التعديل بأمان.');
  const {data,error}=await db().rpc('set_visit_parameter_range_override',{
    p_tenant_id:tenantId,p_branch_id:branchId,p_visit_test_id:visitTestId,
    p_parameter_code:parameterCode,p_reference_ranges:referenceRanges,p_staff_id:staffId,p_reason:reason,
  });
  if(error)throw error;return data;
}
