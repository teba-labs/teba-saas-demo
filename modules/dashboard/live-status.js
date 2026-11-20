/** Pure live status aggregation for owner dashboard current-period reporting. */
export function summarizeVisitTestStatus({visits=[],visitTests=[]}={}){
 const totals={pendingTests:0,inProgressTests:0,completedTests:0,publishedVisits:0,unpublishedVisits:0};
 const branches=new Map(),days=new Map(),visitById=new Map();
 const branchFor=id=>{const key=String(id||'unknown');if(!branches.has(key))branches.set(key,{branchId:id||null,pendingTests:0,inProgressTests:0,completedTests:0,publishedVisits:0,unpublishedVisits:0});return branches.get(key);};
 const dayFor=date=>{if(!date)return null;if(!days.has(date))days.set(date,{date,visits:0,tests:0,pendingTests:0,inProgressTests:0,completedTests:0,publishedVisits:0,unpublishedVisits:0});return days.get(date);};
 for(const visit of visits){
  visitById.set(visit.id,visit);
  const published=visit.is_published===true;
  const branch=branchFor(visit.branch_id),day=dayFor(visit.visit_work_date);
  const key=published?'publishedVisits':'unpublishedVisits';
  totals[key]+=1;branch[key]+=1;if(day){day.visits+=1;day[key]+=1;}
 }
 for(const test of visitTests){
  if(test.status==='cancelled')continue;
  const key=test.status==='pending'?'pendingTests':test.status==='in_progress'?'inProgressTests':test.status==='completed'?'completedTests':null;
  const visit=visitById.get(test.visit_id);
  if(!key)continue;
  totals[key]+=1;
  if(visit){branchFor(visit.branch_id)[key]+=1;const day=dayFor(visit.visit_work_date);if(day){day.tests+=1;day[key]+=1;}}
 }
 return {totals,branches:[...branches.values()],daily:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}
