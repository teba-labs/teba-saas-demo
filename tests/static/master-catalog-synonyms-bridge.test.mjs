import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('master alternate-name JSON arrays are converted to tenant synonyms text arrays in both copy paths', () => {
  const migration = read('database/migrations/118_master_catalog_synonyms_array_bridge.sql');
  const conversion = /array\(select jsonb_array_elements_text\(coalesce\(v_master\.alternate_names,'\[\]'::jsonb\)\)\)/g;
  assert.equal((migration.match(conversion) || []).length, 2);
  assert.match(migration, /create or replace function public\.import_master_catalog_test_unchecked/);
  assert.match(migration, /create or replace function public\.ensure_tenant_core_catalog/);
  assert.match(migration, /synonyms text\[\]/);
  assert.doesNotMatch(migration, /coalesce\(v_master\.alternate_names,'\{\}'\)/);
});

test('catalog copy keeps the explicit JSON formula AST conversion from migration 117', () => {
  const migration = read('database/migrations/118_master_catalog_synonyms_array_bridge.sql');
  assert.equal((migration.match(/formula=private\.master_formula_text_to_jsonb\(mp\.formula\)/g) || []).length, 2);
});
