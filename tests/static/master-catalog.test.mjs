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
 assert.match(importPolicy,/Importability is not clinical approval/);
 assert.doesNotMatch(importPolicy,/clinical_review_status.*verified/);
 assert.match(importPolicy,/v_parameter_count = 0/);
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
 assert.match(js,/استيراد للمعمل/);
});
