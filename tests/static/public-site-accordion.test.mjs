import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const html=fs.readFileSync(path.join(root,'website/index.html'),'utf8');
const page=fs.readFileSync(path.join(root,'website/public-site-page.js'),'utf8');
const css=fs.readFileSync(path.join(root,'website/site.css'),'utf8');

test('public homepage keeps the hero visible and provides one collapsed accordion container',()=>{
  assert.match(html,/<section class="site-accordion-area" id="siteSections">/);
  assert.match(html,/<div class="site-accordion-list" id="accordionSections"><\/div>/);
  assert.doesNotMatch(html,/id="customSections"/);
  assert.match(page,/details\.className='site-accordion-item'/);
  assert.match(page,/summary\.className='site-accordion-trigger'/);
  assert.doesNotMatch(html,/<details[^>]*\sopen(?:\s|>)/);
});

test('public homepage accordion groups expose the agreed public sections',()=>{
  for(const label of ['التحاليل الطبية والخدمات','الباقات والعروض','الفروع ومواعيد العمل','السحب المنزلي','من نحن ومعلومات تهمك','تواصل معنا']) {
    assert.ok(page.includes(label),`missing accordion group: ${label}`);
  }
  assert.match(page,/if\(details\.open\)accordion\.querySelectorAll\('details\[open\]'\)/);
});

test('in-page navigation opens the relevant accordion before scrolling',()=>{
  assert.match(page,/document\.querySelectorAll\('a\[href\^="#"/);
  assert.match(page,/target\?\.closest\('details\.site-accordion-item'\)/);
  assert.match(page,/details\.open=true/);
  assert.match(page,/target\.scrollIntoView/);
});

test('accordion retains CMS content rendering and request workflows',()=>{
  for(const token of ['cards(\'offerCards\'','cards(\'packageCards\'','cards(\'articleCards\'','cards(\'faqCards\'','cards(\'branchCards\'','bindSiteRequests(data)','submit-site-request']) {
    assert.ok(page.includes(token),`missing preserved CMS workflow: ${token}`);
  }
  assert.match(page,/sectionVisibility\.has\(key\)/);
});

test('accordion is responsive and supports dark theme',()=>{
  assert.match(css,/@media\(max-width:760px\)\{[\s\S]*?\.site-accordion-area/);
  assert.match(css,/html\[data-theme="dark"\] \.site-accordion-area/);
});
