import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('results workbench renders numeric, text, boolean and catalog-choice controls from the visit snapshot', () => {
  const ui = read('assets/js/results-workbench.js');
  assert.match(ui, /type === 'boolean'[\s\S]*?value="true"[\s\S]*?value="false"/);
  assert.match(ui, /type === 'choice'[\s\S]*?p\.choices[\s\S]*?<option/);
  assert.match(ui, /type === 'numeric'[\s\S]*?type="number"/);
  assert.match(ui, /data-choices=/);
  assert.doesNotMatch(ui, /dataset\.valueType = result\.value_numeric/);
});

test('result repository rejects invalid boolean and out-of-catalog choice values before writing', () => {
  const repo = read('modules/results/repository.js');
  assert.match(repo, /valueType === 'boolean'[\s\S]*?!\['true', 'false'\]\.includes\(rawValue\)/);
  assert.match(repo, /valueType === 'choice'[\s\S]*?parameter\.choices\.includes\(rawValue\)/);
  assert.match(repo, /Number\.isFinite\(numeric\)/);
});

test('catalog choice definitions are non-empty unique text values', () => {
  const repo = read('modules/catalog/repository.js');
  assert.match(repo, /choices\.some\(choice => typeof choice !== 'string' \|\| !choice\.trim\(\)\)/);
  assert.match(repo, /new Set\(choices\.map\(choice => choice\.trim\(\)\)\)\.size !== choices\.length/);
});

test('migration validates result values against the immutable visit parameter snapshot', () => {
  const sql = read('database/migrations/009_result_value_type_validation.sql');
  assert.match(sql, /security definer set search_path = pg_catalog/i);
  assert.match(sql, /new\.value_numeric::text in \('NaN', 'Infinity', '-Infinity'\)/i);
  assert.match(sql, /new\.value_text not in \('true', 'false'\)/i);
  assert.match(sql, /jsonb_array_elements_text\(v_choices\)/i);
  assert.match(sql, /choice\.value = new\.value_text/i);
  assert.match(sql, /v_parameter->>'value_type'/i);
  assert.match(sql, /v_parameter->'choices'/i);
});
