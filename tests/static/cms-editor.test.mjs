import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const html=fs.readFileSync(path.join(root,'app/cms-editor.html'),'utf8');
const js=fs.readFileSync(path.join(root,'assets/js/cms-editor.js'),'utf8');
const css=fs.readFileSync(path.join(root,'assets/css/cms-editor.css'),'utf8');

test('CMS editor includes all eight tenant-owned website collections',()=>{
 for(const name of ['sections','tests','packages','articles','faqs','testimonials','offers','branches']) assert.match(js,new RegExp(`${name}:\\{title:`));
 assert.match(js,/listCmsItems/);assert.match(js,/saveCmsItem/);assert.match(js,/setCmsItemVisibility/);
});
test('CMS editor requires owner membership and uses tenant-scoped repository methods',()=>{
 assert.match(js,/accountType==='owner'/);assert.match(js,/tenantId:state\.tenant\.id/);
 assert.match(js,/getCmsSettings/);assert.match(js,/saveCmsSettings/);
});
test('CMS editor keeps publication separate from operational catalog and patient data',()=>{
 assert.match(html,/المحتوى والأسعار المعروضة على الموقع مستقلة عن أسعار التشغيل/);
 assert.match(js,/is_published/);assert.doesNotMatch(js,/from\(['"]patients|from\(['"]visits|from\(['"]test_results/);
});
test('CMS editor escapes database content before rendering list labels',()=>{
 assert.match(js,/const esc = value =>/);assert.match(js,/esc\(title\)/);assert.match(js,/esc\(detail\)/);
});
test('CMS editor validates JSON and key public fields before save',()=>{
 assert.match(js,/JSON\.parse\(input\.value/);assert.match(js,/الرابط المختصر يجب/);assert.match(js,/نسبة الخصم يجب/);
});
test('CMS editor assets and navigation controls are present',()=>{
 assert.match(html,/cms-editor\.css/);assert.match(html,/cms-editor\.js/);
 for(const id of ['tenantSelect','collectionSelect','itemsList','itemForm','publicContent','themeJson','togglePublish']) assert.match(html,new RegExp(`id="${id}"`));
 assert.ok(css.length>1000);
});
