import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES, RPC } from '../../core/data/schema-contract.js';
import { cacheRows, getCachedRows, replaceCachedRows, replaceCachedCurrentPrices } from '../../offline/cache.js';

const db = () => getSupabaseClient();
const required = (value, name) => { if (!value) throw new Error(`${name} is required.`); };

export async function listCatalog({ tenantId, includeInactive = false } = {}) {
  required(tenantId, 'tenantId');
  let query = db().from(TABLES.catalog)
    .select('id, tenant_id, code, name, test_kind, category, specimen, method, turnaround_minutes, instructions, is_active, updated_at, short_name, synonyms, loinc_code, clinical_category, clinical_purpose, service_type, patient_preparation, collection_requirements, specimen_requirements, transport_requirements, stability_requirements, rejection_criteria, biosafety_notes, critical_result_policy, reporting_notes, source_references, clinical_review_status, catalog_version')
    .eq('tenant_id', tenantId).order('name');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('catalog', { tenantId })).filter(row => includeInactive || row.is_active);
  const { data, error } = await query;
  if (error) { if (/fetch|network|offline/i.test(error.message || '')) return (await getCachedRows('catalog', { tenantId })).filter(row => includeInactive || row.is_active); throw error; }
  await replaceCachedRows('catalog', data ?? [], { tenantId });
  return (data ?? []).filter(row => includeInactive || row.is_active);
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

export async function listTestParameters({ tenantId, testId, includeInactive = false } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId');
  if (globalThis.navigator?.onLine === false) return (await getCachedRows('test_parameters', { tenantId, testId })).filter(row => includeInactive || row.is_active).sort((a,b) => a.display_order-b.display_order);
  let query = db().from(TABLES.parameters)
    .select('id, tenant_id, test_id, parameter_code, parameter_name, unit, value_type, decimal_places, reference_ranges, choices, display_order, is_required, is_active, result_source, formula, unit_ucum, alternate_units, critical_ranges, interpretation_rules, applicability, method_notes, clinical_metadata, source_references, clinical_review_status')
    .eq('tenant_id', tenantId).eq('test_id', testId)
    .order('display_order');
  const { data, error } = await query;
  if (error) { if (/fetch|network|offline/i.test(error.message || '')) return (await getCachedRows('test_parameters', { tenantId, testId })).filter(row => includeInactive || row.is_active).sort((a,b) => a.display_order-b.display_order); throw error; }
  await replaceCachedRows('test_parameters', data ?? [], { tenantId, testId });
  return (data ?? []).filter(row => includeInactive || row.is_active);
}

export async function saveCatalogTest({ tenantId, test, id } = {}) {
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
  if (!['individual', 'panel'].includes(testKind)) throw new Error('testKind must be individual or panel.');
  const payload = {
    ...(id ? { id } : {}), tenant_id: tenantId, code, name, test_kind: testKind,
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
  const { data, error } = await db().from(TABLES.catalog).upsert(payload).select().single();
  if (error) throw error;
  await cacheRows('catalog', [data]);
  return data;
}

/** Deactivate instead of hard-deleting: historical visits retain their test reference and snapshots. */
export async function setCatalogTestActive({ tenantId, testId, isActive } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId');
  if (typeof isActive !== 'boolean') throw new Error('isActive must be a boolean.');
  const { data, error } = await db().from(TABLES.catalog)
    .update({ is_active: isActive }).eq('tenant_id', tenantId).eq('id', testId).select().single();
  if (error) throw error;
  await cacheRows('catalog', [data]);
  return data;
}

const validateParameter = parameter => {
  const code = String(parameter?.code ?? '').trim();
  const name = String(parameter?.name ?? '').trim();
  required(code, 'parameter.code'); required(name, 'parameter.name');
  if (code.length > 40 || name.length > 160) throw new Error('Parameter code/name is too long.');
  const valueType = parameter.valueType ?? 'numeric';
  if (!['numeric', 'text', 'boolean', 'choice'].includes(valueType)) throw new Error('Unsupported parameter valueType.');
  const decimalPlaces = Number(parameter.decimalPlaces ?? 2);
  const displayOrder = Number(parameter.displayOrder ?? 0);
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) throw new Error('decimalPlaces must be from 0 to 6.');
  if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10000) throw new Error('displayOrder must be a whole number from 0 to 10000.');
  const resultSource = parameter.resultSource ?? 'manual';
  if (!['manual','calculated'].includes(resultSource)) throw new Error('Unsupported parameter result source.');
  const formula = parameter.formula ?? null;
  if (resultSource === 'calculated' && (valueType !== 'numeric' || !formula || typeof formula !== 'object' || Array.isArray(formula))) throw new Error('Calculated parameters require a numeric formula.');
  if (resultSource === 'manual' && formula !== null) throw new Error('Manual parameters cannot have a formula.');
  const ranges = parameter.referenceRanges ?? [];
  const choices = parameter.choices ?? [];
  const validRanges = Array.isArray(ranges) || (ranges !== null && typeof ranges === 'object');
  if (!validRanges || !Array.isArray(choices)) throw new Error('referenceRanges must be an object or array, and choices must be an array.');
  if (valueType === 'choice' && (choices.length === 0 || choices.some(choice => typeof choice !== 'string' || !choice.trim()))) throw new Error('Choice parameters require at least one choice, and each choice must be non-empty text.');
  if (valueType === 'choice' && new Set(choices.map(choice => choice.trim())).size !== choices.length) throw new Error('Choice parameters cannot contain duplicate choices.');
  return { code, name, valueType, decimalPlaces, displayOrder, ranges, choices, resultSource, formula };
};

