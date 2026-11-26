import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('master formula TEXT is explicitly converted to tenant formula JSONB in every provisioning path', () => {
  const migration = read('database/migrations/117_master_formula_text_jsonb_bridge.sql');
  assert.match(migration, /master_formula_text_to_jsonb\(p_formula text\)/);
  assert.match(migration, /v_formula := p_formula::jsonb/);
  assert.match(migration, /jsonb_typeof\(v_formula\) <> 'object'/);
  assert.equal((migration.match(/formula=private\.master_formula_text_to_jsonb\(mp\.formula\)/g) || []).length, 1);
  assert.equal((migration.match(/formula=private\.master_formula_text_to_jsonb\(mp\.formula\)/g) || []).length, 1);
  assert.match(migration, /create or replace function public\.import_master_catalog_test_unchecked/);
  assert.match(migration, /create or replace function public\.ensure_tenant_core_catalog/);
  assert.doesNotMatch(migration, /formula=mp\.formula/);
});

test('master formula conversion rejects malformed AST data without silently losing calculated definitions', () => {
  const migration = read('database/migrations/117_master_formula_text_jsonb_bridge.sql');
  assert.match(migration, /Master catalog formula is not valid JSON/);
  assert.match(migration, /Master catalog formula must be a JSON object/);
  assert.match(migration, /using errcode = '22023'/);
  assert.match(migration, /result_source='calculated'/);
});
