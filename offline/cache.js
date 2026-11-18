import { offlineDb } from './database.js';

export async function cacheRows(tableName, rows = []) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const table = offlineDb.table(tableName);
  const safe = rows.filter(row => row?.id && row?.tenant_id).map(row => ({ ...row, cached_at: new Date().toISOString() }));
  if (safe.length) await table.bulkPut(safe);
  return safe.length;
}

export async function getCachedRows(tableName, { tenantId, branchId, testId } = {}) {
  if (!tenantId) throw new Error('tenantId is required for offline cache reads.');
  let rows = await offlineDb.table(tableName).where('tenant_id').equals(tenantId).toArray();
  if (branchId) rows = rows.filter(row => row.branch_id === branchId);
  if (testId) rows = rows.filter(row => row.test_id === testId);
  return rows;
}

export async function cacheScopedPatient(patient) {
  if (!patient?.id || !patient?.tenant_id || !patient?.branch_id) return;
  await offlineDb.patients.put({ ...patient, cached_at: new Date().toISOString() });
}

/** Replace cached rows for one tenant-scoped slice without touching other tenants. */
export async function replaceCachedRows(tableName, rows = [], { tenantId, branchId, testId } = {}) {
  if (!tenantId) throw new Error('tenantId is required for scoped cache replacement.');
  if (!Array.isArray(rows)) throw new Error('rows must be an array.');
  const table = offlineDb.table(tableName);
  const existing = await table.where('tenant_id').equals(tenantId).toArray();
  const inScope = row => (!branchId || row.branch_id === branchId) && (!testId || row.test_id === testId);
  const stale = existing.filter(inScope);
  if (stale.length) await table.bulkDelete(stale.map(row => row.id));
  const safe = rows
    .filter(row => row?.id && row?.tenant_id === tenantId && (!branchId || row.branch_id === branchId) && (!testId || row.test_id === testId))
    .map(row => ({ ...row, cached_at: new Date().toISOString() }));
  if (safe.length) await table.bulkPut(safe);
  return safe.length;
}
/** Refresh current prices for selected tests without deleting historical price rows.
 * Existing current rows absent from the server response are demoted to history;
 * returned current rows are then upserted into the tenant-scoped cache.
 */
export async function replaceCachedCurrentPrices(rows = [], { tenantId, testIds, branchId = null, scope = 'all' } = {}) {
  if (!tenantId) throw new Error('tenantId is required for current-price cache refresh.');
  if (!Array.isArray(rows) || !Array.isArray(testIds) || testIds.some(id => !id)) {
    throw new Error('rows and testIds must be arrays with valid test IDs.');
  }
  const scopedIds = new Set(testIds);
  const inBranchScope = row => scope === 'base' ? row.branch_id == null : scope === 'branch' ? row.branch_id === branchId : (!branchId || row.branch_id == null || row.branch_id === branchId);
  const safe = rows.filter(row => row?.id && row.tenant_id === tenantId
    && scopedIds.has(row.test_id) && inBranchScope(row) && row.is_current === true)
    .map(row => ({ ...row, cached_at: new Date().toISOString() }));
  const currentIds = new Set(safe.map(row => row.id));
  const table = offlineDb.table('test_prices');
  await offlineDb.transaction('rw', table, async () => {
    const existing = await table.where('tenant_id').equals(tenantId).toArray();
    const historicalized = existing
      .filter(row => scopedIds.has(row.test_id) && inBranchScope(row) && row.is_current === true && !currentIds.has(row.id))
      .map(row => ({ ...row, is_current: false, cached_at: new Date().toISOString() }));
    if (historicalized.length) await table.bulkPut(historicalized);
    if (safe.length) await table.bulkPut(safe);
  });
  return safe.length;
}

