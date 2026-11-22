import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('master medical catalog has read-only global definitions and tenant-owned import links',()=>{
 const sql=read('database/migrations/035_master_lab_catalog_foundation.sql');
 for(const table of ['master_catalog_releases','master_catalog_tests','master_catalog_parameters','tenant_catalog_master_links']) assert.match(sql,new RegExp('create table if not exists public\\.'+table));
 assert.match(sql,/enable row level security/);
 assert.match(sql,/grant select on public\.master_catalog_releases, public\.master_catalog_tests, public\.master_catalog_parameters to authenticated/);
 assert.match(sql,/private\.is_tenant_member\(tenant_id\)/);
 assert.match(sql,/private\.is_tenant_owner\(p_tenant_id\)/);
 assert.match(sql,/import_master_catalog_test/);
 assert.match(sql,/revoke all on function public\.import_master_catalog_test/);
 assert.match(read('database/migrations/036_master_catalog_import_invoker.sql'),/security invoker/);
 assert.match(read('database/migrations/037_guard_master_catalog_import.sql'),/must be clinically verified/);
 const importPolicy=read('database/migrations/077_allow_incomplete_master_catalog_import.sql');
 assert.match(importPolicy,/importability is not clinical approval/i);
 assert.doesNotMatch(importPolicy,/clinical_review_status.*verified/);
 const incompleteImport=read('database/migrations/078_allow_empty_master_catalog_import.sql');
 assert.match(incompleteImport,/Empty\/incomplete definitions/i);
 assert.doesNotMatch(incompleteImport,/v_parameter_count\s*=\s*0/i);
 assert.match(incompleteImport,/revoke all on function private\.guard_tenant_master_catalog_link/);
 assert.match(read('database/migrations/038_master_catalog_import_formula_order.sql'),/result_source='calculated'/);
 assert.match(read('database/migrations/039_master_parameter_alternate_units.sql'),/alternate_units/);
});

test('medical catalog definitions carry specimen, collection, stability, critical and source metadata',()=>{
 const sql=read('database/migrations/035_master_lab_catalog_foundation.sql');
 for(const field of ['patient_preparation','collection_requirements','specimen_requirements','transport_requirements','stability_requirements','rejection_criteria','biosafety_notes','critical_result_policy','source_references','clinical_review_status']) assert.ok(sql.includes(field),'missing '+field);
 for(const field of ['unit_ucum','alternate_units','critical_ranges','interpretation_rules','applicability','formula']) assert.ok(sql.includes(field),'missing '+field);
});

test('catalog repository persists the advanced metadata and imports published master definitions',()=>{
 const repo=read('modules/catalog/repository.js');
 for(const field of ['patient_preparation','collection_requirements','specimen_requirements','transport_requirements','stability_requirements','critical_result_policy','clinical_review_status','unit_ucum','critical_ranges','applicability']) assert.ok(repo.includes(field),'missing '+field);
 assert.match(repo,/listMasterCatalogTests/);
 assert.match(repo,/import_master_catalog_test/);
 assert.match(repo,/parameter_count/);
 assert.match(repo,/master_catalog_parameters/);
});

test('catalog UI exposes the master library and structured medical metadata editors',()=>{
 const html=read('app/catalog.html');
 for(const id of ['masterCatalogPanel','masterCatalogSearch','masterCatalogList','testPreparation','testCollection','testStability','testCriticalPolicy','testSources','parameterCriticalRanges','parameterApplicability','parameterSources','parameterClinicalMetadata']) assert.ok(html.includes(id),'missing '+id);
 const js=read('assets/js/catalog.js');
 assert.match(js,/data-import-master/);
 assert.match(js,/clinicalReviewStatus/);
 assert.match(js,/parseJsonObjectField/);
 assert.match(js,/importMasterCatalogTest/);
 assert.match(html,/id="openMasterLibrary"/);
 assert.match(html,/id="closeMasterLibrary"/);
 assert.match(js,/masterLibraryOpen/);
 assert.match(js,/استيراد واستكمال محليًا/);
 assert.match(js,/بدون بارامترات — قابلة للاستكمال محليًا/);
});

test('master library seeds 13 editable profile templates without invented reference intervals',()=>{
 const sql=read('database/migrations/081_seed_editable_profile_templates.sql');
 for(const code of ['ELECTROLYTE_PROFILE','BONE_PROFILE','CARDIAC_MARKERS_PROFILE','GLYCEMIC_CONTROL_PROFILE','THYROID_ANTIBODY_PROFILE','MALE_FERTILITY_HORMONE_PROFILE','FEMALE_CYCLE_HORMONE_PROFILE','PCOS_EVALUATION_PROFILE','TORCH_SEROLOGY_PROFILE','AUTOIMMUNE_SCREEN_PROFILE','RHEUMATOLOGY_PROFILE','ANTENATAL_INFECTION_SCREEN_PROFILE','PANCREATIC_ENZYME_PROFILE'])assert.ok(sql.includes(code),'missing '+code);
 assert.match(sql,/'needs_review'/);
 assert.match(sql,/'\[\]'::jsonb/);
 assert.match(sql,/local_verification_required/);
 assert.doesNotMatch(sql,/clinical_review_status\s*,?\s*'verified'/);
});
