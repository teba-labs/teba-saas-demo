import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../modules/dashboard/historical-analysis.js', import.meta.url), 'utf8');
const engine = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const monthly = [
 ['h0','h1','expenses','revenue','month','cases','branch','year'],
 ['','','200','1000','11',20,'فرع ألف','2026'],
 ['','','300','1500','11',30,'فرع باء','2026'],
 ['','','99','999','التقفيل',0,'فرع ألف','2026']
];
const annual = [['','','expenses','revenue','branch','year'],['', '',500,2500,'فرع ألف','2026']];
assert.deepEqual(engine.extractHistoricalMonth(monthly,'2026','11','فرع ألف'),{rev:1000,exp:200,cases:20});
assert.deepEqual(engine.extractHistoricalYear(annual,'2026','فرع ألف'),{rev:2500,exp:500});
assert.deepEqual(engine.findLatestHistoricalPeriod([{name:'الشهرية',rows:monthly}]),{year:'2026',month:'11'});
const salesWorkbook=[
 {name:'الشهرية',rows:monthly},
 {name:'السنوية',rows:annual},
 {name:'تكرار التحاليل فرع ألف',rows:[[],[],['CBC',11,10],['ALT',11,5],['غير مسعر',11,2]]},
 {name:'تكرار التحاليل فرع باء',rows:[[],[],['CBC',11,10]]}
];
const pricesWorkbook=[{name:'التحاليل',rows:[['name','type','cost','weight','sell'],['CBC','داخلي',5,2,20],['ALT','خارجي',10,1,15]]}];
const detailWorkbook=[{name:'نوفمبر 2026',rows:[
 ['معامل طيبة فرع ألف'],
 ['بيان المصروفات الثابتة'],
 [],
 [null,null,null,null,100,20,'إيجار',50,'راتب'],
 ['معامل طيبة فرع باء']
]}];
const report=engine.buildHistoricalDashboardReport({salesWorkbook,pricesWorkbook,detailWorkbook,movementWorkbooks:salesWorkbook,year:'2026',month:'11'});
assert.equal(report.source,'historical-excel');
assert.deepEqual(report.totals,{rev:2500,exp:500,cases:50,profit:2000,margin:80});
assert.equal(report.branches.length,2);
assert.equal(report.branches[0].allocation.fixedCost,170);
assert.equal(report.branches[0].allocation.totalPoints,25);
assert.equal(report.branches[0].allocation.pointValue,6.8);
assert.equal(report.branches[0].tests.find(t=>t.name==='CBC').trueCost,18.6);
assert.ok(Math.abs(report.branches[0].tests.find(t=>t.name==='ALT').trueProfitUnit-(-1.8))<1e-9);
assert.equal(report.tests.find(t=>t.name==='CBC').count,20);
assert.deepEqual(report.unmatchedTests,['غير مسعر']);
assert.equal(report.lossMakers.length,2);
console.log('PASS historical monthly/yearly extraction and latest-period detection');
console.log('PASS weighted fixed-cost allocation and true test cost/profit');
console.log('PASS branch aggregation, loss detection, and unmatched-price reporting');
