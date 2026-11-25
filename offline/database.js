import Dexie from 'https://esm.sh/dexie@4';

/** New DB name avoids mutating or colliding with the legacy TebaLabOfflineDB. */
export const offlineDb = new Dexie('TaibaSmartLabOfflineDB');
const stores = {
  patients: 'id, tenant_id, branch_id, updated_at',
  visits: 'id, tenant_id, branch_id, patient_id, workday_id, visit_number, updated_at',
  visit_tests: 'id, tenant_id, branch_id, visit_id, status, updated_at',
  test_results: 'id, tenant_id, branch_id, visit_test_id, updated_at',
  catalog: 'id, tenant_id, code, is_active, updated_at',
  test_prices: 'id, tenant_id, test_id, is_current, effective_from',
  test_parameters: 'id, tenant_id, test_id, parameter_code, is_active',
  staff_directory: 'id, tenant_id, branch_id, is_active',
  workdays: 'id, tenant_id, branch_id, work_date, status',
  expense_categories: 'id, tenant_id, is_active',
  financial_ledger: 'id, tenant_id, branch_id, work_date, movement_at',
  daily_closings: 'id, tenant_id, branch_id, work_date',
  culture_isolates: 'id, tenant_id, branch_id, visit_test_id, isolate_number',
  culture_susceptibilities: 'id, tenant_id, branch_id, isolate_id, antimicrobial_agent',
  outbox: '++local_id, &operation_id, [tenant_id+branch_id], status, created_at, next_attempt_at, entity_type',
  sync_meta: '&key',
  conflicts: '++local_id, &conflict_id, tenant_id, branch_id, created_at, status',
};
offlineDb.version(1).stores({ ...stores });
offlineDb.version(2).stores({ ...stores });
offlineDb.version(3).stores({
  ...stores,
  test_prices: 'id, tenant_id, test_id, branch_id, is_current, effective_from',
});
offlineDb.version(4).stores({ ...stores });
/** Non-exportable device signing key is deliberately kept outside portable backups. */
offlineDb.version(5).stores({ ...stores, device_identity: '&id' });

export async function assertOfflineDatabaseReady() {
  await offlineDb.open();
  return offlineDb.tables.map(table => table.name);
}

/**
 * Report browser storage durability and quota without modifying or deleting
 * any local records. Persistent storage is best-effort and browser-controlled.
 */
export async function getOfflineStorageHealth() {
  const storage = globalThis.navigator?.storage;
  if (!storage) return { supported: false, persistent: false, usage: null, quota: null, remaining: null, usageRatio: null };

  let persistent = false;
  let estimate = {};
  try { if (typeof storage.persisted === 'function') persistent = await storage.persisted(); } catch { /* report unknown as not persistent */ }
  try { if (typeof storage.estimate === 'function') estimate = await storage.estimate(); } catch { /* quota may be unavailable */ }

  const usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
  const quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
  const remaining = usage !== null && quota !== null ? Math.max(0, quota - usage) : null;
  const usageRatio = usage !== null && quota > 0 ? usage / quota : null;
  return { supported: typeof storage.persist === 'function', persistent, usage, quota, remaining, usageRatio };
}

/** Call only from an explicit user action; the browser decides whether to grant persistence. */
export async function requestPersistentOfflineStorage() {
  const storage = globalThis.navigator?.storage;
  if (!storage || typeof storage.persist !== 'function') return getOfflineStorageHealth();
  try { await storage.persist(); } catch { /* return the actual browser-reported state below */ }
  return getOfflineStorageHealth();
}
