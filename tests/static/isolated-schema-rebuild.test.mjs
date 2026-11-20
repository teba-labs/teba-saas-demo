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
  assert.ok(files.includes('056_visit_workbench_archive.sql'));
  assert.ok(files.includes('057_workbench_archive_invoker_and_indexes.sql'));
  assert.ok(files.includes('058_atomic_add_test_to_visit.sql'));
  assert.ok(files.includes('059_visit_parameter_range_overrides.sql'));
  assert.ok(files.includes('060_visit_range_override_fk_indexes.sql'));
  assert.ok(files.includes('061_allow_published_range_corrections.sql'));
  assert.ok(files.includes('062_correct_completed_visit_result.sql'));
  assert.ok(!files.includes('024_patient_age_units.sql'));
});

test('workbench archive is non-destructive and records actor, branch and reason',()=>{
  const migration = read('database/migrations/056_visit_workbench_archive.sql');
  assert.match(migration, /workbench_hidden_at/);
  assert.match(migration, /visit_workbench_archive_events/);
  assert.ok(migration.includes("action in ('hidden','restored')"));
  assert.match(migration, /private.can_access_branch/);
  assert.ok(migration.includes('auth.uid()'));
  assert.ok(migration.includes('revoke all on function public.set_visit_workbench_hidden'));
  assert.doesNotMatch(migration, /delete from public.visits/i);
});

test('test addition to an existing visit is atomic, idempotent, branch-scoped and uses invoker RLS',()=>{
  const migration = read('database/migrations/058_atomic_add_test_to_visit.sql');
  assert.match(migration, /security invoker/i);
  assert.match(migration, /private.can_access_branch/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /status<>'cancelled'/);
  assert.match(migration, /created_by_staff_id/);
  assert.ok(migration.includes('revoke all on function public.add_test_to_visit_atomic'));
});

test('visit range overrides are separate from the frozen catalog snapshot and keep before/after history',()=>{
  const migration=read('database/migrations/059_visit_parameter_range_overrides.sql');
  assert.match(migration,/visit_test_parameter_range_overrides/);
  assert.match(migration,/visit_test_parameter_range_events/);
  assert.match(migration,/security invoker/);
  assert.ok(migration.includes('new.reference_range_snapshot := coalesce(v_override'));
  assert.match(migration,/An approved but unpublished visit must be reopened/);
  assert.match(migration,/app.result_correction/);
  assert.match(migration,/old_reference_ranges/);
  assert.match(migration,/new_reference_ranges/);
  assert.doesNotMatch(migration,/update public.tests_catalog/i);
  assert.match(read('database/migrations/060_visit_range_override_fk_indexes.sql'),/idx_visit_range_overrides_updated_by/);
});

test('completed unpublished result correction is audited and cannot alter an approved or published visit',()=>{
  const migration=read('database/migrations/062_correct_completed_visit_result.sql');
  assert.ok(migration.includes('security invoker'));
  assert.ok(migration.includes('v_test.status'));
  assert.ok(migration.includes('correction_reason'));
  assert.ok(migration.includes('entered_by_staff_id'));
  assert.ok(migration.includes('revoke all on function public.correct_completed_visit_result'));
  assert.ok(migration.includes("v_visit.is_published"));
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
