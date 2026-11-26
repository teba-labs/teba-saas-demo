import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES, RPC } from '../../core/data/schema-contract.js';
import { cacheRows, getCachedRows, replaceCachedRows, replaceCachedCurrentPrices } from '../../offline/cache.js';
import { enqueueOperation } from '../../offline/outbox.js';

const db = () => getSupabaseClient();


async function mergePendingCatalogCache(tableName, serverRows, { tenantId, testId = null, branchId = null } = {}) {
  const cached = await getCachedRows(tableName, { tenantId, ...(testId ? { testId } : {}) });
  const byId = new Map((serverRows || []).map(row => [row.id, row]));
  for (const row of cached) if (row.local_pending) byId.set(row.id, row);
  const merged = [...byId.values()];
  return { all: merged, visible: branchId ? merged.filter(row => !row.local_pending || row.local_branch_id === branchId) : merged };
}

async function queueCatalogChange({ tenantId, branchId, kind, action, recordId, baseSnapshot, recordPayload, dependsOn = [] }) {
  required(branchId, 'branchId');
  const operationId = crypto.randomUUID();
  const cleanRecord = { ...recordPayload };
  for (const key of ['local_pending','local_operation_id','local_branch_id','local_base_updated_at','cached_at']) delete cleanRecord[key];
  const dependencies = [...new Set([...dependsOn, ...(baseSnapshot?.local_operation_id ? [baseSnapshot.local_operation_id] : [])])];
  const payload = { kind, action, record_id: recordId, base_updated_at: baseSnapshot?.local_base_updated_at ?? baseSnapshot?.updated_at ?? null, base_snapshot: baseSnapshot ?? null, record_payload: cleanRecord };
  await enqueueOperation({ tenantId, branchId, entityType: 'catalog_change', action, operationId, payload, dependsOn: dependencies, priority: 4 });
  const localRow = { ...cleanRecord, local_pending: true, local_operation_id: operationId, local_branch_id: branchId, local_base_updated_at: payload.base_updated_at, updated_at: new Date().toISOString() };
  await cacheRows(kind === 'test' ? 'catalog' : 'test_parameters', [localRow]);
  return { ...localRow, queued: true, operationId };
}
const required = (value, name) => { if (!value) throw new Error(`${name} is required.`); };

export async function ensureTenantCoreCatalog(tenantId) {
  required(tenantId, 'tenantId');
  if (globalThis.navigator?.onLine === false) return { installed_count: 0, skipped: true };
  const { data, error } = await db().rpc('ensure_tenant_core_catalog', { p_tenant_id: tenantId });
  if (error && /PGRST202|could not find the function|schema cache/i.test(error.message || '')) {
    return { installed_count: 0, available_count: 0, unavailable: true };
  }
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || { installed_count: 0 }) : (data || { installed_count: 0 });
}

export async function listCatalog({ tenantId, branchId = null, includeInactive = false } = {}) {
  required(tenantId, 'tenantId');
  // Provision the reviewed Core library before listing tenant tests. This RPC is
  // idempotent and only inserts missing definitions; it never overwrites tenant edits.
  await ensureTenantCoreCatalog(tenantId);
  let query = db().from(TABLES.catalog)
    .select('id, tenant_id, code, name, test_kind, category, specimen, method, turnaround_minutes, instructions, is_active, updated_at, short_name, synonyms, loinc_code, clinical_category, clinical_purpose, service_type, patient_preparation, collection_requirements, specimen_requirements, transport_requirements, stability_requirements, rejection_criteria, biosafety_notes, critical_result_policy, reporting_notes, source_references, clinical_review_status, catalog_version')
    .eq('tenant_id', tenantId).order('name');
  if (globalThis.navigator?.onLine === false) { const cached = await getCachedRows('catalog', { tenantId }); return cached.filter(row => (!row.local_pending || !branchId || row.local_branch_id === branchId) && (includeInactive || row.is_active)); }
  const { data, error } = await query;
  if (error) { if (/fetch|network|offline/i.test(error.message || '')) { const cached = await getCachedRows('catalog', { tenantId }); return cached.filter(row => (!row.local_pending || !branchId || row.local_branch_id === branchId) && (includeInactive || row.is_active)); } throw error; }
  const merged = await mergePendingCatalogCache('catalog', data ?? [], { tenantId, branchId });
  await replaceCachedRows('catalog', merged.all, { tenantId });
  return merged.visible.filter(row => includeInactive || row.is_active);
}

export async function listCurrentPrices({ tenantId, branchId = null, testIds } = {}) {
  required(tenantId, 'tenantId');
  if (!Array.isArray(testIds) || testIds.length === 0) return [];
  const selectEffective = rows => {
    const applicable = rows.filter(row => row.is_current && testIds.includes(row.test_id)
      && (!branchId || row.branch_id == null || row.branch_id === branchId));
    if (!branchId) return applicable;
    const byTest = new Map();
    for (const row of applicable.sort((a,b) => Number(b.branch_id === branchId) - Number(a.branch_id === branchId))) {
      if (!byTest.has(row.test_id)) byTest.set(row.test_id, row);
    }
    return [...byTest.values()];
  };
  if (globalThis.navigator?.onLine === false) {
    return selectEffective(await getCachedRows('test_prices', { tenantId }));
  }
  let priceQuery = db().from(TABLES.prices)
    .select('id, tenant_id, test_id, branch_id, selling_price, effective_from, is_current')
    .eq('tenant_id', tenantId).eq('is_current', true).in('test_id', testIds);
  if (branchId) priceQuery = priceQuery.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  const { data, error } = await priceQuery;
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '')) {
      return selectEffective(await getCachedRows('test_prices', { tenantId }));
    }
    throw error;
  }
  // Cache base and branch overrides without deleting another branch's current price.
  await replaceCachedCurrentPrices(data ?? [], { tenantId, testIds, branchId });
  return selectEffective(data ?? []);
}

