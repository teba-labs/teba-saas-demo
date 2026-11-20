import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFormulaExpression, formulaToExpression } from '../../modules/catalog/formula-engine.js';

const parameters = [
  {parameter_code:'HGB',value_type:'numeric',is_active:true},
  {parameter_code:'HCT',value_type:'numeric',is_active:true},
  {parameter_code:'TEXT',value_type:'text',is_active:true},
  {parameter_code:'OFF',value_type:'numeric',is_active:false},
];

test('parses arithmetic with precedence, parentheses, unary signs and constants',()=>{
  const ast=parseFormulaExpression('(HGB + HCT) / 2 - 1',parameters,'MCV');
  assert.deepEqual(ast,{op:'subtract',args:[{op:'divide',args:[{op:'add',args:[{param:'HGB'},{param:'HCT'}]},{const:2}]},{const:1}]});
  assert.equal(formulaToExpression(ast),'(((HGB + HCT) / 2) - 1)');
});

test('rejects missing, inactive, nonnumeric and self-referencing inputs',()=>{
  assert.throws(()=>parseFormulaExpression('HGB + UNKNOWN',parameters,'MCV'),/غير موجود/);
  assert.throws(()=>parseFormulaExpression('HGB + OFF',parameters,'MCV'),/غير موجود/);
  assert.throws(()=>parseFormulaExpression('HGB + TEXT',parameters,'MCV'),/ليس رقميًا/);
  assert.throws(()=>parseFormulaExpression('MCV + HGB',parameters,'MCV'),/نفسه/);
});

test('rejects malformed expressions and formulas without parameter references',()=>{
  assert.throws(()=>parseFormulaExpression('HGB +',parameters,'MCV'),/غير مكتملة/);
  assert.throws(()=>parseFormulaExpression('(HGB + HCT',parameters,'MCV'),/قوس/);
  assert.throws(()=>parseFormulaExpression('12 / 2',parameters,'MCV'),/بارامتر/);
  assert.throws(()=>parseFormulaExpression('HGB @ 2',parameters,'MCV'),/غير مفهومة/);
});

test('supports validated scientific helper functions and decimal constants',()=>{
  assert.deepEqual(parseFormulaExpression('round(ABS(HGB - HCT) / 2, 1)',parameters,'MCV'),{
    op:'round',args:[{op:'divide',args:[{op:'abs',args:[{op:'subtract',args:[{param:'HGB'},{param:'HCT'}]}]},{const:2}]},{const:1}]
  });
  const aggregate=parseFormulaExpression('max(HGB, HCT, .5) + min(HGB, HCT)',parameters,'MCV');
  assert.equal(formulaToExpression(aggregate),'(max(HGB, HCT, 0.5) + min(HGB, HCT))');
  assert.throws(()=>parseFormulaExpression('sqrt(HGB)',parameters,'MCV'),/الدالة غير معروفة/);
  assert.throws(()=>parseFormulaExpression('round(HGB, 1, 2)',parameters,'MCV'),/عدد مدخلاتها/);
});
