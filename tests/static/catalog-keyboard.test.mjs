import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const catalog=await readFile(new URL('assets/js/catalog.js',root),'utf8');
const html=await readFile(new URL('app/catalog.html',root),'utf8');

test('catalog forms support keyboard-first Enter and arrow navigation',()=>{
  assert.match(catalog,/installCatalogKeyboardNavigation/);
  assert.match(catalog,/event\.key==='Enter'/);
  assert.match(catalog,/event\.key==='ArrowDown'\|\|event\.key==='ArrowUp'/);
  assert.match(catalog,/bindList\('testList'/);
  assert.match(catalog,/bindList\('masterCatalogList'/);
  assert.match(catalog,/bindList\('parameterList'/);
  assert.match(html,/id="masterCatalogSearch"/);
  assert.match(html,/id="testForm"/);
  assert.match(html,/id="parameterForm"/);
});
