import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('catalog screen is Arabic RTL and exposes test, parameter and price management controls', () => {
  const html = read('app/catalog.html');
  for (const token of ['lang="ar"', 'dir="rtl"', 'testForm', 'parameterForm', 'priceForm', 'tenantSelect', 'showInactive', 'masterCatalogPanel', 'masterCatalogSearch', 'testPreparation', 'parameterApplicability']) assert.ok(html.includes(token), `missing ${token}`);
  assert.ok(fs.existsSync(path.join(root, 'assets/css/catalog.css')));
  assert.ok(fs.existsSync(path.join(root, 'assets/js/catalog.js')));
});

test('catalog screen uses authenticated tenant context and owner-only price editing', () => {
  const html = read('app/catalog.html');
  const js = read('assets/js/catalog.js');
  assert.match(js, /loadMyTenantContext/);
  assert.match(js, /accountType==='owner'/);
  assert.match(js, /إدارة كتالوج التحاليل والأسعار متاحة لمالك المعمل فقط/);
  assert.match(js, /\$\('priceForm'\)\.hidden=state\.role!=='owner'/);
  assert.match(js, /if\(state\.role!=='owner'\|\|!state\.selectedTest\)return/);
  assert.match(js, /requireOnline\(\)/);
  for (const control of ['parameterInputMode','parameterRangeRows','addReferenceRange','parameterMaxSelections','conditionParameterCode','conditionVisibleValues','parameterChoiceScoresField','parameterChoiceScores']) {
    assert.ok(html.includes('id="'+control+'"'), 'missing doctor-friendly editor control '+control);
  }
  assert.doesNotMatch(html, /id="parameterRanges"/);
  assert.ok(!js.includes("parseJsonField('parameterRanges'"), 'reference ranges must not use JSON text entry');
  assert.ok(js.includes('readRangeRows('));
  assert.ok(js.includes('readDisplayRules('));
  assert.match(js, /resultInputMode/);
});

test('catalog UI uses tenant-scoped repository methods and deactivation instead of deletion', () => {
  const js = read('assets/js/catalog.js');
  for (const name of ['listCatalog','listCurrentPrices','listTestParameters','saveCatalogTest','saveTestParameter','setTestParameterActive' ,'setCurrentPrice','setBranchPrice']) assert.ok(js.includes(name), `missing ${name}`);
  assert.doesNotMatch(js, /\.delete\(/);
});

test('catalog screen and assets are included in the offline application shell', () => {
  const sw = read('service-worker.js');
  for (const asset of ['./app/catalog.html','./assets/css/catalog.css','./assets/js/catalog.js']) assert.ok(sw.includes(asset), `missing ${asset}`);
  assert.match(sw, /taiba-smart-lab-shell-v\d+/);
  assert.match(sw, /modules\/migration\/price-importer\.js/);
});

test('parameter repository supports inactive rows only when management explicitly requests them', () => {
  const repo = read('modules/catalog/repository.js');
  assert.match(repo, /listMasterCatalogTests/);
  assert.match(repo, /importMasterCatalogTest/);
  assert.match(repo, /listTestParameters\(\{ tenantId, testId, includeInactive = false \}/);
  assert.match(repo, /return \(data \?\? \[\]\)\.filter\(row => includeInactive \|\| row\.is_active\)/);
});

test('launcher exposes catalog management to owner accounts only', () => {
  const launcher = read('assets/js/app-home.js');
  assert.match(launcher, /id:'catalog'[\s\S]*?href:'catalog\.html'[\s\S]*?roles:\['owner'\]/);
});

test('catalog tenant switching has one change handler and ignores stale asynchronous loads', () => {
  const js = read('assets/js/catalog.js');
  assert.equal((js.match(/tenantSelect'\)\.addEventListener\('change'/g) || []).length, 1);
  assert.doesNotMatch(js, /tenantSelect'\)\.onchange\s*=/);
  assert.match(js, /tenantRequest/);
  assert.match(js, /requestId!==state\.tenantRequest/);
  assert.match(js, /selectionRequest/);
  assert.match(js, /requestId!==state\.selectionRequest/);
});

test('catalog price cache replacement is transactional in IndexedDB', () => {
  const cache = read('offline/cache.js');
  const body = cache.slice(cache.indexOf('export async function replaceCachedCurrentPrices'));
  assert.match(body, /offlineDb\.transaction\('rw', table, async \(\) =>/);
  assert.match(body, /bulkPut\(historicalized\)/);
  assert.match(body, /bulkPut\(safe\)/);
});

test('catalog edits flow through reception, immutable visit snapshots, results and reports', () => {
  const catalogRepo = read('modules/catalog/repository.js');
  const receptionJs = read('assets/js/reception.js');
  const receptionRepo = read('modules/reception/repository.js');
  const resultJs = read('assets/js/results-workbench.js');
  const resultRepo = read('modules/results/repository.js');

  // Catalog and parameter changes are persisted to the tenant's cloud tables.
  assert.match(catalogRepo, /from\(TABLES\.catalog\)\.upsert\(payload\)/);
  assert.match(catalogRepo, /query\.update\(payload\)/);
  assert.match(catalogRepo, /query\.insert\(payload\)/);
  assert.match(catalogRepo, /eq\('tenant_id', tenantId\)\.eq\('test_id', testId\)\.eq\('id', id\)/);
  assert.match(catalogRepo, /from\(TABLES\.prices\)/);

  // Reception consumes the same tenant catalog, branch-effective prices and parameter definitions.
  for (const token of ['listCatalog', 'listCurrentPrices', 'listTestParameters', 'createVisitIntake']) {
    assert.ok(receptionJs.includes(token), `reception missing ${token}`);
  }
  assert.match(receptionRepo, /create_visit_intake_idempotent/);
  assert.match(receptionRepo, /expected_prices/);
  assert.match(receptionRepo, /DB trigger snapshots current price and technical parameters/);

  // Results are rendered from the visit's frozen technical snapshot and saved atomically to Supabase.
  assert.match(resultJs, /technical_snapshot\?\.parameters/);
  assert.match(resultJs, /saveDraftResults/);
  assert.match(resultRepo, /save_draft_results_idempotent/);
  assert.match(read('database/migrations/074_offline_draft_results_idempotency.sql'), /save_draft_results_atomic\(/);
  assert.match(resultJs, /printVisitReport/);
  assert.match(resultJs, /test_name_snapshot/);
});

test('master catalog import is operational immediately and does not require customer-side clinical approval', () => {
  const migration = read('database/migrations/109_promote_verified_profiles_enable_zero_price_and_master_import.sql');
  const ui = read('assets/js/catalog.js');
  assert.match(migration, /import_master_catalog_test_unchecked/);
  assert.match(migration, /ensure_zero_base_price_for_new_test/);
  assert.match(ui, /جاهز للاستخدام والتعديل داخل كتالوج المعمل بعد الاستيراد/);
  assert.doesNotMatch(ui, /المدى يحتاج تحققًا محليًا|مراجعة البيانات إرشادية وغير مانعة/);
});
