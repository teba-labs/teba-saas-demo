import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const html=readFileSync(path.join(root,'website/index.html'),'utf8');
const js=readFileSync(path.join(root,'website/public-site-page.js'),'utf8');
const css=readFileSync(path.join(root,'website/site.css'),'utf8');
const ui=readFileSync(path.join(root,'website/public-site-ui.js'),'utf8');
const workflow=readFileSync(path.join(root,'.github/workflows/public-website-preview.yml'),'utf8');

test('public website uses the approved Taiba premium design system',()=>{
  assert.match(html,/family=Almarai/);
  assert.match(css,/#0a6847/);
  assert.match(css,/#eab308/);
  assert.match(css,/data-theme="dark"/);
  assert.match(css,/@media\(max-width:720px\)/);
});
test('homepage does not render or link to the medical test catalog',()=>{
  assert.doesNotMatch(html,/id="tests"|href="#tests"|testCards/);
  assert.doesNotMatch(js,/cards\('testCards'/);
  assert.match(js,/x\.section_key!=='tests'/);
});
test('public site keeps CMS content and patient portal entry points',()=>{
  for(const id of ['heroTitle','servicesTextPublic','packageCards','articleCards','faqCards','branchCards','contactDetails','patientAccess']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(js,/loadPublishedSite/);
  assert.match(js,/portal\/index\.html\?lab=/);
});
test('mobile navigation and patient access controls are interactive',()=>{
  assert.match(html,/id="mobileMenuToggle"/);
  assert.match(ui,/classList\.toggle\('is-open'\)/);
  assert.match(ui,/showModal\(\)/);
  assert.match(ui,/close\(\)/);
});
test('preview deployment uses GitHub Pages from main without Netlify credentials',()=>{
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/actions\/deploy-pages@v4/);
  assert.match(workflow,/enablement: true/);
  assert.doesNotMatch(workflow,/NETLIFY_|netlify-cli/);
});
