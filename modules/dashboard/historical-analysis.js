const clean=value=>String(value??'').trim();
const number=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
const normalize=value=>clean(value).toLocaleLowerCase('ar');
const sum=(rows,index)=>rows.reduce((total,row)=>total+number(row?.[index]),0);

export function findLatestHistoricalPeriod(salesWorkbook){
 const monthly=salesWorkbook?.find(s=>s.name.includes('الشهرية'))?.rows||[];
 let latest=null;
 for(let i=1;i<monthly.length;i++){const row=monthly[i];if(!row||clean(row[4])===''||clean(row[4])==='التقفيل')continue;const year=Number(row[7]),month=Number(row[4]);if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12||number(row[3])<=0)continue;if(!latest||year>latest.year||(year===latest.year&&month>latest.month))latest={year,month};}
 return latest?{year:String(latest.year),month:String(latest.month).padStart(2,'0')}:null;
}

export function extractHistoricalMonth(monthlyRows,year,month,branch){
 let rev=0,exp=0,cases=0;
 for(let i=1;i<monthlyRows.length;i++){const row=monthlyRows[i];if(!row)continue;
  if(clean(row[7])!==String(year)||(branch!=='all'&&clean(row[6])!==clean(branch)))continue;
  const rowMonth=clean(row[4]);if(month!=='all'&&rowMonth!==String(month))continue;
  if(rowMonth==='التقفيل'||rowMonth==='')continue;
  rev+=number(row[3]);exp+=number(row[2]);cases+=number(row[5]);
 }
 return{rev,exp,cases};
}
export function extractHistoricalYear(annualRows,year,branch){
 let rev=0,exp=0;
 for(let i=1;i<annualRows.length;i++){const row=annualRows[i];if(!row)continue;
  if(clean(row[5])===String(year)&&(branch==='all'||clean(row[4])===clean(branch))){rev+=number(row[3]);exp+=number(row[2]);}
 }
 return{rev,exp};
}
export function extractHistoricalExpenseBreakdown(rows,year,month,branch){
 const monthNames=['يناير','فبراير','مارس','ابريل','مايو','يونيو','يوليو','اغسطس','سبتمبر','اكتوبر','نوفمبر','ديسمبر'];
 const monthName=monthNames[Number(month)-1];if(!monthName||!Array.isArray(rows))return null;
 let start=-1;
 for(let i=0;i<rows.length;i++){const label=clean(rows[i]?.[0]);if(label.includes(branch)&&label.includes('معامل')){start=i;break;}}
 if(start<0)return null;
 let end=rows.length;
 for(let i=start+1;i<rows.length;i++){const label=clean(rows[i]?.[0]);if(label.includes('معامل')&&label!==clean(rows[start]?.[0])){end=i;break;}}
 let fixed=-1;for(let i=start;i<end;i++)if(clean(rows[i]?.[0])==='بيان المصروفات الثابتة'){fixed=i;break;}
 let chemicals=0,salaries=0;const misc={};
 if(fixed>=0){
  for(let i=fixed+2;i<Math.min(fixed+10,end);i++){const row=rows[i];if(!row)break;const g=clean(row[6]),label=clean(row[8]);if(g==='الاجمالي'||label==='الاجمالي')break;
   const chemical=number(row[4]),other=number(row[5]),salary=number(row[7]);if(chemical>0)chemicals+=chemical;if(other>0&&g)misc[g]=(misc[g]||0)+other;if(salary>0&&label)salaries+=salary;
  }
 }else{
  let special=-1;for(let i=start;i<end;i++)if(clean(rows[i]?.[0]).includes('المرتبات+الايجار')){special=i;break;}
  if(special<0)return null;
  for(let i=special+1;i<Math.min(special+12,end);i++){const row=rows[i];if(!row)break;const label=clean(row[0]),b=number(row[1]),c=number(row[2]);if(label==='اجمالي مرتبات'||label==='اجمالي')break;if(c>0)chemicals+=c;
   if(b>0&&label){if(label.includes('ايجار')||label.includes('إيجار'))misc['ايجار']=(misc['ايجار']||0)+b;else if(label.includes('كهربا'))misc['كهربا']=(misc['كهربا']||0)+b;else if(label.includes('مياة')||label.includes('مياه'))misc['مياة']=(misc['مياة']||0)+b;else if(label.includes('د/')||label.includes('ا/'))salaries+=b;else misc[label]=(misc[label]||0)+b;}
  }
 }
 return{chemicals,salaries,misc};
}
function movementForBranch(movementSheets,branch,month){
 const match=movementSheets.find(s=>s.name.includes('تكرار التحاليل')&&s.name.includes(branch));
 if(!match)return[];
 const out=[];
 for(let i=2;i<match.rows.length;i++){const row=match.rows[i];if(!row||typeof row[0]!=='string'||!clean(row[0]))continue;
  if(month&&number(row[1])!==Number(month))continue;
  out.push({name:clean(row[0]),count:number(row[2])});
 }
 return out;
}
export function buildHistoricalDashboardReport({salesWorkbook,pricesWorkbook,detailWorkbook,movementWorkbooks=[],year,month,branch='all'}={}){
 if(!salesWorkbook||!pricesWorkbook)throw new Error('يلزم تحميل ملف المتابعة وملف الأسعار التاريخيين أولاً.');
 const salesSheets=salesWorkbook,priceSheet=pricesWorkbook.find(s=>s.name.includes('التحاليل'))||pricesWorkbook[0];
 const monthly=salesSheets.find(s=>s.name.includes('الشهرية'))?.rows||[];
 const annual=salesSheets.find(s=>s.name.includes('السنوية'))?.rows||[];
 if(!monthly.length||!annual.length)throw new Error('ملف المتابعة لا يحتوي أوراق الشهرية والسنوية المطلوبة.');
 const prices=new Map();
 for(let i=1;i<(priceSheet?.rows||[]).length;i++){const r=priceSheet.rows[i];if(!r||!r[0])continue;const sell=number(r[4]);if(sell>0)prices.set(normalize(r[0]),{type:clean(r[1])||'خارجي',baseCost:number(r[2]),weight:number(r[3])||1,sell});}
 const branches=[...new Set(monthly.slice(1).map(r=>clean(r?.[6])).filter(Boolean))].filter(name=>branch==='all'||clean(name)===clean(branch));
 const branchReports=branches.map(branch=>{
  const totals=extractHistoricalMonth(monthly,year,month,branch);
  const movement=movementForBranch(movementWorkbooks,branch,month);
  const variable=movement.reduce((v,t)=>v+(prices.get(normalize(t.name))?.baseCost||0)*t.count,0);
  const points=movement.reduce((v,t)=>v+(prices.get(normalize(t.name))?.weight||0)*t.count,0);
  const expenseSheet=detailWorkbook?.find(s=>s.name.includes(['يناير','فبراير','مارس','ابريل','مايو','يونيو','يوليو','اغسطس','سبتمبر','اكتوبر','نوفمبر','ديسمبر'][Number(month)-1])&&s.name.includes(String(year)));
  const breakdown=expenseSheet?extractHistoricalExpenseBreakdown(expenseSheet.rows,year,month,branch):null;
  let fixed=breakdown?(breakdown.chemicals+breakdown.salaries+Object.values(breakdown.misc).reduce((a,b)=>a+b,0)):0;
  if(fixed===0&&totals.exp>0)fixed=Math.max(0,totals.exp-variable);
  const pointValue=points>0?fixed/points:0;
  const tests=movement.filter(t=>prices.has(normalize(t.name))).map(t=>{const p=prices.get(normalize(t.name)),trueCost=p.baseCost+p.weight*pointValue,profitUnit=p.sell-trueCost;return{name:t.name,count:t.count,type:p.type,baseCost:p.baseCost,weight:p.weight,sell:p.sell,trueCost,trueProfitUnit:profitUnit,trueTotalProfit:profitUnit*t.count};});
  return{branch,...totals,profit:totals.rev-totals.exp,margin:totals.rev>0?(totals.rev-totals.exp)/totals.rev*100:0,tests,unmatchedTests:movement.filter(t=>!prices.has(normalize(t.name))).map(t=>t.name),expenseBreakdown:breakdown?{chemicals:breakdown.chemicals,salaries:breakdown.salaries,misc:breakdown.misc,total:fixed}:null,allocation:{variableCost:variable,fixedCost:fixed,totalPoints:points,pointValue,expenseBreakdownAvailable:Boolean(breakdown)}};
 });
 const combined=new Map();
 for(const b of branchReports)for(const t of b.tests){const key=normalize(t.name);if(!combined.has(key))combined.set(key,{...t,count:0,trueTotalProfit:0});const item=combined.get(key);item.count+=t.count;item.trueTotalProfit+=t.trueTotalProfit;}
 const tests=[...combined.values()].map(t=>({...t,trueProfitUnit:t.count?t.trueTotalProfit/t.count:0,trueCost:t.sell-(t.count?t.trueTotalProfit/t.count:0)}));
 const totals=branchReports.reduce((a,b)=>({rev:a.rev+b.rev,exp:a.exp+b.exp,cases:a.cases+b.cases,profit:a.profit+b.profit}),{rev:0,exp:0,cases:0,profit:0});
 return{source:'historical-excel',period:{year:String(year),month:String(month)},branches:branchReports,totals:{...totals,margin:totals.rev>0?totals.profit/totals.rev*100:0},tests:tests.sort((a,b)=>b.count-a.count),topSellers:[...tests].sort((a,b)=>b.count-a.count).slice(0,5),topProfitable:[...tests].sort((a,b)=>b.trueTotalProfit-a.trueTotalProfit).slice(0,5),lossMakers:tests.filter(t=>t.trueProfitUnit<0).sort((a,b)=>a.trueProfitUnit-b.trueProfitUnit),unmatchedTests:[...new Set(branchReports.flatMap(b=>b.unmatchedTests))],annual:buildHistoricalAnnualReport({salesWorkbook,year,branch}),annualTrend:buildHistoricalAnnualTrend({salesWorkbook,branch}),seasonality:buildHistoricalCaseSeasonality({salesWorkbook,branch}),monthlyPlan:buildHistoricalMonthlyPlan({salesWorkbook,branch})};
}

