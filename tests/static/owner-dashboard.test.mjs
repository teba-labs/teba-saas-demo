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

test('daily dashboard trend combines live visits, tests, statuses and ledger movements by work date',()=>{
  const liveStatus=fs.readFileSync(path.join(root,'modules/dashboard/live-status.js'),'utf8');
  assert.match(repo,/summarizeVisitTestStatus/);
  assert.match(liveStatus,/day\.visits\+=1/);
  assert.match(liveStatus,/day\.tests\+=1/);
  assert.match(script,/today\.visits/);
  assert.match(script,/today\.tests/);
  assert.match(page,/الزيارات/);
  assert.match(page,/التحاليل/);
  assert.match(page,/معلقة/);
  assert.match(page,/قيد التنفيذ/);
  assert.match(page,/تقارير منشورة/);
  assert.match(page,/colspan="11"/);
});

test('live expense details reconcile ledger outflows to tenant-scoped expense categories',()=>{
  const breakdown=fs.readFileSync(path.join(root,'modules/dashboard/expense-breakdown.js'),'utf8');
  assert.match(repo,/buildExpenseBreakdown/);
  assert.match(repo,/source_type === 'expense'/);
  assert.match(repo,/source_type,source_id,direction/); // ledger source_id is required to resolve expense categories
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
  assert.match(sw,/taiba-smart-lab-shell-v\d+/);
  assert.match(sw,/\.\/assets\/js\/dashboard\.js/);
});

test('owner dashboard presents exactly 18 independent report entries and separate screens',()=>{
  const reportList=script.match(/const OWNER_REPORTS=\[([\s\S]*?)\n\];/)?.[1]||'';
  const entries=reportList.match(/^\s*\['[A-Za-z]+','[^']+','[^']+'\]/gm)||[];
  assert.equal(entries.length,18);
  for(const id of ['dailyFinance','reconciliation','live','overview','financial','annual','cases','expenseBreakdown','bcg','testReport','monthlyPlan','topSellers','mostProfitable','leastProfitable','needOffers','lossMakers','upload','security']){
    assert.match(script,new RegExp("'"+id+"'"));
  }
  assert.match(script,/data-owner-report=/);
  assert.match(script,/data-owner-screen=/);
  assert.match(script,/data-owner-back/);
  assert.match(script,/if\(id==='home'\)id='overview'/);
});
test('daily financial movement is read-only and links to Workday for new entries',()=>{
  assert.match(script,/report\.ledger\.length/);
  assert.match(script,/workday\.html/);
  assert.match(script,/تسجيل التحصيل والمصروفات يظل من شاشة يوم العمل/);
});
test('security screen does not misrepresent local Excel archive as cloud backup',()=>{
  assert.match(script,/ليس نسخة سحابية/);
  assert.match(script,/ليس قاعدة بيانات الخادم كاملة/);
  assert.match(script,/settings\.html/);
  assert.match(script,/sync-center\.html/);
});

test('owner report screens expose CSV export and the case screen includes historical seasonality',()=>{
  assert.match(script,/data-owner-export=/);
  assert.match(script,/function exportOwnerReport/);
  assert.match(script,/text\/csv;charset=utf-8/);
  assert.match(script,/cases:'موسمية الحالات حسب الشهر'/);
});

test('historical dashboard follows the selected branch by exact workbook branch name',()=>{
  assert.match(script,/data-branch-name=/);
  assert.match(script,/refresh\(\)\.then\(\(\)=>refreshHistoricalDashboard\(\)\)/);
  assert.match(fs.readFileSync(path.join(root,'assets/js/dashboard-history.js'),'utf8'),/dataset\?\.branchName/);
  const history=fs.readFileSync(path.join(root,'modules/dashboard/historical-analysis.js'),'utf8');
  assert.match(history,/branch='all'/);
  assert.match(history,/اسم الفرع المختار غير موجود/);
});

test('live and monthly screens render their own current-day and selected-period KPI summaries',()=>{
  for(const id of ['liveTodayVisits','liveTodayTests','liveTodayCollected','liveTodayExpenses','liveTodayNet','monthGross','monthDiscounts','monthNetBilled','monthCollected','monthExpenses','monthNetCash','monthReceivables','monthVisitsPatients']) assert.match(script,new RegExp(id));
});

