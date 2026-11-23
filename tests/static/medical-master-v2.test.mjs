import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('medical catalog v2 preserves old rows and normalizes the existing master tables in place',()=>{
 const sql=read('database/migrations/083_medical_master_catalog_model_v2.sql');
 assert.match(sql,/legacy_snapshot jsonb/);
 assert.match(sql,/legacy_snapshot = to_jsonb/);
 assert.match(sql,/jsonb_build_array\(reference_ranges\)/);
 assert.doesNotMatch(sql,/create table/i);
 assert.match(sql,/result_input_mode/);
 assert.match(sql,/result_config/);
 assert.match(sql,/display_rules/);
 assert.match(sql,/formula_expression/);
});

test('medical v2 carries every doctor-facing field into tenant imports and immutable visit snapshots',()=>{
 const sql=read('database/migrations/083_medical_master_catalog_model_v2.sql');
 for(const field of ['result_input_mode','result_config','display_rules','formula_expression']) {
  assert.ok(sql.includes(field), 'missing '+field);
 }
 assert.match(sql,/create or replace function private\.apply_catalog_price_snapshot/);
 assert.match(sql,/create or replace function public\.import_master_catalog_test/);
 assert.match(sql,/Only the tenant owner may import master catalog tests/);
 assert.match(sql,/create or replace function private\.add_catalog_kind_to_visit_snapshot/);
});

test('medical v2 validates new result input modes at the database boundary',()=>{
 const sql=read('database/migrations/083_medical_master_catalog_model_v2.sql');
 for(const mode of ['numeric_integer','numeric_decimal','numeric_comparator','text','positive_negative','boolean','single_choice','multi_choice','graded_multi_choice']) {
  assert.ok(sql.includes("'"+mode+"'"), 'missing SQL result mode '+mode);
 }
 assert.match(sql,/create or replace function private\.validate_result_parameter/);
 assert.match(sql,/whole-number result/);
 assert.match(sql,/comparator result/);
 assert.match(sql,/Duplicate choices are not allowed/);
 assert.match(sql,/Too many choices were selected/);
});

test('catalog UI saves doctor-friendly ranges, result modes, choices and visibility rules without JSON range entry',()=>{
 const html=read('app/catalog.html'),js=read('assets/js/catalog.js'),repo=read('modules/catalog/repository.js');
 for(const id of ['parameterInputMode','parameterRangeRows','parameterChoices','parameterMaxSelections','parameterChoiceScoresField','parameterChoiceScores','conditionParameterCode','conditionVisibleValues']) {
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.doesNotMatch(html,/id="parameterRanges"/);
 assert.match(js,/function renderRangeRows/);
 assert.match(js,/function readRangeRows/);
 assert.match(js,/function readDisplayRules/);
 for(const field of ['result_input_mode','result_config','display_rules','formula_expression']) assert.ok(repo.includes(field));
});

test('results UI renders all configured input modes and saves conditional and multi-choice payloads',()=>{
 const js=read('assets/js/results-workbench.js');
 const repo=read('modules/results/repository.js');
 const serializer=read('modules/results/input-mode.js');
 for(const mode of ['numeric_integer','numeric_decimal','numeric_comparator','text','positive_negative','boolean','single_choice','multi_choice','graded_multi_choice']) {
  assert.ok(serializer.includes(mode), 'missing JS result mode '+mode);
 }
 assert.match(js,/renderResultControl/);
 assert.match(js,/evaluateDisplayRules/);
 assert.match(js,/setMultiChoiceValue/);
 assert.match(repo,/prepareResultInput/);
 assert.match(js,/data-display-rules/);
 assert.match(js,/class="result-field" data-display-rules/);
 assert.match(js,/aria-label="\\$\\{name\\}"/);
 assert.doesNotMatch(js,/<label class="result-field"/);
 assert.match(js,/choice-score-total/);
 assert.match(js,/choice_scores/);
});
