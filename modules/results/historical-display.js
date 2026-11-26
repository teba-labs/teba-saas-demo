const META_KEYS = new Set(['format','raw_original','raw_result_at','raw_age','raw_age_unit']);

function displayValue(value) {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join('، ');
  if (typeof value === 'object') {
    const primary = value.value ?? value.result ?? value.text ?? value.label;
    const unit = value.unit ? ' ' + value.unit : '';
    if (primary != null) return String(primary) + unit;
    return Object.entries(value).map(([key, item]) => key + ': ' + displayValue(item)).filter(Boolean).join(' · ');
  }
  return String(value);
}

export function historicalResultEntries(resultData) {
  const payload = resultData && typeof resultData === 'object' && !Array.isArray(resultData)
    ? resultData
    : { value: resultData };
  const entries = [];
  if (payload.parameters && typeof payload.parameters === 'object' && !Array.isArray(payload.parameters)) {
    for (const [name, value] of Object.entries(payload.parameters)) {
      const rendered = displayValue(value);
      if (rendered) entries.push({ label: name, value: rendered });
    }
  }
  if (payload.value != null && payload.value !== '') entries.unshift({ label: 'النتيجة', value: displayValue(payload.value) });
  if (payload.unit) entries.push({ label: 'الوحدة', value: displayValue(payload.unit) });
  if (payload.reference_range) entries.push({ label: 'المدى المرجعي', value: displayValue(payload.reference_range) });
  if (!entries.length) {
    for (const [name, value] of Object.entries(payload)) {
      if (META_KEYS.has(name) || value == null || value === '') continue;
      const rendered = displayValue(value);
      if (rendered) entries.push({ label: name, value: rendered });
    }
  }
  if (!entries.length && payload.raw_original && typeof payload.raw_original === 'object') {
    for (const [name, value] of Object.entries(payload.raw_original)) {
      const rendered = displayValue(value);
      if (rendered) entries.push({ label: name, value: rendered });
    }
  }
  return entries;
}

export function renderHistoricalResultValues(resultData, documentRef = document) {
  const entries = historicalResultEntries(resultData);
  const list = documentRef.createElement('dl');
  list.className = 'historical-result-values';
  if (!entries.length) {
    const empty = documentRef.createElement('p');
    empty.textContent = 'لا توجد تفاصيل نتيجة قابلة للعرض.';
    list.append(empty);
    return list;
  }
  for (const entry of entries) {
    const row = documentRef.createElement('div');
    const label = documentRef.createElement('dt');
    const value = documentRef.createElement('dd');
    label.textContent = entry.label;
    value.textContent = entry.value;
    row.append(label, value);
    list.append(row);
  }
  return list;
}
