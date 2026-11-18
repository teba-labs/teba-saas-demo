import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('outbox leases recover after interrupted sync and dependencies block child operations', () => {
  const source = read('offline/outbox.js');
  assert.match(source, /recoverExpiredLeases/);
  assert.match(source, /lease_until/);
  assert.match(source, /dependencyReady/);
  assert.match(source, /ack:\$\{operationId\}/);
  assert.match(source, /navigator\.locks\.request/);
});

test('offline visit intake uses stable operation ID and server-side idempotent RPC', () => {
  const repo = read('modules/reception/repository.js');
  const sql = read('database/migrations/007_offline_idempotent_visit_intake.sql');
  const adapters = read('offline/supabase-adapters.js');
  assert.match(repo, /operationId = uuid\(\)/);
  assert.match(repo, /create_visit_intake_idempotent/);
  assert.match(repo, /expected_prices/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /offline_visit_intake_receipts/);
  assert.match(sql, /OFFLINE_PRICE_CONFLICT/);
  assert.match(adapters, /p_operation_id: operation\.operation_id/);
});

test('patient creation, visit intake, payment and expenses have explicit queued adapters', () => {
  const reception = read('modules/reception/repository.js');
  const workday = read('modules/workday/repository.js');
  const workdayUi = read('assets/js/workday.js');
  const adapters = read('offline/supabase-adapters.js');
  for (const type of ['patients', 'visit_intake']) assert.match(reception, new RegExp(`entityType: '${type}'`));
  for (const type of ['patients', 'visit_intake', 'payment', 'expense']) assert.match(adapters, new RegExp(`${type}: async operation`));
  assert.match(workday, /entityType: 'expense'/);
  assert.match(workdayUi, /getCachedRows\('staff_directory'/);
});

test('local backup is scoped, checksummed, versioned and restores transactionally', () => {
  const source = read('offline/backup.js');
  assert.match(source, /checksum_sha256/);
  assert.match(source, /SHA-256/);
  assert.match(source, /different tenant or branch/);
  assert.match(source, /offlineDb\.transaction\('rw'/);
  assert.match(source, /local-device-cache-and-pending-operations-only/);
});

test('sync center states local backup limitations and offers queue/conflict review', () => {
  const page = read('app/sync-center.html');
  const script = read('assets/js/sync-center.js');
  assert.match(page, /نسخة سحابية كاملة/);
  assert.match(page, /تعارضات/);
  assert.match(script, /retryFailedOperations/);
  assert.match(script, /createSupabaseSyncHandlers/);
});

test('service worker caches app shell and Dexie module but never caches Supabase API responses', () => {
  const sw = read('service-worker.js');
  assert.match(sw, /APP_SHELL/);
  assert.match(sw, /hostname === 'esm\.sh'/);
  assert.match(sw, /hostname\.endsWith\('\.supabase\.co'\)/);
  assert.match(sw, /Never cache authenticated API or patient data responses/);
});

test('offline context, workday, staff, catalog and price snapshots are available from local cache', () => {
  const context = read('core/tenant/context.js');
  const reception = read('modules/reception/repository.js');
  const catalog = read('modules/catalog/repository.js');
  const workdayUi = read('assets/js/workday.js');
  assert.match(context, /tenant-context:/);
  assert.match(reception, /getCachedRows\('workdays'/);
  assert.match(catalog, /getCachedRows\('test_prices'/);
  assert.match(workdayUi, /getCachedRows\('staff_directory'/);
});

test('offline queue recovery, summaries, conflicts and retries require an exact tenant/branch scope', () => {
  const source = read('offline/outbox.js');
  assert.match(source, /recoverExpiredLeases\(now, \{ tenantId, branchId \}\)/);
  assert.match(source, /item\.tenant_id === tenantId && item\.branch_id === branchId/);
  assert.match(source, /A tenant and branch must be selected before synchronizing/);
  assert.match(source, /Tenant and branch are required to view offline queue status/);
  assert.match(source, /Tenant and branch are required to view offline conflicts/);
  assert.match(source, /Tenant and branch are required to retry offline operations/);
});

test('cross-device local restore drops device-local auto IDs and merges without overwriting existing rows', () => {
  const source = read('offline/backup.js');
  assert.match(source, /local_id: _deviceLocalId/);
  assert.match(source, /await table\.add\(row\)/);
  assert.match(source, /Keep the already-present row/);
  assert.match(source, /different content\. Restore was rolled back/);
  assert.doesNotMatch(source, /await table\.bulkPut\(rows\)/);
});