/** Warm all active test parameter snapshots before a branch goes offline. */
export async function warmCatalogParameters({ tenantId, branchId = null, testIds = [] } = {}) {
  required(tenantId, 'tenantId');
  const ids = [...new Set(testIds.filter(Boolean))];
  if (!ids.length || globalThis.navigator?.onLine === false) return 0;
  const rows = [];
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db().from(TABLES.parameters)
        .select('id, tenant_id, test_id, parameter_code, parameter_name, unit, value_type, decimal_places, reference_ranges, choices, display_order, is_required, is_active, result_source, formula, unit_ucum, alternate_units, critical_ranges, interpretation_rules, applicability, method_notes, clinical_metadata, source_references, clinical_review_status, reference_interval_status, result_input_mode, result_config, display_rules, formula_expression, created_at, updated_at')
        .eq('tenant_id', tenantId).in('test_id', chunk)
        .order('test_id').order('display_order').range(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 500) break;
    }
  }
  const merged = await mergePendingCatalogCache('test_parameters', rows, { tenantId, branchId });
  await cacheRows('test_parameters', merged.all);
  return rows.length;
}

export async function listTestParameters({ tenantId, branchId = null, testId, includeInactive = false } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('test_parameters', { tenantId, testId })).filter(row => (!row.local_pending || !branchId || row.local_branch_id === branchId) && (includeInactive || row.is_active)).sort((a,b) => a.display_order-b.display_order);
  let query = db().from(TABLES.parameters)
    .select('id, tenant_id, test_id, parameter_code, parameter_name, unit, value_type, decimal_places, reference_ranges, choices, display_order, is_required, is_active, result_source, formula, unit_ucum, alternate_units, critical_ranges, interpretation_rules, applicability, method_notes, clinical_metadata, source_references, clinical_review_status, reference_interval_status, result_input_mode, result_config, display_rules, formula_expression, created_at, updated_at')
    .eq('tenant_id', tenantId).eq('test_id', testId)
    .order('display_order');
  const { data, error } = await query;
  if (error) { if (/fetch|network|offline/i.test(error.message || '')) return (await getCachedRows('test_parameters', { tenantId, testId })).filter(row => (!row.local_pending || !branchId || row.local_branch_id === branchId) && (includeInactive || row.is_active)).sort((a,b) => a.display_order-b.display_order); throw error; }
  const merged = await mergePendingCatalogCache('test_parameters', data ?? [], { tenantId, testId, branchId });
  await replaceCachedRows('test_parameters', merged.all, { tenantId, testId });
  return merged.visible.filter(row => includeInactive || row.is_active);
}

