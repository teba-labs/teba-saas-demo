import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResultInputMode, prepareResultInput, resultValueTypeForMode } from '../../modules/results/input-mode.js';

test('numeric modes serialize finite numeric values with integer enforcement',()=>{
  assert.deepEqual(prepareResultInput({inputMode:'numeric_integer'},'42'),{value_numeric:42,value_text:null});
  assert.deepEqual(prepareResultInput({inputMode:'numeric_decimal'},'4.25'),{value_numeric:4.25,value_text:null});
  assert.throws(()=>prepareResultInput({inputMode:'numeric_integer'},'4.2'),/أرقامًا صحيحة/);
  assert.throws(()=>prepareResultInput({inputMode:'numeric_decimal'},'NaN'),/رقمية صحيحة/);
});

test('comparator results stay text and enforce a safe comparator format',()=>{
  assert.deepEqual(prepareResultInput({inputMode:'numeric_comparator'},'<5'),{value_numeric:null,value_text:'<5'});
  assert.deepEqual(prepareResultInput({inputMode:'numeric_comparator'},'>=1.25'),{value_numeric:null,value_text:'>=1.25'});
  for(const value of ['5','abc','<','<=NaN'])assert.throws(()=>prepareResultInput({inputMode:'numeric_comparator'},value),/نتيجة مقارنة/);
});

test('qualitative and single choice modes only accept configured options',()=>{
  assert.deepEqual(prepareResultInput({inputMode:'positive_negative',choices:['Positive','Negative']},'Positive'),{value_numeric:null,value_text:'Positive'});
  assert.deepEqual(prepareResultInput({inputMode:'single_choice',choices:['A','B']},'B'),{value_numeric:null,value_text:'B'});
  assert.throws(()=>prepareResultInput({inputMode:'single_choice',choices:['A','B']},'C'),/القائمة المحددة/);
  assert.deepEqual(prepareResultInput({inputMode:'boolean'},'false'),{value_numeric:null,value_text:'false'});
  assert.throws(()=>prepareResultInput({inputMode:'boolean'},'yes'),/اختر نعم أو لا/);
});

test('multiple and graded choices serialize as JSON text and honor selection limits',()=>{
  const parameter={inputMode:'multi_choice',choices:['1+','2+','3+'],resultConfig:{max_selections:2}};
  assert.deepEqual(prepareResultInput(parameter,'["1+","3+"]'),{value_numeric:null,value_text:'["1+","3+"]'});
  assert.throws(()=>prepareResultInput(parameter,'["1+","2+","3+"]'),/يتجاوز الحد/);
  assert.throws(()=>prepareResultInput(parameter,'["1+","unknown"]'),/غير صحيحة/);
  assert.throws(()=>prepareResultInput(parameter,'["1+","1+"]'),/تكرار/);
  assert.deepEqual(prepareResultInput({...parameter,inputMode:'graded_multi_choice'},'["2+"]'),{value_numeric:null,value_text:'["2+"]'});
});

test('legacy value_type records remain readable before and after schema migration',()=>{
  assert.equal(normalizeResultInputMode({valueType:'numeric'}),'numeric_decimal');
  assert.equal(normalizeResultInputMode({valueType:'choice'}),'single_choice');
  assert.equal(resultValueTypeForMode('multi_choice'),'choice');
  assert.deepEqual(prepareResultInput({valueType:'text'},'No growth'),{value_numeric:null,value_text:'No growth'});
  assert.throws(()=>prepareResultInput({inputMode:'unsupported'},'x'),/غير مدعوم/);
});
