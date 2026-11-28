const clean=value=>String(value??'').trim();
const asciiDigits=value=>String(value??'').replace(/[٠-٩۰-۹]/g,d=>String(d.charCodeAt(0)>=1776&&d.charCodeAt(0)<=1785?d.charCodeAt(0)-1776:d.charCodeAt(0)-1632));
const finite=value=>{if(value===null||value===undefined||clean(value)==='')return null;const normalized=asciiDigits(value).replace(/[٬,،]/g,'').replace(/٫/g,'.').replace(/[−–]/g,'-').replace(/٪$/,'');const n=Number(normalized);return Number.isFinite(n)?n:null;};
const normalize=value=>clean(value).toLocaleLowerCase('ar').replace(/[ـ\s]+/g,' ');
const MONTH=/^(\d{4})[-/](\d{1,2})$/;
export const FINANCIAL_FIELDS=[
 {key:'period_date',label:'التاريخ / الفترة',required:false,aliases:['date','التاريخ','تاريخ','الفترة','period','التاريخ الكامل']},
 {key:'year',label:'السنة',required:false,aliases:['year','السنة','عام']},
 {key:'month',label:'الشهر',required:false,aliases:['month','الشهر','رقم الشهر']},
 {key:'metric_key',label:'نوع البند المالي (للملفات ذات عمود بند)',required:false,aliases:['metric','type','نوع الحركة','الحركة','item type']},
 {key:'amount',label:'القيمة المالية العامة',required:false,aliases:['amount','value','المبلغ','القيمة']},
 {key:'revenue',label:'الإيرادات / المبيعات',required:false,aliases:['revenue','income','sales','الإيراد','الايراد','الإيرادات','الايرادات','المبيعات']},
 {key:'collections',label:'التحصيل النقدي',required:false,aliases:['collections','cash received','تحصيل','التحصيل','المقبوضات']},
 {key:'expenses',label:'المصروفات',required:false,aliases:['expense','expenses','المصروف','المصروفات','إجمالي المصروفات']},
 {key:'cases',label:'عدد الحالات / الزيارات',required:false,aliases:['cases','visits','عدد الحالات','الحالات','الزيارات','عدد الزيارات']},
 {key:'discounts',label:'الخصومات',required:false,aliases:['discount','discounts','الخصم','الخصومات']},
 {key:'tests_count',label:'عدد التحاليل',required:false,aliases:['tests count','عدد التحاليل','حركة التحاليل','التحاليل']},
 {key:'quantity',label:'العدد / الكمية',required:false,aliases:['quantity','count','العدد','الكمية']},
 {key:'item_name',label:'اسم التحليل / العنصر',required:false,aliases:['test','test name','اسم التحليل','الصنف','الخدمة']},
 {key:'category_name',label:'التصنيف / بند المصروف',required:false,aliases:['category','التصنيف','بند المصروف','نوع المصروف']},
 {key:'branch_name',label:'اسم الفرع',required:false,aliases:['branch','branch name','الفرع','اسم الفرع']},
 {key:'unit_cost',label:'تكلفة الوحدة',required:false,aliases:['cost','unit cost','التكلفة','تكلفة الوحدة','سعر التكلفة']},
 {key:'weight',label:'وزن / نقاط تحميل التكلفة الثابتة',required:false,aliases:['weight','allocation weight','points','النقاط','الوزن','وزن التحميل']},
 {key:'selling_price',label:'سعر البيع',required:false,aliases:['price','selling price','سعر البيع','السعر']},
 {key:'currency_code',label:'العملة',required:false,aliases:['currency','العملة','العملة المستخدمة']}
];
export function normalizeFinancialDate(value){
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
 if(typeof value==='number'&&value>20000&&value<100000){const d=new Date(Date.UTC(1899,11,30)+value*86400000);return d.toISOString().slice(0,10);}
 const s=asciiDigits(clean(value));const ymd=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);if(ymd){const year=Number(ymd[1]),month=Number(ymd[2]),day=Number(ymd[3]),date=new Date(Date.UTC(year,month-1,day));if(month>=1&&month<=12&&day>=1&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day)return date.toISOString().slice(0,10);return null;}let m=s.match(MONTH);if(m){const year=Number(m[1]),month=Number(m[2]);if(month>=1&&month<=12)return year+'-'+String(month).padStart(2,'0')+'-01';}
 const dmy=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);if(dmy){const day=Number(dmy[1]),month=Number(dmy[2]),year=Number(dmy[3]);const date=new Date(Date.UTC(year,month-1,day));if(month>=1&&month<=12&&day>=1&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day)return date.toISOString().slice(0,10);return null;}
 const d=new Date(s);return s&& !Number.isNaN(d.getTime())?d.toISOString().slice(0,10):null;
}
export function detectFinancialHeader(matrix=[]){
 const rows=(matrix||[]).slice(0,100);
 const candidates=rows.map((row,index)=>{
  const values=(row||[]).map(normalize),count=values.filter(Boolean).length;
  const recognized=values.filter(value=>FINANCIAL_FIELDS.some(field=>field.aliases.some(alias=>normalize(alias)===value))).length;
  return {row,index,count,recognized,score:recognized*10+Math.min(count,20)*0.1-index*0.001};
 }).filter(x=>x.count);
 if(!candidates.length)return null;
 const matched=candidates.filter(x=>x.recognized>0).sort((a,b)=>b.score-a.score)[0];
 const chosen=matched||candidates.sort((a,b)=>b.count-a.count||a.index-b.index)[0];
 return {row:chosen.row,index:chosen.index,count:chosen.count,recognizedFields:chosen.recognized};
}
export function preferPendingFinancialRows(rows=[]){
 const identity=row=>[row.period_date||'',row.metric_key||'',String(row.item_name||'').trim().toLocaleLowerCase('ar'),String(row.category_name||'').trim().toLocaleLowerCase('ar'),String(row.currency_code||'').trim().toUpperCase(),row.branch_id||''].join('|');
 const group=row=>[row.period_date||'',row.metric_key||'',String(row.currency_code||'').trim().toUpperCase(),row.branch_id||''].join('|');
 const detail=row=>Boolean(String(row.item_name||'').trim()||String(row.category_name||'').trim());
 const pendingKeys=new Set(rows.filter(row=>row.pending_approval).map(identity)),pendingModes=new Map();
 for(const row of rows.filter(item=>item.pending_approval)){const key=group(row),mode=detail(row)?'detail':'summary',modes=pendingModes.get(key)||{detail:false,summary:false};modes[mode]=true;pendingModes.set(key,modes);}
 return rows.filter(row=>{
  const modes=pendingModes.get(group(row)),mode=detail(row)?'detail':'summary';
  if(!modes)return row.pending_approval||!pendingKeys.has(identity(row));
  if(modes.detail&&modes.summary){if(mode==='summary')return false;return row.pending_approval||!pendingKeys.has(identity(row));}
  if(modes.detail&&mode==='summary')return false;
  if(modes.summary&&mode==='detail')return false;
  return row.pending_approval||!pendingKeys.has(identity(row));
 });
}
export function classifyFinancialSheet({headers=[],mapping=[],rows=[]}={}){
 const fields=new Set((mapping||[]).map(item=>item.fieldKey).filter(Boolean));
 const hasPeriod=fields.has('period_date')||(fields.has('year')&&fields.has('month'));
 const hasAmount=['amount','revenue','collections','expenses','cases','discounts','tests_count'].some(key=>fields.has(key));
 const hasPrice=fields.has('unit_cost')||fields.has('selling_price');
 const hasItem=fields.has('item_name');
 let type='unclassified',label='بيانات غير مصنفة';
 if(hasItem&&hasPrice&&!hasPeriod){type='price-list';label='قائمة أسعار وتكلفة التحاليل';}
 else if(hasPeriod&&hasItem){type='transaction-detail';label='تفاصيل معاملات / تحاليل';}
 else if(hasPeriod&&hasAmount){type='period-summary';label='ملخص مالي أو تشغيلي حسب الفترة';}
 else if(hasAmount){type='financial-movements';label='حركات مالية';}
 const recognizedFields=[...fields],confidence=recognizedFields.length>=4?0.9:recognizedFields.length>=2?0.72:recognizedFields.length?0.5:0.15;
 return {type,label,confidence,recognizedFields,nonEmptyRows:(rows||[]).filter(row=>row?.some(value=>clean(value)!=='')).length};
}
export function suggestFinancialMapping(headers){
 const normalized=(headers||[]).map(normalize),hasYear=normalized.some(h=>['year','السنة','عام'].includes(h)),hasDate=normalized.some(h=>FINANCIAL_FIELDS.find(f=>f.key==='period_date').aliases.some(a=>normalize(a)===h));
 return (headers||[]).map((header,columnIndex)=>{const h=normalize(header);let best=null;if(!hasYear&&!hasDate&&['month','الشهر'].includes(h))best=FINANCIAL_FIELDS.find(f=>f.key==='period_date');else for(const field of FINANCIAL_FIELDS){if(field.aliases.some(alias=>normalize(alias)===h)){best=field;break;}}return {columnIndex,header:String(header??''),fieldKey:best?.key||'',confidence:best?'suggested':'unmapped'};});
}
function isFinancialAggregateRow(source=[],excludedIndex=null){
 return (source||[]).some((value,index)=>{
  if(index===excludedIndex)return false;
  const label=normalize(value);
  return /^(?:الإجمالي|اجمالي|إجمالي|المجموع|مجموع|total|subtotal|grand total)(?:$|\s|[:：-])/i.test(label);
 });
}
export function analyzeFinancialRows({headers=[],rows=[],mapping=[],rowOffset=1}={}){
 const mapped=new Map(mapping.filter(x=>x.fieldKey).map(x=>[x.fieldKey,x.columnIndex]));
 const hasDate=mapped.has('period_date')||(mapped.has('year')&&mapped.has('month'));
 const hasTimelessPrice=mapped.has('item_name')&&(mapped.has('unit_cost')||mapped.has('selling_price'));
 const required=hasDate||hasTimelessPrice?[]:[{label:'التاريخ أو ربط السنة والشهر معًا'}];
 const records=[],issues=[],seen=new Map();let blankRows=0,invalidNumbers=0,duplicateRows=0,aggregateRows=0;
 const metricFields=['revenue','collections','expenses','cases','discounts','tests_count'];
 const numericFields=['amount','quantity','revenue','collections','expenses','cases','discounts','tests_count','unit_cost','selling_price','weight'];
 const hasDetailRows=rows.some(source=>{
  if(!source||isFinancialAggregateRow(source,mapped.get('item_name')))return false;
  const value=key=>mapped.has(key)?source[mapped.get(key)]:null;
  const split=Number(value('year'))>0&&Number(value('month'))>0?String(Number(value('year')))+'-'+String(Number(value('month'))).padStart(2,'0'):null;
  const hasDate=Boolean(normalizeFinancialDate(value('period_date'))||normalizeFinancialDate(split));
  const hasMetric=Boolean(clean(value('metric_key')))&&(finite(value('amount'))!==null||finite(value('quantity'))!==null);
  const hasWide=metricFields.some(key=>mapped.has(key)&&finite(value(key))!==null);
  const hasPrice=Boolean(clean(value('item_name')))&&(finite(value('unit_cost'))!==null||finite(value('selling_price'))!==null);
  return hasMetric||hasPrice||(hasDate&&hasWide);
 });
 for(let i=0;i<rows.length;i++){
  const source=rows[i]||[],rowNumber=i+rowOffset+1;if(!source.some(v=>clean(v)!=='')){blankRows++;continue;}if(hasDetailRows&&isFinancialAggregateRow(source,mapped.get('item_name'))){aggregateRows++;continue;}
  const raw={};for(const field of FINANCIAL_FIELDS){const index=mapped.get(field.key);raw[field.key]=index===undefined?null:source[index]??null;}
  const splitPeriod=Number(raw.year)>0&&Number(raw.month)>0?String(Number(raw.year))+'-'+String(Number(raw.month)).padStart(2,'0'):null;
  const period=normalizeFinancialDate(raw.period_date)||normalizeFinancialDate(splitPeriod);
  const metric=clean(raw.metric_key),wide=metricFields.filter(key=>mapped.has(key)&&clean(raw[key])!==''),hasPriceFields=clean(raw.item_name)!==''&&(finite(raw.unit_cost)!==null||finite(raw.selling_price)!==null);
  const priceOnly=!metric&&!wide.length&&hasPriceFields;
  for(const key of numericFields)if(clean(raw[key])!==''&&finite(raw[key])===null)invalidNumbers++;
  if(period===null&&!priceOnly)issues.push({row:rowNumber,field:'period_date',message:'تاريخ أو فترة غير صالحة'});
  if(!metric&&!wide.length&&!priceOnly)issues.push({row:rowNumber,field:'metric_key',message:'اربط نوع البند أو بندًا ماليًا مستقلًا أو اسم تحليل مع سعر/تكلفة'});
  const outputs=metric?[{metric_key:metric,amount:finite(raw.amount),quantity:finite(raw.quantity)}]:wide.map(key=>({metric_key:key,amount:['cases','tests_count'].includes(key)?null:finite(raw[key]),quantity:['cases','tests_count'].includes(key)?finite(raw[key]):null}));
  if(priceOnly)outputs.push({metric_key:'test_price',amount:null,quantity:null});
  if(metric&&!outputs[0].amount&&!outputs[0].quantity&&raw.selling_price===null&&raw.unit_cost===null)issues.push({row:rowNumber,field:'amount',message:'لا توجد قيمة أو كمية أو سعر/تكلفة قابلة للتحليل'});
  for(const output of outputs){
   const record={period_date:period,metric_key:output.metric_key,amount:output.amount,quantity:output.quantity,item_name:raw.item_name,category_name:raw.category_name,branch_name:raw.branch_name,unit_cost:finite(raw.unit_cost),selling_price:finite(raw.selling_price),weight:finite(raw.weight),currency_code:raw.currency_code};
   const fingerprint=JSON.stringify([record.period_date,normalize(record.metric_key),normalize(record.item_name),normalize(record.category_name),record.amount,record.quantity,record.unit_cost,record.selling_price,record.weight,normalize(record.currency_code),normalize(record.branch_name)]);
   const duplicate=seen.has(fingerprint);if(duplicate)duplicateRows++;else seen.set(fingerprint,rowNumber);
   records.push({...record,_rowNumber:rowNumber,_fingerprint:fingerprint,_duplicate:duplicate,_duplicateOf:duplicate?seen.get(fingerprint):null,_original:source});
  }
 }
 const importable=records.some(record=>Boolean(record.period_date||record.metric_key==='test_price')&&Boolean(record.metric_key)&&Boolean(record.amount!==null||record.quantity!==null||record.unit_cost!==null||record.selling_price!==null)&&record._duplicate!==true);
 return {records,issues,issueCount:issues.length,blankRows,invalidNumbers,duplicateRows,aggregateRows,missingRequired:required.length,missingRequiredFields:required.map(x=>x.label),ready:required.length===0&&importable,headers};
}
function metricClass(key){
 const k=normalize(key);
 if(/تحصيل|قبض|collection|cash received/.test(k))return 'collections';
 if(/test_price|price list|قائمة اسعار|قائمة أسعار/.test(k))return 'price';
 if(/مصروف|expense|تكلف/.test(k))return 'expenses';
 if(/تحليل|test/.test(k))return 'tests';
 if(/إيراد|ايراد|مبيعات|revenue|income/.test(k))return 'revenue';
 if(/حالة|زيارة|case|visit|عدد الحالات|عدد الزيارات/.test(k))return 'cases';
 if(/خصم|discount/.test(k))return 'discounts';
 if(/راتب|salary|أجور/.test(k))return 'payroll';
 return 'other';
}
export function buildGenericHistoricalReport(rows,{from=null,to=null,branchId=null}={}){
 const selected=(rows||[]).filter(r=>(r.period_date===null||r.period_date===undefined||((!from||r.period_date>=from)&&(!to||r.period_date<=to)))&&(!branchId||r.branch_id===branchId||(r.branch_id==null&&metricClass(r.metric_key)==='price')));
 const totals={revenue:0,collections:0,expenses:0,cases:0,discounts:0,payroll:0,tests:0,other:0};
 const monthly=new Map(),items=new Map(),categories=new Map(),priceMap=new Map();
 for(const r of selected){if(metricClass(r.metric_key)==='price'&&r.item_name){priceMap.set(normalize(r.item_name),{unitCost:r.unit_cost,sellingPrice:r.selling_price,weight:r.weight??1});}}
 for(const r of selected){
  const cls=metricClass(r.metric_key);if(cls==='price')continue;
  const amount=Number(r.amount||0),qty=Number(r.quantity||0),month=String(r.period_date||'').slice(0,7);
  totals[cls]=(totals[cls]||0)+(cls==='cases'||cls==='tests'?qty:amount);
  if(month){const m=monthly.get(month)||{month,revenue:0,collections:0,expenses:0,cases:0,discounts:0,tests:0};if(cls==='revenue')m.revenue+=amount;if(cls==='collections')m.collections+=amount;if(cls==='expenses'||cls==='payroll')m.expenses+=amount;if(cls==='cases')m.cases+=qty||amount;if(cls==='discounts')m.discounts+=amount;if(cls==='tests')m.tests+=qty||1;monthly.set(month,m);}
  if(r.item_name){const price=priceMap.get(normalize(r.item_name))||{},item=items.get(normalize(r.item_name))||{name:r.item_name,count:0,revenue:0,cost:0,weightPoints:0,unitCost:0,sellingPrice:0};
   const count=qty||1,unitSell=r.selling_price??price.sellingPrice,unitCost=r.unit_cost??price.unitCost,weight=r.weight??price.weight??1;
   item.count+=count;item.revenue+=unitSell!==null&&unitSell!==undefined?Number(unitSell)*count:amount;item.cost+=unitCost!==null&&unitCost!==undefined?Number(unitCost)*count:0;item.weightPoints+=Number(weight||1)*count;
   if(unitSell!==null&&unitSell!==undefined)item.sellingPrice+=Number(unitSell)*count;
   if(unitCost!==null&&unitCost!==undefined)item.unitCost+=Number(unitCost)*count;
   items.set(normalize(r.item_name),item);
  }
  if(r.category_name)categories.set(r.category_name,(categories.get(r.category_name)||0)+amount);
 }
 const monthlyRows=[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(m=>({...m,profit:m.revenue-m.expenses,margin:m.revenue?(m.revenue-m.expenses)/m.revenue*100:0}));
 const seasonal=Array.from({length:12},(_,i)=>{const months=monthlyRows.filter(m=>Number(m.month.slice(5,7))===i+1);return {month:i+1,revenue:months.length?months.reduce((s,x)=>s+x.revenue,0)/months.length:0,cases:months.length?months.reduce((s,x)=>s+x.cases,0)/months.length:0,years:months.length};});
 const active=monthlyRows.filter(m=>m.revenue||m.cases),latest=active.at(-1);
 const outlook=latest?[1,2,3].map(offset=>{const d=new Date(latest.month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);const month=d.toISOString().slice(0,7),season=seasonal[Number(month.slice(5,7))-1];return {month,revenue:season.revenue,cases:season.cases,years:season.years,method:season.years?'متوسط الأشهر التاريخية المتاحة لنفس الشهر التقويمي':'لا توجد بيانات سابقة لهذا الشهر'};}):[];
 const targetMonth=outlook[0]?.month||null,targetSeason=targetMonth?seasonal[Number(targetMonth.slice(5,7))-1]:null;
 const plan=targetSeason?{month:targetMonth,revenue:targetSeason.revenue,cases:targetSeason.cases,method:'متوسط الأشهر التاريخية المتاحة لنفس الشهر التقويمي',years:targetSeason.years,outlook}:null;
 const totalExpenses=totals.expenses+totals.payroll;totals.expenses=totalExpenses;
 const itemValues=[...items.values()],variableCost=itemValues.reduce((s,x)=>s+x.cost,0),totalPoints=itemValues.reduce((s,x)=>s+x.weightPoints,0),fixedCost=Math.max(0,totalExpenses-variableCost),pointValue=totalPoints?fixedCost/totalPoints:0;
 const itemRows=itemValues.map(x=>{const count=x.count||0,unitCost=count?x.unitCost/count:0,sellingPrice=count&&x.sellingPrice?x.sellingPrice/count:(count?x.revenue/count:0),weight=count?x.weightPoints/count:1,trueCost=unitCost+weight*pointValue,trueProfitUnit=sellingPrice-trueCost;return {...x,directCost:x.cost,cost:trueCost*count,unitCost,sellingPrice,weight,trueCost,trueProfitUnit,trueTotalProfit:trueProfitUnit*count,profit:trueProfitUnit*count,unitProfit:trueProfitUnit};}).sort((a,b)=>b.count-a.count);
 const profit=totals.revenue-totalExpenses,median=values=>{const a=[...values].sort((x,y)=>x-y);if(!a.length)return 0;const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
 const medianCount=median(itemRows.map(x=>x.count)),medianProfit=median(itemRows.map(x=>x.trueProfitUnit));
 const portfolio=itemRows.map(x=>({...x,segment:x.count>=medianCount&&x.trueProfitUnit>=medianProfit?'star':x.count>=medianCount?'cash-cow':x.trueProfitUnit>=medianProfit?'question':'dog'}));
 return {source:'excel',scope:{from,to,branchId},totals:{...totals,variableCost,fixedCost,totalPoints,pointValue,profit,margin:totals.revenue?profit/totals.revenue*100:0},monthly:monthlyRows,seasonality:seasonal,monthlyPlan:plan,items:itemRows,portfolio:{stars:portfolio.filter(x=>x.segment==='star'),cashCows:portfolio.filter(x=>x.segment==='cash-cow'),questions:portfolio.filter(x=>x.segment==='question'),dogs:portfolio.filter(x=>x.segment==='dog'),medianCount,medianProfit},topSellers:[...itemRows].sort((a,b)=>b.count-a.count).slice(0,20),topProfitable:[...itemRows].sort((a,b)=>b.trueTotalProfit-a.trueTotalProfit).slice(0,20),lossMakers:itemRows.filter(x=>x.trueProfitUnit<0).sort((a,b)=>a.trueProfitUnit-b.trueProfitUnit),needOffers:itemRows.filter(x=>x.count<5).sort((a,b)=>a.count-b.count),expenseCategories:[...categories].map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount),periods:[...new Set(selected.map(r=>String(r.period_date||'').slice(0,7)).filter(Boolean))].sort()};
}
