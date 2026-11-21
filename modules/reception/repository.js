import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES, RPC } from '../../core/data/schema-contract.js';
import { enqueueOperation } from '../../offline/outbox.js';
import { cacheRows, cacheScopedPatient, getCachedRows } from '../../offline/cache.js';

const db = () => getSupabaseClient();
const need = (v, n) => { if (!v) throw new Error(`${n} is required.`); };
const uuid = () => crypto.randomUUID();
const dateStamp = () => new Date().toISOString().slice(0,10).replaceAll('-','');
const referenceCode = prefix => `${prefix}-${dateStamp()}-${uuid().replaceAll('-','').slice(0,8).toUpperCase()}`;
const ageInYears = (value, unit) => value == null || value === '' ? null
  : Number((Number(value) / (unit === 'days' ? 365.2425 : unit === 'months' ? 12 : 1)).toFixed(4));

export async function findPatients({ tenantId, branchId, search, limit = 30 } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  const term = String(search ?? '').trim();
  if (term.length < 2) return [];
  const cachedSearch = async () => (await getCachedRows('patients', { tenantId, branchId }))
    .filter(row => `${row.full_name || ''} ${row.phone || ''} ${row.patient_number || ''}`.toLowerCase().includes(term.toLowerCase()))
    .slice(0, Math.min(Math.max(Number(limit) || 30, 1), 100));
  if (globalThis.navigator?.onLine === false) return cachedSearch();
  const safeTerm = term.replace(/[%,_*]/g, ' ').replace(/\\s+/g, ' ').trim();
  if (safeTerm.length < 2) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const columns = 'id, patient_number, full_name, phone, age_years, age_value, age_unit, sex, created_at';
  const [byName, byPhone, byNumber] = await Promise.all([
    db().from(TABLES.patients).select(columns).eq('tenant_id', tenantId).eq('branch_id', branchId).ilike('full_name', `%${safeTerm}%`).order('full_name').limit(safeLimit),
    db().from(TABLES.patients).select(columns).eq('tenant_id', tenantId).eq('branch_id', branchId).ilike('phone', `%${safeTerm}%`).order('full_name').limit(safeLimit),
    db().from(TABLES.patients).select(columns).eq('tenant_id', tenantId).eq('branch_id', branchId).ilike('patient_number', `%${safeTerm}%`).order('full_name').limit(safeLimit),
  ]);
  if (byName.error || byPhone.error || byNumber.error) {
    const error = byName.error || byPhone.error || byNumber.error;
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return cachedSearch();
    throw error;
  }
  const merged = new Map([...(byName.data ?? []), ...(byPhone.data ?? []), ...(byNumber.data ?? [])].map(row => [row.id, row]));
  const result = [...merged.values()].sort((a,b) => String(a.full_name).localeCompare(String(b.full_name))).slice(0, safeLimit);
  await Promise.all(result.map(cacheScopedPatient));
  return result;
}

export async function createPatient({ tenantId, branchId, patient } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(patient?.fullName, 'patient.fullName');
  const ageUnit = ['days','months','years'].includes(patient.ageUnit) ? patient.ageUnit : 'years';
  const ageValue = patient.ageValue == null || patient.ageValue === '' ? null : Number(patient.ageValue);
  if (ageValue !== null && (!Number.isFinite(ageValue) || ageValue < 0 || ageValue > (ageUnit === 'days' ? 43800 : ageUnit === 'months' ? 1440 : 120))) {
    throw new Error('العمر المدخل خارج النطاق المسموح.');
  }
  const payload = {
    id: patient.id ?? uuid(), tenant_id: tenantId, branch_id: branchId,
    patient_number: patient.patientNumber ?? referenceCode('P'),
    full_name: String(patient.fullName).trim(), phone: patient.phone ?? null,
    age_value: ageValue, age_unit: ageUnit, age_years: ageInYears(ageValue, ageUnit),
    sex: patient.sex ?? 'unknown', created_by_staff_id: patient.createdByStaffId ?? null,
  };
  const queue = async () => {
    const operationId = uuid();
    await cacheScopedPatient(payload);
    await enqueueOperation({ tenantId, branchId, entityType: 'patients', action: 'create', operationId, payload, priority: 1 });
    return { ...payload, pendingOperationId: operationId, offline_pending: true };
  };
  if (globalThis.navigator?.onLine === false) return queue();
  const { data, error } = await db().from(TABLES.patients).insert(payload).select().single();
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return queue();
    throw error;
  }
  await cacheScopedPatient(data);
  return data;
}

