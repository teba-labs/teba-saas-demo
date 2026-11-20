import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const page=fs.readFileSync(path.join(root,'app/dashboard.html'),'utf8');
const script=fs.readFileSync(path.join(root,'assets/js/dashboard.js'),'utf8');
const repo=fs.readFileSync(path.join(root,'dashboard/repository.js'),'utf8');
test('owner dashboard is Arabic RTL and includes month, tenant and branch filters',()=>{
  assert.match(page,/lang="ar" dir="rtl"/);
  for(const id of ['tenantSelect','branchSelect','month','collected','expenses','netCash','receivables','grossBilled','discounts','netBilled','dailyRows','expenseBreakdownRows','branchRows','testRows','summaryText']) assert.match(page,new RegExp(`id="${id}"`));
});
test('dashboard is restricted in the interface to tenant owners',()=>{
  assert.match(script,/filter\(t=>t\.accountType==='owner'\)/);
  assert.match(script,/لوحة التحليل المالي متاحة لمدير المعمل فقط/);
  assert.match(script,/state\.tenant\?\.allBranches\|\|state\.tenant\?\.branches/);
  assert.match(script,/مؤرشف/);
  assert.match(repo,/select\('id,name,is_active'\)/);
});
test('cash collections and expenses are sourced from financial ledger, not invoice totals',()=>{
  assert.match(repo,/from\('financial_ledger'\)/);
  assert.match(repo,/row\.direction === 'inflow'/);
  assert.match(repo,/row\.direction === 'outflow'/);
  assert.match(repo,/netCash: collected - expenses/);
  assert.match(repo,/receivables/);
});
test('invoice gross, discount and net amounts are shown separately',()=>{
  assert.match(repo,/gross_total,discount_amount,net_total/);
  assert.match(repo,/grossBilled/); assert.match(repo,/discounts/); assert.match(repo,/netBilled/);
  assert.match(page,/إجمالي الفواتير قبل الخصم/); assert.match(page,/الخصومات/);
});
test('test movement is reported without inventing per-test profit margins',()=>{
  assert.match(repo,/test_name_snapshot/); assert.match(repo,/topTests/);
  assert.match(page,/لا نعرض هامش ربح أو ربحية تحليل قبل إدخال تكلفة تشغيل موثوقة/);
});
test('summary copy action is available and report supports all branches or one branch',()=>{
  assert.match(page,/id="copySummary"/); assert.match(script,/navigator\.clipboard\.writeText/);
  assert.match(repo,/branchId = null/); assert.match(repo,/branchId\)/);
});

test('owner dashboard paginates every source query and excludes cancelled visits and tests',()=>{
  assert.match(repo,/async function readAllPages/);
  assert.match(repo,/\.range\(offset, offset \+ pageSize - 1\)/);
  assert.match(repo,/\.neq\('status', 'cancelled'\)/);
  assert.match(repo,/visit_billing/);
  assert.match(repo,/payments/);
  assert.match(repo,/visit_tests/);
});

test('daily dashboard trend combines live visits, tests and ledger movements by work date',()=>{
  assert.match(repo,/dailyItem\(visit\.visit_work_date\)\.visits \+= 1/);
  assert.match(repo,/dailyItem\(date\)\.tests \+= 1/);
  assert.match(script,/d\.visits\|\|0/);
  assert.match(script,/d\.tests\|\|0/);
  assert.match(page,/الزيارات/);
  assert.match(page,/التحاليل/);
});

test('live expense details reconcile ledger outflows to tenant-scoped expense categories',()=>{
  const breakdown=fs.readFileSync(path.join(root,'modules/dashboard/expense-breakdown.js'),'utf8');
  assert.match(repo,/buildExpenseBreakdown/);
  assert.match(repo,/source_type === 'expense'/);
  assert.match(repo,/from\('expenses'\)/);
  assert.match(repo,/from\('expense_categories'\)/);
  assert.match(repo,/\.eq\('tenant_id', tenantId\)/);
  assert.match(repo,/offset \+= 500/);
  assert.match(repo,/expenseBreakdown,/);
  assert.match(breakdown,/ledger\.source_type==='expense'/);
  assert.match(breakdown,/categoryName/);
  assert.match(script,/report\.expenseBreakdown/);
  assert.match(page,/تفصيل المصروفات حسب البند/);
});

test('owner dashboard shell refresh includes the archived-branch selector update',()=>{
  const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
  assert.match(sw,/taiba-smart-lab-shell-v27/);
  assert.match(sw,/\.\/assets\/js\/dashboard\.js/);
});
