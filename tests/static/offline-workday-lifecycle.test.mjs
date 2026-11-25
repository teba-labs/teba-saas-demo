import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('workday open, expense and close are queued locally with safe dependencies',()=>{
  const repository=read('modules/workday/repository.js');
  const ui=read('assets/js/workday.js');
  const adapters=read('offline/supabase-adapters.js');
  assert.match(repository,/entityType:'workday_open'/);
  assert.match(repository,/entityType: 'expense'/);
  assert.match(repository,/entityType:'workday_close'/);
  assert.match(repository,/pendingBranchOperationIds/);
  assert.match(repository,/dependsOn/);
  assert.match(ui,/openDay').disabled=open\|\|!state\.staff\.length/);
  assert.match(ui,/closeDay').disabled=!open\|\|!state\.staff\.length/);
  assert.match(ui,/latestPending\.total&&navigator\.onLine!==false/);
  assert.match(adapters,/workday_open: async operation/);
  assert.match(adapters,/workday_close: async operation/);
  assert.match(adapters,/sameClosingSnapshot/);
});

test('offline reception payments and first visit payments contribute to the local cash summary',()=>{
  const reception=read('modules/reception/repository.js');
  const workday=read('modules/workday/repository.js');
  const adapters=read('offline/supabase-adapters.js');
  assert.match(reception,/local_ledger_id/);
  assert.match(reception,/source_type: 'payment'/);
  assert.match(reception,/local_visit_pending/);
  assert.match(workday,/source_type:'expense'/);
  assert.match(adapters,/removeLocalLedgerRow\(p\.local_ledger_id\)/);
  assert.match(adapters,/visit-map:/);
});

test('home and owner dashboard can render local branch data without cloud reports',()=>{
  const home=read('assets/js/app-home.js');
  const dashboard=read('assets/js/dashboard.js');
  const summary=read('offline/dashboard-summary.js');
  assert.match(home,/getCachedRows\('patients'/);
  assert.match(home,/getCachedRows\('visits'/);
  assert.match(dashboard,/getOfflineDashboardSummary/);
  assert.match(dashboard,/ملخص محلي — دون اتصال/);
  assert.match(summary,/financial_ledger/);
  assert.match(summary,/outbox/);
});

test('settings are readable from cache but cloud configuration changes remain online-only',()=>{
  const settings=read('modules/settings/repository.js');
  const staff=read('modules/staff/repository.js');
  const expenses=read('modules/expenses/repository.js');
  assert.match(settings,/requireOnlineSettingsWrite/);
  assert.match(staff,/getCachedRows\('staff_directory'/);
  assert.match(expenses,/getCachedRows\('expense_categories'/);
});
