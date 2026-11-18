import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES, RPC } from '../../core/data/schema-contract.js';
import { enqueueOperation } from '../../offline/outbox.js';
import { cacheRows, cacheScopedPatient, getCachedRows } from '../../offline/cache.js';

const db = () => getSupabaseClient();
const need = (v, n) => { if (!v) throw new Error(`${n} is required.`); };
const uuid = () => crypto.randomUUID();

export async function findPatients({ tenantId, branchId, search, limit = 30 } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  const term = String(search ?? '').trim();
  if (term.length < 2) return [];
  const cachedSearch = async () => (await getCachedRows('patients', { tenantId, branchId }))
    .filter(row => `${row.full_name || ''} ${row.phone || ''}`.toLowerCase().includes(term.toLowerCase()))
    .slice(0, Math.min(Math.max(Number(limit) || 30, 1), 100));
  if (globalThis.navigator?.onLine === false) return cachedSearch();
  // Query each column separately: user text never enters a compound PostgREST filter expression.
  const safeTerm = term.replace(/[%,_*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (safeTerm.length < 2) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const columns = 'id, patient_number, full_name, phone, age_years, sex, created_at';
  const [byName, byPhone] = await Promise.all([
    db().from(TABLES.patients).select(columns).eq('tenant_id', tenantId).eq('branch_id', branchId).ilike('full_name', `%${safeTerm}%`).order('full_name').limit(safeLimit),
    db().from(TABLES.patients).select(columns).eq('tenant_id', tenantId).eq('branch_id', branchId).ilike('phone', `%${safeTerm}%`).order('full_name').limit(safeLimit),
  ]);
  if (byName.error || byPhone.error) {
    if (!globalThis.navigator?.onLine || globalThis.navigator.onLine === false || /fetch|network|offline/i.test(`${byName.error?.message || ''} ${byPhone.error?.message || ''}`)) return cachedSearch();
    throw byName.error || byPhone.error;
  }
  const merged = new Map([...(byName.data ?? []), ...(byPhone.data ?? [])].map(row => [row.id, row]));
  const result = [...merged.values()].sort((a,b) => String(a.full_name).localeCompare(String(b.full_name))).slice(0, safeLimit);
  await Promise.all(result.map(cacheScopedPatient));
  return result;
}

export async function createPatient({ tenantId, branchId, patient } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(patient?.fullName, 'patient.fullName');
  const payload = {
    id: patient.id ?? uuid(), tenant_id: tenantId, branch_id: branchId,
    patient_number: patient.patientNumber ?? null,
    full_name: String(patient.fullName).trim(), phone: patient.phone ?? null,
    age_years: patient.ageYears ?? null, sex: patient.sex ?? 'unknown',
    created_by_staff_id: patient.createdByStaffId ?? null,
  };
  const queue = async () => {
    const operationId = uuid();
    await cacheScopedPatient(payload);
    await enqueueOperation({ tenantId, branchId, entityType: 'patients', action: 'create', operationId, payload });
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
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(patientId, 'patientId'); need(visitNumber, 'visitNumber');
  const workday = await getOpenWorkday({ tenantId, branchId });
  const payload = {
    tenant_id: tenantId, branch_id: branchId, patient_id: patientId,
    workday_id: workday.id, visit_number: String(visitNumber).trim(),
    created_by_staff_id: staffId ?? null, referred_by: referredBy ?? null, notes: notes ?? null,
  };
  const { data, error } = await db().from(TABLES.visits).insert(payload).select().single();
  if (error) throw error;
  return data;
}

/** Adds a test; DB trigger snapshots current price and technical parameters. */
export async function addTestToVisit({ tenantId, branchId, visitId, testId, staffId } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(visitId, 'visitId'); need(testId, 'testId');
  const { data, error } = await db().from(TABLES.visitTests).insert({
    tenant_id: tenantId, branch_id: branchId, visit_id: visitId,
    test_id: testId, created_by_staff_id: staffId ?? null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function createVisitBilling({ tenantId, branchId, visitId, grossTotal, discountAmount = 0 } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(visitId, 'visitId');
  const gross = Number(grossTotal), discount = Number(discountAmount);
  if (!Number.isFinite(gross) || !Number.isFinite(discount) || gross < 0 || discount < 0 || discount > gross) {
    throw new Error('Invalid gross total or discount amount.');
  }
  const { data, error } = await db().from(TABLES.billing).insert({
    tenant_id: tenantId, branch_id: branchId, visit_id: visitId,
    gross_total: gross, discount_amount: discount,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function recordPayment({ tenantId, branchId, visitId, amount, paymentMethod = 'cash', staffId, notes } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(visitId, 'visitId'); need(staffId, 'staffId');
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
  const payload = { visit_id: visitId, amount: value, payment_method: paymentMethod, staff_id: staffId, notes: notes ?? null };
  const queue = async () => { await enqueueOperation({ tenantId, branchId: visitRow.branch_id, entityType: 'payment', action: 'create', operationId, payload }); return { queued: true, operationId }; };
  if (globalThis.navigator?.onLine === false) return queue();
  const { data, error } = await db().rpc(RPC.recordPatientPayment, {
    p_tenant_id: tenantId, p_visit_id: visitId, p_amount: value,
    p_payment_method: paymentMethod, p_idempotency_key: operationId, p_staff_id: staffId,
    p_notes: notes ?? null,
  });
  if (error) { if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return queue(); throw error; }
  return data;
}

/** Creates the visit, DB-priced test snapshots, invoice and optional first payment in one DB transaction. */
export async function createVisitIntake({ tenantId, branchId, patientId, visitNumber, staffId, testIds, discountAmount = 0, initialPayment = 0, paymentMethod = 'cash', referredBy, notes, expectedPrices = [], dependsOn = [] } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(patientId, 'patientId'); need(visitNumber, 'visitNumber'); need(staffId, 'staffId');
  if (!Array.isArray(testIds) || testIds.length === 0) throw new Error('Select at least one test.');
  const discount = Number(discountAmount), payment = Number(initialPayment);
  if (!Number.isFinite(discount) || discount < 0 || !Number.isFinite(payment) || payment < 0) throw new Error('Invalid discount or payment amount.');
  if (!Array.isArray(expectedPrices) || expectedPrices.length !== testIds.length || expectedPrices.some(p => !p?.id || !p?.test_id || !Number.isFinite(Number(p.selling_price)))) {
    throw new Error('Price snapshots are incomplete. Refresh the catalog before registering this visit.');
  }
  const operationId = uuid();
  const payload = {
    patient_id: patientId, visit_number: String(visitNumber).trim(), staff_id: staffId,
    test_ids: testIds, discount_amount: discount, initial_payment: payment,
    payment_method: paymentMethod, referred_by: referredBy ?? null, notes: notes ?? null,
    expected_prices: expectedPrices.map(p => ({ test_id: p.test_id, price_id: p.id, selling_price: Number(p.selling_price) })),
  };
  const queue = async () => {
    await enqueueOperation({ tenantId, branchId, entityType: 'visit_intake', action: 'create', operationId, payload, dependsOn });
    return { queued: true, operationId };
  };
  // A newly queued patient must reach the server before its dependent visit.
  // Keep the child operation queued even if connectivity has just returned.
  if (globalThis.navigator?.onLine === false || dependsOn.length > 0) return queue();
  const { data, error } = await db().rpc('create_visit_intake_idempotent', {
    p_operation_id: operationId, p_tenant_id: tenantId, p_branch_id: branchId,
    p_patient_id: patientId, p_visit_number: payload.visit_number, p_staff_id: staffId,
    p_test_ids: testIds, p_discount_amount: discount, p_initial_payment: payment,
    p_payment_method: paymentMethod, p_referred_by: payload.referred_by, p_notes: payload.notes,
    p_expected_prices: payload.expected_prices,
  });
  if (error) {
    if (/fetch|network|offline/i.test(error.message || '') || globalThis.navigator?.onLine === false) return queue();
    throw error;
  }
  return data;
}
