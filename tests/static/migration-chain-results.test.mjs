import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8');

test('migration 001 installs the result-validation trigger that migration 009 hardens in place', async () => {
  const base = await read('database/migrations/001_initial_schema_v1.sql');
  const hardening = await read('database/migrations/009_result_value_type_validation.sql');
  assert.match(base, /create trigger trg_validate_result_parameter before insert or update on public\.test_results[\s\S]*execute function private\.validate_result_parameter\(\)/i);
  assert.match(hardening, /create or replace function private\.validate_result_parameter\(\)/i);
  assert.doesNotMatch(hardening, /drop trigger\s+trg_validate_result_parameter/i);
});

test('frozen visit-test snapshots contain the type and choices consumed by migration 009', async () => {
  const base = await read('database/migrations/001_initial_schema_v1.sql');
  const hardening = await read('database/migrations/009_result_value_type_validation.sql');
  assert.match(base, /'value_type',p\.value_type[\s\S]*'reference_ranges',p\.reference_ranges[\s\S]*'choices',p\.choices/i);
  assert.match(hardening, /v_parameter->>'value_type'/i);
  assert.match(hardening, /v_parameter->'choices'/i);
  assert.match(hardening, /choice\.value = new\.value_text/i);
});

test('published-result correction updates the same result row and is subject to the result validation trigger', async () => {
  const publication = await read('database/migrations/003_atomic_report_publication.sql');
  const base = await read('database/migrations/001_initial_schema_v1.sql');
  const hardening = await read('database/migrations/009_result_value_type_validation.sql');
  assert.match(publication, /update public\.test_results set[\s\S]*value_numeric=p_value_numeric[\s\S]*value_text=p_value_text/i);
  assert.match(publication, /set_config\('app\.result_correction','on',true\)/i);
  assert.match(base, /before insert or update on public\.test_results/i);
  assert.match(hardening, /returns trigger/i);
  assert.match(hardening, /v_value_type = 'boolean'[\s\S]*new\.value_text not in \('true', 'false'\)/i);
});