export async function getOpenWorkday({ tenantId, branchId } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  if (globalThis.navigator?.onLine === false) {
    const cached = await getCachedRows('workdays', { tenantId, branchId });
    const open = cached.find(row => row.status === 'open');
    if (!open) throw new Error('لا يوجد يوم عمل مفتوح محفوظ محليًا لهذا الفرع.');
    return open;
  }
  const { data, error } = await db().from(TABLES.workdays)
    .select('id, tenant_id, branch_id, work_date, status, opened_at')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('status', 'open')
    .maybeSingle();
  if (error) { if (/fetch|network|offline/i.test(error.message || '')) { const cached = await getCachedRows('workdays', { tenantId, branchId }); const open = cached.find(row => row.status === 'open'); if (open) return open; } throw error; }
  if (!data) throw new Error('No open workday for this branch. Open the workday before registering visits.');
  await cacheRows('workdays', [data]);
  return data;
}

export async function createVisit({ tenantId, branchId, patientId, visitNumber, staffId, referredBy, notes } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(patientId, 'patientId'); need(staffId, 'staffId');
  const workday = await getOpenWorkday({ tenantId, branchId });
  const payload = {
    tenant_id: tenantId, branch_id: branchId, patient_id: patientId,
    workday_id: workday.id, visit_number: String(visitNumber || referenceCode('V')).trim(),
    created_by_staff_id: staffId, referred_by: referredBy ?? null, notes: notes ?? null,
  };
  const { data, error } = await db().from(TABLES.visits).insert(payload).select().single();
  if (error) throw error;
  return data;
}

/** Adds a test; DB trigger snapshots current price and technical parameters. */
export async function addTestToVisit({ tenantId, branchId, visitId, testId, staffId } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(visitId, 'visitId'); need(testId, 'testId');
  if (!staffId) throw new Error('An active staff identity is required to add a test to this visit.');
  if (globalThis.navigator?.onLine === false) throw new Error('إضافة تحليل لزيارة قائمة تحتاج اتصالًا بالإنترنت.');
  const { data, error } = await db().rpc('add_test_to_visit_atomic', {
    p_tenant_id: tenantId, p_branch_id: branchId, p_visit_id: visitId,
    p_test_id: testId, p_staff_id: staffId,
  });
  if (error) throw error;
  return data;
}

export async function createVisitBilling({ tenantId, branchId, visitId, grossTotal, discountAmount = 0 } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(visitId, 'visitId');
  const gross = Number(grossTotal), discount = Number(discountAmount);
  if (!Number.isFinite(gross) || !Number.isFinite(discount) || gross < 0 || discount < 0 || discount > gross) throw new Error('Invalid gross total or discount amount.');
  const { data, error } = await db().from(TABLES.billing).insert({ tenant_id: tenantId, branch_id: branchId, visit_id: visitId, gross_total: gross, discount_amount: discount }).select().single();
  if (error) throw error;
  return data;
}

export async function recordPayment({ tenantId, visitId, amount, paymentMethod = 'cash', staffId, notes } = {}) {
  need(tenantId, 'tenantId'); need(visitId, 'visitId'); need(staffId, 'staffId');
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Payment amount must be greater than zero.');
  const operationId = uuid();
  let visitRow;
  if (globalThis.navigator?.onLine === false) {
    visitRow = (await getCachedRows('visits', { tenantId })).find(row => row.id === visitId);
    if (!visitRow) throw new Error('لا توجد بيانات الزيارة محفوظة محليًا؛ لا يمكن وضع التحصيل في قائمة الانتظار بأمان.');
  } else {
    const visit = await db().from(TABLES.visits).select('id,tenant_id,branch_id,patient_id,visit_number,status').eq('tenant_id', tenantId).eq('id', visitId).single();
    if (visit.error) { if (/fetch|network|offline/i.test(visit.error.message || '')) { visitRow = (await getCachedRows('visits', { tenantId })).find(row => row.id === visitId); if (!visitRow) throw visit.error; } else throw visit.error; } else { visitRow = visit.data; await cacheRows('visits', [visitRow]); }
  }
  let collector;
  if (globalThis.navigator?.onLine === false) collector = (await getCachedRows('staff_directory', { tenantId })).find(row => row.id === staffId && row.is_active);
  else {
    const staffResult = await db().from(TABLES.staffDirectory).select('id, tenant_id, branch_id, is_active').eq('tenant_id', tenantId).eq('id', staffId).eq('is_active', true).maybeSingle();
    if (staffResult.error) {
      if (/fetch|network|offline/i.test(staffResult.error.message || '')) collector = (await getCachedRows('staff_directory', { tenantId })).find(row => row.id === staffId && row.is_active);
      else throw staffResult.error;
    } else collector = staffResult.data;
  }
  if (!collector?.branch_id) throw new Error('لا يمكن تحديد فرع التحصيل من حساب الموظف. حدّث بيانات الموظفين أثناء الاتصال أولًا.');
  const collectionBranchId = collector.branch_id;
  const payload = { visit_id: visitId, amount: value, payment_method: paymentMethod, staff_id: staffId, notes: notes ?? null };
  const queue = async () => { await enqueueOperation({ tenantId, branchId: collectionBranchId, entityType: 'payment', action: 'create', operationId, payload }); return { queued: true, operationId }; };
  if (globalThis.navigator?.onLine === false) return queue();
  const { data, error } = await db().rpc(RPC.recordPatientPayment, { p_tenant_id: tenantId, p_visit_id: visitId, p_amount: value, p_payment_method: paymentMethod, p_idempotency_key: operationId, p_staff_id: staffId, p_notes: notes ?? null });
  if (error) { if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return queue(); throw error; }
  return data;
}

