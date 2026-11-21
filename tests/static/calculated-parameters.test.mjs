import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('calculated parameter schema validates numeric formula sources and protects dependencies',()=>{
  const sql=read('database/migrations/034_calculated_test_parameters.sql');
  assert.match(sql,/result_source text not null default 'manual'/);
  assert.match(sql,/formula jsonb/);
  assert.match(sql,/validate_formula_ast/);
  assert.match(sql,/dependency cycle detected/i);
  assert.match(sql,/must be an existing active numeric parameter/);
  assert.match(sql,/keep its code stable/);
});

test('visit snapshots retain formulas and server-side save computes dependencies safely',()=>{
  const sql=read('database/migrations/034_calculated_test_parameters.sql');
  assert.match(sql,/'result_source',p\.result_source,'formula',p\.formula/);
  assert.match(sql,/evaluate_catalog_formula/);
  assert.match(sql,/v_right=0 then return null/);
  assert.match(sql,/Calculated parameters cannot be entered manually/);
  assert.match(sql,/save_draft_results_atomic/);
  assert.match(sql,/return query select \* from public\.test_results/);
});

test('catalog editor saves calculated numeric formulas and results UI is read-only for derived values',()=>{
  const html=read('app/catalog.html');
  const catalog=read('assets/js/catalog.js');
  const repository=read('modules/catalog/repository.js');
  const results=read('assets/js/results-workbench.js');
  assert.match(html,/id="parameterSource"/);
  assert.match(html,/id="parameterFormula"/);
  const sw=read('service-worker.js');
  assert.match(sw,/modules\/catalog\/formula-engine\.js/);
  assert.match(sw,/taiba-smart-lab-shell-v\\d+/);
  assert.match(catalog,/parseFormulaExpression\(/);
  assert.match(repository,/result_source: valid\.resultSource, formula: valid\.formula/);
  assert.match(results,/data-result-source="calculated"/);
  assert.match(results,/input\.dataset\.resultSource !== 'calculated'/);
  assert.match(results,/حساب البارامترات المشتقة تلقائيًا على السحابة/);
});
