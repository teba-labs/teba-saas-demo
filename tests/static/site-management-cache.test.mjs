import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');

test('website studio and patient portal workspaces are linked from the owner home and cached',()=>{
 const home=read('app/index.html');
 const page=read('app/site-management.html');
 const worker=read('service-worker.js');
 assert.match(home,/href="cms-editor\.html"/);
 assert.match(home,/href="site-management\.html"/);
 assert.match(page,/site-management\.css/);
 assert.match(page,/site-management\.js/);
 for(const asset of ['./app/site-management.html','./assets/css/site-management.css','./assets/js/site-management.js','./app/cms-editor.html','./assets/css/cms-editor.css','./assets/js/cms-editor.js','./website/index.html','./website/public-site-page.js']) assert.ok(worker.includes(asset),asset);
 assert.match(worker,/taiba-smart-lab-shell-v\d+/);
});