/** Creates the visit, DB-priced test snapshots, invoice and optional first payment in one DB transaction. */
export async function createVisitIntake({ tenantId, branchId, patientId, visitNumber, staffId, testIds, discountAmount = 0, initialPayment = 0, paymentMethod = 'cash', referredBy, notes, expectedPrices = [], dependsOn = [], localVisitId = null, localVisitTests = [] } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(patientId, 'patientId'); need(staffId, 'staffId');
  if (!Array.isArray(testIds) || testIds.length === 0) throw new Error('Select at least one test.');
  const discount = Number(discountAmount), payment = Number(initialPayment);
  if (!Number.isFinite(discount) || discount < 0 || !Number.isFinite(payment) || payment < 0) throw new Error('Invalid discount or payment amount.');
  if (!Array.isArray(expectedPrices) || expectedPrices.length !== testIds.length || expectedPrices.some(p => !p?.id || !p?.test_id || !Number.isFinite(Number(p.selling_price)))) throw new Error('Price snapshots are incomplete. Refresh the catalog before registering this visit.');
  const operationId = uuid();
  const payload = {
    patient_id: patientId, visit_number: String(visitNumber || referenceCode('V')).trim(), staff_id: staffId,
    test_ids: testIds, discount_amount: discount, initial_payment: payment, payment_method: paymentMethod,
    referred_by: referredBy ?? null, notes: notes ?? null,
    expected_prices: expectedPrices.map(p => ({ test_id: p.test_id, price_id: p.id, selling_price: Number(p.selling_price) })),
    local_visit_id: localVisitId,
    local_visit_test_ids: Array.isArray(localVisitTests) ? localVisitTests.map(row => ({ id: row.id, test_id: row.test_id })) : [],
  };
  const queue = async () => {
    await enqueueOperation({ tenantId, branchId, entityType: 'visit_intake', action: 'create', operationId, payload, dependsOn, priority: 2 });
    return { queued: true, operationId, visitNumber: payload.visit_number };
  };
  if (globalThis.navigator?.onLine === false || dependsOn.length > 0) return queue();
  const { data, error } = await db().rpc('create_visit_intake_idempotent', {
    p_operation_id: operationId, p_tenant_id: tenantId, p_branch_id: branchId, p_patient_id: patientId,
    p_visit_number: payload.visit_number, p_staff_id: staffId, p_test_ids: testIds,
    p_discount_amount: discount, p_initial_payment: payment, p_payment_method: paymentMethod,
    p_referred_by: payload.referred_by, p_notes: payload.notes, p_expected_prices: payload.expected_prices,
  });
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return queue();
    throw error;
  }
  return { visitId: data, visitNumber: payload.visit_number };
}

/** Returns branch visits with a remaining balance; the RPC aggregates payments securely across collection branches. */
export async function listBranchOutstandingBalances({ tenantId, branchId, limit = 50 } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  if (globalThis.navigator?.onLine === false) throw new Error('عرض المديونيات يحتاج اتصالًا بالإنترنت؛ لم نعرض أرقامًا محلية قد تكون غير مكتملة.');
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const { data, error } = await db().rpc('list_branch_outstanding_balances', { p_tenant_id: tenantId, p_branch_id: branchId, p_limit: safeLimit });
  if (error) throw error;
  return data ?? [];
}
