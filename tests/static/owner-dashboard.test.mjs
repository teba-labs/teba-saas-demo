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
  for(const id of ['tenantSelect','branchSelect','month','collected','expenses','netCash','receivables','grossBilled','discounts','netBilled','dailyRows','branchRows','testRows','summaryText']) assert.match(page,new RegExp(`id="${id}"`));
});
test('dashboard is restricted in the interface to tenant owners',()=>{
  assert.match(script,/filter\(t=>t\.accountType==='owner'\)/);
  assert.match(script,/لوحة التحليل المالي متاحة لمدير المعمل فقط/);
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
