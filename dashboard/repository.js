import { getSupabaseClient } from '../core/supabase-client.js';
const db = () => getSupabaseClient();
const need = (value, name) => { if (!value) throw new Error(`${name} is required.`); };
const sum = (rows, field) => (rows ?? []).reduce((total, row) => total + Number(row[field] ?? 0), 0);

/**
 * Owner dashboard for one tenant and a calendar month.
 * Collections/expenses come from the immutable financial ledger; invoices are
 * deliberately reported separately so unpaid balances are never counted as cash.
 */
export async function getOwnerMonthlyDashboard({ tenantId, monthStart, monthEnd, branchId = null } = {}) {
  need(tenantId, 'tenantId'); need(monthStart, 'monthStart'); need(monthEnd, 'monthEnd');
  const client = db();
  const scope = (query, column = 'branch_id') => branchId ? query.eq(column, branchId) : query;

  const [branchesResult, ledgerResult, visitsResult] = await Promise.all([
    client.from('branches').select('id,name,is_active').eq('tenant_id', tenantId).order('name'),
    scope(client.from('financial_ledger')
      .select('id,branch_id,source_type,direction,amount,work_date,movement_at,description')
      .eq('tenant_id', tenantId).gte('work_date', monthStart).lt('work_date', monthEnd)
      .order('work_date').order('movement_at')),
    scope(client.from('visits')
      .select('id,branch_id,visit_work_date,status,patient_id')
      .eq('tenant_id', tenantId).gte('visit_work_date', monthStart).lt('visit_work_date', monthEnd)),
  ]);
  for (const result of [branchesResult, ledgerResult, visitsResult]) if (result.error) throw result.error;
  const branches = branchesResult.data ?? [];
  const ledger = ledgerResult.data ?? [];
  const visits = visitsResult.data ?? [];
  const visitIds = visits.map(row => row.id);

  let billing = [], payments = [], visitTests = [];
  if (visitIds.length) {
    const [billingResult, paymentsResult, testsResult] = await Promise.all([
      client.from('visit_billing').select('visit_id,gross_total,discount_amount,net_total').eq('tenant_id', tenantId).in('visit_id', visitIds),
      // All payments for the month's visits are needed to calculate their current receivables.
      client.from('payments').select('visit_id,amount,received_at,branch_id').eq('tenant_id', tenantId).in('visit_id', visitIds),
      client.from('visit_tests').select('id,visit_id,branch_id,test_id,test_name_snapshot,price_snapshot,status').eq('tenant_id', tenantId).in('visit_id', visitIds),
    ]);
    for (const result of [billingResult, paymentsResult, testsResult]) if (result.error) throw result.error;
    billing = billingResult.data ?? []; payments = paymentsResult.data ?? []; visitTests = testsResult.data ?? [];
  }

  const collectedRows = ledger.filter(row => row.direction === 'inflow');
  const expenseRows = ledger.filter(row => row.direction === 'outflow');
  const collected = sum(collectedRows, 'amount');
  const expenses = sum(expenseRows, 'amount');
  const grossBilled = sum(billing, 'gross_total');
  const discounts = sum(billing, 'discount_amount');
  const netBilled = sum(billing, 'net_total');
  const paidForPeriodVisits = payments.reduce((total, row) => total + Number(row.amount ?? 0), 0);
  const receivables = Math.max(0, netBilled - paidForPeriodVisits);

  const byBranch = branches.filter(branch => !branchId || branch.id === branchId).map(branch => {
    const branchLedger = ledger.filter(row => row.branch_id === branch.id);
    const branchVisits = visits.filter(row => row.branch_id === branch.id);
    const ids = new Set(branchVisits.map(row => row.id));
    const branchBilling = billing.filter(row => ids.has(row.visit_id));
    const branchPayments = payments.filter(row => ids.has(row.visit_id));
    const branchTests = visitTests.filter(row => row.branch_id === branch.id);
    const cashIn = sum(branchLedger.filter(row => row.direction === 'inflow'), 'amount');
    const cashOut = sum(branchLedger.filter(row => row.direction === 'outflow'), 'amount');
    const billed = sum(branchBilling, 'net_total');
    return {
      id: branch.id, name: branch.name, visits: branchVisits.length, tests: branchTests.length,
      grossBilled: sum(branchBilling, 'gross_total'), discounts: sum(branchBilling, 'discount_amount'),
      netBilled: billed, collected: cashIn, expenses: cashOut, netCash: cashIn - cashOut,
      receivables: Math.max(0, billed - sum(branchPayments, 'amount')),
    };
  });

  const dailyMap = new Map();
  for (const row of ledger) {
    const item = dailyMap.get(row.work_date) ?? { date: row.work_date, collected: 0, expenses: 0 };
    if (row.direction === 'inflow') item.collected += Number(row.amount);
    if (row.direction === 'outflow') item.expenses += Number(row.amount);
    dailyMap.set(row.work_date, item);
  }
  const testMap = new Map();
  for (const row of visitTests) {
    const item = testMap.get(row.test_id) ?? { testId: row.test_id, name: row.test_name_snapshot, count: 0, billed: 0 };
    item.count += 1; item.billed += Number(row.price_snapshot ?? 0); testMap.set(row.test_id, item);
  }
  const uniquePatients = new Set(visits.map(row => row.patient_id));
  return {
    period: { monthStart, monthEnd }, branches: byBranch,
    totals: {
      visits: visits.length, patients: uniquePatients.size, tests: visitTests.length,
      grossBilled, discounts, netBilled, collected, expenses, netCash: collected - expenses,
      receivables, paymentCount: collectedRows.length, expenseCount: expenseRows.length,
    },
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    topTests: [...testMap.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    ledger,
  };
}
