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

test('customer master library exposes published definitions without making central review a customer task', () => {
  assert.doesNotMatch(repository, /eq\('clinical_review_status','verified'\)/);
  assert.doesNotMatch(repository, /\.filter\(row=>row\.parameter_count>0/);
  assert.match(repository, /Published definitions remain importable even when clinical metadata is incomplete/);
  assert.match(ui, /جاهز للاستخدام والتعديل داخل كتالوج المعمل بعد الاستيراد/);
  assert.doesNotMatch(ui, /مراجعة البيانات إرشادية وغير مانعة|المدى يحتاج تحققًا محليًا/);
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
  assert.match(ui, /جاهز للاستخدام والتعديل داخل كتالوج المعمل بعد الاستيراد/);
  assert.doesNotMatch(ui, /مراجعة البيانات إرشادية وغير مانعة|الاستيراد متاح دون اعتماد محلي/);
  assert.match(ui, /استيراد كل التعريفات/);
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

test('partial catalog definitions are available to tenant import without fabricated medical metadata', () => {
  const currentImport = migration;
  assert.match(currentImport, /Only the tenant owner may import master catalog tests/);
  assert.doesNotMatch(currentImport, /method and specimen must be defined/);
  assert.doesNotMatch(currentImport, /v_bad_count>0|v_invalid>0|set is_active=false/);
  assert.match(repository, /importMasterCatalogTest/);
  assert.doesNotMatch(repository, /eq\('clinical_review_status','verified'\)/);
  assert.match(repository, /missing_numeric_ranges/);
});

test('master imports are active immediately; manually deactivated tests can still be re-enabled without changing prices',async()=>{
 const catalogHtml=await readFile(new URL('app/catalog.html',root),'utf8');
 const currentImport=await readFile(new URL('database/migrations/109_promote_verified_profiles_enable_zero_price_and_master_import.sql',root),'utf8');
 assert.match(catalogHtml,/id="activateCatalogTest"/);
 assert.match(ui,/setCatalogTestActive\(\{tenantId:state\.tenant\.id,testId:state\.selectedTest,isActive:true\}\)/);
 assert.match(ui,/تم تفعيل التحليل/);
 assert.match(repository,/export async function setCatalogTestActive/);
 assert.match(currentImport,/v_test_id := public\.import_master_catalog_test_unchecked/);
 assert.doesNotMatch(currentImport,/set is_active\s*=\s*false/i);
});

test('new master imports stay active and receive a zero base price without a local approval step',async()=>{
 const currentImport=await readFile(new URL('database/migrations/109_promote_verified_profiles_enable_zero_price_and_master_import.sql',root),'utf8');
 assert.match(currentImport,/import_master_catalog_test_unchecked/);
 assert.match(currentImport,/ensure_zero_base_price_for_new_test/);
 assert.match(currentImport,/selling_price, is_current[\s\S]*?0, true/);
 assert.doesNotMatch(currentImport,/set is_active\s*=\s*false/i);
 assert.match(currentImport,/Only the tenant owner can import a master catalog test/);
});

test('tenant catalog bootstraps reviewed Core tests idempotently before reception catalog listing',async()=>{
 const migration=await readFile(new URL('database/migrations/105_auto_provision_verified_core_catalog.sql',root),'utf8');
 const repository=await readFile(new URL('modules/catalog/repository.js',root),'utf8');
 const home=await readFile(new URL('assets/js/app-home.js',root),'utf8');
 assert.match(migration,/ensure_tenant_core_catalog/);
 assert.match(migration,/clinical_review_status = 'verified'/);
 assert.match(migration,/if v_existing is not null then\s+continue/);
 assert.match(repository,/rpc\('ensure_tenant_core_catalog'/);
 assert.match(home,/prepareTenantCatalog\(state\.tenant\.id\)/);
 assert.match(home,/warmCatalogParameters/);
 assert.match(home,/تم تجهيزها للعمل دون اتصال بعد أول مزامنة/);
 assert.doesNotMatch(home,/signOut\(\).*catalog/);
});
