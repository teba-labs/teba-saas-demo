import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

const pages=[
  'app/index.html','app/dashboard.html','app/settings.html','app/catalog.html',
  'app/data-import.html','app/reception.html','app/results-workbench.html',
  'app/result-entry.html','app/workday.html','app/cms-editor.html',
  'app/platform-admin.html','app/site-management.html','app/site-preview.html',
  'app/sync-center.html','portal/index.html','website/index.html'
];

test('every application, portal and public-site page loads the shared viewport layer after its page stylesheet',async()=>{
  for(const path of pages){
    const html=await read(path);
    assert.match(html,/<meta[^>]+name=["']viewport["'][^>]+width=device-width/i, path+' must declare a device-width viewport');
    const sharedCss=html.indexOf('app-viewport.css');
    assert.notEqual(sharedCss,-1,path+' must load app-viewport.css');
    const localCss=[...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)]
      .map(match=>match[1]).filter(href=>!href.includes('app-viewport.css'));
    if(localCss.length){
      const firstLocal=html.indexOf(localCss[0]);
      assert.ok(sharedCss>firstLocal,path+' must load shared responsive rules after its page stylesheet');
    }
  }
});

test('shared viewport layer preserves page-owned grids and only adapts generic card collections',async()=>{
  const css=await read('assets/css/app-viewport.css');
  for(const selector of ['.apps-grid','.owner-links','.owner-report-grid','.modules','.cards','.table-wrap']){
    assert.ok(css.includes(selector),'missing safe shared selector: '+selector);
  }
  for(const breakpoint of ['1099px','767px','420px']){
    assert.ok(css.includes('max-width:'+breakpoint),'missing safe viewport breakpoint '+breakpoint);
  }
  assert.match(css,/grid-template-columns:repeat\(auto-fit,minmax/);
  assert.match(css,/overflow-x:auto/);
  assert.doesNotMatch(css,/\.layout\s*\{|\.form-grid\s*\{|\.results-columns\s*\{/,
    'shared viewport CSS must not overwrite page-specific workbench grids');
});

test('results workbench owns its three-column desktop and mobile tab layout',async()=>{
  const pageCss=await read('assets/css/results-workbench.css');
  assert.match(pageCss,/\.results-workbench-page \.results-columns\{display:grid;grid-template-columns:minmax\(210px/);
  assert.match(pageCss,/@media\(max-width:760px\)[\s\S]*?\.results-workbench-page \.results-columns\{grid-template-columns:1fr\}/);
  assert.match(pageCss,/\.results-mobile-tabs\{display:grid/);
  assert.match(pageCss,/\.results-workbench-page \.results-columns\{display:block!important/);
});
