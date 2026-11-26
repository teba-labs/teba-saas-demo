import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('catalog repository exposes tenant-scoped test and parameter management with offline review proposals', () => {
  const source = read('modules/catalog/repository.js');
  for (const name of ['saveCatalogTest', 'setCatalogTestActive', 'saveTestParameter', 'setTestParameterActive']) {
    assert.match(source, new RegExp(`export async function ${name}\\b`));
  }
  assert.match(source, /\.eq\('tenant_id', tenantId\)/);
  assert.match(source, /\.eq\('test_id', testId\)/);
  assert.match(source, /أضف الاختيارات المطلوبة لهذا النوع من النتائج/);
  assert.match(source, /يجب أن تكون المديات المرجعية قائمة/);
  assert.match(source, /decimalPlaces must be from 0 to 6/);
  assert.match(source, /Preserve parameter history\/snapshots by toggling is_active/);
  assert.doesNotMatch(source, /\.delete\(\)/);
});

test('catalog cache refresh replaces only the intended tenant slice and keeps other tenants isolated', () => {
  const cache = read('offline/cache.js');
  assert.match(cache, /export async function replaceCachedRows/);
  assert.match(cache, /where\('tenant_id'\)\.equals\(tenantId\)/);
  assert.match(cache, /row\.test_id === testId/);
  assert.match(cache, /row\?\.tenant_id === tenantId/);
  const catalog = read('modules/catalog/repository.js');
  assert.match(catalog, /mergePendingCatalogCache\('catalog', data \?\? \[\], \{ tenantId, branchId \}\)/);
  assert.match(catalog, /mergePendingCatalogCache\('test_parameters', data \?\? \[\], \{ tenantId, testId, branchId \}\)/);
});

test('price writes remain owner-policy protected and price reads do not expose price mutation to employees', () => {
  const sql = read('database/migrations/001_initial_schema_v1.sql');
  const repo = read('modules/catalog/repository.js');
  assert.match(sql, /create policy tsl_test_prices_owner_manage on public\.test_prices for all to authenticated using \(private\.is_tenant_owner\(tenant_id\)\)/);
  assert.match(repo, /Price history is changed by an owner-only database policy/);
  assert.match(repo, /export async function setCurrentPrice/);
});

test('catalog and parameter reads cache inactive rows before filtering the visible result', () => {
  const source = read('modules/catalog/repository.js');
  assert.ok(source.indexOf("replaceCachedRows('catalog', merged.all, { tenantId })") < source.indexOf("return merged.visible.filter(row => includeInactive || row.is_active)"));
  const parameters = source.slice(source.indexOf('export async function listTestParameters'), source.indexOf('export async function saveCatalogTest'));
  assert.ok(parameters.indexOf("replaceCachedRows('test_parameters', merged.all, { tenantId, testId })") < parameters.indexOf("return merged.visible.filter(row => includeInactive || row.is_active)"));
});


test('parameter creation and editing use explicit tenant/test-scoped insert and update operations', () => {
  const source = read('modules/catalog/repository.js');
  assert.match(source, /const response = id[\s\S]*?query\.update\(payload\)[\s\S]*?query\.insert\(payload\)/);
  assert.match(source, /eq\('tenant_id', tenantId\)\.eq\('test_id', testId\)\.eq\('id', id\)/);
  assert.match(source, /كود البارامتر مستخدم بالفعل داخل هذا التحليل/);
  assert.match(source, /لم يرجع الخادم بيانات البارامتر بعد الحفظ/);
});

test('zero is a valid base price and is seeded for imported/new catalog tests', () => {
  const migration = read('database/migrations/109_promote_verified_profiles_enable_zero_price_and_master_import.sql');
  assert.match(migration, /ensure_zero_base_price_for_new_test/);
  assert.match(migration, /selling_price, is_current[\s\S]*?0, true/);
  assert.match(migration, /v_test_id := public\.import_master_catalog_test_unchecked/);
});
