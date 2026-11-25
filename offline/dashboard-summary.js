import { offlineDb } from './database.js';

export async function getOfflineDashboardSummary({tenantId,monthStart,monthEnd,branchId=null,branches=[]}={}){
  if(!tenantId||!monthStart||!monthEnd)throw new Error('Tenant and month range are required.');
  const [allVisits,allTests,allLedger,allOutbox,ledgerSnapshot]=await Promise.all([
    offlineDb.visits.where('tenant_id').equals(tenantId).toArray(),
    offlineDb.visit_tests.where('tenant_id').equals(tenantId).toArray(),
    offlineDb.financial_ledger.where('tenant_id').equals(tenantId).toArray(),
    offlineDb.outbox.where('tenant_id').equals(tenantId).toArray(),
    offlineDb.sync_meta.get(`financial-ledger-month:${tenantId}:${branchId||branches[0]?.id||''}:${monthStart}`),
  ]);
  const allowedBranches=new Set(branchId?[branchId]:branches.map(row=>row.id));
  const inScope=row=>!allowedBranches.size||allowedBranches.has(row.branch_id);
  const visits=allVisits.filter(row=>inScope(row)&&String(row.visit_work_date||row.work_date||'')>=monthStart&&String(row.visit_work_date||row.work_date||'')<monthEnd&&row.status!=='cancelled');
  const visitIds=new Set(visits.map(row=>row.id));
  const tests=allTests.filter(row=>inScope(row)&&visitIds.has(row.visit_id)&&row.status!=='cancelled');
  const ledger=allLedger.filter(row=>inScope(row)&&String(row.work_date||'')>=monthStart&&String(row.work_date||'')<monthEnd);
  const collected=ledger.filter(row=>row.direction==='inflow').reduce((sum,row)=>sum+Number(row.amount||0),0);
  const expenses=ledger.filter(row=>row.direction==='outflow').reduce((sum,row)=>sum+Number(row.amount||0),0);
  const pending=allOutbox.filter(row=>inScope(row)&&['pending','syncing','failed','conflict'].includes(row.status));
  const dailyMap=new Map();
  for(const visit of visits){const date=String(visit.visit_work_date||visit.work_date||'');const item=dailyMap.get(date)||{date,visits:0,tests:0,collected:0,expenses:0};item.visits++;dailyMap.set(date,item);}
  for(const test of tests){const visit=visits.find(row=>row.id===test.visit_id);if(visit){const date=String(visit.visit_work_date||visit.work_date||'');const item=dailyMap.get(date);if(item)item.tests++;}}
  for(const row of ledger){const item=dailyMap.get(row.work_date)||{date:row.work_date,visits:0,tests:0,collected:0,expenses:0};if(row.direction==='inflow')item.collected+=Number(row.amount||0);if(row.direction==='outflow')item.expenses+=Number(row.amount||0);dailyMap.set(row.work_date,item);}
  return {
    period:{monthStart,monthEnd},
    branches:branches.filter(row=>!branchId||row.id===branchId),
    visits:visits.length,patients:new Set(visits.map(row=>row.patient_id).filter(Boolean)).size,
    tests:tests.length,collected,expenses,netCash:collected-expenses,
    pending:{total:pending.length,failed:pending.filter(row=>row.status==='failed').length,conflict:pending.filter(row=>row.status==='conflict').length},
    daily:[...dailyMap.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    ledgerSnapshot:ledgerSnapshot?{cachedRows:ledgerSnapshot.cachedRows,totalRows:ledgerSnapshot.totalRows,truncated:ledgerSnapshot.truncated,preparedAt:ledgerSnapshot.cached_at}:null,
    cachedRows:{visits:allVisits.length,tests:allTests.length,ledger:allLedger.length},
  };
}
