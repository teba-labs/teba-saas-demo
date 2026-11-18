import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('branch-scoped cache replacement removes stale staff only from the refreshed branch', () => {
  const cache = read('offline/cache.js');
  assert.match(cache, /replaceCachedRows\(tableName, rows = \[\], \{ tenantId, branchId, testId \} = \{\}\)/);
  assert.match(cache, /\(!branchId \|\| row\.branch_id === branchId\)/);
  assert.match(cache, /row\?\.tenant_id === tenantId && \(!branchId \|\| row\.branch_id === branchId\)/);
  const reception = read('assets/js/reception.js');
  const workday = read('assets/js/workday.js');
  assert.match(reception, /replaceCachedRows\('staff_directory',staffRows,\{tenantId:state\.tenant\.id,branchId:state\.branch\.id\}\)/);
  assert.match(workday, /replaceCachedRows\('staff_directory',staffRows,\{tenantId:state\.tenant\.id,branchId:state\.branch\.id\}\)/);
});