export async function saveCatalogTest({ tenantId, branchId, test, id, initialParameter } = {}) {
  required(tenantId, 'tenantId');
  const code = String(test?.code ?? '').trim();
  const name = String(test?.name ?? '').trim();
  required(code, 'test.code'); required(name, 'test.name');
  if (code.length > 40) throw new Error('Test code must be 40 characters or fewer.');
  if (name.length > 160) throw new Error('Test name must be 160 characters or fewer.');
  const turnaround = test.turnaroundMinutes == null || test.turnaroundMinutes === '' ? null : Number(test.turnaroundMinutes);
  if (turnaround !== null && (!Number.isInteger(turnaround) || turnaround < 0 || turnaround > 10080)) {
    throw new Error('turnaroundMinutes must be a whole number from 0 to 10080.');
  }
  const testKind = test?.testKind ?? 'individual';
  if (!['individual', 'panel', 'group'].includes(testKind)) throw new Error('testKind must be individual, panel, or group.');
  const recordId = id || crypto.randomUUID();
  const payload = {
    id: recordId, tenant_id: tenantId, code, name, test_kind: testKind,
    category: test.category?.trim() || null, specimen: test.specimen?.trim() || null,
    method: test.method?.trim() || null, turnaround_minutes: turnaround,
    instructions: test.instructions?.trim() || null, is_active: test.isActive !== false,
    short_name: test.shortName?.trim() || null, synonyms: test.synonyms ?? [], loinc_code: test.loincCode?.trim() || null,
    clinical_category: test.clinicalCategory?.trim() || null, clinical_purpose: test.clinicalPurpose?.trim() || null,
    service_type: test.serviceType || 'laboratory_test', patient_preparation: test.patientPreparation ?? {},
    collection_requirements: test.collectionRequirements ?? {}, specimen_requirements: test.specimenRequirements ?? {},
    transport_requirements: test.transportRequirements ?? {}, stability_requirements: test.stabilityRequirements ?? {},
    rejection_criteria: test.rejectionCriteria ?? [], biosafety_notes: test.biosafetyNotes?.trim() || null,
    critical_result_policy: test.criticalResultPolicy ?? {}, reporting_notes: test.reportingNotes?.trim() || null,
    source_references: test.sourceReferences ?? [], clinical_review_status: test.clinicalReviewStatus || 'needs_review',
  };
  const cached = (await getCachedRows('catalog', { tenantId })).find(row => row.id === recordId) || null;
  if (globalThis.navigator?.onLine === false) return queueCatalogChange({ tenantId, branchId, kind: 'test', action: cached ? 'update' : 'create', recordId, baseSnapshot: cached, recordPayload: payload, dependsOn: cached?.local_operation_id ? [cached.local_operation_id] : [] });
  if (!id && initialParameter) {
    const parameterPayload = buildParameterPayload({ tenantId, testId: recordId, parameter: initialParameter });
    const { data: created, error: createError } = await db().rpc(RPC.createCatalogTestWithDefaultParameter, {
      p_tenant_id: tenantId, p_test: payload, p_parameter: parameterPayload,
    });
    if (createError) {
      if (/fetch|network|offline/i.test(createError.message || '') || globalThis.navigator?.onLine === false) {
        return queueCatalogChange({ tenantId, branchId, kind: 'test', action: 'create', recordId, baseSnapshot: null, recordPayload: payload });
      }
      throw createError;
    }
    const savedTest = created?.test;
    const savedParameter = created?.parameter;
    if (!savedTest?.id || savedTest.id !== recordId || !savedParameter?.id || savedParameter.test_id !== recordId) {
      throw new Error('لم يرجع الخادم التحليل والبارامتر الأول بعد الحفظ الذري.');
    }
    await cacheRows('catalog', [savedTest]);
    await cacheRows('test_parameters', [savedParameter]);
    return { ...savedTest, initialParameterSaved: true };
  }
  const { data, error } = await db().from(TABLES.catalog).upsert(payload).select().single();
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return queueCatalogChange({ tenantId, branchId, kind: 'test', action: cached ? 'update' : 'create', recordId, baseSnapshot: cached, recordPayload: payload });
    throw error;
  }
  await cacheRows('catalog', [data]);
  return data;
}

/** Deactivate instead of hard-deleting: historical visits retain their test reference and snapshots. */
export async function setCatalogTestActive({ tenantId, branchId, testId, isActive } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId');
  if (typeof isActive !== 'boolean') throw new Error('isActive must be a boolean.');
  const cached = (await getCachedRows('catalog', { tenantId })).find(row => row.id === testId) || null;
  if (globalThis.navigator?.onLine === false) {
    if (!cached) throw new Error('جهّز كتالوج الفرع أثناء الاتصال قبل إيقاف أو تفعيل تحليل دون إنترنت.');
    return queueCatalogChange({ tenantId, branchId, kind: 'test', action: 'update', recordId: testId, baseSnapshot: cached, recordPayload: { ...cached, is_active: isActive }, dependsOn: cached.local_operation_id ? [cached.local_operation_id] : [] });
  }
  const { data, error } = await db().from(TABLES.catalog)
    .update({ is_active: isActive }).eq('tenant_id', tenantId).eq('id', testId).select().single();
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) {
      if (!cached) throw new Error('لا توجد نسخة محلية من التحليل لإتمام التعديل دون اتصال.');
      return queueCatalogChange({ tenantId, branchId, kind: 'test', action: 'update', recordId: testId, baseSnapshot: cached, recordPayload: { ...cached, is_active: isActive } });
    }
    throw error;
  }
  await cacheRows('catalog', [data]);
  return data;
}

const inputModes = new Set([
  'numeric_integer','numeric_decimal','numeric_comparator','text',
  'positive_negative','boolean','single_choice','multi_choice','graded_multi_choice',
]);
const valueTypeForMode = mode => ({
  numeric_integer:'numeric',numeric_decimal:'numeric',numeric_comparator:'text',
  text:'text',positive_negative:'choice',boolean:'boolean',
  single_choice:'choice',multi_choice:'choice',graded_multi_choice:'choice',
}[mode] || 'numeric');

