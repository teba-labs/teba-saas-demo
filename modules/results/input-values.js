const DEFAULT_QUALITATIVE_VALUES = ['positive','negative','equivocal','trace','weak positive','weak negative'];

export function resolveResultInputMode(parameter = {}) {
  if (parameter.inputMode || parameter.result_input_mode) return parameter.inputMode || parameter.result_input_mode;
  const type = parameter.valueType || parameter.value_type || 'numeric';
  if (type === 'numeric') return Number(parameter.decimalPlaces ?? parameter.decimal_places ?? 2) === 0
    ? 'numeric_integer' : 'numeric_decimal';
  return type === 'choice' ? 'single_choice' : type;
}

const asChoices = parameter => Array.isArray(parameter.choices) ? parameter.choices : [];
const asText = value => String(value ?? '').trim();

export function prepareResultInputValue(parameter, value, flag = null) {
  if (!parameter?.code) throw new Error('Every result must identify its parameter code.');
  const mode = resolveResultInputMode(parameter);
  const raw = asText(value);
  if (!raw) throw new Error('A result value is required.');
  const choices = asChoices(parameter);
  const numeric = mode === 'numeric_integer' || mode === 'numeric_decimal';

  if (mode === 'numeric_integer' || mode === 'numeric_decimal') {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error('Numeric result is invalid.');
    if (mode === 'numeric_integer' && !Number.isInteger(parsed)) throw new Error('أدخل عددًا صحيحًا بدون كسور.');
    return { parameter_code: parameter.code, value_numeric: parsed, value_text: null, flag };
  }
  if (mode === 'numeric_comparator') {
    if (!/^(<=|>=|<|>|≤|≥)\\s*-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)$/.test(raw)) {
      throw new Error('اكتب علامة مقارنة ثم رقمًا، مثل: > 5 أو ≤ 3.2');
    }
    return { parameter_code: parameter.code, value_numeric: null, value_text: raw, flag };
  }
  if (mode === 'boolean') {
    const normalized = raw.toLowerCase();
    if (!['true','false'].includes(normalized)) throw new Error('اختر نعم أو لا للنتيجة المنطقية.');
    return { parameter_code: parameter.code, value_numeric: null, value_text: normalized, flag };
  }
  if (mode === 'positive_negative') {
    const normalized = raw.toLowerCase();
    if (!DEFAULT_QUALITATIVE_VALUES.includes(normalized) && !choices.includes(raw)) {
      throw new Error('اختر نتيجة موجبة أو سالبة من القائمة.');
    }
    return { parameter_code: parameter.code, value_numeric: null, value_text: raw, flag };
  }
  if (mode === 'single_choice') {
    if (!choices.includes(raw)) throw new Error('اختر قيمة من القائمة المحددة لهذا البارامتر.');
    return { parameter_code: parameter.code, value_numeric: null, value_text: raw, flag };
  }
  if (mode === 'multi_choice' || mode === 'graded_multi_choice') {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('الاختيارات المتعددة غير محفوظة بصيغة صحيحة.'); }
    const selected = Array.isArray(parsed) ? parsed : parsed?.selected;
    if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length
      || selected.some(option => !choices.includes(option))) {
      throw new Error('اختر قيمة واحدة على الأقل من الاختيارات المتاحة، دون تكرار.');
    }
    if (mode === 'multi_choice') {
      return { parameter_code: parameter.code, value_numeric: null, value_text: JSON.stringify(selected), flag };
    }
    const scores = parameter.resultConfig?.choice_scores || parameter.result_config?.choice_scores || {};
    let score = 0;
    for (const choice of selected) {
      if (!Number.isFinite(Number(scores[choice]))) throw new Error('كل اختيار متدرج يحتاج درجة رقمية معرفة في الكتالوج.');
      score += Number(scores[choice]);
    }
    if (parsed && !Array.isArray(parsed) && parsed.score != null && Number(parsed.score) !== score) {
      throw new Error('درجة الاختيارات لا تطابق الدرجات المحددة في الكتالوج.');
    }
    return { parameter_code: parameter.code, value_numeric: null, value_text: JSON.stringify({ selected, score }), flag };
  }
  if (mode === 'text') {
    return { parameter_code: parameter.code, value_numeric: null, value_text: raw, flag };
  }
  throw new Error('Unsupported result input mode: ' + mode);
}
