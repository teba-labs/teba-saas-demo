import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const js=fs.readFileSync(new URL('assets/js/results-workbench.js',root),'utf8');
const settings=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8');
const html=fs.readFileSync(new URL('app/settings.html',root),'utf8');
const assets=fs.readFileSync(new URL('modules/settings/assets-repository.js',root),'utf8');

test('report groups all individual tests together and renders every panel as its own page',()=>{
 for(const value of ["individualHtml = testSections.filter(section => section.kind !== 'panel' && section.hasContent)","const profileSections = testSections.filter(section => section.kind === 'panel' && section.hasContent)",'profileSections.map','profile-report','groupedTestSections']) assert.ok(js.includes(value),value);
});

test('print settings include configurable three-zone header, footer, logo source and watermark',()=>{
 for(const id of ['printIdentitySide','printLogoSource','printShowBranchAddresses','printShowContacts','printWebsiteUrl','printSupportUrl','printFooterCenterMode','printWatermarkMode','printWatermarkOpacity','printWatermarkSize','printWatermarkPosition','printHeaderSideText','printStampFile','printShowStamp','printReviewerName','printShowReviewer']) assert.ok(html.includes('id="'+id+'"'),id);
 for(const key of ['identitySide','logoSource','showBranchAddresses','showContacts','websiteUrl','supportUrl','footerCenterMode','watermarkMode','watermarkOpacity','watermarkSize','watermarkPosition','headerSideText','stampPath','showStamp','reviewerName','showReviewer']) assert.ok(settings.includes(key),key);
 for(const value of ['header-grid','footer-right','footer-left','watermark-text','تم إجراء التحاليل بفرع','header.report-header{position:fixed','footer{position:fixed','footerGridColumns']) assert.ok(js.includes(value),value);
});
function resultsHasHeaderText(source){return source.includes("replace(/\\n/g,'<br>')");}

test('print settings persist and reload the newly added options as structured JSON',()=>{
 assert.ok(settings.includes('watermarkOpacity:'));
 assert.ok(settings.includes('savePrintSettings'));
 assert.ok(settings.includes('printWatermarkOpacity'));
 assert.ok(js.includes('canPrint ?'));
 assert.ok(js.includes('أكمل تحليلًا واحدًا على الأقل قبل الطباعة الجزئية'));
 assert.ok(js.includes('partialReport'));
 assert.ok(js.includes('state.previewedVisits.has(visitId)'));
 assert.ok(js.includes('identity-extra'));
 assert.ok(js.includes('print.showStamp'));
 assert.ok(js.includes('print.showReviewer'));
 assert.ok(js.includes('report-approval'));
 assert.ok(js.includes('headerSideText'));
 assert.ok(settings.includes("assetKind:'stamp'"));
 assert.ok(assets.includes("['logo','signature','stamp']"));
 assert.ok(settings.includes("uploadPrintStamp"));
 assert.ok(settings.includes('const approvals='));
 assert.ok(settings.includes('printStampPreview'));
 assert.ok(settings.includes('printReviewerName'));
 assert.ok(resultsHasHeaderText(settings));
 assert.ok(js.includes('computeReferenceFlag'));
 assert.ok(js.includes('result.reference_range_snapshot ?? parameter.reference_ranges'));
 assert.ok(js.includes('لم تُحفظ بعد'));
 assert.ok(js.includes('taibaGetDirtyResultInputs'));
 assert.ok(js.includes('قبل نشر التقرير'));
});

 
test('preprinted letterhead settings independently suppress lab header and footer while preserving report body',()=>{
 for(const id of ['printShowHeader','printShowFooter']) assert.ok(html.includes('id="'+id+'"'),id);
 for(const key of ['showHeader','showFooter']) assert.ok(settings.includes(key),key);
 for(const value of ['showPrintHeader','showPrintFooter','pageTopMargin','pageBottomMargin']) assert.ok(js.includes(value),value);
 assert.ok(settings.includes('هيدر المعمل مخفي'));
 assert.ok(settings.includes('فوتر المعمل مخفي'));
});

test('each profile starts on a separate page while the first profile avoids a blank leading page',()=>{
 assert.ok(js.includes(".profile-report{break-before:page;page-break-before:always}"));
 assert.ok(js.includes(".profile-report.first-profile{break-before:auto;page-break-before:auto}"));
 assert.ok(js.includes('hasContent'));
 assert.ok(js.includes('const reference = hasReference ?'));
 assert.ok(js.includes("'<section class=\"report-cover-meta\">"));
});
test('lab branding repeats separately from first-page patient and visit metadata',()=>{
 assert.ok(js.includes("'<header class=\"report-header\"><div class=\"header-grid\">"));
 assert.ok(js.includes("'<section class=\"report-cover-meta\"><h1>LABORATORY REPORT</h1>"));
});


test('any saved result can be printed as a marked partial report while final publication stays gated',()=>{
 const finalPublication=fs.readFileSync(new URL('database/migrations/108_block_partial_report_publication.sql',root),'utf8');
 const partialPublication=fs.readFileSync(new URL('database/migrations/110_partial_report_publication.sql',root),'utf8');
 assert.match(js,/const hasAnySavedResults = group\.items\.some/);
 assert.match(js,/const partialReport = globalThis\.navigator/);
 assert.match(js,/rows\.some\(row => row\.visit_test_id === item\.id\)/);
 assert.match(js,/لا يمكن نشر التقرير النهائي قبل اكتمال جميع التحاليل/);
 assert.match(js,/تقرير جزئي — بعض النتائج لم تصدر بعد/);
 assert.match(finalPublication,/All visit tests must be completed before report publication/);
 assert.match(partialPublication,/publish_partial_report_version/);
 assert.match(partialPublication,/set_config\('app\.report_publication','partial',true\)/);
});