function median(values){
 const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
 if(!sorted.length)return 0;
 const middle=Math.floor(sorted.length/2);
 return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}

/** Historical product-portfolio analyses use only matched tests with a positive recorded selling price. */
export function buildHistoricalProductPortfolio(report){
 if(!report||!Array.isArray(report.tests))throw new Error('A historical dashboard report is required.');
 const products=report.tests.filter(test=>Number.isFinite(Number(test.count))&&Number(test.count)>0&&Number.isFinite(Number(test.sell))&&Number(test.sell)>0);
 const medianCount=median(products.map(test=>Number(test.count)));
 const medianProfit=median(products.map(test=>Number(test.trueProfitUnit)));
 const withProfit=products.map(test=>({...test,segment:
  Number(test.count)>=medianCount&&Number(test.trueProfitUnit)>=medianProfit?'star':
  Number(test.count)>=medianCount?'cash-cow':
  Number(test.trueProfitUnit)>=medianProfit?'question':'dog'
 }));
 return {
  thresholds:{medianCount,medianProfit},
  topSellers:[...withProfit].sort((a,b)=>b.count-a.count||b.trueTotalProfit-a.trueTotalProfit).slice(0,20),
  mostProfitable:[...withProfit].sort((a,b)=>b.trueTotalProfit-a.trueTotalProfit).slice(0,20),
  leastProfitable:[...withProfit].filter(test=>test.trueProfitUnit>0).sort((a,b)=>a.trueTotalProfit-b.trueTotalProfit).slice(0,20),
  needOffers:[...withProfit].filter(test=>test.count<5).sort((a,b)=>a.count-b.count||b.trueProfitUnit-a.trueProfitUnit).slice(0,50),
  lossMakers:[...withProfit].filter(test=>test.trueProfitUnit<0).sort((a,b)=>a.trueProfitUnit-b.trueProfitUnit),
  urgent:{losses:[...withProfit].filter(test=>test.trueProfitUnit<0).sort((a,b)=>a.trueProfitUnit-b.trueProfitUnit),
   lowDemandOpportunities:[...withProfit].filter(test=>test.count<=1&&test.trueProfitUnit>medianProfit).sort((a,b)=>b.trueProfitUnit-a.trueProfitUnit)},
  bcg:{
   stars:withProfit.filter(test=>test.segment==='star').sort((a,b)=>b.trueTotalProfit-a.trueTotalProfit),
   cashCows:withProfit.filter(test=>test.segment==='cash-cow').sort((a,b)=>b.count-a.count),
   questions:withProfit.filter(test=>test.segment==='question').sort((a,b)=>b.trueProfitUnit-a.trueProfitUnit),
   dogs:withProfit.filter(test=>test.segment==='dog').sort((a,b)=>a.trueTotalProfit-b.trueTotalProfit)
  }
 };
}

