import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('branch price migration keeps one base price and one override per branch',()=>{
 const sql=read('database/migrations/014_branch_specific_test_prices.sql');
 assert.match(sql,/add column if not exists branch_id uuid/i);
 assert.match(sql,/foreign key\(tenant_id,branch_id\) references public\.branches\(tenant_id,id\)/i);
 assert.match(sql,/uq_test_prices_current_base[\s\S]*?branch_id is null/i);
 assert.match(sql,/uq_test_prices_current_branch[\s\S]*?branch_id is not null/i);
 assert.match(sql,/public\.set_branch_test_price/i);
 assert.match(sql,/private\.is_tenant_owner\(p_tenant_id\)/);
});

test('new visit snapshots prefer the branch override and otherwise use the base price',()=>{
 const sql=read('database/migrations/014_branch_specific_test_prices.sql');
 assert.match(sql,/tp\.branch_id=new\.branch_id or tp\.branch_id is null/i);
 assert.match(sql,/order by \(tp\.branch_id is not null\) desc limit 1/i);
 assert.match(sql,/new\.price_snapshot:=v_price/);
});

test('offline intake validates the effective branch price id and amount before creating a visit',()=>{
 const sql=read('database/migrations/014_branch_specific_test_prices.sql');
 assert.match(sql,/left join lateral\([\s\S]*?tp\.branch_id=p_branch_id or tp\.branch_id is null[\s\S]*?order by \(tp\.branch_id is not null\) desc limit 1/i);
 assert.match(sql,/current_price\.id<>e\.price_id/);
 assert.match(sql,/current_price\.selling_price<>e\.selling_price/);
 assert.match(sql,/OFFLINE_PRICE_CONFLICT/);
});

test('catalog repository returns one effective price per test for a selected branch and supports branch overrides',()=>{
 const repo=read('modules/catalog/repository.js');
 assert.match(repo,/listCurrentPrices\(\{ tenantId, branchId = null, testIds \}/);
 assert.match(repo,/row\.branch_id == null \|\| row\.branch_id === branchId/);
 assert.match(repo,/Number\(b\.branch_id === branchId\) - Number\(a\.branch_id === branchId\)/);
 assert.match(repo,/setBranchPrice/);
 assert.match(repo,/RPC\.setBranchTestPrice/);
 assert.match(repo,/replaceCachedCurrentPrices\(\[data\], \{ tenantId, testIds: \[testId\], branchId, scope: 'branch' \}\)/);
});

test('offline cache preserves other branches current prices when refreshing one branch',()=>{
 const cache=read('offline/cache.js');
 assert.match(cache,/inBranchScope = row => !branchId \|\| row\.branch_id == null \|\| row\.branch_id === branchId/);
 assert.match(cache,/inBranchScope\(row\).*row\.is_current === true/);
 const db=read('offline/database.js');
 assert.match(db,/offlineDb\.version\(3\)\.stores/);
 assert.match(db,/test_prices: 'id, tenant_id, test_id, branch_id, is_current, effective_from'/);
});
