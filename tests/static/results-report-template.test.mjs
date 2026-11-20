import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const js=fs.readFileSync(new URL('assets/js/results-workbench.js',root),'utf8');
const settings=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8');
const html=fs.readFileSync(new URL('app/settings.html',root),'utf8');

test('report groups all individual tests together and renders every panel as its own page',()=>{
 for(const value of ["individualHtml = testSections.filter(section => section.kind !== 'panel')","profileHtml = testSections.filter(section => section.kind === 'panel')",'profile-report','groupedTestSections']) assert.ok(js.includes(value),value);
});

test('print settings include configurable three-zone header, footer, logo source and watermark',()=>{
 for(const id of ['printIdentitySide','printLogoSource','printShowBranchAddresses','printShowContacts','printWebsiteUrl','printSupportUrl','printFooterCenterMode','printWatermarkMode','printWatermarkOpacity','printWatermarkSize','printWatermarkPosition']) assert.ok(html.includes('id="'+id+'"'),id);
 for(const key of ['identitySide','logoSource','showBranchAddresses','showContacts','websiteUrl','supportUrl','footerCenterMode','watermarkMode','watermarkOpacity','watermarkSize','watermarkPosition']) assert.ok(settings.includes(key),key);
 for(const value of ['header-grid','footer-right','footer-left','watermark-text','تم إجراء التحاليل بفرع','header.report-header{position:fixed','footer{position:fixed','footerGridColumns']) assert.ok(js.includes(value),value);
});

test('print settings persist and reload the newly added options as structured JSON',()=>{
 assert.ok(settings.includes('watermarkOpacity:'));
 assert.ok(settings.includes('savePrintSettings'));
 assert.ok(settings.includes('printWatermarkOpacity'));
 assert.ok(js.includes('canPrint ?'));
 assert.ok(js.includes('اعتمد الزيارة أولًا للطباعة'));
 assert.ok(js.includes('state.previewedVisits.has(visitId)'));
 assert.ok(js.includes('computeReferenceFlag'));
 assert.ok(js.includes('result.reference_range_snapshot ?? parameter.reference_ranges'));
 assert.ok(js.includes('لم تُحفظ بعد'));
 assert.ok(js.includes('taibaGetDirtyResultInputs'));
 assert.ok(js.includes('قبل نشر التقرير'));
});
