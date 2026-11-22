import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('medical master v2 reshapes existing tables without creating a new catalog table',()=>{
 const sql=read('database/migrations/083_medical_master_catalog_model_v2.sql');
 assert.match(sql,/legacy_snapshot/);
 assert.match(sql,/master_catalog_tests[\s\S]*?add constraint master_catalog_tests_test_kind_check[\s\S]*?'group'/);
 assert.match(sql,/result_input_mode/);
 assert.match(sql,/result_config/);
 assert.match(sql,/display_rules/);
 assert.match(sql,/formula_expression/);
 assert.match(sql,/definition->'components'/);
 assert.doesNotMatch(sql,/create table/i);
});

test('master v2 preserves old ranges and exposes age units and readable formulas',()=>{
 const sql=read('database/migrations/083_medical_master_catalog_model_v2.sql');
 assert.match(sql,/legacy_snapshot = to_jsonb/);
 assert.match(sql,/jsonb_build_array\(reference_ranges\)/);
 assert.match(sql,/'min_unit'/);
 assert.match(sql,/'max_unit'/);
 assert.match(sql,/master_formula_to_expression/);
 assert.match(sql,/formula_expression = private\.master_formula_to_expression/);
});

test('master v2 imports doctor-facing controls into tenant-owned parameter copies',()=>{
 const sql=read('database/migrations/083_medical_master_catalog_model_v2.sql');
 for(const field of ['result_input_mode','result_config','display_rules','formula_expression']) assert.ok(sql.includes(field));
 assert.match(sql,/Only the tenant owner may import master catalog tests/);
 assert.match(sql,/security invoker/);
 assert.match(sql,/tenant_catalog_master_links/);
});

test('master v2 keeps group components in existing test definitions and visit snapshots',()=>{
 const sql=read('database/migrations/083_medical_master_catalog_model_v2.sql');
 assert.match(sql,/test_kind='group'/);
 assert.match(sql,/coalesce\(v_definition->'components','\[\]'::jsonb\)/);
 assert.match(sql,/\{components\}/);
});