const validateParameter = parameter => {
  const code = String(parameter?.code ?? '').trim();
  const name = String(parameter?.name ?? '').trim();
  required(code, 'parameter.code'); required(name, 'parameter.name');
  if (code.length > 40 || name.length > 160) throw new Error('Parameter code/name is too long.');
  const resultInputMode = parameter.resultInputMode
    || ({numeric:'numeric_decimal',text:'text',boolean:'boolean',choice:'single_choice'}[parameter.valueType] || 'numeric_decimal');
  if (!inputModes.has(resultInputMode)) throw new Error('نوع إدخال النتيجة غير مدعوم.');
  const valueType = valueTypeForMode(resultInputMode);
  const decimalPlaces = Number(parameter.decimalPlaces ?? 2);
  const displayOrder = Number(parameter.displayOrder ?? 0);
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) throw new Error('decimalPlaces must be from 0 to 6.');
  if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10000) throw new Error('displayOrder must be a whole number from 0 to 10000.');
  const resultSource = parameter.resultSource ?? 'manual';
  if (!['manual','calculated'].includes(resultSource)) throw new Error('Unsupported parameter result source.');
  const formula = parameter.formula ?? null;
  if (resultSource === 'calculated'
      && (!['numeric_integer','numeric_decimal'].includes(resultInputMode)
        || !formula || typeof formula !== 'object' || Array.isArray(formula))) {
    throw new Error('المعادلة التلقائية تحتاج بارامترًا رقميًا ومعادلة صحيحة.');
  }
  if (resultSource === 'manual' && formula !== null) throw new Error('Manual parameters cannot have a formula.');
  const ranges = parameter.referenceRanges ?? [];
  if (!Array.isArray(ranges)) throw new Error('يجب أن تكون المديات المرجعية قائمة.');
  const referenceIntervalStatus = parameter.referenceIntervalStatus
    || (['numeric_integer','numeric_decimal'].includes(resultInputMode) ? 'local_verification_required' : 'not_applicable');
  if (!['not_applicable','local_verification_required','verified_local'].includes(referenceIntervalStatus)) throw new Error('Unsupported reference interval status.');
  const sourceReferences = parameter.sourceReferences ?? [];
  if (!Array.isArray(sourceReferences)) throw new Error('المراجع العلمية يجب أن تكون قائمة.');
  if (referenceIntervalStatus === 'verified_local'
      && ['numeric_integer','numeric_decimal'].includes(resultInputMode)
      && (!ranges.length || !sourceReferences.length)) {
    throw new Error('اعتماد المدى محليًا يتطلب مدى واحدًا على الأقل ومرجعًا علميًا.');
  }
  for (const range of ranges) {
    if (!range || typeof range !== 'object' || Array.isArray(range)) throw new Error('كل مدى مرجعي يجب أن يكون صحيحًا.');
    const low = range.lower ?? range.low ?? range.min;
    const high = range.upper ?? range.high ?? range.max;
    if (low != null && !Number.isFinite(Number(low))) throw new Error('الحد الأدنى للمدى المرجعي يجب أن يكون رقمًا.');
    if (high != null && !Number.isFinite(Number(high))) throw new Error('الحد الأعلى للمدى المرجعي يجب أن يكون رقمًا.');
    if (low != null && high != null && Number(low) > Number(high)) throw new Error('الحد الأدنى لا يمكن أن يتجاوز الحد الأعلى.');
    if (range.age?.min != null && range.age?.max != null && Number(range.age.min) > Number(range.age.max)) {
      throw new Error('نطاق العمر المرجعي غير صحيح.');
    }
  }
  const choices = parameter.choices ?? [];
  const choiceModes = ['positive_negative','single_choice','multi_choice','graded_multi_choice'];
  if (!Array.isArray(choices) || (choiceModes.includes(resultInputMode)
      && (!choices.length || choices.some(choice => typeof choice !== 'string' || !choice.trim())))) {
    throw new Error('أضف الاختيارات المطلوبة لهذا النوع من النتائج.');
  }
  if (new Set(choices.map(choice => String(choice).trim())).size !== choices.length) {
    throw new Error('لا يمكن تكرار الاختيار نفسه.');
  }
  const resultConfig = parameter.resultConfig ?? {};
  if (!resultConfig || typeof resultConfig !== 'object' || Array.isArray(resultConfig)) {
    throw new Error('إعدادات النتيجة غير صحيحة.');
  }
  if (resultConfig.max_selections != null) {
    const maxSelections = Number(resultConfig.max_selections);
    if (!Number.isInteger(maxSelections) || maxSelections < 1 || maxSelections > Math.max(choices.length,1)) {
      throw new Error('الحد الأقصى للاختيارات غير صحيح.');
    }
  }
  if (resultInputMode === 'graded_multi_choice') {
    const scores = resultConfig.choice_scores;
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
      throw new Error('أدخل درجة لكل اختيار في النوع المتدرج.');
    }
    const keys = Object.keys(scores);
    if (keys.length !== choices.length
        || choices.some(choice => !Object.hasOwn(scores, choice) || !Number.isFinite(Number(scores[choice])))) {
      throw new Error('درجة كل اختيار يجب أن تكون رقمًا، ويجب تغطية كل الاختيارات.');
    }
  }
  const displayRules = parameter.displayRules ?? [];
  if (!Array.isArray(displayRules)) throw new Error('قواعد إظهار الاختيارات يجب أن تكون قائمة.');
  for (const rule of displayRules) {
    const supportedOperators = ['equals','not_equals','lt','lte','gt','gte'];
    if (!rule?.when?.parameter_code || !supportedOperators.includes(rule.when.operator)
        || rule.when.value === undefined || rule.when.value === null
        || !String(rule.when.value).trim() || !Array.isArray(rule.visible_values)) {
      throw new Error('قاعدة الإظهار الشرطي غير مكتملة.');
    }
    if (['lt','lte','gt','gte'].includes(rule.when.operator) && !Number.isFinite(Number(rule.when.value))) {
      throw new Error('المقارنة الرقمية تحتاج قيمة رقمية صحيحة.');
    }
  }
  return {
    code,name,valueType,resultInputMode,decimalPlaces,displayOrder,ranges,choices,
    resultSource,formula,referenceIntervalStatus,sourceReferences,resultConfig,displayRules,
  };
};

