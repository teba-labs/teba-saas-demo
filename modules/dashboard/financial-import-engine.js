const clean=value=>String(value??'').trim();
const finite=value=>{if(value===null||value===undefined||clean(value)==='')return null;const n=Number(String(value).replace(/[,،]/g,'').replace(/[\u0660-\u0669]/g,d=>String(d.charCodeAt(0)-1632)));return Number.isFinite(n)?n:null;};
const normalize=value=>clean(value).toLocaleLowerCase('ar').replace(/[ـ\s]+/g,' ');
const MONTH=/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/;
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
 {key:'selling_price',label:'سعر البيع',required:false,aliases:['price','selling price','سعر البيع','السعر']},
 {key:'currency_code',label:'العملة',required:false,aliases:['currency','العملة','العملة المستخدمة']}
];
export function normalizeFinancialDate(value){
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
 if(typeof value==='number'&&value>20000&&value<100000){const d=new Date(Date.UTC(1899,11,30)+value*86400000);return d.toISOString().slice(0,10);}
 const s=clean(value);let m=s.match(MONTH);if(m){const year=Number(m[1]),month=Number(m[2]);if(month>=1&&month<=12)return year+'-'+String(month).padStart(2,'0')+'-01';}
 const d=new Date(s);return s&& !Number.isNaN(d.getTime())?d.toISOString().slice(0,10):null;
}
export function suggestFinancialMapping(headers){
 return (headers||[]).map((header,columnIndex)=>{const h=normalize(header);let best=null;for(const field of FINANCIAL_FIELDS){if(field.aliases.some(alias=>normalize(alias)===h)){best=field;break;}}return {columnIndex,header:String(header??''),fieldKey:best?.key||'',confidence:best?'suggested':'unmapped'};});
}
export function analyzeFinancialRows({headers=[],rows=[],mapping=[]}={}){
 const mapped=new Map(mapping.filter(x=>x.fieldKey).map(x=>[x.fieldKey,x.columnIndex]));
 const required=(mapped.has('period_date')||(mapped.has('year')&&mapped.has('month')))?[]:[{label:'التاريخ أو ربط السنة والشهر معًا'}];
 const records=[],issues=[],seen=new Map();let blankRows=0,invalidNumbers=0,duplicateRows=0;
 const metricFields=['revenue','collections','expenses','cases','discounts','tests_count'];
 for(let i=0;i<rows.length;i++){
  const source=rows[i]||[];if(!source.some(v=>clean(v)!=='')){blankRows++;continue;}
  const raw={};for(const field of FINANCIAL_FIELDS){const index=mapped.get(field.key);raw[field.key]=index===undefined?null:source[index]??null;}
  const splitPeriod=Number(raw.year)>0&&Number(raw.month)>0?String(Number(raw.year))+'-'+String(Number(raw.month)).padStart(2,'0'):null;const period=normalizeFinancialDate(raw.period_date)||normalizeFinancialDate(splitPeriod);
  if(period===null)issues.push({row:i+2,field:'period_date',message:'تاريخ أو فترة غير صالحة'});
  const metric=clean(raw.metric_key);
  const wide=metricFields.filter(key=>mapped.has(key)&&clean(raw[key])!=='');
  if(!metric&&!wide.length)issues.push({row:i+2,field:'metric_key',message:'اربط عمود نوع البند أو عمودًا ماليًا مستقلًا مثل الإيراد أو المصروفات'});
  const outputs=metric?[{metric_key:metric,amount:finite(raw.amount),quantity:finite(raw.quantity)}]:wide.map(key=>({metric_key:key,amount:['cases','tests_count'].includes(key)?null:finite(raw[key]),quantity:['cases','tests_count'].includes(key)?finite(raw[key]):null}));
  if(metric&&!outputs[0].amount&&!outputs[0].quantity&&raw.selling_price===null)issues.push({row:i+2,field:'amount',message:'لا توجد قيمة أو كمية قابلة للتحليل'});
  for(const output of outputs){
   const record={period_date:period,metric_key:output.metric_key,amount:output.amount,quantity:output.quantity,item_name:raw.item_name,category_name:raw.category_name,branch_name:raw.branch_name,unit_cost:finite(raw.unit_cost),selling_price:finite(raw.selling_price),currency_code:raw.currency_code};
   for(const key of ['unit_cost','selling_price'])if(record[key]===null&&clean(raw[key])!=='')invalidNumbers++;
   const fingerprint=JSON.stringify([record.period_date,normalize(record.metric_key),normalize(record.item_name),normalize(record.category_name),record.amount,record.quantity,record.unit_cost,record.selling_price,normalize(record.branch_name)]);
   const duplicate=seen.has(fingerprint);if(duplicate)duplicateRows++;else seen.set(fingerprint,i+2);
   records.push({...record,_rowNumber:i+2,_fingerprint:fingerprint,_duplicate:duplicate,_duplicateOf:duplicate?seen.get(fingerprint):null,_original:source});
  }
 }
 return {records,issues,issueCount:issues.length,blankRows,invalidNumbers,duplicateRows,missingRequired:required.length,missingRequiredFields:required.map(x=>x.label),ready:required.length===0&&issues.length===0,headers};
}
function metricClass(key){
 const k=normalize(key);
 if(/تحصيل|قبض|collection|cash received/.test(k))return 'collections';
 if(/مصروف|expense|تكلف/.test(k))return 'expenses';
 if(/تحليل|test/.test(k))return 'tests';
 if(/إيراد|ايراد|مبيعات|revenue|income/.test(k))return 'revenue';
 if(/حالة|زيارة|case|visit|عدد الحالات|عدد الزيارات/.test(k))return 'cases';
 if(/خصم|discount/.test(k))return 'discounts';
 if(/راتب|salary|أجور/.test(k))return 'payroll';
 return 'other';
}
export function buildGenericHistoricalReport(rows,{from=null,to=null,branchId=null}={}){
 const selected=(rows||[]).filter(r=>(!from||r.period_date>=from)&&(!to||r.period_date<=to)&&(!branchId||r.branch_id===branchId));
 const totals={revenue:0,collections:0,expenses:0,cases:0,discounts:0,payroll:0,tests:0,other:0};
 const monthly=new Map(),items=new Map(),categories=new Map();
 for(const r of selected){const cls=metricClass(r.metric_key),amount=Number(r.amount||0),qty=Number(r.quantity||0),month=String(r.period_date||'').slice(0,7);totals[cls]=(totals[cls]||0)+(cls==='cases'||cls==='tests'?qty:amount);
  if(month){const m=monthly.get(month)||{month,revenue:0,collections:0,expenses:0,cases:0,discounts:0,tests:0};if(cls==='revenue')m.revenue+=amount;if(cls==='collections')m.collections+=amount;if(cls==='expenses'||cls==='payroll')m.expenses+=amount;if(cls==='cases')m.cases+=qty||amount;if(cls==='discounts')m.discounts+=amount;if(cls==='tests')m.tests+=qty||1;monthly.set(month,m);}
  if(r.item_name){const item=items.get(normalize(r.item_name))||{name:r.item_name,count:0,revenue:0,cost:0};item.count+=qty||1;item.revenue+=r.selling_price!==null?r.selling_price* (qty||1):amount;item.cost+=r.unit_cost!==null?r.unit_cost*(qty||1):0;items.set(normalize(r.item_name),item);}
  if(r.category_name){categories.set(r.category_name,(categories.get(r.category_name)||0)+amount);}
 }
 const monthlyRows=[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(m=>({...m,profit:m.revenue-m.expenses,margin:m.revenue?(m.revenue-m.expenses)/m.revenue*100:0}));
 const seasonal=Array.from({length:12},(_,i)=>{const months=monthlyRows.filter(m=>Number(m.month.slice(5,7))===i+1);return {month:i+1,revenue:months.length?months.reduce((s,x)=>s+x.revenue,0)/months.length:0,cases:months.length?months.reduce((s,x)=>s+x.cases,0)/months.length:0,years:months.length};});
 const active=monthlyRows.filter(m=>m.revenue||m.cases),latest=active.at(-1);
 const targetMonth=latest?(()=>{const d=new Date(latest.month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,7);})():null;
 const targetSeason=targetMonth?seasonal[Number(targetMonth.slice(5,7))-1]:null;
 const outlook=latest?[1,2,3].map(offset=>{const d=new Date(latest.month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);const month=d.toISOString().slice(0,7),season=seasonal[Number(month.slice(5,7))-1];return {month,revenue:season.revenue,cases:season.cases,years:season.years,method:season.years?'متوسط الأشهر التاريخية المتاحة لنفس الشهر التقويمي':'لا توجد بيانات سابقة لهذا الشهر'};}):[];const plan=targetSeason?{month:targetMonth,revenue:targetSeason.revenue,cases:targetSeason.cases,method:'متوسط الأشهر التاريخية المتاحة لنفس الشهر التقويمي',years:targetSeason.years,outlook}:null;
 const itemRows=[...items.values()].map(x=>({...x,profit:x.revenue-x.cost,unitProfit:x.count?(x.revenue-x.cost)/x.count:0})).sort((a,b)=>b.count-a.count);
 const totalExpenses=totals.expenses+totals.payroll;totals.expenses=totalExpenses;const profit=totals.revenue-totalExpenses;
 return {source:'excel',scope:{from,to,branchId},totals:{...totals,profit,margin:totals.revenue?profit/totals.revenue*100:0},monthly:monthlyRows,seasonality:seasonal,monthlyPlan:plan,items:itemRows,expenseCategories:[...categories].map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount),periods:[...new Set(selected.map(r=>String(r.period_date||'').slice(0,7)).filter(Boolean))].sort()};
}
