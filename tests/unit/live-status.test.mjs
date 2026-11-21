import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../../modules/dashboard/live-status.js',import.meta.url),'utf8');
const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const result=mod.summarizeVisitTestStatus({
 visits:[
  {id:'v1',branch_id:'b1',visit_work_date:'2026-11-21',is_published:true},
  {id:'v2',branch_id:'b1',visit_work_date:'2026-11-21',is_published:false},
  {id:'v3',branch_id:'b2',visit_work_date:'2026-11-20',is_published:false}
 ],
 visitTests:[
  {id:'t1',visit_id:'v1',status:'pending'},
  {id:'t2',visit_id:'v1',status:'in_progress'},
  {id:'t3',visit_id:'v2',status:'completed'},
  {id:'t4',visit_id:'v3',status:'cancelled'}
 ]
});
assert.deepEqual(result.totals,{pendingTests:1,inProgressTests:1,completedTests:1,publishedVisits:1,unpublishedVisits:2});
assert.equal(result.branches.find(x=>x.branchId==='b1').pendingTests,1);
assert.equal(result.branches.find(x=>x.branchId==='b1').publishedVisits,1);
assert.equal(result.daily.find(x=>x.date==='2026-11-21').tests,3);
assert.equal(result.daily.find(x=>x.date==='2026-11-21').unpublishedVisits,1);
assert.equal(result.daily.find(x=>x.date==='2026-11-20').tests,0);
console.log('PASS: live test status and visit publication counts are branch/date scoped.');
