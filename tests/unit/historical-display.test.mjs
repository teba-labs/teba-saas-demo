import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalResultEntries } from '../../modules/results/historical-display.js';

test('legacy historical parameter values are presented as readable label/value rows', () => {
  const rows = historicalResultEntries({
    format: 'legacy-historical-v1',
    value: '12.4',
    unit: 'mg/dL',
    reference_range: '5–15',
    parameters: { GLUCOSE: '92', CREATININE: { value: '0.8', unit: 'mg/dL' } },
    raw_original: { Patient: 'مريض', Result: '12.4' },
  });
  assert.deepEqual(rows, [
    { label: 'النتيجة', value: '12.4' },
    { label: 'GLUCOSE', value: '92' },
    { label: 'CREATININE', value: '0.8 mg/dL' },
    { label: 'الوحدة', value: 'mg/dL' },
    { label: 'المدى المرجعي', value: '5–15' },
  ]);
});

test('historical result fallback omits internal metadata and formats original row cells', () => {
  const rows = historicalResultEntries({
    format: 'legacy-historical-v1',
    raw_original: { 'اسم المريض': 'أحمد', 'نتيجة التحليل': 'سلبي' },
    raw_result_at: '10:00',
  });
  assert.deepEqual(rows, [
    { label: 'اسم المريض', value: 'أحمد' },
    { label: 'نتيجة التحليل', value: 'سلبي' },
  ]);
});
