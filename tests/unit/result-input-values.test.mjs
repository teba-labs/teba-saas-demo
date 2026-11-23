import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareResultInputValue,resolveResultInputMode} from '../../modules/results/input-values.js';

test('resolves legacy catalog parameter types without breaking existing tests',()=>{
 assert.equal(resolveResultInputMode({value_type:'numeric',decimal_places:0}),'numeric_integer');
 assert.equal(resolveResultInputMode({value_type:'numeric',decimal_places:2}),'numeric_decimal');
 assert.equal(resolveResultInputMode({value_type:'choice'}),'single_choice');
 assert.equal(resolveResultInputMode({result_input_mode:'numeric_comparator'}),'numeric_comparator');
});

test('validates integer and decimal inputs into numeric database columns',()=>{
 assert.deepEqual(prepareResultInputValue({code:'RBC',inputMode:'numeric_integer'},'5'),{
  parameter_code:'RBC',value_numeric:5,value_text:null,flag:null
 });
 assert.throws(()=>prepareResultInputValue({code:'RBC',inputMode:'numeric_integer'},'5.2'),/عددًا صحيحًا/);
 assert.equal(prepareResultInputValue({code:'ALT',inputMode:'numeric_decimal'},'12.35').value_numeric,12.35);
 assert.throws(()=>prepareResultInputValue({code:'ALT',inputMode:'numeric_decimal'},'abc'),/Numeric result is invalid/);
});

test('validates comparator, text, qualitative and yes/no values',()=>{
 assert.equal(prepareResultInputValue({code:'TITER',inputMode:'numeric_comparator'},'> 160').value_text,'> 1:160');
 assert.throws(()=>prepareResultInputValue({code:'TITER',inputMode:'numeric_comparator'},'above 1'),/علامة مقارنة/);
 assert.equal(prepareResultInputValue({code:'COMMENT',inputMode:'text'},'Normal morphology').value_text,'Normal morphology');
 assert.equal(prepareResultInputValue({code:'URINE',inputMode:'positive_negative'},'Positive').value_text,'Positive');
 assert.throws(()=>prepareResultInputValue({code:'URINE',inputMode:'positive_negative'},'Unknown'),/موجبة أو سالبة/);
 assert.equal(prepareResultInputValue({code:'PREG',inputMode:'boolean'},'false').value_text,'false');
 assert.throws(()=>prepareResultInputValue({code:'PREG',inputMode:'boolean'},'yes'),/نعم أو لا/);
});

test('validates single and multiple choice values against catalog options',()=>{
 const parameter={code:'CRYSTAL',inputMode:'single_choice',choices:['Urate','Oxalate']};
 assert.equal(prepareResultInputValue(parameter,'Urate').value_text,'Urate');
 assert.throws(()=>prepareResultInputValue(parameter,'Cystine'),/القائمة المحددة/);
 const multi={code:'CRYSTALS',inputMode:'multi_choice',choices:['Urate','Oxalate']};
 assert.deepEqual(JSON.parse(prepareResultInputValue(multi,'["Urate","Oxalate"]').value_text),['Urate','Oxalate']);
 assert.throws(()=>prepareResultInputValue(multi,'["Urate","Unknown"]'),/الاختيارات المتاحة/);
 assert.throws(()=>prepareResultInputValue(multi,'["Urate","Urate"]'),/دون تكرار/);
});

test('calculates graded multiple-choice score from catalog-defined weights',()=>{
 const graded={code:'SCORE',inputMode:'graded_multi_choice',choices:['A','B','C'],resultConfig:{choice_scores:{A:1,B:2,C:3}}};
 const saved=prepareResultInputValue(graded,'{"selected":["A","C"],"score":4}');
 assert.deepEqual(JSON.parse(saved.value_text),{selected:['A','C'],score:4});
 assert.throws(()=>prepareResultInputValue(graded,'{"selected":["A","C"],"score":3}'),/لا تطابق/);
 assert.throws(()=>prepareResultInputValue({code:'SCORE',inputMode:'graded_multi_choice',choices:['A']},'["A"]'),/درجة رقمية/);
});
