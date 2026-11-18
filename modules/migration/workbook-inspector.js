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
    ['title','العنوان',false,['title','name','العنوان','الاسم']],
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
    .normalize('NFKD').replace(/[\\u064B-\\u065F\\u0670]/g,'')
    .replace(/[أإآ]/g,'ا').replace(/[ىي]/g,'ي')
    .replace(/[^\\p{L}\\p{N}]+/gu,' ').trim();
}
function headerCandidates(rows) {
  return rows.slice(0, 15).map((row, index) => {
    const values = (row || []).map(cleanCell).filter(Boolean);
    const unique = new Set(values.map(normalizeHeader));
    return { rowIndex: index, nonEmpty: values.length, unique: unique.size, score: values.length + unique.size * 0.25, values: (row || []).map(cleanCell), preview: rows.slice(index + 1, index + 6).map(next => next.map(cleanCell)) };
  }).filter(x => x.nonEmpty >= 2).sort((a,b) => b.score-a.score).slice(0,5);
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
    ['test_results',/نتائج|result|test_results/],['ledger',/حرك|مالي|ledger|financial|خزين|مدفوع/],
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
export function getEntityOptions(){return ENTITY_OPTIONS.map(([value,label])=>({value,label}));}
export function getEntityFields(entityType){return (ENTITY_FIELDS[entityType]?.fields||[]).map(([key,label,required])=>({key,label,required}));}

/** Reads workbook bytes in this browser tab only. It never uploads or persists source rows. */
export async function inspectWorkbookFile(file) {
  if (!(file instanceof File)) throw new Error('اختر ملف Excel أو CSV أولًا.');
  if (!/\\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('الملفات المدعومة الآن: XLSX وXLS وCSV.');
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('حجم الملف يجب أن يكون أقل من 20 ميجابايت.');
  if (!globalThis.crypto?.subtle) throw new Error('المتصفح لا يدعم فحص بصمة الملف بأمان. افتح الصفحة عبر HTTPS.');
  const buffer = await file.arrayBuffer();
  const [sha256, XLSX] = await Promise.all([hashHex(buffer), import(XLSX_URL)]);
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > MAX_SHEETS) {
    throw new Error('عدد أوراق العمل غير صالح أو يتجاوز الحد المسموح (50 ورقة).');
  }
  const sheets = workbook.SheetNames.map(name => {
    const worksheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false, blankrows: false });
    const candidates = headerCandidates(rows);
    const suggested = candidates[0]?.rowIndex ?? 0;
    const header = (rows[suggested] || []).map(cleanCell);
    return {
      name, rowCount: rows.filter(row => row.some(cell => cleanCell(cell) !== '')).length,
      headerRowIndex: suggested, headerCandidates: candidates,
      headers: header, preview: rows.slice(suggested + 1, suggested + 6).map(row => row.map(cleanCell)),
      entityType: inferSheetType(name), columnMapping: suggestColumnMapping(header,inferSheetType(name))
    };
  });
  return { fileName:file.name,fileSize:file.size,sha256,sheetCount:sheets.length,sheets,inspectedAt:new Date().toISOString(),privacy:'local-only' };
}
