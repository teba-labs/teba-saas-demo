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
  if(clean(row[7])!==String(year)||clean(row[6])!==clean(branch))continue;
  const rowMonth=clean(row[4]);if(month!=='all'&&rowMonth!==String(month))continue;
  if(rowMonth==='التقفيل'||rowMonth==='')continue;
  rev+=number(row[3]);exp+=number(row[2]);cases+=number(row[5]);
 }
 return{rev,exp,cases};
}
export function extractHistoricalYear(annualRows,year,branch){
 let rev=0,exp=0;
 for(let i=1;i<annualRows.length;i++){const row=annualRows[i];if(!row)continue;
  if(clean(row[5])===String(year)&&clean(row[4])===clean(branch)){rev+=number(row[3]);exp+=number(row[2]);}
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
export function buildHistoricalDashboardReport({salesWorkbook,pricesWorkbook,detailWorkbook,movementWorkbooks=[],year,month}={}){
 if(!salesWorkbook||!pricesWorkbook)throw new Error('يلزم تحميل ملف المتابعة وملف الأسعار التاريخيين أولاً.');
 const salesSheets=salesWorkbook,priceSheet=pricesWorkbook.find(s=>s.name.includes('التحاليل'))||pricesWorkbook[0];
 const monthly=salesSheets.find(s=>s.name.includes('الشهرية'))?.rows||[];
 const annual=salesSheets.find(s=>s.name.includes('السنوية'))?.rows||[];
 if(!monthly.length||!annual.length)throw new Error('ملف المتابعة لا يحتوي أوراق الشهرية والسنوية المطلوبة.');
 const prices=new Map();
 for(let i=1;i<(priceSheet?.rows||[]).length;i++){const r=priceSheet.rows[i];if(!r||!r[0])continue;const sell=number(r[4]);if(sell>0)prices.set(normalize(r[0]),{type:clean(r[1])||'خارجي',baseCost:number(r[2]),weight:number(r[3])||1,sell});}
 const branches=[...new Set(monthly.slice(1).map(r=>clean(r?.[6])).filter(Boolean))];
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
  return{branch,...totals,profit:totals.rev-totals.exp,margin:totals.rev>0?(totals.rev-totals.exp)/totals.rev*100:0,tests,unmatchedTests:movement.filter(t=>!prices.has(normalize(t.name))).map(t=>t.name),allocation:{variableCost:variable,fixedCost:fixed,totalPoints:points,pointValue,expenseBreakdownAvailable:Boolean(breakdown)}};
 });
 const combined=new Map();
 for(const b of branchReports)for(const t of b.tests){const key=normalize(t.name);if(!combined.has(key))combined.set(key,{...t,count:0,trueTotalProfit:0});const item=combined.get(key);item.count+=t.count;item.trueTotalProfit+=t.trueTotalProfit;}
 const tests=[...combined.values()].map(t=>({...t,trueProfitUnit:t.count?t.trueTotalProfit/t.count:0,trueCost:t.sell-(t.count?t.trueTotalProfit/t.count:0)}));
 const totals=branchReports.reduce((a,b)=>({rev:a.rev+b.rev,exp:a.exp+b.exp,cases:a.cases+b.cases,profit:a.profit+b.profit}),{rev:0,exp:0,cases:0,profit:0});
 return{source:'historical-excel',period:{year:String(year),month:String(month)},branches:branchReports,totals:{...totals,margin:totals.rev>0?totals.profit/totals.rev*100:0},tests:tests.sort((a,b)=>b.count-a.count),topSellers:[...tests].sort((a,b)=>b.count-a.count).slice(0,5),topProfitable:[...tests].sort((a,b)=>b.trueTotalProfit-a.trueTotalProfit).slice(0,5),lossMakers:tests.filter(t=>t.trueProfitUnit<0).sort((a,b)=>a.trueProfitUnit-b.trueProfitUnit),unmatchedTests:[...new Set(branchReports.flatMap(b=>b.unmatchedTests))]};
}
