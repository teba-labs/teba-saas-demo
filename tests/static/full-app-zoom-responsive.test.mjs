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

test('shared responsive layer overrides page-specific fixed grids at desktop zoom and tablet widths',async()=>{
  const css=await read('assets/css/app-viewport.css');
  for(const selector of ['body .login-layout','body .layout','body .workspace-context','body .selectors','body .filters','body .form-grid','body .fields','body .results-columns','body .studio-nav','body .modules','body .kpis','body .tiles','body .totals','body .table-wrap']){
    assert.ok(css.includes(selector),'missing shared responsive override: '+selector);
  }
  for(const breakpoint of ['1100px','900px','700px','520px','360px']){
    assert.ok(css.includes('max-width:'+breakpoint),'missing viewport breakpoint '+breakpoint);
  }
  assert.match(css,/grid-template-columns:repeat\(auto-fit,minmax/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/flex-wrap:wrap/);
});

test('results workbench keeps its three-column desktop desk and collapses at tablet widths',async()=>{
  const css=await read('assets/css/app-viewport.css');
  assert.match(css,/body \.results-columns\{\s*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*?body :is\(\.layout,\.identity-layout,\.collection-layout,\.workspace-context,\.results-columns\)\{grid-template-columns:minmax\(0,1fr\)\}/);
});
