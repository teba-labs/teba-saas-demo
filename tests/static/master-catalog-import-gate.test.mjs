import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const repository = await readFile(new URL('modules/catalog/repository.js', root), 'utf8');
const ui = await readFile(new URL('assets/js/catalog.js', root), 'utf8');
const migration = await readFile(new URL('database/migrations/087_gate_master_catalog_import.sql', root), 'utf8');
const activation = await readFile(new URL('database/migrations/088_guard_master_import_activation.sql', root), 'utf8');
const hormoneSeed = await readFile(new URL('database/migrations/089_complete_reproductive_hormone_profiles.sql', root), 'utf8');

test('customer master library exposes only centrally reviewed complete definitions', () => {
  assert.match(repository, /eq\('clinical_review_status','verified'\)/);
  assert.match(repository, /row\.unreviewed_parameters===0/);
  assert.match(repository, /row\.placeholder_parameters===0/);
  assert.match(repository, /row\.missing_numeric_ranges===0/);
  assert.match(repository, /row\.missing_units===0/);
  assert.match(repository, /row\.missing_formulas===0/);
});

test('central import is guarded on the server and imported copies start inactive', () => {
  assert.match(migration, /not passed central clinical review/);
  assert.match(migration, /parameters, units, reference intervals, formulas or clinical review are incomplete/);
  assert.match(migration, /set is_active = false/);
  assert.match(migration, /Only the tenant owner may import/);
});

test('catalog UI no longer invites customers to complete placeholder definitions', () => {
  assert.match(ui, /مكتملة ومراجعة مركزيًا/);
  assert.match(ui, /التعريفات الناقصة لا تظهر للعميل/);
  assert.doesNotMatch(ui, /استيراد واستكمال محليًا/);
});

test('a tenant cannot activate an imported test with incomplete active parameters', () => {
  assert.match(activation, /guard_master_import_activation/);
  assert.match(activation, /لا يمكن اعتماد التحليل/);
  assert.match(activation, /reference_ranges/);
  assert.match(activation, /result_source = 'calculated' and p.formula is null/);
});

test('reproductive hormone profiles carry source-backed intervals without pretending local validation', () => {
  for (const code of ['FEMALE_CYCLE_HORMONE_PROFILE','MALE_FERTILITY_HORMONE_PROFILE']) assert.ok(hormoneSeed.includes(code));
  for (const source of ['MAYO-FSH-602753','MAYO-LH-602752','MAYO-ESTS-8575','MAYO-PGSN-8141','MAYO-PRL-800091','MAYO-TTST-8533']) assert.ok(hormoneSeed.includes(source));
  assert.match(hormoneSeed, /reference_interval_status='local_verification_required'/);
  assert.match(hormoneSeed, /external_source_suggested/);
});
