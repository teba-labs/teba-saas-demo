import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root=new URL('../../',import.meta.url);
const module=await readFile(new URL('modules/ui/keyboard-navigation.js',root),'utf8');
const sw=await readFile(new URL('service-worker.js',root),'utf8');
const pages=['catalog','cms-editor','dashboard','data-import','index','platform-admin','reception','results-workbench','settings','sync-center','workday'];

test('shared keyboard navigation is loaded on every application screen',async()=>{
  for(const page of pages){
    const html=await readFile(new URL('app/'+page+'.html',root),'utf8');
    assert.match(html,/modules\/ui\/keyboard-navigation\.js/,page);
  }
  assert.match(module,/event\.key === 'Enter'/);
  assert.match(module,/ArrowDown/);
  assert.match(module,/ArrowUp/);
  assert.match(module,/Home/);
  assert.match(module,/End/);
  assert.match(module,/data-keyboard-native/);
  assert.ok(sw.includes('./modules/ui/keyboard-navigation.js'));
  assert.match(sw,/taiba-smart-lab-shell-v26/);
});
