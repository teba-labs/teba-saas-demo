import { getSupabaseClient } from '../core/supabase-client.js';
import { buildExpenseBreakdown } from '../modules/dashboard/expense-breakdown.js';
import { summarizeVisitTestStatus } from '../modules/dashboard/live-status.js';
const db = () => getSupabaseClient();
const need = (value, name) => { if (!value) throw new Error(`${name} is required.`); };
const sum = (rows, field) => (rows ?? []).reduce((total, row) => total + Number(row[field] ?? 0), 0);

/** Read every page explicitly; PostgREST's default row cap must not silently truncate owner reports. */
async function readAllPages(buildQuery, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/**
 * Owner dashboard for one tenant and a calendar month.
 * Collections/expenses come from the immutable financial ledger; invoices are
 * deliberately reported separately so unpaid balances are never counted as cash.
 */
export async function getOwnerMonthlyDashboard({ tenantId, monthStart, monthEnd, branchId = null } = {}) {
  need(tenantId, 'tenantId'); need(monthStart, 'monthStart'); need(monthEnd, 'monthEnd');
  const client = db();
  const scope = (query, column = 'branch_id') => branchId ? query.eq(column, branchId) : query;

  const [branches, ledger, visits] = await Promise.all([
    readAllPages(() => client.from('branches').select('id,name,is_active')
      .eq('tenant_id', tenantId).order('name').order('id')),
    readAllPages(() => scope(client.from('financial_ledger')
      .select('id,branch_id,source_type,source_id,direction,amount,work_date,movement_at,description')
      .eq('tenant_id', tenantId).gte('work_date', monthStart).lt('work_date', monthEnd)
      .order('work_date').order('movement_at').order('id'))),
    readAllPages(() => scope(client.from('visits')
      .select('id,branch_id,visit_work_date,status,is_published,patient_id')
      .eq('tenant_id', tenantId).gte('visit_work_date', monthStart).lt('visit_work_date', monthEnd)
      .neq('status', 'cancelled').order('visit_work_date').order('id'))),
  ]);
  const liveStatus = summarizeVisitTestStatus({ visits, visitTests: [] });
  const visitIds = visits.map(row => row.id);

  let billing = [], payments = [], visitTests = [];
  if (visitIds.length) {
    const [billingRows, paymentRows, testRows] = await Promise.all([
      readAllPages(() => client.from('visit_billing').select('visit_id,gross_total,discount_amount,net_total')
        .eq('tenant_id', tenantId).in('visit_id', visitIds).order('visit_id')),
      // All payments for the month's visits are needed to calculate their current receivables.
      readAllPages(() => client.from('payments').select('visit_id,amount,received_at,branch_id')
        .eq('tenant_id', tenantId).in('visit_id', visitIds).order('received_at').order('id')),
      readAllPages(() => client.from('visit_tests').select('id,visit_id,branch_id,test_id,test_name_snapshot,price_snapshot,status')
        .eq('tenant_id', tenantId).in('visit_id', visitIds).neq('status', 'cancelled').order('visit_id').order('id')),
    ]);
    billing = billingRows; payments = paymentRows; visitTests = testRows;
    Object.assign(liveStatus.totals, summarizeVisitTestStatus({ visits, visitTests }).totals);
    liveStatus.branches = summarizeVisitTestStatus({ visits, visitTests }).branches;
    liveStatus.daily = summarizeVisitTestStatus({ visits, visitTests }).daily;
  }

  const collectedRows = ledger.filter(row => row.direction === 'inflow');
  const expenseRows = ledger.filter(row => row.direction === 'outflow');
  const expenseSourceIds = [...new Set(expenseRows.filter(row => row.source_type === 'expense' && row.source_id).map(row => row.source_id))];
  const linkedExpenses = [];
  for (let offset = 0; offset < expenseSourceIds.length; offset += 500) {
    const ids = expenseSourceIds.slice(offset, offset + 500);
    linkedExpenses.push(...await readAllPages(() => client.from('expenses').select('id,category_id')
      .eq('tenant_id', tenantId).in('id', ids).order('id')));
  }
  const categoryIds = [...new Set(linkedExpenses.map(row => row.category_id).filter(Boolean))];
  const expenseCategories = [];
  for (let offset = 0; offset < categoryIds.length; offset += 500) {
    const ids = categoryIds.slice(offset, offset + 500);
    expenseCategories.push(...await readAllPages(() => client.from('expense_categories').select('id,name')
      .eq('tenant_id', tenantId).in('id', ids).order('name').order('id')));
  }
  const expenseBreakdown = buildExpenseBreakdown({ ledgerRows: expenseRows, expenseRows: linkedExpenses, categoryRows: expenseCategories, branches });
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
      ...(liveStatus.branches.find(item => item.branchId === branch.id) || {pendingTests:0,inProgressTests:0,completedTests:0,publishedVisits:0,unpublishedVisits:0}),
    };
  });

  const dailyMap = new Map(liveStatus.daily.map(item => [item.date, {...item, collected:0, expenses:0}]));
  const dailyItem = date => {
    const item = dailyMap.get(date) ?? { date, collected: 0, expenses: 0, visits: 0, tests: 0, pendingTests:0, inProgressTests:0, completedTests:0, publishedVisits:0, unpublishedVisits:0 };
    dailyMap.set(date, item);
    return item;
  };
  for (const row of ledger) {
    const item = dailyItem(row.work_date);
    if (row.direction === 'inflow') item.collected += Number(row.amount);
    if (row.direction === 'outflow') item.expenses += Number(row.amount);
  }
  const testMap = new Map();
  for (const row of visitTests) {
    const item = testMap.get(row.test_id) ?? { testId: row.test_id, name: row.test_name_snapshot, count: 0, billed: 0 };
    item.count += 1; item.billed += Number(row.price_snapshot ?? 0); testMap.set(row.test_id, item);
  }
  const uniquePatients = new Set(visits.map(row => row.patient_id));
  const categoryNameById = new Map(expenseCategories.map(row => [row.id, row.name]));
  const categoryNameByExpenseId = new Map(linkedExpenses.map(row => [row.id, row.category_id ? (categoryNameById.get(row.category_id) || 'بند غير معروف') : 'مصروف غير مصنف']));
  const ledgerWithCategories = ledger.map(row => ({...row, category_name: row.source_type === 'expense' ? (categoryNameByExpenseId.get(row.source_id) || 'مصروف غير مرتبط ببند') : row.direction === 'outflow' ? 'حركة خارجة أخرى' : null}));
  return {
    period: { monthStart, monthEnd }, branches: byBranch,
    totals: {
      visits: visits.length, patients: uniquePatients.size, tests: visitTests.length,
      grossBilled, discounts, netBilled, collected, expenses, netCash: collected - expenses,
      receivables, paymentCount: collectedRows.length, expenseCount: expenseRows.length,
      ...liveStatus.totals,
    },
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    expenseBreakdown,
    topTests: [...testMap.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    ledger: ledgerWithCategories,
  };
}