/** Annual revenue/expense comparison from the historical annual worksheet. */
export function buildHistoricalAnnualReport({salesWorkbook,year,branch='all'}={}){
 if(!salesWorkbook||!year)throw new Error('Historical sales workbook and year are required.');
 const rows=salesWorkbook.find(sheet=>sheet.name.includes('السنوية'))?.rows||[];
 if(!rows.length)throw new Error('The annual worksheet is missing.');
 const branches=[...new Set(rows.slice(1).filter(row=>clean(row?.[5])===String(year)).map(row=>clean(row?.[4])).filter(Boolean))].filter(name=>branch==='all'||clean(name)===clean(branch));
 const byBranch=branches.map(branch=>({branch,...extractHistoricalYear(rows,year,branch)})).map(item=>({...item,profit:item.rev-item.exp,margin:item.rev>0?(item.rev-item.exp)/item.rev*100:0}));
 const totals=byBranch.reduce((acc,item)=>({rev:acc.rev+item.rev,exp:acc.exp+item.exp,profit:acc.profit+item.profit}),{rev:0,exp:0,profit:0});
 return {year:String(year),branches:byBranch,totals:{...totals,margin:totals.rev>0?totals.profit/totals.rev*100:0}};
}

/** Monthly case seasonality; missing months stay zero and are not silently averaged as active months. */
export function buildHistoricalCaseSeasonality({salesWorkbook,years,branch='all'}={}){
 const rows=salesWorkbook?.find(sheet=>sheet.name.includes('الشهرية'))?.rows||[];
 if(!rows.length)throw new Error('The monthly worksheet is missing.');
 const selectedYears=(years||[...new Set(rows.slice(1).map(row=>clean(row?.[7])).filter(Boolean))]).map(String).sort();
 const series=selectedYears.map(year=>{
  const months=Array.from({length:12},(_,index)=>extractHistoricalMonth(rows,year,String(index+1),branch).cases);
  const activeMonths=months.filter(value=>value>0).length;
  return {year,months,total:months.reduce((sum,value)=>sum+value,0),activeMonths,averagePerActiveMonth:activeMonths?months.reduce((sum,value)=>sum+value,0)/activeMonths:0};
 });
 const monthTotals=Array.from({length:12},(_,index)=>series.reduce((sum,item)=>sum+item.months[index],0));
 return {branch,series,monthTotals,busiestMonths:monthTotals.map((cases,index)=>({month:index+1,cases})).filter(item=>item.cases>0).sort((a,b)=>b.cases-a.cases).slice(0,3),quietestMonths:monthTotals.map((cases,index)=>({month:index+1,cases})).filter(item=>item.cases>0).sort((a,b)=>a.cases-b.cases).slice(0,3)};
}

