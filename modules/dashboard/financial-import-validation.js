/**
 * Shared pre-persistence guard for accountant workbook rows.
 * Ordinary movements require a period; a test-price list is timeless by design.
 * Zero is a valid cost/price and must not be treated as missing.
 */
export function isFinancialImportRowImportable(row = {}) {
  const hasPrice = row.unit_cost !== null && row.unit_cost !== undefined
    || row.selling_price !== null && row.selling_price !== undefined;
  const timelessPrice = row.metric_key === 'test_price' && hasPrice;
  const hasMeasure = row.amount !== null && row.amount !== undefined
    || row.quantity !== null && row.quantity !== undefined
    || timelessPrice;
  return Boolean(
    row.period_date || timelessPrice
  ) && Boolean(String(row.metric_key ?? '').trim())
    && Boolean(hasMeasure)
    && row._duplicate !== true;
}
