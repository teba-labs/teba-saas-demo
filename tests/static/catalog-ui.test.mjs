import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('catalog screen is Arabic RTL and exposes test, parameter and price management controls', () => {
  const html = read('app/catalog.html');
  for (const token of ['lang="ar"', 'dir="rtl"', 'testForm', 'parameterForm', 'priceForm', 'tenantSelect', 'showInactive']) assert.ok(html.includes(token), `missing ${token}`);
  assert.ok(fs.existsSync(path.join(root, 'assets/css/catalog.css')));
  assert.ok(fs.existsSync(path.join(root, 'assets/js/catalog.js')));
});

test('catalog screen uses authenticated tenant context and owner-only price editing', () => {
  const js = read('assets/js/catalog.js');
  assert.match(js, /loadMyTenantContext/);
  assert.match(js, /accountType==='owner'/);
  assert.match(js, /إدارة كتالوج التحاليل والأسعار متاحة لمالك المعمل فقط/);
  assert.match(js, /\$\('priceForm'\)\.hidden=state\.role!=='owner'/);
  assert.match(js, /if\(state\.role!=='owner'\|\|!state\.selectedTest\)return/);
  assert.match(js, /requireOnline\(\)/);
  assert.match(js, /parseJsonField\('parameterRanges','المدى المرجعي',true\)/);
});

test('catalog UI uses tenant-scoped repository methods and deactivation instead of deletion', () => {
  const js = read('assets/js/catalog.js');
  for (const name of ['listCatalog','listCurrentPrices','listTestParameters','saveCatalogTest','saveTestParameter','setTestParameterActive' ,'setCurrentPrice','setBranchPrice']) assert.ok(js.includes(name), `missing ${name}`);
  assert.doesNotMatch(js, /\.delete\(/);
});

test('catalog screen and assets are included in the offline application shell', () => {
  const sw = read('service-worker.js');
  for (const asset of ['./app/catalog.html','./assets/css/catalog.css','./assets/js/catalog.js']) assert.ok(sw.includes(asset), `missing ${asset}`);
  assert.match(sw, /taiba-smart-lab-shell-v11/);
  assert.match(sw, /modules\/migration\/price-importer\.js/);
});

test('parameter repository supports inactive rows only when management explicitly requests them', () => {
  const repo = read('modules/catalog/repository.js');
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
