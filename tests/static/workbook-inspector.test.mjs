import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('archive preflight is owner-only, local-only and linked from settings',()=>{
 const html=read('app/data-import.html'),js=read('assets/js/data-import.js'),inspector=read('modules/migration/workbook-inspector.js'),settings=read('app/settings.html');
 assert.match(html,/مرحلة الفحص فقط/);
 assert.match(html,/لا يتم رفع محتوى الملف/);
 assert.match(js,/accountType==='owner'/);
 assert.match(js,/inspectWorkbookFile/);
 assert.match(js,/headerRowSelect/);
 assert.doesNotMatch(js,/tenantSelect/);
 assert.match(js,/replaceChildren/);
 assert.match(inspector,/workbook\.SheetNames\.map/);
 assert.match(inspector,/sha256/);
 assert.match(inspector,/20 \* 1024 \* 1024/);
 assert.match(settings,/data-import\.html/);
 assert.doesNotMatch(inspector,/fetch\(|\.from\(['"]|\.rpc\(/);
});
