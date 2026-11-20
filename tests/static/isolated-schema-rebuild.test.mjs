import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('migration filenames follow the current main sequence without reusing 024', () => {
  const files = fs.readdirSync(path.join(root, 'database/migrations'));
  assert.ok(files.includes('024_print_settings_audit.sql'));
  assert.ok(files.includes('054_source_suggested_core_intervals.sql'));
  assert.ok(files.includes('055_patient_age_units.sql'));
  assert.ok(!files.includes('024_patient_age_units.sql'));
});

test('patient age migration preserves the entered unit and normalized compatibility value', () => {
  const migration = read('database/migrations/055_patient_age_units.sql');
  assert.match(migration, /add column if not exists age_value/);
  assert.match(migration, /add column if not exists age_unit/);
  assert.match(migration, /age_unit in \('days','months','years'\)/);
  assert.match(migration, /age_years type numeric\(8,4\)/);
});

test('CI validates source and tests but never pushes schema changes to hosted databases', () => {
  const workflow = read('.github/workflows/static-contract-tests.yml');
  assert.match(workflow, /node --test tests\/static\/\*\.test\.mjs tests\/unit\/\*\.test\.mjs/);
  assert.match(workflow, /git archive --format=zip/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /supabase db push|migration repair|supabase link/i);
});
