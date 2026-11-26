import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('outbox treats repeated operation IDs as idempotent only for identical scoped payloads', () => {
  const source = read('offline/outbox.js');
  assert.match(source, /stableJson\(existing\.payload\) === stableJson\(safePayload\)/);
  assert.match(source, /existing\.tenant_id === tenantId/);
  assert.match(source, /existing\.branch_id === branchId/);
  assert.match(source, /Offline operation ID was reused with different scope or payload/);
  assert.match(source, /offlineDb\.transaction\('rw', offlineDb\.outbox/);
});

test('dependency acknowledgements cannot be borrowed across tenant or branch scope', () => {
  const source = read('offline/outbox.js');
  assert.match(source, /acknowledged\.tenant_id !== item\.tenant_id/);
  assert.match(source, /acknowledged\.branch_id !== item\.branch_id/);
});

test('only the current lease owner may acknowledge, conflict, or fail an operation', () => {
  const source = read('offline/outbox.js');
  assert.match(source, /current\.sync_owner !== owner/);
  assert.match(source, /current\.status !== 'syncing'/);
  assert.match(source, /current\.operation_id !== item\.operation_id/);
  assert.match(source, /const applied = await offlineDb\.transaction/);
  assert.match(source, /const retained = await markFailure\(item,[\s\S]*?maxAttempts, owner\)/);
});

test('every local service-worker shell asset exists in the repository', () => {
  const source = read('service-worker.js');
  const shell = source.match(/const APP_SHELL = \[([\s\S]*?)\n\];/);
  assert.ok(shell, 'APP_SHELL array must be present');
  const assets = [...shell[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.ok(assets.length > 40, 'the complete application shell must be cached');
  for (const asset of assets) {
    if (/^https?:\/\//.test(asset)) continue;
    const localPath = path.join(root, asset.replace(/^\.\//, '').split('?')[0]);
    assert.ok(fs.existsSync(localPath), `missing offline shell asset: ${asset}`);
  }
  for (const required of [
    './offline/database.js', './offline/outbox.js', './offline/cache.js',
    './offline/backup.js', './offline/supabase-adapters.js',
    './offline/background-sync.js', './modules/reception/repository.js',
    './modules/results/repository.js',
  ]) assert.ok(assets.includes(required), `offline-critical module is not precached: ${required}`);
});

test('service worker falls back to cache after a bounded network attempt and never caches Supabase API responses', () => {
  const source = read('service-worker.js');
  assert.match(source, /fetchWithTimeout/);
  assert.match(source, /AbortController/);
  assert.match(source, /cache\.match\(request\)/);
  assert.match(source, /hostname\.endsWith\('\.supabase\.co'\)/);
  assert.match(source, /Never cache authenticated API or patient data responses/);
});

test('Sync Center reports persistent storage and quota without deleting local data', () => {
  const database = read('offline/database.js');
  const page = read('app/sync-center.html');
  const script = read('assets/js/sync-center.js');
  assert.match(database, /getOfflineStorageHealth/);
  assert.match(database, /requestPersistentOfflineStorage/);
  assert.match(database, /storage\.persist\(\)/);
  assert.match(database, /storage\.estimate\(\)/);
  assert.match(page, /id="protectStorage"/);
  assert.match(page, /لا نحذف أي بيانات تلقائيًا/);
  assert.match(script, /refreshStorageHealth/);
  assert.match(script, /requestPersistentOfflineStorage/);
});


test('offline preparation warms a branch-scoped working set and records its limits', () => {
  const prepare = read('offline/prepare.js');
  const reception = read('modules/reception/repository.js');
  const page = read('app/sync-center.html');
  const script = read('assets/js/sync-center.js');
  const sw = read('service-worker.js');
  assert.match(prepare, /loadMyTenantContext/);
  assert.match(prepare, /tenant\?\.branches\?\.find/);
  assert.match(prepare, /warmCatalogParameters/);
  assert.match(prepare, /listCurrentPrices/);
  assert.match(prepare, /warmBranchPatients/);
  assert.match(prepare, /listBranchWorkPage/);
  assert.match(prepare, /listResultsForVisitTests/);
  assert.match(prepare, /listCultureResults/);
  assert.match(prepare, /offline-prepared:/);
  assert.match(prepare, /maxWorklistRows = 500/);
  assert.match(reception, /warmBranchPatients/);
  assert.match(reception, /range\(offset, end\)/);
  assert.match(reception, /count: 'exact'/);
  assert.match(prepare, /missingPrices/);
  assert.match(prepare, /tests_without_current_price/);
  assert.match(prepare, /has_open_workday: Boolean\(workday\)/);
  assert.doesNotMatch(prepare, /لا يوجد يوم عمل مفتوح محفوظ/);
  assert.match(prepare, /complete: issues\.length === 0/);
  assert.match(page, /id="prepareOffline"/);
  assert.match(script, /prepareOfflineBranch/);
  assert.match(script, /getOfflinePreparationStatus/);
  assert.match(sw, /'\.\/offline\/prepare\.js'/);
});