/** Multi-year financial trend with year-over-year growth, preserving missing baselines as null. */
export function buildHistoricalAnnualTrend({salesWorkbook,years,branch='all'}={}){
 if(!salesWorkbook)throw new Error('Historical sales workbook is required.');
 const annualRows=salesWorkbook.find(sheet=>sheet.name.includes('السنوية'))?.rows||[];
 const available=[...new Set(annualRows.slice(1).map(row=>clean(row?.[5])).filter(value=>/^\d{4}$/.test(value)))].sort();
 const selected=(years||available).map(String).sort();
 const totals=selected.map(year=>({year,...extractHistoricalYear(annualRows,year,branch)}));
 return totals.map((item,index)=>({...item,profit:item.rev-item.exp,margin:item.rev>0?(item.rev-item.exp)/item.rev*100:0,
  revenueGrowth:index&&totals[index-1].rev>0?(item.rev-totals[index-1].rev)/totals[index-1].rev*100:null,
  expenseGrowth:index&&totals[index-1].exp>0?(item.exp-totals[index-1].exp)/totals[index-1].exp*100:null
 }));
}

/** Pure, read-only reconciliation. Branch names must match exactly; no fuzzy tenant/branch guessing. */
export function compareHistoricalAndLiveReports({historicalReport,liveReport,branchName=null}={}){
 if(!historicalReport?.totals||!liveReport?.totals)throw new Error('Both historical and live reports are required.');
 let historicalRevenue=Number(historicalReport.totals.rev||0),historicalCases=Number(historicalReport.totals.cases||0);
 let liveRevenue=Number(liveReport.totals.collected||0),liveCases=Number(liveReport.totals.visits||0),scope='all';
 if(branchName!==null){
  const historicalBranch=historicalReport.branches?.find(item=>clean(item.branch)===clean(branchName));
  const liveBranch=liveReport.branches?.find(item=>clean(item.name)===clean(branchName));
  if(!historicalBranch||!liveBranch)return {matched:false,reason:'Branch names do not match exactly.',scope:branchName};
  historicalRevenue=Number(historicalBranch.rev||0);historicalCases=Number(historicalBranch.cases||0);
  liveRevenue=Number(liveBranch.collected||0);liveCases=Number(liveBranch.visits||0);scope=branchName;
 }
 return {matched:true,scope,liveRevenue,historicalRevenue,revenueDifference:liveRevenue-historicalRevenue,
  liveCases,historicalCases,casesDifference:liveCases-historicalCases};
}

