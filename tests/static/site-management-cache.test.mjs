import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');

test('site management workspace is linked from the owner home and included in the offline app shell',()=>{
 const home=read('app/index.html');
 const page=read('app/site-management.html');
 const worker=read('service-worker.js');
 assert.match(home,/href="site-management\.html"/);
 assert.match(page,/site-management\.css/);
 assert.match(page,/site-management\.js/);
 for(const asset of ['./app/site-management.html','./assets/css/site-management.css','./assets/js/site-management.js']) assert.ok(worker.includes(asset),asset);
 assert.match(worker,/taiba-smart-lab-shell-v33/);
});