function buildParameterPayload({ tenantId, testId, parameter, id } = {}) {
  required(tenantId, 'tenantId');
  const valid = validateParameter(parameter);
  return {
    id: id || crypto.randomUUID(), tenant_id: tenantId, ...(testId ? { test_id: testId } : {}),
    parameter_code: valid.code, parameter_name: valid.name,
    unit: parameter.unit?.trim() || null, value_type: valid.valueType,
    result_input_mode: valid.resultInputMode, result_config: valid.resultConfig, display_rules: valid.displayRules,
    formula_expression: parameter.formulaExpression?.trim() || null,
    decimal_places: valid.decimalPlaces, reference_ranges: valid.ranges,
    choices: valid.choices, display_order: valid.displayOrder,
    result_source: valid.resultSource, formula: valid.formula,
    unit_ucum: parameter.unitUcum?.trim() || null, alternate_units: parameter.alternateUnits ?? [],
    critical_ranges: parameter.criticalRanges ?? {}, interpretation_rules: parameter.interpretationRules ?? [],
    applicability: parameter.applicability ?? {}, method_notes: parameter.methodNotes?.trim() || null,
    clinical_metadata: parameter.clinicalMetadata ?? {}, source_references: valid.sourceReferences,
    reference_interval_status: valid.referenceIntervalStatus, clinical_review_status: parameter.clinicalReviewStatus || 'needs_review',
    is_required: parameter.isRequired !== false, is_active: parameter.isActive !== false,
  };
}

/** Technical parameter data is editable by tenant members; database RLS remains authoritative. */
export async function saveTestParameter({ tenantId, branchId, testId, parameter, id, dependsOn = [] } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId');
  const payload = buildParameterPayload({ tenantId, testId, parameter, id });
  const recordId = payload.id;
  const cached = (await getCachedRows('test_parameters', { tenantId, testId })).find(row => row.id === recordId) || null;
  if (globalThis.navigator?.onLine === false) return queueCatalogChange({ tenantId, branchId, kind: 'parameter', action: cached ? 'update' : 'create', recordId, baseSnapshot: cached, recordPayload: payload, dependsOn: [...dependsOn, ...(cached?.local_operation_id ? [cached.local_operation_id] : [])] });
  // Keep create and edit as explicit operations. This avoids ambiguous upsert
  // conflicts on the tenant/test/parameter-code unique key and scopes edits to
  // the exact parameter row in this tenant and test.
  const query = db().from(TABLES.parameters);
  const response = id
    ? await query.update(payload)
        .eq('tenant_id', tenantId).eq('test_id', testId).eq('id', id)
        .select().single()
    : await query.insert(payload).select().single();
  const { data, error } = response;
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return queueCatalogChange({ tenantId, branchId, kind: 'parameter', action: cached ? 'update' : 'create', recordId, baseSnapshot: cached, recordPayload: payload, dependsOn: [...dependsOn, ...(cached?.local_operation_id ? [cached.local_operation_id] : [])] });
    if (error.code === '23505') {
      throw new Error('كود البارامتر مستخدم بالفعل داخل هذا التحليل. غيّر الكود أو افتح البارامتر الموجود للتعديل.');
    }
    throw error;
  }
  if (!data) throw new Error('لم يرجع الخادم بيانات البارامتر بعد الحفظ.');
  await cacheRows('test_parameters', [data]);
  return data;
}

/** Preserve parameter history/snapshots by toggling is_active instead of deleting rows. */
export async function setTestParameterActive({ tenantId, branchId, testId, parameterId, isActive } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId'); required(parameterId, 'parameterId');
  if (typeof isActive !== 'boolean') throw new Error('isActive must be a boolean.');
  const cached = (await getCachedRows('test_parameters', { tenantId, testId })).find(row => row.id === parameterId) || null;
  if (globalThis.navigator?.onLine === false) {
    if (!cached) throw new Error('جهّز بارامترات التحليل أثناء الاتصال قبل تعديلها دون إنترنت.');
    return queueCatalogChange({ tenantId, branchId, kind: 'parameter', action: 'update', recordId: parameterId, baseSnapshot: cached, recordPayload: { ...cached, is_active: isActive } });
  }
  const { data, error } = await db().from(TABLES.parameters)
    .update({ is_active: isActive }).eq('tenant_id', tenantId).eq('test_id', testId)
    .eq('id', parameterId).select().single();
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) {
      if (!cached) throw new Error('لا توجد نسخة محلية من البارامتر لإتمام التعديل دون اتصال.');
      return queueCatalogChange({ tenantId, branchId, kind: 'parameter', action: 'update', recordId: parameterId, baseSnapshot: cached, recordPayload: { ...cached, is_active: isActive } });
    }
    throw error;
  }
  await cacheRows('test_parameters', [data]);
  return data;
}

