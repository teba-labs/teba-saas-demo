import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('culture workflow stores multiple isolates and isolate-specific AST with branch RLS',()=>{
 const sql=read('database/migrations/041_culture_isolates_and_ast.sql');
 for(const table of ['visit_test_culture_isolates','visit_test_culture_susceptibility']) assert.ok(sql.includes('create table if not exists public.'+table));
 assert.match(sql,/enable row level security/);
 assert.ok(sql.includes('private.can_access_branch'));
 assert.match(sql,/breakpoint_edition/);
 assert.match(sql,/CLSI/);
 assert.match(sql,/EUCAST/);
 assert.ok(read('database/migrations/042_culture_rls_policy_scope_fix.sql').includes('visit_test_culture_isolates.tenant_id'));
 assert.ok(read('database/migrations/042_culture_rls_policy_scope_fix.sql').includes('visit_test_culture_susceptibility.tenant_id'));
});

test('culture results are editable from the workbench and printed with isolate-level AST',()=>{
 const js=read('assets/js/results-workbench.js');
 assert.match(js,/listCultureResults/);
 assert.match(js,/saveCultureIsolate/);
 assert.match(js,/saveCultureSusceptibility/);
 assert.match(js,/culture-ast-form/);
 assert.ok(js.includes('cultureRows.susceptibilities'));
 assert.match(js,/resolveReferenceRange/);
 const repo=read('modules/results/culture-repository.js');
 assert.match(repo,/onConflict:'visit_test_id,isolate_number'/);
 assert.match(repo,/onConflict:'isolate_id,antimicrobial_agent'/);
 const sw=read('service-worker.js');
 assert.ok(sw.includes('modules/results/culture-repository.js'));
});

test('CBC, urine, stool and culture profiles are present with source references and local interval status',()=>{
 const sql=read('database/migrations/040_seed_core_medical_profiles.sql');
 for(const code of ['HEM_CBC','UA_COMPLETE','STOOL_EXAM','CULTURE_URINE','CULTURE_STOOL']) assert.ok(sql.includes(code));
 for(const source of ['ICSH-PBS-2015','EFLM-UA-2023','WHO-PARASITOLOGY','IDSA-ASM-2024','CLSI-M100-36']) assert.ok(sql.includes(source));
 assert.match(sql,/local_verification_required/);
 assert.match(sql,/reference_interval_status/);
 const formulas=read('database/migrations/045_seed_validated_calculated_profiles.sql');
 for(const code of ['PROTEIN_PROFILE','LIPID_PROFILE','HOMA_IR']) assert.ok(formulas.includes(code));
 for(const formula of ['GLOBULIN','AG_RATIO','NON_HDL_C','HOMA1_IR']) assert.ok(formulas.includes(formula));
 assert.match(formulas,/Matthews-HOMA-Paper/);
 assert.match(read('database/migrations/043_culture_completion_guard.sql'),/positive culture/);
 assert.match(read('database/migrations/044_core_profile_optional_fields.sql'),/UA_RENAL_EPITHELIAL/);
 assert.match(read('database/migrations/046_legacy_source_name_index.sql'),/Legacy Taiba data\.js source-name index/);
 assert.match(read('database/migrations/048_mayo_cbc_suggested_intervals.sql'),/MAYO-CBC-9109/);
 assert.match(read('database/migrations/049_granular_microscopy_fields.sql'),/RBC_SCHISTOCYTES/);
 assert.match(read('database/migrations/049_granular_microscopy_fields.sql'),/UA_WBC_CLUMPS/);
 assert.match(read('database/migrations/049_granular_microscopy_fields.sql'),/ST_PARASITE_METHOD/);
 assert.match(read('database/migrations/050_mayo_pediatric_cbc_intervals.sql'),/pediatric/);
 assert.match(read('database/migrations/051_culture_fk_indexes_and_rls_perf.sql'),/idx_culture_ast_tenant_branch_staff/);
});

test('catalog editor separates verified local intervals from clinical definition review',()=>{
 const html=read('app/catalog.html');
 assert.match(html,/parameterReferenceStatus/);
 const repo=read('modules/catalog/repository.js');
 assert.ok(repo.includes('reference_interval_status: valid.referenceIntervalStatus'));
 assert.match(repo,/verified_local/);
});
