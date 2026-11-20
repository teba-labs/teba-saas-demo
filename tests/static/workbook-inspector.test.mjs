import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {inferSheetType,suggestColumnMapping,getEntityFields,rankHeaderCandidates,validateArchiveFileMeta,validateSheetCount} from '../../modules/migration/workbook-inspector.js';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('archive import is owner-only, review-first and linked from settings',()=>{
 const html=read('app/data-import.html'),js=read('assets/js/data-import.js'),inspector=read('modules/migration/workbook-inspector.js'),settings=read('app/settings.html');
 assert.match(html,/فحص شامل واستيراد محدود آمن/);
 assert.match(html,/استيراد نتائج المعمل السابقة/);
 assert.match(html,/لا يُرفع الملف إلا عند اعتماد النتائج التاريخية/);
 assert.match(html,/historicalBranch/);
 assert.match(js,/accountType==='owner'/);
 assert.match(js,/inspectWorkbookFile/);
 assert.match(js,/headerRowSelect/);
 assert.doesNotMatch(js,/tenantSelect/);
 assert.match(js,/replaceChildren/);
 assert.match(inspector,/workbook\.SheetNames\.map/);
 assert.match(inspector,/blankrows: true/);
 assert.match(inspector,/sha256/);
 assert.match(inspector,/50 \* 1024 \* 1024/);
 assert.match(settings,/data-import\.html/);
 assert.doesNotMatch(inspector,/fetch\(|\.from\(['"]|\.rpc\(/);
});

test('Arabic and English sheet names are classified, with specific sheets before generic ones',()=>{
 assert.equal(inferSheetType('المرضى'),'patients');
 assert.equal(inferSheetType('Patients'),'patients');
 assert.equal(inferSheetType('تحاليل الزيارة'),'visit_tests');
 assert.equal(inferSheetType('الزيارات'),'visits');
 assert.equal(inferSheetType('نتائج التحاليل'),'test_results');
 assert.equal(inferSheetType('Financial Ledger'),'ledger');
 assert.equal(inferSheetType('كتالوج التحاليل'),'catalog');
 assert.equal(inferSheetType('أسعار التحاليل'),'prices');
 assert.equal(inferSheetType('المصروفات'),'expenses');
 assert.equal(inferSheetType('مقالات الموقع'),'website');
 assert.equal(inferSheetType('ورقة غير معروفة'),'unknown');
});

test('column suggestions recognize Arabic and English aliases and avoid duplicate target mappings',()=>{
 const mapped=suggestColumnMapping(['اسم المريض','Phone','العمر','اسم المريض','تاريخ الزيارة'],'patients');
 assert.equal(mapped[0].fieldKey,'name');
 assert.equal(mapped[1].fieldKey,'phone');
 assert.equal(mapped[2].fieldKey,'age');
 assert.equal(mapped[3].fieldKey,'');
 assert.equal(mapped[4].fieldKey,'');
 const visit=suggestColumnMapping(['visit_id','patient_id','visit_date','paid_amount'],'visits');
 assert.deepEqual(visit.map(x=>x.fieldKey),['source_id','patient_id','visit_date','paid_amount']);
});

test('required fields are explicitly identified for each supported entity',()=>{
 for(const entity of ['patients','visits','visit_tests','test_results','ledger','catalog','prices','expenses','website']){
  assert.ok(getEntityFields(entity).some(field=>field.required),entity+' should define required fields');
 }
 assert.deepEqual(getEntityFields('unknown'),[]);
});

test('mapping review stays in-memory until explicit historical, catalog or price import',()=>{
 const js=read('assets/js/data-import.js'),html=read('app/data-import.html');
 assert.match(js,/suggestColumnMapping/);
 assert.match(js,/addEventListener\('change'/);
 assert.match(js,/columnMapping/);
 assert.match(js,/findHistoricalPatientCandidates/);
 assert.match(js,/importHistoricalResults/);
 assert.match(js,/importNewCatalogTests/);
 assert.match(js,/importNewBasePrices/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|\.from\(|\.rpc\(|fetch\(/);
 assert.match(js,/importNewBasePrices/);
 assert.match(html,/فرع حفظ النتائج التاريخية/);
 assert.match(js,/أسعار البيع العامة/);
});

test('file guards and workbook sheet limit remain enforced',()=>{
 const inspector=read('modules/migration/workbook-inspector.js');
 assert.match(inspector,/MAX_FILE_BYTES = 20 \* 1024 \* 1024/);
 assert.match(inspector,/MAX_SHEETS = 200/);
 assert.match(inspector,/fileSize > MAX_FILE_BYTES/);
 assert.match(inspector,/count > MAX_SHEETS/);
 assert.match(inspector,/slice\(0, 15\)/);
});

test('all archive tool assets are in the offline shell',()=>{
 const sw=read('service-worker.js');
 for(const asset of ['./app/data-import.html','./assets/css/data-import.css','./assets/js/data-import.js','./modules/migration/workbook-inspector.js','./modules/migration/price-importer.js'])assert.ok(sw.includes(asset),asset);
});

test('synthetic workbook fixture finds a late Arabic header row and ignores blank rows',()=>{
 const rows=[['تقرير الأرشيف'],[],['تم التصدير'],[],[],[],[],['اسم المريض','رقم الهاتف','اسم المريض'],['سارة','0100',''],[],['عمر','0111','']];
 const candidates=rankHeaderCandidates(rows);
 assert.equal(candidates[0].rowIndex,7);
 assert.deepEqual(candidates[0].values,['اسم المريض','رقم الهاتف','اسم المريض']);
 assert.ok(candidates[0].preview.some(row=>row[0]==='سارة'));
});

test('synthetic multi-sheet names retain distinct entity classifications',()=>{
 const sheets=['Patients','الزيارات','تحاليل الزيارة','نتائج التحاليل','Financial Ledger','كتالوج التحاليل','أسعار التحاليل','المصروفات','مقالات الموقع'];
 assert.deepEqual(sheets.map(inferSheetType),['patients','visits','visit_tests','test_results','ledger','catalog','prices','expenses','website']);
});

test('archive file validation rejects malformed extensions, empty files and files above 50 MB',()=>{
 assert.equal(validateArchiveFileMeta('backup.xlsx',50*1024*1024),true);
 assert.throws(()=>validateArchiveFileMeta('backup.pdf',100),/الملفات المدعومة/);
 assert.throws(()=>validateArchiveFileMeta('empty.csv',0),/حجم الملف/);
 assert.throws(()=>validateArchiveFileMeta('oversized.xlsx',50*1024*1024+1),/حجم الملف/);
});

test('sheet-count guard rejects empty or over-limit workbooks',()=>{
 assert.equal(validateSheetCount(200),true);
 assert.throws(()=>validateSheetCount(0),/عدد أوراق العمل/);
 assert.throws(()=>validateSheetCount(201),/عدد أوراق العمل/);
});

test('synthetic patient rows detect missing required values, duplicate IDs and invalid numbers',async()=>{
 const {analyzeArchiveSheet}=await import('../../modules/migration/workbook-inspector.js');
 const rows=[['patient_id','name','age'],['P1','سارة','32'],['P1','','عشرون'],['P2','عمر','8']];
 const mapping=[{columnIndex:0,header:'patient_id',fieldKey:'source_id'},{columnIndex:1,header:'name',fieldKey:'name'},{columnIndex:2,header:'age',fieldKey:'age'}];
 const report=analyzeArchiveSheet(rows,0,'patients',mapping);
 assert.equal(report.nonEmptyRows,3);
 assert.equal(report.duplicateRows,1);
 assert.equal(report.missingRequired,1);
 assert.equal(report.invalidNumbers,0);
 assert.ok(report.issues.some(x=>x.type==='duplicate'));
 assert.ok(report.issues.some(x=>x.type==='missing-required'));
});

test('synthetic ledger rows detect invalid monetary values and blank lines',async()=>{
 const {analyzeArchiveSheet}=await import('../../modules/migration/workbook-inspector.js');
 const rows=[['type','amount','created_at'],['payment','150','2026-01-01'],['expense','abc','2026-01-02'],['','','']];
 const mapping=[{columnIndex:0,header:'type',fieldKey:'type'},{columnIndex:1,header:'amount',fieldKey:'amount'},{columnIndex:2,header:'created_at',fieldKey:'created_at'}];
 const report=analyzeArchiveSheet(rows,0,'ledger',mapping);
 assert.equal(report.nonEmptyRows,2);
 assert.equal(report.blankRows,1);
 assert.equal(report.invalidNumbers,1);
});

test('synthetic cross-sheet checks identify visits with missing patient references and orphan test rows',async()=>{
 const {analyzeArchiveSheet,analyzeArchiveRelationships}=await import('../../modules/migration/workbook-inspector.js');
 const patients={entityType:'patients',rawRows:[['id','name'],['P1','سارة']],headerRowIndex:0,columnMapping:[{columnIndex:0,header:'id',fieldKey:'source_id'},{columnIndex:1,header:'name',fieldKey:'name'}]};
 const visits={entityType:'visits',rawRows:[['visit_id','patient_id','visit_date'],['V1','P1','2026-01-01'],['V2','P9','2026-01-02']],headerRowIndex:0,columnMapping:[{columnIndex:0,header:'visit_id',fieldKey:'source_id'},{columnIndex:1,header:'patient_id',fieldKey:'patient_id'},{columnIndex:2,header:'visit_date',fieldKey:'visit_date'}]};
 const visitTests={entityType:'visit_tests',rawRows:[['visit_id','test_code'],['V1','CBC'],['V9','TSH']],headerRowIndex:0,columnMapping:[{columnIndex:0,header:'visit_id',fieldKey:'visit_id'},{columnIndex:1,header:'test_code',fieldKey:'test_code'}]};
 for(const sheet of [patients,visits,visitTests])sheet.analysis=analyzeArchiveSheet(sheet.rawRows,sheet.headerRowIndex,sheet.entityType,sheet.columnMapping);
 const links=analyzeArchiveRelationships([patients,visits,visitTests]);
 assert.equal(links.find(x=>x.from==='visits').missing,1);
 assert.equal(links.find(x=>x.from==='visit_tests').missing,1);
});

test('mapping UI displays row validation and relationship review while retaining local-only boundary',()=>{
 const js=read('assets/js/data-import.js');
 assert.match(js,/analyzeArchiveSheet/);
 assert.match(js,/analyzeArchiveRelationships/);
 assert.match(js,/ملاحظات فحص الصفوف/);
 assert.match(js,/مراجعة الارتباط بين الأوراق/);
 assert.doesNotMatch(js,/\.from\(|\.rpc\(|fetch\(|localStorage|sessionStorage/);
});


test('legacy age retains original value and unit without lossy conversion',async()=>{
 const {inspectLegacyAge}=await import('../../modules/migration/workbook-inspector.js');
 for(const [value,unit] of [['40','years'],['6','months'],['2','days']]){
  const result=inspectLegacyAge(value,unit);
  assert.equal(result.rawAge,value);assert.equal(result.rawAgeType,unit);
  assert.equal(result.ageYears,null);assert.equal(result.status,'unit-preserved');
 }
 assert.equal(inspectLegacyAge('unknown','years').status,'needs-review');
});

test('legacy date parser refuses ambiguous day-month dates and does not guess locale',async()=>{
 const {inspectLegacyDate}=await import('../../modules/migration/workbook-inspector.js');
 assert.deepEqual(inspectLegacyDate('2024-02-01'),{raw:'2024-02-01',status:'valid',isoDate:'2024-02-01'});
 assert.equal(inspectLegacyDate('01/02/2024').status,'ambiguous');
 assert.equal(inspectLegacyDate('31/02/2024').status,'invalid');
 assert.equal(inspectLegacyDate('Feb 1 2024').status,'needs-review');
});

test('legacy finance flags possible duplicate representation without adding payments',async()=>{
 const {inspectLegacyFinance}=await import('../../modules/migration/workbook-inspector.js');
 const review=inspectLegacyFinance({paidAmount:'150',ledgerEntries:[{visit_id:7,amount:100},{visit_id:7,amount:50}]});
 assert.equal(review.status,'ledger-semantics-unknown-manual-review');
 assert.equal(review.rawPaidAmount,'150');
 assert.equal(review.linkedLedgerCount,2);
 assert.equal(inspectLegacyFinance({paidAmount:80,ledgerEntries:[]}).status,'cumulative-only-no-payment-history');
 const explicit=inspectLegacyFinance({paidAmount:150,ledgerEntries:[{visit_id:7,amount:150,confirmedPayment:true}]});
 assert.equal(explicit.status,'manual-reconciliation-required');
 assert.equal(explicit.confirmedPaymentTotal,150);
});

test('legacy result payload inspection preserves raw JSON and identifies parameter paths',async()=>{
 const {inspectLegacyResultPayload}=await import('../../modules/migration/workbook-inspector.js');
 const raw='{"Hb":{"value":"12.5","unit":"g/dL"},"WBC":7}';
 const review=inspectLegacyResultPayload(raw);
 assert.equal(review.valid,true);assert.equal(review.rawOriginal,raw);
 assert.ok(review.paths.some(x=>x.path==='Hb.value'));
 assert.equal(inspectLegacyResultPayload('{broken').valid,false);
});

test('archive analysis adds non-destructive age/date/result review metadata',async()=>{
 const {analyzeArchiveSheet}=await import('../../modules/migration/workbook-inspector.js');
 const rows=[['name','age','age_type','created_at'],['سارة','6','months','01/02/2024']];
 const map=[['name','name'],['age','age'],['age_type','age_type'],['created_at','created_at']].map(([header,fieldKey],columnIndex)=>({header,fieldKey,columnIndex}));
 const report=analyzeArchiveSheet(rows,0,'patients',map);
 assert.equal(report.legacyReview.ageRows,1);
 assert.equal(report.legacyReview.dateAmbiguous,1);
 assert.equal(report.records[0]._legacyAgeReview.rawAgeType,'months');
 assert.equal(report.records[0]._legacyAgeReview.ageYears,null);
});


test('Netlify deployment serves the app entry point from an isolated dist deployment',()=>{
 const config=read('netlify.toml');
 assert.match(config,/command\s*=\s*"bash scripts\/build-netlify\.sh"/);
 assert.match(config,/publish\s*=\s*"dist"/);
 assert.match(config,/from\s*=\s*"\/"[\s\S]*to\s*=\s*"\/app\/index\.html"/);
 assert.match(config,/X-Content-Type-Options/);
 assert.match(config,/X-Frame-Options/);
});