/** Set an owner-managed price override for one branch. */
export async function setBranchPrice({ tenantId, branchId, testId, sellingPrice } = {}) {
  required(tenantId, 'tenantId'); required(branchId, 'branchId'); required(testId, 'testId');
  const price = Number(sellingPrice);
  if (!Number.isFinite(price) || price < 0 || price > 9999999999.99) throw new Error('sellingPrice must be a valid non-negative amount.');
  const { data, error } = await db().rpc(RPC.setBranchTestPrice, {
    p_tenant_id: tenantId, p_branch_id: branchId, p_test_id: testId, p_selling_price: price,
  });
  if (error) throw error;
  if (!data?.id || data.tenant_id !== tenantId || data.branch_id !== branchId
    || data.test_id !== testId || data.is_current !== true) {
    throw new Error('The branch price update did not return a valid current-price record.');
  }
  await replaceCachedCurrentPrices([data], { tenantId, testIds: [testId], branchId, scope: 'branch' });
  return data;
}

/** Price history is changed by an owner-only database policy. */
export async function setCurrentPrice({ tenantId, testId, sellingPrice } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId');
  const price = Number(sellingPrice);
  if (!Number.isFinite(price) || price < 0 || price > 9999999999.99) throw new Error('sellingPrice must be a valid non-negative amount.');
  const { data, error } = await db().rpc(RPC.setCurrentTestPrice, {
    p_tenant_id: tenantId,
    p_test_id: testId,
    p_selling_price: price,
  });
  if (error) throw error;
  if (!data?.id || data.tenant_id !== tenantId || data.test_id !== testId || data.is_current !== true) {
    throw new Error('The price update did not return a valid current-price record.');
  }
  // Refresh current-price cache only after the server confirms the new row.
  await replaceCachedCurrentPrices([data], { tenantId, testIds: [testId], scope: 'base' });
  return data;
}


/** Read only current tenant-wide base prices; branch overrides are deliberately excluded. */
export async function listCurrentBasePrices({ tenantId, testIds } = {}) {
  required(tenantId, 'tenantId');
  if (!Array.isArray(testIds) || testIds.length === 0) return [];
  const { data, error } = await db().from(TABLES.prices)
    .select('id, tenant_id, test_id, branch_id, selling_price, effective_from, is_current')
    .eq('tenant_id', tenantId).eq('is_current', true).is('branch_id', null)
    .in('test_id', testIds);
  if (error) throw error;
  return data ?? [];
}

/**
 * Insert a missing base price without replacing an existing one.
 * The partial unique index uq_test_prices_current_base is the concurrency guard.
 */
export async function addBasePriceIfMissing({ tenantId, testId, sellingPrice } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId');
  const price = Number(sellingPrice);
  if (!Number.isFinite(price) || price < 0 || price > 9999999999.99
    || Math.abs(price * 100 - Math.round(price * 100)) > 1e-7) {
    throw new Error('sellingPrice must be a non-negative amount with at most two decimal places.');
  }
  const { data: authData, error: authError } = await db().auth.getUser();
  if (authError) throw authError;
  const userId = authData?.user?.id;
  if (!userId) throw new Error('An authenticated owner session is required to import prices.');

  const { data: test, error: testError } = await db().from(TABLES.catalog)
    .select('id').eq('tenant_id', tenantId).eq('id', testId).eq('is_active', true).maybeSingle();
  if (testError) throw testError;
  if (!test) throw new Error('The active catalog test was not found for this tenant.');

  const findCurrent = () => db().from(TABLES.prices)
    .select('id, tenant_id, test_id, branch_id, selling_price, effective_from, is_current')
    .eq('tenant_id', tenantId).eq('test_id', testId).eq('is_current', true)
    .is('branch_id', null).maybeSingle();
  const { data: existing, error: existingError } = await findCurrent();
  if (existingError) throw existingError;
  if (existing) return { created: false, price: existing };

  const { data, error } = await db().from(TABLES.prices).insert({
    tenant_id: tenantId, test_id: testId, branch_id: null,
    selling_price: price, is_current: true, updated_by: userId,
  }).select('id, tenant_id, test_id, branch_id, selling_price, effective_from, is_current').single();
  if (error) {
    if (error.code === '23505') {
      const { data: current, error: rereadError } = await findCurrent();
      if (rereadError) throw rereadError;
      if (current) return { created: false, price: current };
    }
    throw error;
  }
  let cacheUpdated = true;
  try { await replaceCachedCurrentPrices([data], { tenantId, testIds: [testId], scope: 'base' }); }
  catch { cacheUpdated = false; }
  return { created: true, price: data, cacheUpdated };
}

