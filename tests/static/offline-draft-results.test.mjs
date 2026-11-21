import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const migration = read('database/migrations/074_offline_draft_results_idempotency.sql');
const repository = read('modules/results/repository.js');
const adapter = read('offline/supabase-adapters.js');
const outbox = read('offline/outbox.js');
const ui = read('assets/js/results-workbench.js');
const sync = read('offline/background-sync.js');
const worklist = read('modules/laboratory/repository.js');
const cacheSchema = read('offline/database.js');
const culture = read('modules/results/culture-repository.js');

test('offline draft-result writes use a stable operation ID and server idempotency RPC', () => {
  assert.match(repository, /save_draft_results_idempotent/);
  assert.match(repository, /operationId = crypto\.randomUUID\(\)/);
  assert.match(repository, /entityType: 'draft_results'/);
  assert.match(adapter, /p_operation_id: operation\.operation_id/);
  assert.match(adapter, /save_draft_results_idempotent/);
});

test('server receipt is tenant/branch scoped, actor-bound, payload-bound, and atomic', () => {
  assert.match(migration, /private\.offline_operation_receipts/);
  assert.match(migration, /primary key \(tenant_id, branch_id, operation_id\)/);
  assert.match(migration, /private\.can_access_branch\(p_tenant_id, p_branch_id\)/);
  assert.match(migration, /created_by is distinct from auth\.uid\(\)/);
  assert.match(migration, /payload is distinct from v_payload/);
  assert.match(migration, /save_draft_results_atomic\(/);
  assert.match(migration, /revoke all on table private\.offline_operation_receipts/);
});

test('unsynced draft results survive workbench rerender and cannot be completed or approved prematurely', () => {
  assert.match(outbox, /listPendingDraftResults/);
  assert.match(ui, /listPendingDraftResults/);
  assert.match(ui, /محفوظ محليًا — بانتظار المزامنة/);
  assert.match(ui, /هناك نتائج محلية لم تصل إلى السحابة بعد/);
  assert.match(sync, /taiba:offline-sync-complete/);
});

test('subscription expiry does not gate outbox acknowledgement or erase queued operations', () => {
  assert.doesNotMatch(outbox, /subscription|entitlement|expires_at/i);
  assert.match(outbox, /await offlineDb\.outbox\.delete\(item\.local_id\)/);
});

test('previously loaded branch worklist, staff, result values and culture reads are cached for offline review', () => {
  assert.match(worklist, /getCachedRows\('visit_tests'/);
  assert.match(worklist, /cacheRows\('visit_tests'/);
  assert.match(repository, /getCachedRows\('test_results'/);
  assert.match(repository, /cacheRows\('test_results'/);
  assert.match(cacheSchema, /culture_isolates/);
  assert.match(cacheSchema, /culture_susceptibilities/);
  assert.match(culture, /getCachedRows\('culture_isolates'/);
  assert.match(ui, /getCachedRows\('staff_directory'/);
});
