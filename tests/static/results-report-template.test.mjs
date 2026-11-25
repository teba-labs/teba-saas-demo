import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const js=fs.readFileSync(new URL('assets/js/results-workbench.js',root),'utf8');
const settings=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8');
const html=fs.readFileSync(new URL('app/settings.html',root),'utf8');
const assets=fs.readFileSync(new URL('modules/settings/assets-repository.js',root),'utf8');

test('report groups individual tests and profile reports with stable page-break rules',()=>{
 for(const value of ["individualHtml = testSections.filter(section => section.kind !== 'panel' && section.hasContent)","const profileSections = testSections.filter(section => section.kind === 'panel' && section.hasContent)",'profileSections.map','profile-report','groupedTestSections','.profile-report{break-before:page;page-break-before:always}','.profile-report.first-profile{break-before:auto;page-break-before:auto}']) assert.ok(js.includes(value),value);
});

test('reference ranges are normalized, age/sex matched and never rendered as raw JSON',()=>{
 assert.ok(js.includes('function normalizeReferenceRangePayload(value)'));
 assert.ok(js.includes('function resolveReferenceRange(value, patient'));
 assert.ok(js.includes('patientAgeInYears(patient)'));
 assert.ok(js.includes('normalizedRangeSex'));
 assert.ok(js.includes('function formatReferenceRange(value)'));
 assert.ok(js.includes("return '-';"));
 assert.ok(js.includes("const reference = resolveReferenceRange(rawReference, patient, parameter.reference_interval_status)"));
 assert.ok(!js.includes('Object.entries(value).map(([key, item]) => key +'));
});

test('result table uses fixed clinical column widths, wrapping and correct cell directions',()=>{
 for(const value of ['table-layout:fixed','width:100%','width:40%','width:15%','width:10%','width:25%','word-break:break-word','overflow-wrap:anywhere','.parameter-cell{direction:rtl;text-align:right}','.result-cell,.reference-cell{direction:ltr;text-align:left}']) assert.ok(js.includes(value),value);
});

test('bilingual report header repeats patient visit metadata and footer per PDF page',()=>{
 for(const value of ['identity-en','identity-ar','patient-header-meta','patientMetaHtml','Patient Name','Patient ID','Visit Number','Age / Sex','Visit Date','headerCanvas','footerCanvas','pdf.addImage','Page \${page} of \${totalPages}']) assert.ok(js.includes(value),value);
 assert.ok(js.includes('data-page-top-margin'));
 assert.ok(js.includes('data-page-bottom-margin'));
 assert.ok(js.includes('const pageTopMargin = 49'));
 assert.ok(js.includes('const pageBottomMargin = 25'));
});

test('analysis headings are separated from tables and report body is English on white paper',()=>{
 assert.ok(js.includes('.analysis-heading{font-size:13px;margin:20px 0 7px;clear:both'));
 assert.ok(js.includes('lang="en" dir="ltr"'));
 assert.ok(js.includes('LABORATORY REPORT'));
 assert.ok(js.includes('Parameter</th><th>Result</th><th>Unit</th><th>Reference Interval</th><th>Flag'));
 assert.ok(js.includes('background:#fff'));
});

test('owner settings expose bilingual lab and branch print identity and persist it',()=>{
 for(const id of ['laboratoryNameEn','laboratoryNameAr','printLabNameEn','printLabNameAr','printBranchNameEn','printAddressEn','printAddressAr','printPhoneEn','printPhoneAr','printLogoSource','printShowBranchAddresses','printShowContacts','printWebsiteUrl','printSupportUrl','printFooterCenterMode','printWatermarkMode','printWatermarkOpacity','printWatermarkSize','printWatermarkPosition','printHeaderSideText','printStampFile','printShowStamp','printReviewerName','printShowReviewer']) assert.ok(html.includes('id="'+id+'"'),id);
 for(const key of ['laboratory_name_en','laboratory_name_ar','labNameEn','labNameAr','branchNameEn','addressEn','addressAr','phoneEn','phoneAr','savePrintSettings','loadPrintSettings','settings_json']) assert.ok(settings.includes(key),key);
 assert.ok(settings.includes("assetKind:'stamp'"));
 assert.ok(assets.includes("['logo','signature','stamp']"));
 assert.ok(settings.includes("uploadPrintStamp"));
 assert.ok(settings.includes('printStampPreview'));
 assert.ok(settings.includes('printReviewerName'));
 assert.ok(settings.includes('preview-patient-meta'));
});

test('preprinted stationery can hide lab identity/footer while retaining repeating patient details and page numbers',()=>{
 for(const id of ['printShowHeader','printShowFooter']) assert.ok(html.includes('id="'+id+'"'),id);
 for(const key of ['showHeader','showFooter']) assert.ok(settings.includes(key),key);
 assert.ok(js.includes('showPrintHeader'));
 assert.ok(js.includes('showPrintFooter'));
 assert.ok(js.includes("'<header class=\"report-header'"));
 assert.ok(js.includes('patientMetaHtml'));
 assert.ok(js.includes('Page \${page} of \${totalPages}'));
});

test('PDF generation uses same report preview and attaches repeated page furniture before publication',()=>{
 assert.ok(js.includes('state.reportPreviewHtml.set(visitId,reportHtml)'));
 assert.ok(js.includes('ensureHtml2Pdf'));
 assert.ok(js.includes('ensureHtml2Canvas'));
 assert.ok(js.includes('.toPdf()'));
 assert.ok(js.includes("pdf.output('blob')"));
 assert.ok(js.includes('publishReportVersion('));
 assert.ok(js.includes('onclone:cloned=>cloned.querySelectorAll'));
 assert.ok(js.includes('pdf.setPage(page)'));
 assert.ok(js.includes('pdf.addImage'));
});

test('partial reports include only saved completed results and do not bypass final publication gates',()=>{
 assert.match(js,/const hasAnySavedResults = group\.items\.some/);
 assert.match(js,/const partialReport = !localOffline && globalThis\.navigator/);
 assert.match(js,/rows\.some\(row => row\.visit_test_id === item\.id\)/);
 assert.match(js,/لا يمكن نشر التقرير النهائي قبل اكتمال جميع التحاليل/);
 assert.match(js,/PARTIAL REPORT — some results are not yet available/);
 const finalPublication=fs.readFileSync(new URL('database/migrations/108_block_partial_report_publication.sql',root),'utf8');
 const partialPublication=fs.readFileSync(new URL('database/migrations/111_partial_report_publication.sql',root),'utf8');
 assert.match(finalPublication,/All visit tests must be completed before report publication/);
 assert.match(partialPublication,/publish_partial_report_version/);
 assert.match(partialPublication,/set_config\('app\.report_publication','partial',true\)/);
});