/** Technical parameter data is editable by tenant members; database RLS remains authoritative. */
export async function saveTestParameter({ tenantId, testId, parameter, id } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId');
  const valid = validateParameter(parameter);
  const payload = {
    ...(id ? { id } : {}), tenant_id: tenantId, test_id: testId,
    parameter_code: valid.code, parameter_name: valid.name,
    unit: parameter.unit?.trim() || null, value_type: valid.valueType,
    decimal_places: valid.decimalPlaces, reference_ranges: valid.ranges,
    choices: valid.choices, display_order: valid.displayOrder,
    result_source: valid.resultSource, formula: valid.formula,
    unit_ucum: parameter.unitUcum?.trim() || null, alternate_units: parameter.alternateUnits ?? [],
    critical_ranges: parameter.criticalRanges ?? {}, interpretation_rules: parameter.interpretationRules ?? [],
    applicability: parameter.applicability ?? {}, method_notes: parameter.methodNotes?.trim() || null, clinical_metadata: parameter.clinicalMetadata ?? {},
    source_references: parameter.sourceReferences ?? [], clinical_review_status: parameter.clinicalReviewStatus || 'needs_review',
    is_required: parameter.isRequired !== false, is_active: parameter.isActive !== false,
  };
  const { data, error } = await db().from(TABLES.parameters).upsert(payload).select().single();
  if (error) throw error;
  await cacheRows('test_parameters', [data]);
  return data;
}

/** Preserve parameter history/snapshots by toggling is_active instead of deleting rows. */
export async function setTestParameterActive({ tenantId, testId, parameterId, isActive } = {}) {
  required(tenantId, 'tenantId'); required(testId, 'testId'); required(parameterId, 'parameterId');
  if (typeof isActive !== 'boolean') throw new Error('isActive must be a boolean.');
  const { data, error } = await db().from(TABLES.parameters)
    .update({ is_active: isActive }).eq('tenant_id', tenantId).eq('test_id', testId)
    .eq('id', parameterId).select().single();
  if (error) throw error;
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
export async function listMasterCatalogTests() {
  const { data: releases, error: releaseError } = await db().from('master_catalog_releases')
    .select('id, version, title, published_at').eq('status','published').order('published_at',{ascending:false});
  if (releaseError) throw releaseError;
  if (!releases?.length) return [];
  const { data, error } = await db().from('master_catalog_tests')
    .select('id, release_id, master_code, canonical_name, alternate_names, test_kind, category, service_type, clinical_review_status, source_name')
    .in('release_id', releases.map(row=>row.id)).order('canonical_name');
  if (error) throw error;
  const byRelease = new Map(releases.map(row=>[row.id,row]));
  return (data ?? []).map(row=>({...row, release:byRelease.get(row.release_id)}));
}

export async function importMasterCatalogTest({ tenantId, masterTestId } = {}) {
  required(tenantId,'tenantId'); required(masterTestId,'masterTestId');
  const { data, error } = await db().rpc('import_master_catalog_test', {
    p_tenant_id:tenantId, p_master_test_id:masterTestId,
  });
  if (error) throw error;
  return data;
}
