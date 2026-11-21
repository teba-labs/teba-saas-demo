import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const html=readFileSync(new URL('app/site-management.html',root),'utf8');
const js=readFileSync(new URL('assets/js/site-management.js',root),'utf8');
const home=readFileSync(new URL('app/index.html',root),'utf8');
test('patient portal management remains separate from the owner website studio',()=>{
 assert.match(js,/accountType==='owner'/);assert.match(home,/cms-editor\.html/);assert.match(html,/portal\/index\.html/);assert.match(html,/id="publication"/);
 assert.doesNotMatch(html,/cms-editor\.html/);
});
test('publication monitor is tenant-scoped, read-only, and bounded to latest 100 visits',()=>{
 assert.match(js,/\.eq\('tenant_id',state\.tenant\.id\)/);assert.match(js,/\.limit\(100\)/);assert.doesNotMatch(js,/\.update\(.*is_published/s);
});
test('patient portal management does not expose cross-tenant patient records or modify publication state',()=>{
 assert.match(js,/from\('patients'\).*\.eq\('tenant_id',state\.tenant\.id\)/s);assert.doesNotMatch(js,/from\('test_results'\)/);
});
