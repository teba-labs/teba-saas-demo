import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('catalog editor exposes structured clinician-facing modes, ranges and conditional rules without a raw range JSON field',()=>{
 const html=read('app/catalog.html');
 for(const id of ['parameterInputMode','addReferenceRange','referenceRangeRows','parameterRuleSource','parameterRuleOperator','parameterRuleValue','parameterRuleChoices'])assert.ok(html.includes('id="'+id+'"'), 'missing '+id);
 assert.doesNotMatch(html,/id="parameterRanges"/);
 assert.match(html,/numeric_comparator/);
 assert.match(html,/multi_choice/);
 assert.match(html,/graded_multi_choice/);
});

test('catalog repository loads and saves the full v2 parameter contract',()=>{
 const repo=read('modules/catalog/repository.js');
 assert.match(repo,/result_input_mode, result_config, display_rules, formula_expression/);
 assert.match(repo,/result_input_mode: valid\.inputMode/);
 assert.match(repo,/result_config: valid\.resultConfig/);
 assert.match(repo,/display_rules: valid\.displayRules/);
 assert.match(repo,/formula_expression: parameter\.formulaExpression/);
 const ui=read('assets/js/catalog.js');
 assert.match(ui,/parseReferenceRangeEditor\(\)/);
 assert.match(ui,/parseChoiceEditor\(\)/);
 assert.match(ui,/source_parameter_code/);
 assert.match(ui,/formulaExpression/);
});

test('results UI renders all new input modes and applies conditional visibility',()=>{
 const ui=read('assets/js/results-workbench.js');
 for(const mode of ['numeric_integer','numeric_decimal','numeric_comparator','positive_negative','single_choice','multi_choice','graded_multi_choice'])assert.ok(ui.includes(mode),'missing '+mode);
 assert.match(ui,/applyConditionalFields/);
 assert.match(ui,/getResultInputValue/);
 assert.match(ui,/!input\.closest\('label'\)\?\.hidden/);
 assert.match(ui,/formatStoredResultForReport/);
 assert.match(ui,/choice-checkbox-list/);
 assert.match(ui,/data-choice-option/);
});

test('database migration snapshots v2 definitions, validates new values and conditionally removes hidden results',()=>{
 const sql=read('database/migrations/083_medical_master_catalog_model_v2.sql');
 for(const token of ['legacy_snapshot','result_input_mode','result_config','display_rules','formula_expression','min_unit','max_unit','result_parameter_is_visible','result_value_matches_input_mode','A submitted parameter does not exist in the visit technical snapshot'])assert.ok(sql.includes(token),'missing '+token);
 assert.match(sql,/p->>'result_input_mode'/);
 assert.match(sql,/p->'display_rules'/);
 assert.match(sql,/choice_scores/);
 assert.match(sql,/delete from public\.test_results tr/);
 assert.match(sql,/security invoker/);
 assert.doesNotMatch(sql,/create table/i);
});
