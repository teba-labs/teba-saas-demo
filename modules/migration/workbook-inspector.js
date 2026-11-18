const XLSX_URL = 'https://esm.sh/xlsx@0.18.5';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 50;

const ENTITY_FIELDS = {
  patients: { label: 'المرضى', fields: [
    ['source_id','معرّف المريض الأصلي',false,['id','patient id','patient_id','معرف المريض','كود المريض']],
    ['name','اسم المريض',true,['name','full name','patient name','patient_name','اسم','اسم المريض','الاسم']],
    ['phone','الهاتف',false,['phone','mobile','telephone','رقم الهاتف','الموبايل','التليفون']],
    ['age','العمر الأصلي',false,['age','العمر']],
    ['age_type','وحدة العمر',false,['age type','age_type','age unit','نوع العمر','وحدة العمر']],
    ['sex','النوع',false,['sex','gender','النوع','الجنس']],
    ['branch','الفرع',false,['branch','branch name','branch_id','الفرع','اسم الفرع']],
    ['created_at','تاريخ التسجيل',false,['created_at','created at','registration date','تاريخ التسجيل']]
  ]},
  visits: { label: 'الزيارات / الحالات', fields: [
    ['source_id','رقم الزيارة الأصلي',false,['visit_id','visit id','رقم الزيارة','كود الزيارة']],
    ['patient_id','معرّف المريض الأصلي',true,['patient_id','patient id','معرف المريض']],
    ['branch','الفرع',false,['branch','branch_id','branch name','الفرع']],
    ['visit_date','تاريخ الزيارة',true,['visit_date','visit date','date','تاريخ الزيارة','التاريخ']],
    ['status','الحالة',false,['status','الحالة']],
    ['total_amount','الإجمالي',false,['total_amount','total','الإجمالي','اجمالي']],
    ['discount','الخصم',false,['discount','الخصم']],
    ['paid_amount','المدفوع التراكمي',false,['paid_amount','paid','المدفوع','المدفوعات']]
  ]},
  visit_tests: { label: 'تحاليل الزيارة', fields: [
    ['visit_id','رقم الزيارة الأصلي',true,['visit_id','visit id','رقم الزيارة']],
    ['test_code','كود التحليل',false,['test_code','code','كود التحليل','كود']],
    ['test_name','اسم التحليل',false,['test_name','test name','analysis','اسم التحليل','التحليل']],
    ['price','السعر وقت الزيارة',false,['price_at_time','price','السعر','السعر وقت الزيارة']],
    ['cancelled','ملغي؟',false,['is_cancelled','cancelled','ملغي']]
  ]},
  test_results: { label: 'نتائج التحاليل', fields: [
    ['visit_id','رقم الزيارة الأصلي',true,['visit_id','visit id','رقم الزيارة']],
    ['test_code','كود التحليل',false,['test_code','code','كود التحليل']],
    ['results_data','بيانات النتائج الخام',true,['results_data','results','result data','النتائج','بيانات النتائج']],
    ['created_at','تاريخ النتيجة',false,['created_at','result date','تاريخ النتيجة']]
  ]},
  ledger: { label: 'الحركة المالية', fields: [
    ['source_id','معرّف الحركة',false,['id','ledger_id','معرف الحركة']],
    ['type','نوع الحركة الأصلي',true,['type','transaction type','نوع الحركة','النوع']],
    ['item_name','البيان',false,['item_name','description','البيان','الوصف']],
    ['amount','المبلغ',true,['amount','value','المبلغ','القيمة']],
    ['created_at','التاريخ الأصلي',true,['created_at','date','transaction date','التاريخ']],
    ['visit_id','رقم الزيارة الأصلي',false,['visit_id','visit id','رقم الزيارة']],
    ['branch','الفرع',false,['branch','branch_id','الفرع']]
  ]},
  catalog: { label: 'كتالوج التحاليل', fields: [
    ['test_code','كود التحليل',false,['test_code','code','كود التحليل','الكود']],
    ['test_name','اسم التحليل',true,['test_name','name','test name','اسم التحليل','الاسم']],
    ['price','السعر',false,['price','selling_price','السعر']],
    ['parameters','المعلمات / التفاصيل',false,['parameters','parameter','المعلمات','البارامترات']]
  ]},
  expenses: { label: 'بنود / مصروفات', fields: [
    ['category','بند المصروف',true,['category','category_name','expense category','بند المصروف','البند']],
    ['amount','المبلغ',false,['amount','المبلغ']],
    ['date','التاريخ',false,['date','created_at','التاريخ']],
    ['description','البيان',false,['description','item_name','الوصف','البيان']],
    ['branch','الفرع',false,['branch','branch_id','الفرع']]
  ]},
  website: { label: 'محتوى الموقع', fields: [
    ['title','العنوان',true,['title','name','العنوان','الاسم']],
    ['content','المحتوى',false,['content','body','description','المحتوى','الوصف']],
    ['slug','الرابط المختصر',false,['slug','الرابط المختصر']],
    ['is_published','منشور؟',false,['is_published','published','منشور']],
    ['sort_order','الترتيب',false,['sort_order','order','الترتيب']]
  ]}
};
const ENTITY_OPTIONS = [
  ['unknown','غير محدد'],['patients','المرضى'],['visits','الزيارات / الحالات'],
  ['visit_tests','تحاليل الزيارة'],['test_results','نتائج التحاليل'],['ledger','الحركة المالية'],
  ['catalog','كتالوج التحاليل'],['expenses','بنود / مصروفات'],['website','محتوى الموقع']
];

function cleanCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}
function normalizeHeader(value) {
  return cleanCell(value).toLocaleLowerCase('ar')
    .normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g,'')
    .replace(/[أإآ]/g,'ا').replace(/[ئىىي]/g,'ي').replace(/ؤ/g,'و')
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function rankHeaderCandidates(rows) {
  return rows.slice(0, 15).map((row, index) => {
    const values = (row || []).map(cleanCell).filter(Boolean);
    const unique = new Set(values.map(normalizeHeader));
    return { rowIndex: index, nonEmpty: values.length, unique: unique.size, score: values.length + unique.size * 0.25, values: (row || []).map(cleanCell), preview: rows.slice(index + 1, index + 6).map(next => next.map(cleanCell)) };
  }).filter(x => x.nonEmpty >= 2).sort((a,b) => b.score-a.score).slice(0,5);
}

const UNIQUE_KEYS = {
  patients:['source_id'], visits:['source_id'], ledger:['source_id'], catalog:['test_code'],
  visit_tests:['visit_id','test_code'], test_results:['visit_id','test_code']
};
const NUMERIC_FIELDS = new Set(['total_amount','discount','paid_amount','amount','price','sort_order']);
const RELATIONSHIPS = [
  {from:'visits',field:'patient_id',to:'patients',targetField:'source_id',label:'المريض المرتبط بالزيارة'},
  {from:'visit_tests',field:'visit_id',to:'visits',targetField:'source_id',label:'الزيارة المرتبطة بالتحليل'},
  {from:'test_results',field:'visit_id',to:'visits',targetField:'source_id',label:'الزيارة المرتبطة بالنتيجة'},
  {from:'ledger',field:'visit_id',to:'visits',targetField:'source_id',optional:true,label:'الزيارة المرتبطة بالحركة المالية'}
];
function rowObject(row, mapping) {
  const out={}, counts=new Map();
  for(const item of mapping||[]) if(item.fieldKey) counts.set(item.fieldKey,(counts.get(item.fieldKey)||0)+1);
  for(const item of mapping||[]) if(item.fieldKey && counts.get(item.fieldKey)===1) out[item.fieldKey]=cleanCell(row?.[item.columnIndex]);
  return out;
}
function numericValue(value) {
  let text=cleanCell(value).replace(/[٠-٩۰-۹]/g,d=>String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(d)%10));
  text=text.replace(/[٬,،\s]/g,'').replace(/٫/g,'.').replace(/جنيه(مصري)?|ج\.م|EGP/gi,'').trim();
  return text && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null;
}
function dateStatus(value) {
  const text=cleanCell(value);
  if(!text)return 'empty';
  let m=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if(m){const y=+m[1],mo=+m[2],d=+m[3];const date=new Date(Date.UTC(y,mo-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d?'valid':'invalid';}
  m=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if(m){const a=+m[1],b=+m[2];if(a>12&&b<=12)return b>=1&&b<=12&&a>=1&&a<=31?'valid':'invalid';if(b>12&&a<=12)return a>=1&&a<=12&&b>=1&&b<=31?'valid':'invalid';if(a>=1&&a<=12&&b>=1&&b<=12)return 'ambiguous';return 'invalid';}
  const parsed=Date.parse(text);
  return Number.isNaN(parsed)?'invalid':'ambiguous';
}
export function inspectLegacyDate(value) {
  const raw=value===undefined||value===null?'':String(value).trim();
  if(!raw)return {raw,status:'empty',isoDate:null};
  let m=raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if(m){const y=+m[1],mo=+m[2],d=+m[3],dt=new Date(Date.UTC(y,mo-1,d));const valid=dt.getUTCFullYear()===y&&dt.getUTCMonth()===mo-1&&dt.getUTCDate()===d;return {raw,status:valid?'valid':'invalid',isoDate:valid?raw:null};}
  m=raw.match(/^(\\d{1,2})[\\/. -](\\d{1,2})[\\/. -](\\d{4})$/);
  if(m){const a=+m[1],b=+m[2],y=+m[3];if(a>=1&&a<=12&&b>=1&&b<=12)return {raw,status:'ambiguous',isoDate:null};const day=a>12?a:b,month=a>12?b:a;const dt=new Date(Date.UTC(y,month-1,day));const valid=dt.getUTCFullYear()===y&&dt.getUTCMonth()===month-1&&dt.getUTCDate()===day;return {raw,status:valid?'valid':'invalid',isoDate:valid?dt.toISOString().slice(0,10):null};}
  return {raw,status:'needs-review',isoDate:null};
}
export function inspectLegacyAge(age,ageType) {
  const rawAge=age===undefined||age===null?'':String(age).trim();
  const rawAgeType=ageType===undefined||ageType===null?'':String(ageType).trim();
  const unit=rawAgeType.toLocaleLowerCase('ar').replace(/[أإآ]/g,'ا').trim();
  const value=/^\\d+(?:[.,]\\d+)?$/.test(rawAge.replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))))?Number(rawAge.replace(',','.').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))):null;
  const unitKnown=/^(سنه|سنوات|عام|اعوام|year|years|y|شهر|شهور|اشهر|month|months|mo|يوم|ايام|day|days|d)$/.test(unit);
  return {rawAge,rawAgeType,numericValue:value,unitKnown,ageYears:null,status:!rawAge?'empty':value===null?'needs-review':unitKnown?'unit-preserved':'unit-review-required'};
}
export function inspectLegacyFinance({paidAmount,ledgerEntries=[]}={}) {
  const paid=paidAmount===undefined||paidAmount===null||paidAmount===''?null:Number(String(paidAmount).replace(/,/g,''));
  const linked=ledgerEntries.filter(x=>x&&x.visit_id!==undefined&&x.visit_id!==null);
  const explicitlyConfirmedPayments=linked.filter(x=>x.confirmedPayment===true);
  const confirmedTotal=explicitlyConfirmedPayments.reduce((sum,x)=>sum+Math.abs(Number(x.amount)||0),0);
  return {rawPaidAmount:paidAmount??null,linkedLedgerCount:linked.length,confirmedPaymentCount:explicitlyConfirmedPayments.length,
    confirmedPaymentTotal:confirmedTotal,status:paid===null?'no-cumulative-paid-value':
    explicitlyConfirmedPayments.length?'manual-reconciliation-required':
    linked.length?'ledger-semantics-unknown-manual-review':'cumulative-only-no-payment-history'};
}
export function inspectLegacyResultPayload(raw) {
  let parsed=raw,valid=true;
  if(typeof raw==='string'){try{parsed=JSON.parse(raw);}catch{valid=false;}}
  const paths=[];
  const walk=(value,path='',depth=0)=>{
    if(paths.length>=100||depth>8)return;
    if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [key,item] of Object.entries(value))walk(item,path?path+'.'+key:key,depth+1);}
    else if(Array.isArray(value)){if(!value.length)paths.push({path,type:'empty-array'});else value.slice(0,30).forEach((item,index)=>walk(item,path+'['+index+']',depth+1));}
    else paths.push({path,type:value===null?'null':typeof value});
  };
  if(valid)walk(parsed);
  return {valid,rawOriginal:raw,topLevelType:parsed===null?'null':Array.isArray(parsed)?'array':typeof parsed,paths,truncated:paths.length>=100};
}
export function analyzeArchiveSheet(rows, headerRowIndex, entityType, mapping) {
  const data=(rows||[]).slice(headerRowIndex+1);
  const fields=ENTITY_FIELDS[entityType]?.fields||[];
  const required=fields.filter(f=>f[2]).map(f=>f[0]);
  const keys=UNIQUE_KEYS[entityType]||[];
  const seen=new Map(), issues=[];
  let blankRows=0, missingRequired=0, invalidNumbers=0, duplicateRows=0;
  const records=[];
  const add=(type,rowNumber,message)=>{if(issues.length<25)issues.push({type,rowNumber,message});};
  data.forEach((row,index)=>{
    const record=rowObject(row,mapping);
    if(!Object.values(record).some(Boolean)){blankRows++;return;}
    records.push({...record,_rowNumber:headerRowIndex+index+2});
    for(const key of required) if(!String(record[key]||'').trim()){missingRequired++;add('missing-required',headerRowIndex+index+2,'حقل مطلوب فارغ: '+(fields.find(f=>f[0]===key)?.[1]||key));}
    for(const key of NUMERIC_FIELDS) if(record[key] && !Number.isFinite(Number(record[key].replace(/[,،]/g,'')))){invalidNumbers++;add('invalid-number',headerRowIndex+index+2,'قيمة رقمية غير صالحة في '+key);}
    if(keys.length && keys.every(k=>record[k])){
      const signature=keys.map(k=>record[k].toLocaleLowerCase('ar')).join('|');
      if(seen.has(signature)){duplicateRows++;add('duplicate',headerRowIndex+index+2,'تكرار محتمل للمفتاح '+keys.join(' + ')+'؛ يظهر أيضًا في الصف '+seen.get(signature));}
      else seen.set(signature,headerRowIndex+index+2);
    }
  });
  const headerNames=(mapping||[]).map(m=>normalizeHeader(m.header)).filter(Boolean);
  const duplicateHeaders=headerNames.filter((name,index)=>headerNames.indexOf(name)!==index).length;
  if(duplicateHeaders)add('duplicate-header',headerRowIndex+1,'يوجد '+duplicateHeaders+' عنوان عمود مكرر؛ راجع المطابقة يدويًا.');
  const legacyReview={ageRows:0,dateAmbiguous:0,dateInvalid:0,resultPayloadInvalid:0,financeRows:0};
  for(const record of records){
    if(entityType==='patients'&&record.age){const age=inspectLegacyAge(record.age,record.age_type);record._legacyAgeReview=age;if(age.status!=='empty')legacyReview.ageRows++;}
    const dateField=entityType==='visits'?'visit_date':entityType==='ledger'?'created_at':entityType==='expenses'?'date':entityType==='patients'?'created_at':null;
    if(dateField&&record[dateField]){record._legacyDateReview=inspectLegacyDate(record[dateField]);if(record._legacyDateReview.status==='ambiguous')legacyReview.dateAmbiguous++;if(['invalid','needs-review'].includes(record._legacyDateReview.status))legacyReview.dateInvalid++;}
    if(entityType==='test_results'&&record.results_data){record._legacyResultReview=inspectLegacyResultPayload(record.results_data);if(!record._legacyResultReview.valid)legacyReview.resultPayloadInvalid++;}
    if(entityType==='visits'&&record.paid_amount!==undefined)legacyReview.financeRows++;
  }
  return {entityType,totalRows:data.length,nonEmptyRows:records.length,blankRows,missingRequired,invalidNumbers,duplicateRows,duplicateHeaders,issueCount:missingRequired+invalidNumbers+duplicateRows+(duplicateHeaders?1:0),issues,records,legacyReview};
}
export function analyzeArchiveRelationships(sheets) {
  const results=[];
  for(const relation of RELATIONSHIPS){
    const source=sheets.find(s=>s.entityType===relation.from);
    const target=sheets.find(s=>s.entityType===relation.to);
    if(!source||!target)continue;
    const sourceRecords=source.analysis?.records||[];
    const targetRecords=target.analysis?.records||[];
    if(!sourceRecords.length||!targetRecords.length)continue;
    const targetIds=new Set(targetRecords.map(r=>String(r[relation.targetField]||'').trim()).filter(Boolean));
    let missing=0;const samples=[];
    for(const record of sourceRecords){
      const value=String(record[relation.field]||'').trim();
      if(!value&&relation.optional)continue;
      if(!value||!targetIds.has(value)){missing++;if(samples.length<10)samples.push(record._rowNumber);}
    }
    results.push({from:relation.from,to:relation.to,field:relation.field,missing,total:sourceRecords.length,sampleRows:samples,label:relation.label});
  }
  return results;
}

