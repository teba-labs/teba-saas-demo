const MODE_TO_LEGACY_TYPE = {
  numeric_integer: 'numeric',
  numeric_decimal: 'numeric',
  numeric_comparator: 'text',
  text: 'text',
  positive_negative: 'choice',
  boolean: 'boolean',
  single_choice: 'choice',
  multi_choice: 'choice',
  graded_multi_choice: 'choice',
};

export function normalizeResultInputMode(parameter = {}) {
  if (parameter.inputMode) return parameter.inputMode;
  if (parameter.resultInputMode) return parameter.resultInputMode;
  if (parameter.result_input_mode) return parameter.result_input_mode;
  return ({ numeric: 'numeric_decimal', text: 'text', boolean: 'boolean', choice: 'single_choice' }[
    parameter.valueType || parameter.value_type || 'numeric'
  ] || 'numeric_decimal');
}

export function resultValueTypeForMode(mode) {
  return MODE_TO_LEGACY_TYPE[mode] || null;
}

/**
 * Convert a clinician-entered value into the database's backward-compatible
 * numeric/text pair. Multi-choice values are stored as a JSON string in value_text.
 */
export function prepareResultInput(parameter, value) {
  const mode = normalizeResultInputMode(parameter);
  if (!MODE_TO_LEGACY_TYPE[mode]) throw new Error('نوع إدخال النتيجة غير مدعوم: ' + mode);
  const rawValue = value === null || value === undefined ? '' : String(value).trim();
  if (!rawValue) throw new Error('أدخل نتيجة التحليل أولًا.');

  const choices = Array.isArray(parameter.choices) ? parameter.choices : [];
  const config = parameter.resultConfig || parameter.result_config || {};
  const allowed = item => choices.includes(item);

  if (mode === 'numeric_integer' || mode === 'numeric_decimal') {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) throw new Error('أدخل قيمة رقمية صحيحة.');
    if (mode === 'numeric_integer' && !Number.isInteger(numeric)) {
      throw new Error('هذا الحقل يقبل أرقامًا صحيحة فقط دون كسور.');
    }
    return { value_numeric: numeric, value_text: null };
  }
  if (mode === 'numeric_comparator') {
    if (!/^(<=|>=|<|>)[\\s]*[+-]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)$/.test(rawValue)) {
      throw new Error('اكتب نتيجة مقارنة مثل <5 أو <=10 أو >300 أو >=1.2.');
    }
    return { value_numeric: null, value_text: rawValue };
  }
  if (mode === 'boolean') {
    if (!['true', 'false'].includes(rawValue)) throw new Error('اختر نعم أو لا.');
    return { value_numeric: null, value_text: rawValue };
  }
  if (mode === 'positive_negative' || mode === 'single_choice') {
    if (!allowed(rawValue)) throw new Error('اختر قيمة من القائمة المحددة لهذا البارامتر.');
    return { value_numeric: null, value_text: rawValue };
  }
  if (mode === 'multi_choice' || mode === 'graded_multi_choice') {
    let selected;
    try { selected = JSON.parse(rawValue); } catch { throw new Error('اختر قيمة واحدة على الأقل من القائمة.'); }
    if (!Array.isArray(selected) || !selected.length || selected.some(item => typeof item !== 'string' || !allowed(item))) {
      throw new Error('الاختيارات المحددة غير صحيحة.');
    }
    if (new Set(selected).size !== selected.length) throw new Error('لا يمكن تكرار الاختيار نفسه.');
    const maximum = Number(config.max_selections ?? 0);
    if (maximum > 0 && selected.length > maximum) throw new Error('عدد الاختيارات يتجاوز الحد المسموح.');
    return { value_numeric: null, value_text: JSON.stringify(selected) };
  }
  return { value_numeric: null, value_text: rawValue };
}
