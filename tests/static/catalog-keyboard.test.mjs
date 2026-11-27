import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const module=await readFile(new URL('modules/ui/keyboard-navigation.js',root),'utf8');
const sw=await readFile(new URL('service-worker.js',root),'utf8');
const css=await readFile(new URL('assets/css/app-viewport.css',root),'utf8');

test('shared keyboard navigation is loaded on every application and patient-portal screen',async()=>{
  const pages=(await readdir(new URL('app/',root))).filter(name=>name.endsWith('.html'));
  assert.ok(pages.length>=14,'expected all application pages to be covered');
  for(const page of pages){
    const html=await readFile(new URL('app/'+page,root),'utf8');
    assert.match(html,/modules\/ui\/keyboard-navigation\.js/,page);
  }
  const portal=await readFile(new URL('portal/index.html',root),'utf8');
  assert.match(portal,/modules\/ui\/keyboard-navigation\.js/);
  const website=await readFile(new URL('website/index.html',root),'utf8');
  assert.match(website,/modules\/ui\/keyboard-navigation\.js/);
});

test('shared keyboard handler covers form flow, list movement, tabs, Space and Escape',()=>{
  assert.match(module,/event\.key === 'Enter'/);
  assert.match(module,/event\.key === 'Escape'/);
  assert.match(module,/event\.key === ' '/);
  assert.match(module,/ArrowDown/);
  assert.match(module,/ArrowUp/);
  assert.match(module,/ArrowLeft/);
  assert.match(module,/ArrowRight/);
  assert.match(module,/Home/);
  assert.match(module,/End/);
  assert.match(module,/data-keyboard-native/);
  assert.match(module,/setAttribute\('role', 'tablist'\)/);
  assert.match(module,/dialog\.close\(\)/);
  assert.ok(sw.includes('./modules/ui/keyboard-navigation.js'));
  assert.match(sw,/taiba-smart-lab-shell-v92/);
  assert.match(css,/:focus-visible/);
});

test('CMS navigation groups are exposed as keyboard-operable tablists',async()=>{
  const html=await readFile(new URL('app/cms-editor.html',root),'utf8');
  assert.match(html,/class="studio-nav" data-keyboard-tabs="views"/);
  assert.equal((html.match(/data-keyboard-tabs="subtabs"/g)||[]).length,2);
});

test('public website menu closes and restores focus with Escape',async()=>{
  const ui=await readFile(new URL('website/public-site-ui.js',root),'utf8');
  assert.match(ui,/event\.key !== 'Escape'/);
  assert.match(ui,/menu\?\.focus\(\)/);
});
