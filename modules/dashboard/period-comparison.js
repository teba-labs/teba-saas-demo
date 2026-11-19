const METRICS = [
  ['netBilled','صافي الفواتير','money'],
  ['collected','التحصيل الفعلي','money'],
  ['expenses','المصروفات','money'],
  ['netCash','صافي النقدية','money'],
  ['receivables','المديونيات','money'],
  ['visits','الزيارات','count'],
  ['patients','المرضى','count'],
  ['tests','التحاليل','count']
];

export function getPreviousMonthRange(monthStart) {
  if (!/^\d{4}-\d{2}-01$/.test(String(monthStart || ''))) {
    throw new Error('monthStart must be the first day of a valid month.');
  }
  const [year, month] = monthStart.slice(0, 7).split('-').map(Number);
  if (month < 1 || month > 12) throw new Error('monthStart month must be between 01 and 12.');
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const next = new Date(Date.UTC(year, month - 1, 1));
  return {
    monthStart: previous.toISOString().slice(0, 10),
    monthEnd: next.toISOString().slice(0, 10)
  };
}

export function compareDashboardPeriods(current, previous) {
  if (!current?.totals || !previous?.totals) throw new Error('Both period reports are required.');
  return METRICS.map(([key, label, kind]) => {
    const currentValue = Number(current.totals[key] ?? 0);
    const previousValue = Number(previous.totals[key] ?? 0);
    const difference = currentValue - previousValue;
    return {
      key, label, kind, current: currentValue, previous: previousValue, difference,
      changePercent: previousValue === 0 ? (currentValue === 0 ? 0 : null) : difference / Math.abs(previousValue) * 100
    };
  });
}