/** Seasonal next-month plan. Targets are historical averages, not guarantees or AI forecasts. */
export function buildHistoricalMonthlyPlan({salesWorkbook,latestPeriod=findLatestHistoricalPeriod(salesWorkbook),branch='all'}={}){
 if(!salesWorkbook||!latestPeriod)throw new Error('A historical sales workbook and latest revenue month are required.');
 const monthly=salesWorkbook.find(sheet=>sheet.name.includes('الشهرية'))?.rows||[];
 const latestYear=Number(latestPeriod.year),latestMonth=Number(latestPeriod.month);
 const targetDate=new Date(Date.UTC(latestYear,latestMonth,1));
 const targetYear=targetDate.getUTCFullYear(),targetMonth=targetDate.getUTCMonth()+1;
 const monthRows=monthly.slice(1).filter(row=>clean(row?.[6])&&clean(row?.[4])!=='التقفيل');
 const branches=[...new Set(monthRows.map(row=>clean(row[6])))].filter(name=>branch==='all'||clean(name)===clean(branch));
 const plans=branches.map(branch=>{
  let history=[];
  for(const year of [...new Set(monthRows.map(row=>Number(row[7])).filter(y=>y<targetYear))].sort((a,b)=>b-a)){
   const values=extractHistoricalMonth(monthly,String(year),String(targetMonth),branch);
   if(values.rev>0||values.cases>0)history.push({year, ...values});
  }
  const usedFallback=history.length===0;
  if(usedFallback)history=[{year:latestYear,...extractHistoricalMonth(monthly,String(latestYear),String(latestMonth),branch)}].filter(item=>item.rev>0||item.cases>0);
  const average=key=>history.length?history.reduce((sum,item)=>sum+item[key],0)/history.length:0;
  const revenue=average('rev'),cases=average('cases');
  return {branch,history,usedFallback,targetRevenue:revenue,targetCases:cases,averageInvoice:cases?revenue/cases:0,
   weeklyTargets:Array.from({length:4},(_,index)=>({week:index+1,revenue:revenue/4,cases:cases/4}))};
 });
 const totals=plans.reduce((sum,item)=>({revenue:sum.revenue+item.targetRevenue,cases:sum.cases+item.targetCases}),{revenue:0,cases:0});
 return {source:'historical-seasonality',basedOn:{year:String(latestYear),month:String(latestMonth).padStart(2,'0')},
  target:{year:String(targetYear),month:String(targetMonth).padStart(2,'0')},branches:plans,totals,
  note:'Targets are the arithmetic average of available prior-year data for the same calendar month. If none exists, the latest month is used and flagged.'};
}
