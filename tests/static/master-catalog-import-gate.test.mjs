import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const repository = await readFile(new URL('modules/catalog/repository.js', root), 'utf8');
const ui = await readFile(new URL('assets/js/catalog.js', root), 'utf8');
const migration = await readFile(new URL('database/migrations/087_gate_master_catalog_import.sql', root), 'utf8');
const activation = await readFile(new URL('database/migrations/088_guard_master_import_activation.sql', root), 'utf8');
const hormoneSeed = await readFile(new URL('database/migrations/089_complete_reproductive_hormone_profiles.sql', root), 'utf8');
const chemistrySeed = await readFile(new URL('database/migrations/090_complete_common_chemistry_profiles.sql', root), 'utf8');
const lipidSeed = await readFile(new URL('database/migrations/091_complete_lipid_profile_decision_ranges.sql', root), 'utf8');
const urineSeed = await readFile(new URL('database/migrations/092_complete_urine_catalog_ranges.sql', root), 'utf8');
const cbcSeed = await readFile(new URL('database/migrations/093_complete_cbc_indices_and_differential.sql', root), 'utf8');
const stoolSeed = await readFile(new URL('database/migrations/094_complete_stool_profiles_and_dedupe.sql', root), 'utf8');
const finalGate = await readFile(new URL('database/migrations/095_finalize_master_import_completeness.sql', root), 'utf8');
const remainingCore = await readFile(new URL('database/migrations/096_complete_remaining_core_profiles.sql', root), 'utf8');
const proteinSemen = await readFile(new URL('database/migrations/097_complete_protein_and_semen_profiles.sql', root), 'utf8');

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

test('common chemistry, lipid, urine, CBC and stool master data have forward-only enrichment migrations', () => {
  assert.match(chemistrySeed, /HOMA1_IR/);
  assert.match(chemistrySeed, /KIDNEY_PROFILE/);
  assert.match(lipidSeed, /LIPID_PROFILE/);
  assert.match(urineSeed, /UA_COMPLETE/);
  assert.match(cbcSeed, /PCT/);
  assert.match(cbcSeed, /'calculated'/);
  assert.match(stoolSeed, /STOOL_EXAM/);
  assert.match(stoolSeed, /CULTURE_STOOL/);
});

test('final server import gate checks method, specimen and choice options', () => {
  assert.match(finalGate, /method and specimen must be defined/);
  assert.match(finalGate, /p.value_type = 'choice' and coalesce\(jsonb_array_length\(p.choices\),0\)=0/);
  assert.match(finalGate, /set is_active=false/);
  assert.match(repository, /missing_choices/);
  assert.match(repository, /row.definition\?\.method/);
  assert.match(repository, /row.definition\?\.specimen/);
});

test('all 45 core definitions are supported by source-backed profile migrations', () => {
  for (const code of ['BONE_PROFILE','ELECTROLYTE_PROFILE','GLYCEMIC_CONTROL_PROFILE','PANCREATIC_ENZYME_PROFILE','AUTOIMMUNE_SCREEN_PROFILE','RHEUMATOLOGY_PROFILE','THYROID_ANTIBODY_PROFILE','PCOS_EVALUATION_PROFILE','ANTENATAL_INFECTION_SCREEN_PROFILE','TORCH_SEROLOGY_PROFILE','CARDIAC_MARKERS_PROFILE']) assert.ok(remainingCore.includes(code));
  assert.match(proteinSemen, /WHO Laboratory Manual for the Examination and Processing of Human Semen/);
  assert.match(proteinSemen, /QUEST-7577/);
  assert.match(proteinSemen, /PEROXIDASE_LEUKOCYTES/);
});
