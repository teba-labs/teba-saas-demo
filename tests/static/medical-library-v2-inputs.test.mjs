import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('catalog editor exposes structured clinician-facing modes, ranges and conditional rules without raw range JSON',()=>{
 const html=read('app/catalog.html');
 for(const id of ['parameterInputMode','parameterRangeRows','addReferenceRange','parameterMaxSelections','conditionParameterCode','conditionOperator','conditionValue','conditionVisibleValues','parameterChoiceScoresField','parameterChoiceScores'])assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 assert.doesNotMatch(html,/id="parameterRanges"/);
 assert.match(html,/numeric_comparator/);
 assert.match(html,/multi_choice/);
 assert.match(html,/graded_multi_choice/);
});

test('catalog repository persists structured input mode, choices, scoring and conditional rules',()=>{
 const repo=read('modules/catalog/repository.js');
 for(const token of ['result_input_mode','result_config','display_rules','formula_expression','max_selections','choice_scores','visible_values'])assert.ok(repo.includes(token),'missing '+token);
 const ui=read('assets/js/catalog.js');
 for(const token of ['readRangeRows(','readChoiceScores(','readDisplayRules(','resultConfig:','displayRules:'])assert.ok(ui.includes(token),'missing '+token);
});

test('results UI renders all configured input modes and keeps conditional choices staff-friendly',()=>{
 const ui=read('assets/js/results-workbench.js');
 for(const mode of ['numeric_integer','numeric_decimal','numeric_comparator','positive_negative','single_choice','multi_choice','graded_multi_choice'])assert.ok(ui.includes(mode),'missing '+mode);
 for(const token of ['renderResultControl(','evaluateDisplayRules(','multi-choice-editor','data-choice-value','choice-score-total'])assert.ok(ui.includes(token),'missing '+token);
});

test('forward migration validates input modes, selection limits and current main visibility-rule shape',()=>{
 const sql=read('database/migrations/084_medical_result_input_validation_and_conditional_rules.sql');
 for(const token of ['result_parameter_is_visible','result_value_matches_input_mode','result_parameter_value_matches_display_rules','max_selections','visible_values','choice_scores','save_draft_results_atomic','complete_visit_test_atomic','approve_visit_atomic'])assert.ok(sql.includes(token),'missing '+token);
 assert.match(sql,/jsonb_typeof\(v_rule->'when'\)/);
 assert.match(sql,/p->>'result_input_mode'/);
 assert.match(sql,/delete from public\.test_results tr/);
 assert.doesNotMatch(sql,/create table/i);
});

test('existing shared result serializer and repository remain the single save path',()=>{
 const serializer=read('modules/results/input-mode.js');
 const repository=read('modules/results/repository.js');
 assert.match(serializer,/prepareResultInput/);
 assert.match(serializer,/max_selections/);
 assert.match(repository,/prepareResultInput\(parameter, value\)/);
 assert.match(repository,/save_draft_results_idempotent/);
});
