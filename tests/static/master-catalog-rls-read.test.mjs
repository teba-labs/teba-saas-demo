import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const sql = fs.readFileSync(path.join(root, 'database/migrations/20261124143652_published_master_catalog_read_policies.sql'), 'utf8');

test('authenticated lab users can read published master catalog only', () => {
  for (const policy of [
    'master_catalog_releases_published_read',
    'master_catalog_tests_published_read',
    'master_catalog_parameters_published_read',
  ]) assert.match(sql, new RegExp('create policy ' + policy));

  assert.equal((sql.match(/for select/gi) || []).length, 3);
  assert.equal((sql.match(/to authenticated/gi) || []).length, 3);
  assert.match(sql, /status\s*=\s*'published'/i);
  assert.match(sql, /master_catalog_tests\.release_id/i);
  assert.match(sql, /master_catalog_parameters\.master_test_id/i);
  assert.doesNotMatch(sql, /to anon/i);
  assert.doesNotMatch(sql, /for (insert|update|delete|all)/i);
});
