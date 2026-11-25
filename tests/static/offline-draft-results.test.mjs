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
const reception = read('assets/js/reception.js');
const intake = read('modules/reception/repository.js');
const adapters = read('offline/supabase-adapters.js');
const report = read('modules/laboratory/repository.js');
const backup = read('offline/backup.js');
const settings = read('modules/settings/repository.js');
const catalog = read('modules/catalog/repository.js');

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

test('unsynced draft results survive rerender and local approval waits for server validation', () => {
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

test('offline reception creates a locally linked visit/test worklist and chains result saves behind intake', () => {
  assert.match(reception, /localVisitTests/);
  assert.match(reception, /فتح النتائج دون اتصال/);
  assert.match(intake, /cacheRows\('visits'/);
  assert.match(intake, /cacheRows\('visit_tests'/);
  assert.match(repository, /dependsOn, priority: 3/);
  assert.match(adapters, /visit-map:/);
  assert.match(adapters, /local_visit_test_ids/);
  assert.match(adapters, /save_draft_results_idempotent/);
  assert.match(report, /globalThis\.navigator\?\.onLine === false[\s\S]*getCachedRows\('visit_tests'/);
});

test('offline culture isolate and susceptibility writes are durable, dependency ordered and idempotent', () => {
  const cultureMigration = read('database/migrations/075_offline_culture_idempotency.sql');
  assert.match(culture, /entityType:'culture_isolate'/);
  assert.match(culture, /entityType:'culture_susceptibility'/);
  assert.match(culture, /local_isolate_operation_id/);
  assert.match(adapters, /culture_isolate: async operation/);
  assert.match(adapters, /culture_susceptibility: async operation/);
  assert.match(adapters, /isolate-map:/);
  assert.match(cultureMigration, /save_culture_isolate_idempotent/);
  assert.match(cultureMigration, /save_culture_susceptibility_idempotent/);
  assert.match(cultureMigration, /offline_operation_receipts/);
  assert.match(cultureMigration, /Completed or approved culture results are locked/);
});

test('offline report printing is explicitly provisional and includes queued local draft values', () => {
  assert.match(ui, /طباعة مسودة غير معتمدة/);
  assert.match(ui, /لا تُسلّم باعتبارها تقريرًا نهائيًا/);
  assert.match(ui, /pendingRows/);
});

test('offline navigation reuses cached membership, catalog parameters, lab identity and print settings', () => {
  assert.match(read('core/tenant/context.js'), /cachedContext\(\)/);
  assert.match(catalog, /warmCatalogParameters/);
  assert.match(reception, /warmCatalogParameters/);
  assert.match(settings, /lab-settings:/);
  assert.match(settings, /print-settings:/);
  assert.match(intake, /const columns = 'id, tenant_id, branch_id, patient_number/);
});

test('local backups include culture caches and continue restoring older backup formats', () => {
  assert.match(backup, /const VERSION = 3/);
  assert.match(backup, /culture_isolates/);
  assert.match(backup, /culture_susceptibilities/);
  assert.match(backup, /V2_VERSION/);
});

test('offline derived results use the catalog formula AST for provisional display and print', () => {
  assert.match(ui, /evaluateLocalFormula/);
  assert.match(ui, /calculateLocalDerivedResults/);
  assert.match(ui, /local-calculated:/);
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
