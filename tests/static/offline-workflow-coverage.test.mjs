import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('offline session restore is limited to a previously prepared authenticated device', () => {
  const auth = read('core/auth/session.js');
  const identity = read('offline/device-identity.js');
  const entitlement = read('offline/entitlement.js');
  assert.match(auth, /if \(isOffline\(\)\)\s*\{\s*const user = await getCachedOfflineUser\(\)/);
  assert.match(identity, /if \(!device\?\.offline_session_ready \|\| !device\.user_id\) return null/);
  assert.match(entitlement, /setOfflineSessionReady\(true\)/);
  assert.match(auth, /تسجيل الدخول لأول مرة يحتاج اتصالًا بالإنترنت/);
});

test('reception queues patient and visit intake locally and reuses the prepared open workday', () => {
  const reception = read('modules/reception/repository.js');
  const ui = read('assets/js/reception.js');
  assert.match(reception, /entityType: 'patients', action: 'create'/);
  assert.match(reception, /if \(globalThis\.navigator\?\.onLine === false\) return queue\(\)/);
  assert.match(reception, /const cached = await getCachedRows\('workdays', \{ tenantId, branchId \}\)/);
  assert.match(reception, /entityType: 'visit_intake', action: 'create'/);
  assert.match(reception, /cacheRows\('visits'/);
  assert.match(reception, /cacheRows\('visit_tests'/);
  assert.match(ui, /searchParams\.set\('visit_id',visitId\)/);
  const catalog = ui.slice(ui.indexOf('function renderCatalog()'), ui.indexOf('async function saveQuickCatalogPrice'));
  assert.doesNotMatch(catalog, /\$\{!price\?'disabled'/);
  assert.match(catalog, /price\?\.selling_price\?\?0/);
});

test('results workbench reads cached visit work and queues draft results behind local intake', () => {
  const lab = read('modules/laboratory/repository.js');
  const results = read('modules/results/repository.js');
  const ui = read('assets/js/results-workbench.js');
  const outbox = read('offline/outbox.js');
  assert.match(lab, /if \(globalThis\.navigator\?\.onLine === false\) return localWorklist\(\)/);
  assert.match(lab, /getCachedRows\('visit_tests'/);
  assert.match(results, /entityType: 'draft_results', action: 'save'/);
  assert.match(results, /if \(globalThis\.navigator\?\.onLine === false\) return queue\(\)/);
  assert.match(ui, /dependsOn: item\.local_intake_operation_id \? \[item\.local_intake_operation_id\] : \[\]/);
  assert.match(outbox, /async function dependencyReady/);
  assert.match(outbox, /ack:\$\{operationId\}/);
});

test('offline report preview and printing are visibly marked as unapproved local work copies', () => {
  const ui = read('assets/js/results-workbench.js');
  assert.match(ui, /UNAPPROVED WORK COPY/);
  assert.match(ui, /Print work copy — not approved/);
  assert.match(ui, /const localOffline = .*visit\.local_offline/);
  assert.match(ui, /if \(globalThis\.navigator\?\.onLine === false \|\| localOffline\)/);
});

test('dashboard switches to a clearly limited local summary while offline', () => {
  const dashboard = read('assets/js/dashboard.js');
  const summary = read('offline/dashboard-summary.js');
  assert.match(dashboard, /getOfflineDashboardSummary/);
  assert.match(dashboard, /if\(navigator\.onLine===false\)/);
  assert.match(dashboard, /renderOfflineDashboard\(local\)/);
  assert.match(dashboard, /البيانات التالية من البيانات المحفوظة على هذا الجهاز فقط/);
  assert.match(summary, /pending/);
});

test('offline application shell includes the requested core pages and dependencies', () => {
  const sw = read('service-worker.js');
  for (const path of [
    './app/index.html', './app/catalog.html', './app/reception.html',
    './app/results-workbench.html', './app/dashboard.html',
    './assets/js/catalog.js', './assets/js/reception.js',
    './assets/js/results-workbench.js', './assets/js/dashboard.js',
    './offline/database.js', './offline/outbox.js',
    './offline/entitlement.js', './offline/supabase-adapters.js'
  ]) assert.ok(sw.includes(path), 'service worker shell is missing ' + path);
});

test('offline queue remains protected by signed entitlement and synchronization is not entitlement-gated', () => {
  const queue = read('offline/outbox.js');
  const policy = read('offline/queue-policy.js');
  const sync = read('offline/outbox.js');
  assert.match(queue, /await assertQueueAllowed\(\{ tenantId, branchId \}\)/);
  assert.match(policy, /assertOfflineEntitlement/);
  assert.match(sync, /export async function syncOutbox/);
  assert.match(sync, /if \(globalThis\.navigator && navigator\.onLine === false\)/);
});