test('CSV export includes live KPI cards and historical reconciliation KPI cards',()=>{
  assert.match(script,/\.kpi,\.history-analysis-kpis article/);
  assert.match(script,/const csv='\\uFEFF'/);
});

test('optional local reference period selector appears only on upload and hides on menu return',()=>{
  assert.match(script,/id='historyPeriodPanel'/);
  assert.match(script,/historyPeriod\.hidden=id!=='upload'/);
  assert.match(script,/controls\.hidden=true/);
  assert.match(script,/historyPeriod\.hidden=id!=='upload'/);
});

test('overview includes grounded operational insights and expense breakdown visualization',()=>{
  assert.match(script,/ownerOverviewInsights/);
  assert.match(script,/توجد مديونيات قائمة بقيمة/);
  assert.match(script,/expenseBreakdownChart/);
  assert.match(script,/expense-bar-track/);
});

test('owner report screens support browser print-to-PDF and use standard BCG labels',()=>{
  assert.match(script,/data-owner-print/);
  assert.match(script,/window\.print\(\)/);
  const history=fs.readFileSync(path.join(root,'assets/js/dashboard-history.js'),'utf8');
  assert.match(history,/أبقار حلوب/);
  assert.match(history,/كلاب/);
  assert.match(fs.readFileSync(path.join(root,'assets/css/dashboard.css'),'utf8'),/@media print/);
});
test('monthly plan UI renders a three-month outlook from the historical engine',()=>{
  const history=fs.readFileSync(path.join(root,'assets/js/dashboard-history.js'),'utf8');
  const engine=fs.readFileSync(path.join(root,'modules/dashboard/historical-analysis.js'),'utf8');
  assert.match(engine,/const outlook=\[1,2,3\]\.map\(buildMonthPlan\)/);
  assert.match(history,/خطة الأشهر الثلاثة التالية/);
  assert.match(history,/report\.monthlyPlan\.outlook\.flatMap/);
});

test('owner daily movement ledger resolves expense category names through tenant-scoped source ids',()=>{
  const repository=fs.readFileSync(path.join(root,'dashboard/repository.js'),'utf8');
  assert.match(repository,/categoryNameByExpenseId/);
  assert.match(repository,/ledgerWithCategories/);
  assert.match(script,/row\.category_name\|\|row\.description/);
});

test('live dashboard counts pending, in-progress, completed tests and published visits from scoped records',()=>{
  const repository=fs.readFileSync(path.join(root,'dashboard/repository.js'),'utf8');
  const status=fs.readFileSync(path.join(root,'modules/dashboard/live-status.js'),'utf8');
  assert.match(repository,/is_published/);
  assert.match(repository,/summarizeVisitTestStatus/);
  assert.match(status,/pendingTests/);
  assert.match(status,/inProgressTests/);
  assert.match(status,/completedTests/);
  assert.match(status,/publishedVisits/);
  assert.match(script,/liveTodayPendingTests/);
  assert.match(script,/liveTodayPublishedVisits/);
});

test('live status module is included in the offline application shell',()=>{
  const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
  assert.match(sw,/modules\/dashboard\/live-status\.js/);
});

test('owner dashboard presents 18 reports through expandable categories and one report workspace',()=>{
  const css=fs.readFileSync(path.join(root,'assets/css/dashboard.css'),'utf8');
  assert.match(script,/mountOwnerDashboardNavigation/);
  assert.match(script,/18 تقريرًا/);
  assert.match(script,/owner-nav-groups/);
  assert.match(script,/data-owner-group=/);
  assert.match(script,/data-owner-more/);
  assert.match(script,/data-owner-report=/);
  assert.match(script,/data-owner-screen=/);
  assert.match(css,/\.owner-group-toggle/);
  assert.match(css,/\.owner-nav-extra/);
  assert.match(css,/\.owner-more-groups/);
  assert.match(page,/theme-controller\.js/);
});