/** Date-range test demand report; tenant/branch scoped and paginated without changing data. */
export async function getOwnerTestRangeReport({tenantId,fromDate,toDateExclusive,branchId=null,search=''}={}){
 need(tenantId,'tenantId');need(fromDate,'fromDate');need(toDateExclusive,'toDateExclusive');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)||!/^\d{4}-\d{2}-\d{2}$/.test(toDateExclusive)||toDateExclusive<=fromDate)throw new Error('A valid half-open date range is required.');
 const client=db();
 const buildVisitsQuery=()=>{
  let query=client.from('visits').select('id,branch_id').eq('tenant_id',tenantId)
   .gte('visit_work_date',fromDate).lt('visit_work_date',toDateExclusive).neq('status','cancelled')
   .order('visit_work_date').order('id');
  if(branchId)query=query.eq('branch_id',branchId);
  return query;
 };
 const visits=await readAllPages(buildVisitsQuery);
 const counts=new Map();
 for(let offset=0;offset<visits.length;offset+=500){
  const ids=visits.slice(offset,offset+500).map(row=>row.id);
  const tests=await readAllPages(()=>client.from('visit_tests')
   .select('test_id,test_name_snapshot,price_snapshot,status')
   .eq('tenant_id',tenantId).in('visit_id',ids).neq('status','cancelled').order('test_id'));
  for(const row of tests){
   const key=String(row.test_id||row.test_name_snapshot||'').trim();if(!key)continue;
   const item=counts.get(key)||{testId:row.test_id,name:row.test_name_snapshot||key,count:0,billed:0};
   item.count+=1;item.billed+=Number(row.price_snapshot||0);counts.set(key,item);
  }
 }
 const needle=String(search||'').trim().toLocaleLowerCase('ar');
 const tests=[...counts.values()].filter(item=>!needle||String(item.name).toLocaleLowerCase('ar').includes(needle)||String(item.testId||'').toLocaleLowerCase('ar').includes(needle)).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ar'));
 return {period:{fromDate,toDateExclusive},visitCount:visits.length,testCount:tests.reduce((sum,item)=>sum+item.count,0),tests};
}
