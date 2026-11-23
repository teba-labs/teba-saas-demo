import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const repository = await readFile(new URL('modules/catalog/repository.js', root), 'utf8');
const ui = await readFile(new URL('assets/js/catalog.js', root), 'utf8');
const migration = await readFile(new URL('database/migrations/100_master_catalog_partial_import_activation.sql', root), 'utf8');
const activation = await readFile(new URL('database/migrations/100_master_catalog_partial_import_activation.sql', root), 'utf8');
const hormoneSeed = await readFile(new URL('database/migrations/089_complete_reproductive_hormone_profiles.sql', root), 'utf8');
const chemistrySeed = await readFile(new URL('database/migrations/090_complete_common_chemistry_profiles.sql', root), 'utf8');
const lipidSeed = await readFile(new URL('database/migrations/091_complete_lipid_profile_decision_ranges.sql', root), 'utf8');
const urineSeed = await readFile(new URL('database/migrations/092_complete_urine_catalog_ranges.sql', root), 'utf8');
const cbcSeed = await readFile(new URL('database/migrations/093_complete_cbc_indices_and_differential.sql', root), 'utf8');
const stoolSeed = await readFile(new URL('database/migrations/094_complete_stool_profiles_and_dedupe.sql', root), 'utf8');
const finalGate = await readFile(new URL('database/migrations/095_finalize_master_import_completeness.sql', root), 'utf8');
const remainingCore = await readFile(new URL('database/migrations/096_complete_remaining_core_profiles.sql', root), 'utf8');
const proteinSemen = await readFile(new URL('database/migrations/097_complete_protein_and_semen_profiles.sql', root), 'utf8');
const versionedCore = await readFile(new URL('database/migrations/098_publish_versioned_core_catalog_and_sync_clean_tenants.sql', root), 'utf8');
const retireLegacy = await readFile(new URL('database/migrations/099_retire_legacy_name_only_catalog.sql', root), 'utf8');

test('customer master library exposes all published definitions and labels review state', () => {
  assert.doesNotMatch(repository, /eq\('clinical_review_status','verified'\)/);
  assert.doesNotMatch(repository, /\.filter\(row=>row\.parameter_count>0/);
  assert.match(repository, /Published definitions remain importable even when clinical metadata is incomplete/);
});

test('central import stays tenant-owner scoped while missing clinical metadata remains optional', async () => {
  assert.match(migration, /Only the tenant owner may import master catalog tests/);
  assert.match(migration, /Only tests in a published master release can be imported/);
  assert.doesNotMatch(migration, /method and specimen must be defined/);
  assert.doesNotMatch(migration, /v_bad_count>0|v_invalid>0|set is_active=false/);
  assert.match(migration, /return new/);
  const permissions = await readFile(new URL('database/migrations/101_catalog_import_invoker_permissions.sql', root), 'utf8');
  assert.match(permissions, /security invoker/i);
  assert.match(permissions, /grant execute on function public\.import_master_catalog_test_unchecked/);
  assert.match(permissions, /to authenticated/);
});

test('catalog UI lets owners import incomplete definitions and complete them later', () => {
  assert.match(ui, /قابل للمراجعة والاستكمال داخل المعمل/);
  assert.match(ui, /يمكنك الاستيراد الآن وإكمال البيانات لاحقًا/);
  assert.match(ui, /استيراد الآن/);
  assert.doesNotMatch(ui, /التعريفات الناقصة لا تظهر للعميل/);
});

test('tenant activation does not reject missing ranges, methods, specimens, units, choices or formulas', () => {
  assert.match(activation, /guard_master_import_activation/);
  assert.match(activation, /Do not block operational activation/);
  assert.doesNotMatch(activation, /لا يمكن اعتماد التحليل/);
  assert.doesNotMatch(activation, /reference_ranges/);
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

test('core catalog publication is versioned and syncs only uncustomized tenant copies', () => {
  assert.match(versionedCore, /taiba-core-2026\.11\.23-r1/);
  assert.match(versionedCore, /status='retired'/);
  assert.match(versionedCore, /cardinality\(l\.customization_fields\),0\)=0/);
  assert.match(versionedCore, /baseline_snapshot=jsonb_build_object/);
  assert.doesNotMatch(versionedCore, /update public\.visit_tests/i);
  assert.doesNotMatch(versionedCore, /update public\.test_results/i);
});

test('preserved legacy index is republished as editable and explicitly unreviewed', async () => {
  assert.match(retireLegacy, /taiba-legacy-name-index-2026\.11\.20-r1/);
  const publish = await readFile(new URL('database/migrations/102_publish_editable_legacy_catalog_index.sql', root), 'utf8');
  assert.match(publish, /taiba-expanded-index-2026\.11\.23-r2/);
  assert.match(publish, /needs_review/);
  assert.match(publish, /published/);
});