/** Published global master catalog; definitions are read-only and imported as tenant-owned copies. */
function parseMasterFormulaAst(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function listMasterCatalogTests() {
  const { data: releases, error: releaseError } = await db().from('master_catalog_releases')
    .select('id, version, title, published_at').eq('status','published').order('published_at',{ascending:false});
  if (releaseError) throw releaseError;
  if (!releases?.length) return [];
  const { data, error } = await db().from('master_catalog_tests')
    .select('id, release_id, master_code, canonical_name, alternate_names, test_kind, category, service_type, clinical_review_status, source_name, definition')
    .in('release_id', releases.map(row=>row.id)).order('canonical_name');
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map(row=>row.id);
  const parameterCounts = new Map();
  if (ids.length) {
    const { data: parameterRows, error: parameterError } = await db().from('master_catalog_parameters')
      .select('master_test_id,value_type,reference_ranges,reference_interval_status,clinical_review_status,clinical_metadata,result_source,formula,unit,choices,result_input_mode')
      .in('master_test_id', ids);
    if (parameterError) throw parameterError;
    for (const parameter of parameterRows ?? []) {
      const stats = parameterCounts.get(parameter.master_test_id) || { count: 0, missing_numeric_ranges: 0, unreviewed_parameters: 0, placeholder_parameters: 0, missing_units: 0, missing_formulas: 0, missing_choices: 0 };
      stats.count += 1;
      if (parameter.value_type === 'numeric' && (!Array.isArray(parameter.reference_ranges) || parameter.reference_ranges.length === 0) && parameter.reference_interval_status !== 'not_applicable') stats.missing_numeric_ranges += 1;
      if (parameter.clinical_review_status !== 'verified') stats.unreviewed_parameters += 1;
      if (parameter.clinical_metadata?.template_placeholder === true) stats.placeholder_parameters += 1;
      if (parameter.value_type === 'numeric' && !parameter.unit) stats.missing_units += 1;
      if (parameter.result_source === 'calculated' && !parseMasterFormulaAst(parameter.formula)) stats.missing_formulas += 1;
      if (parameter.value_type === 'choice' && (!Array.isArray(parameter.choices) || parameter.choices.length === 0)) stats.missing_choices += 1;
      parameterCounts.set(parameter.master_test_id, stats);
    }
  }
  const byRelease = new Map(releases.map(row=>[row.id,row]));
  return rows.map(row=>({
    ...row,
    parameter_count: parameterCounts.get(row.id)?.count || 0,
    missing_numeric_ranges: parameterCounts.get(row.id)?.missing_numeric_ranges || 0,
    unreviewed_parameters: parameterCounts.get(row.id)?.unreviewed_parameters || 0,
    placeholder_parameters: parameterCounts.get(row.id)?.placeholder_parameters || 0,
    missing_units: parameterCounts.get(row.id)?.missing_units || 0,
    missing_formulas: parameterCounts.get(row.id)?.missing_formulas || 0,
    missing_choices: parameterCounts.get(row.id)?.missing_choices || 0,
    release: byRelease.get(row.release_id),
  })); // Published definitions remain importable even when clinical metadata is incomplete.
}

export async function importMasterCatalogTest({ tenantId, masterTestId } = {}) {
  required(tenantId,'tenantId'); required(masterTestId,'masterTestId');
  const { data, error } = await db().rpc('import_master_catalog_test', {
    p_tenant_id:tenantId, p_master_test_id:masterTestId,
  });
  if (error) throw error;
  return data;
}


/** Pending catalog changes submitted by any device in the selected tenant/branch. */
export async function listPendingCatalogChanges({ tenantId, branchId } = {}) {
  required(tenantId, 'tenantId'); required(branchId, 'branchId');
  const { data, error } = await db().from('sync_conflicts')
    .select('id, tenant_id, branch_id, operation_id, entity_type, entity_id, local_payload, server_payload, resolution, resolution_payload, created_at, resolved_by, resolved_at')
    .eq('tenant_id', tenantId).eq('branch_id', branchId)
    .in('entity_type', ['catalog_test_change','catalog_parameter_change'])
    .or('resolution.is.null,resolution.eq.conflict').order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function requireTenantCatalogReviewer(tenantId) {
  const { data: authData, error: authError } = await db().auth.getUser();
  if (authError) throw authError;
  const userId = authData?.user?.id;
  if (!userId) throw new Error('يلزم تسجيل الدخول لمراجعة تعديلات الكتالوج.');
  const { data: membership, error } = await db().from('tenant_memberships')
    .select('account_type').eq('tenant_id', tenantId).eq('user_id', userId)
    .eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (membership?.account_type !== 'owner') {
    throw new Error('اعتماد أو رفض تعديلات الكتالوج متاح لمالك المعمل فقط.');
  }
  return userId;
}

/** Apply or reject one proposal. Updates are optimistic and never overwrite a newer server version. */
export async function resolveCatalogChangeProposal({ tenantId, branchId, proposalId, decision } = {}) {
  required(tenantId, 'tenantId'); required(branchId, 'branchId'); required(proposalId, 'proposalId');
  if (!['approve','reject'].includes(decision)) throw new Error('قرار المراجعة غير صالح.');
  const { data: proposal, error: proposalError } = await db().from('sync_conflicts')
    .select('*').eq('id', proposalId).eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle();
  if (proposalError) throw proposalError;
  if (!proposal) throw new Error('طلب تعديل الكتالوج غير موجود في هذا الفرع.');
  if (proposal.resolution && proposal.resolution !== 'conflict') return { status: proposal.resolution };
  const resolvedBy = await requireTenantCatalogReviewer(tenantId);
  if (decision === 'reject') {
    const { data, error } = await db().from('sync_conflicts').update({ resolution: 'rejected', resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_payload: { decision: 'rejected' } })
      .eq('id', proposalId).eq('tenant_id', tenantId).eq('branch_id', branchId).or('resolution.is.null,resolution.eq.conflict').select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('سبق أن اتخذ جهاز آخر قرارًا بشأن هذا التعديل. حدّث القائمة.');
    return { status: 'rejected' };
  }
  const payload = proposal.local_payload || {};
  const kind = proposal.entity_type === 'catalog_test_change' ? 'test' : proposal.entity_type === 'catalog_parameter_change' ? 'parameter' : null;
  if (!kind || !payload.record_payload || payload.record_id !== proposal.entity_id) throw new Error('بيانات طلب التعديل غير مكتملة؛ لم يتم تطبيقه.');
  const table = kind === 'test' ? TABLES.catalog : TABLES.parameters;
  const record = { ...payload.record_payload };
  for (const key of ['local_pending','local_operation_id','local_branch_id','local_base_updated_at','cached_at','created_at','updated_at']) delete record[key];
  const allowedColumns = kind === 'test'
    ? new Set(['id','tenant_id','code','name','test_kind','category','specimen','method','turnaround_minutes','instructions','is_active','short_name','synonyms','loinc_code','clinical_category','clinical_purpose','service_type','patient_preparation','collection_requirements','specimen_requirements','transport_requirements','stability_requirements','rejection_criteria','biosafety_notes','critical_result_policy','reporting_notes','source_references','clinical_review_status','catalog_version'])
    : new Set(['id','tenant_id','test_id','parameter_code','parameter_name','unit','value_type','decimal_places','reference_ranges','choices','display_order','is_required','is_active','result_source','formula','unit_ucum','alternate_units','critical_ranges','interpretation_rules','applicability','method_notes','clinical_metadata','source_references','clinical_review_status','reference_interval_status','result_input_mode','result_config','display_rules','formula_expression']);
  if (record.id !== proposal.entity_id || record.tenant_id !== tenantId || Object.keys(record).some(key => !allowedColumns.has(key))) {
    throw new Error('طلب التعديل يحتوي على نطاق أو حقول غير مسموح بها؛ لم يتم تطبيقه.');
  }
  if (kind === 'parameter') {
    if (!record.test_id) throw new Error('البارامتر لا يرتبط بتحليل صالح.');
    const parent = await db().from(TABLES.catalog).select('id').eq('tenant_id', tenantId).eq('id', record.test_id).maybeSingle();
    if (parent.error) throw parent.error;
    if (!parent.data) throw new Error('لا يمكن اعتماد البارامتر قبل اعتماد التحليل الأب.');
  }
  const { data: current, error: currentError } = await db().from(table).select('*').eq('tenant_id', tenantId).eq('id', proposal.entity_id).maybeSingle();
  if (currentError) throw currentError;
  const stableValue = value => Array.isArray(value) ? value.map(stableValue) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])])) : value;
  const matchesCurrent = Boolean(current) && Object.keys(record).every(key => JSON.stringify(stableValue(current[key])) === JSON.stringify(stableValue(record[key])));
  let applied = null;
  if (payload.action === 'create') {
    if (current && matchesCurrent) {
      applied = current; // Recover safely if the row insert succeeded before the proposal acknowledgement.
    } else if (current) {
      const reason = 'يوجد سجل بنفس المعرّف على الخادم؛ لم يتم استبداله.';
      await db().from('sync_conflicts').update({ resolution: 'conflict', resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_payload: { reason, server_snapshot: current } }).eq('id', proposalId).or('resolution.is.null,resolution.eq.conflict');
      return { status: 'conflict', reason, serverSnapshot: current };
    }
    if (!current) {
      const inserted = await db().from(table).insert(record).select().single();
      if (inserted.error) throw inserted.error;
      applied = inserted.data;
    }
  } else if (payload.action === 'update') {
    const expectedVersion = payload.base_updated_at;
    if (current && matchesCurrent) {
      applied = current; // Idempotent recovery after a successful update and interrupted acknowledgement.
    } else if (!current || !expectedVersion || current.updated_at !== expectedVersion) {
      const reason = 'تغير السجل على جهاز آخر منذ تحميل النسخة المحلية. راجع النسختين قبل إعادة التعديل.';
      await db().from('sync_conflicts').update({ resolution: 'conflict', resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_payload: { reason, server_snapshot: current || null } }).eq('id', proposalId).is('resolution', null);
      return { status: 'conflict', reason, serverSnapshot: current || null };
    }
    if (!applied) {
      const patch = { ...record }; delete patch.id; delete patch.tenant_id;
      const updated = await db().from(table).update(patch).eq('tenant_id', tenantId).eq('id', proposal.entity_id).eq('updated_at', expectedVersion).select().maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) return { status: 'conflict', reason: 'تغير السجل أثناء اعتماد التعديل؛ لم تتم الكتابة فوق النسخة الأحدث.' };
      applied = updated.data;
    }
  } else throw new Error('نوع التعديل غير مدعوم.');
  const resolved = await db().from('sync_conflicts').update({ resolution: 'approved', resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_payload: { applied_record_id: applied.id, applied_updated_at: applied.updated_at } })
    .eq('id', proposalId).eq('tenant_id', tenantId).eq('branch_id', branchId).or('resolution.is.null,resolution.eq.conflict').select('id').maybeSingle();
  if (resolved.error) throw resolved.error;
  if (!resolved.data) throw new Error('تم تطبيق السجل لكن قرار المراجعة تغير بالتزامن؛ حدّث القائمة وتحقق من حالة الطلب.');
  await cacheRows(kind === 'test' ? 'catalog' : 'test_parameters', [applied]);
  return { status: 'approved', record: applied };
}
