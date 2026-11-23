import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('results workbench renders configured result input modes from the immutable visit snapshot', () => {
  const ui = read('assets/js/results-workbench.js');
  const serializer = read('modules/results/input-mode.js');
  assert.ok(ui.includes('resultInputMode(p)'));
  assert.ok(ui.includes('renderResultControl(p,metadata,locked,mode)'));
  assert.ok(ui.includes('multi-choice-editor'));
  assert.ok(ui.includes('numeric_comparator'));
  assert.ok(ui.includes('data-display-rules'));
  assert.ok(serializer.includes("mode === 'boolean'"));
  assert.ok(serializer.includes("mode === 'single_choice'"));
});

test('result repository delegates validation and serialization to the shared module', () => {
  const repo = read('modules/results/repository.js');
  const serializer = read('modules/results/input-mode.js');
  assert.ok(repo.includes('prepareResultInput(parameter, value)'));
  assert.ok(repo.includes('save_draft_results_idempotent'));
  assert.ok(serializer.includes('Number.isFinite(numeric)'));
  assert.ok(serializer.includes('choices.includes(item)'));
  assert.ok(serializer.includes("mode === 'boolean'"));
});

test('catalog choice definitions are non-empty and unique text values', () => {
  const repo = read('modules/catalog/repository.js');
  assert.ok(repo.includes("choices.some(choice => typeof choice !== 'string' || !choice.trim())"));
  assert.ok(repo.includes('new Set(choices.map(choice => String(choice).trim())).size !== choices.length'));
  assert.ok(repo.includes('choiceModes.includes(resultInputMode)'));
});

test('legacy result validation remains and v2 validates configured modes against visit snapshots', () => {
  const legacy = read('database/migrations/009_result_value_type_validation.sql');
  const v2 = read('database/migrations/083_medical_master_catalog_model_v2.sql');
  assert.ok(legacy.toLowerCase().includes('security definer set search_path = pg_catalog'));
  assert.ok(legacy.includes("new.value_numeric::text in ('NaN', 'Infinity', '-Infinity')"));
  assert.ok(legacy.includes("new.value_text not in ('true', 'false')"));
  assert.ok(v2.includes('create or replace function private.validate_result_parameter'));
  for (const mode of ['numeric_integer','numeric_decimal','numeric_comparator','text','positive_negative','boolean','single_choice','multi_choice','graded_multi_choice']) {
    assert.ok(v2.includes("'"+mode+"'"), 'missing database input mode '+mode);
  }
  assert.ok(v2.includes("v_parameter->>'result_input_mode'"));
});
