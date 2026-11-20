import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const js=fs.readFileSync(new URL('assets/js/results-workbench.js',root),'utf8');
const settings=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8');
const html=fs.readFileSync(new URL('app/settings.html',root),'utf8');

test('report groups all individual tests together and renders every panel as its own page',()=>{
 assert.match(js,/individualHtml = testSections\.filter\(section => section\.kind !== 'panel'\)/);
 assert.match(js,/profileHtml = testSections\.filter\(section => section\.kind === 'panel'\)/);
 assert.match(js,/profile-report/);
 assert.match(js,/groupedTestSections/);
});

test('print settings include configurable three-zone header, footer, logo source and watermark',()=>{
 for(const id of ['printIdentitySide','printLogoSource','printShowBranchAddresses','printShowContacts','printWebsiteUrl','printSupportUrl','printFooterCenterMode','printWatermarkMode','printWatermarkOpacity','printWatermarkSize','printWatermarkPosition']) assert.ok(html.includes('id="'+id+'"'),id);
 for(const key of ['identitySide','logoSource','showBranchAddresses','showContacts','websiteUrl','supportUrl','footerCenterMode','watermarkMode','watermarkOpacity','watermarkSize','watermarkPosition']) assert.ok(settings.includes(key),key);
 assert.match(js,/header-grid/);
 assert.match(js,/footer-right/);
 assert.match(js,/footer-left/);
 assert.match(js,/watermark-text/);
 assert.match(js,/تم إجراء التحاليل بفرع/);
});

test('print settings persist and reload the newly added options as structured JSON',()=>{
 assert.match(settings,/watermarkOpacity:/);
 assert.match(settings,/savePrintSettings\(\{tenantId:state\.tenant\.id,branchId:\$\('printBranch'\)\.value\|\|null,settings\}\)/);
 assert.match(settings,/printWatermarkOpacity/);
});