function hashHex(buffer) {
  return crypto.subtle.digest('SHA-256', buffer).then(bytes =>
    [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('')
  );
}
export function inferSheetType(sheetName) {
  const n=normalizeHeader(sheetName);
  const rules=[
    ['patients',/مرض|patient|patients|عملاء/],['visit_tests',/تحاليل الزيار|visit test|visit_tests|تفاصيل التحاليل/],
    ['visits',/زيار|حالا|visit|visits|استقبال/],
    ['test_results',/نتائج|نتايج|result|test_results/],['ledger',/حرك|مالي|ledger|financial|خزين|مدفوع/],
    ['catalog',/كتالوج|تحاليل|catalog|tests/],['expenses',/مصروف|expense|بنود/],
    ['website',/موقع|مقال|faq|عرض|package|testimonial|article/]
  ];
  return rules.find(([,pattern])=>pattern.test(n))?.[0]||'unknown';
}
export function suggestColumnMapping(headers, entityType) {
  const fields=ENTITY_FIELDS[entityType]?.fields||[];
  const used=new Set();
  return (headers||[]).map((header,index)=>{
    const normalized=normalizeHeader(header);
    let best=null;
    if(normalized) for(const field of fields){
      const aliases=[field[0],...field[3]].map(normalizeHeader);
      const score=aliases.includes(normalized)?100:aliases.some(a=>a&&normalized.includes(a))?65:0;
      if(score>(best?.score||0))best={key:field[0],score};
    }
    const key=best&&best.score>=65&&!used.has(best.key)?best.key:'';
    if(key)used.add(key);
    return {columnIndex:index,header:cleanCell(header),fieldKey:key,confidence:key?(best.score===100?'high':'review'):'unmapped'};
  });
}
export function validateArchiveFileMeta(fileName,fileSize){
  if (!/\.(xlsx|xls|csv)$/i.test(String(fileName||''))) throw new Error('الملفات المدعومة الآن: XLSX وXLS وCSV.');
  if (!fileSize || fileSize > MAX_FILE_BYTES) throw new Error('حجم الملف يجب أن يكون أقل من 20 ميجابايت.');
  return true;
}
export function validateSheetCount(count){
  if (!Number.isInteger(count) || count < 1 || count > MAX_SHEETS) throw new Error('عدد أوراق العمل غير صالح أو يتجاوز الحد المسموح (50 ورقة).');
  return true;
}
export function getEntityOptions(){return ENTITY_OPTIONS.map(([value,label])=>({value,label}));}
export function getEntityFields(entityType){return (ENTITY_FIELDS[entityType]?.fields||[]).map(([key,label,required])=>({key,label,required}));}

/** Reads workbook bytes in this browser tab only. It never uploads or persists source rows. */
export async function inspectWorkbookFile(file) {
  if (!(file instanceof File)) throw new Error('اختر ملف Excel أو CSV أولًا.');
  validateArchiveFileMeta(file.name,file.size);
  if (!globalThis.crypto?.subtle) throw new Error('المتصفح لا يدعم فحص بصمة الملف بأمان. افتح الصفحة عبر HTTPS.');
  const buffer = await file.arrayBuffer();
  const [sha256, XLSX] = await Promise.all([hashHex(buffer), import(XLSX_URL)]);
  let workbook;
  try { workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false }); }
  catch { throw new Error('تعذر قراءة الملف. تأكد أنه ملف Excel أو CSV سليم وغير تالف.'); }
  validateSheetCount(workbook.SheetNames.length);
  const sheets = workbook.SheetNames.map(name => {
    const worksheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false, blankrows: true });
    const candidates = rankHeaderCandidates(rows);
    const suggested = candidates[0]?.rowIndex ?? 0;
    const header = (rows[suggested] || []).map(cleanCell);
    return {
      name, rowCount: rows.filter(row => row.some(cell => cleanCell(cell) !== '')).length,
      headerRowIndex: suggested, headerCandidates: candidates,
      headers: header, preview: rows.slice(suggested + 1, suggested + 6).map(row => row.map(cleanCell)),
      entityType: inferSheetType(name), columnMapping: suggestColumnMapping(header,inferSheetType(name)), rawRows: rows
    };
  });
  return { fileName:file.name,fileSize:file.size,sha256,sheetCount:sheets.length,sheets,inspectedAt:new Date().toISOString(),privacy:'local-only' };
}
