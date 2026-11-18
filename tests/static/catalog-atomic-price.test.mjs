import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('atomic price migration serializes changes and performs close plus insert in one invoker transaction', () => {
  const sql = read('database/migrations/008_atomic_catalog_price_update.sql');
  assert.match(sql, /create or replace function public\.set_current_test_price\(\s*p_tenant_id uuid,\s*p_test_id uuid,\s*p_selling_price numeric/is);
  assert.match(sql, /set search_path = pg_catalog/i);
  assert.match(sql, /private\.is_tenant_owner\(p_tenant_id\)/);
  assert.match(sql, /from public\.tests_catalog tc[\s\S]*?for update/i);
  assert.match(sql, /update public\.test_prices[\s\S]*?insert into public\.test_prices[\s\S]*?return to_jsonb\(v_price_row\)/i);
  assert.match(sql, /revoke all on function public\.set_current_test_price\(uuid, uuid, numeric\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.set_current_test_price\(uuid, uuid, numeric\) to authenticated/i);
  assert.doesNotMatch(sql, /security\s+definer/i);
  assert.match(sql, /'NaN'::numeric/);
});

test('catalog price repository uses only the atomic owner RPC and validates its response', () => {
  const repo = read('modules/catalog/repository.js');
  const body = repo.slice(repo.indexOf('export async function setCurrentPrice'));
  assert.match(body, /\.rpc\(RPC\.setCurrentTestPrice/);
  assert.match(body, /p_tenant_id: tenantId/);
  assert.match(body, /p_test_id: testId/);
  assert.match(body, /p_selling_price: price/);
  assert.match(body, /data\.is_current !== true/);
  assert.doesNotMatch(body, /\.update\(\{ is_current: false \}\)/);
  assert.doesNotMatch(body, /\.insert\(\{ tenant_id: tenantId, test_id: testId, selling_price/);
});

test('atomic price RPC is centralized in schema contract', () => {
  const schema = read('core/data/schema-contract.js');
  assert.match(schema, /setCurrentTestPrice: 'set_current_test_price'/);
});

test('atomic price migration matches the existing tenant-owner RLS and table privilege contract', () => {
  const schema = read('database/migrations/001_initial_schema_v1.sql');
  assert.match(schema, /create policy tsl_test_prices_owner_manage on public\.test_prices for all to authenticated using \(private\.is_tenant_owner\(tenant_id\)\) with check \(private\.is_tenant_owner\(tenant_id\)\)/i);
  assert.match(schema, /grant insert, update, delete on public\.branches,[\s\S]*?public\.test_prices,[\s\S]*?to authenticated/i);
  assert.match(schema, /create unique index if not exists uq_test_prices_current on public\.test_prices\(tenant_id, test_id\) where is_current/i);
  assert.match(schema, /grant execute on function private\.is_tenant_owner\(uuid\) to authenticated/i);
});

test('atomic price migration rejects invalid numeric inputs before changing price history', () => {
  const sql = read('database/migrations/008_atomic_catalog_price_update.sql');
  const validation = sql.slice(sql.indexOf('if p_selling_price is null'), sql.indexOf('if not private.is_tenant_owner'));
  assert.match(validation, /p_selling_price is null/i);
  assert.match(validation, /p_selling_price < 0/i);
  assert.match(validation, /p_selling_price = 'NaN'::numeric/i);
  assert.match(validation, /p_selling_price > 9999999999\.99/i);
  assert.ok(sql.indexOf('if p_selling_price is null') < sql.indexOf('update public.test_prices'));
});

test('current-price cache refresh preserves historical rows and demotes stale current rows', () => {
  const cache = read('offline/cache.js');
  const repository = read('modules/catalog/repository.js');
  assert.match(cache, /export async function replaceCachedCurrentPrices/);
  assert.match(cache, /row\.is_current === true && !currentIds\.has\(row\.id\)/);
  assert.match(cache, /is_current: false/);
  assert.match(cache, /table\.bulkPut\(historicalized\)/);
  assert.match(cache, /table\.bulkPut\(safe\)/);
  assert.match(repository, /replaceCachedCurrentPrices\(data \?\? \[\], \{ tenantId, testIds, branchId \}\)/);
  assert.match(repository, /replaceCachedCurrentPrices\(\[data\], \{ tenantId, testIds: \[testId\], branchId \}\)/);
  assert.doesNotMatch(repository, /replaceCachedRows\('test_prices'/);
});
