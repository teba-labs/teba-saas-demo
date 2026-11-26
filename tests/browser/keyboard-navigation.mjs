import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pages=[
  'app/index.html','app/dashboard.html','app/settings.html','app/catalog.html',
  'app/data-import.html','app/reception.html','app/results-workbench.html',
  'app/result-entry.html','app/workday.html','app/cms-editor.html',
  'app/platform-admin.html','app/site-management.html','app/site-preview.html',
  'app/sync-center.html','portal/index.html','website/index.html'
];
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const file=path.resolve(root,pathname.slice(1));
    assert.ok(file.startsWith(root+path.sep),'path escaped repository');
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});
    res.end(await readFile(file));
  }catch(error){res.writeHead(404);res.end(String(error));}
});
await new Promise(resolve=>server.listen(4174,'127.0.0.1',resolve));
let browser;
const failures=[];
try{
  browser=await chromium.launch({headless:true});
  for(const pagePath of pages){
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='127.0.0.1'||url.hostname==='localhost') return route.continue();
      return route.abort();
    });
    await page.goto('http://127.0.0.1:4174/'+pagePath,{waitUntil:'load',timeout:60000});
    const loaded=await page.locator('script[src*="keyboard-navigation.js"]').count();
    assert.equal(loaded,1,pagePath+': shared keyboard module missing');

    const visibleFocusables=await page.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])').evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length>0&&!el.hidden&&getComputedStyle(el).visibility!=='hidden').length);
    if(visibleFocusables){
      await page.keyboard.press('Tab');
      await page.evaluate(()=>document.activeElement.setAttribute('data-kb-first-focus','true'));
      const firstFocused=await page.evaluate(()=>document.activeElement!==document.body&&document.activeElement.getClientRects().length>0);
      assert.ok(firstFocused,pagePath+': Tab did not focus a visible control');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const reverseFocused=await page.locator('[data-kb-first-focus]:focus').count();
      assert.equal(reverseFocused,1,pagePath+': Shift+Tab did not restore focus to the previous control');
    }

    await page.evaluate(()=>{
      document.querySelectorAll('#workspace[hidden]').forEach(el=>{el.hidden=false;});
      document.querySelectorAll('#loginPanel').forEach(el=>{el.hidden=true;});
    });
    const tabGroups=page.locator('[role="tablist"]');
    for(let groupIndex=0;groupIndex<await tabGroups.count();groupIndex++){
      const group=tabGroups.nth(groupIndex);
      if(!(await group.isVisible())) continue;
      const tabs=group.locator('[role="tab"]:visible');
      if(await tabs.count()<2) continue;
      const rtl=await group.evaluate(el=>getComputedStyle(el).direction==='rtl');
      await tabs.nth(0).focus();
      await page.keyboard.press(rtl?'ArrowLeft':'ArrowRight');
      assert.equal(await tabs.nth(1).evaluate(el=>el===document.activeElement),true,pagePath+': arrow key did not move between actual page tabs');
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'true',pagePath+': actual page tab was not activated by arrow key');
    }

    await page.evaluate(()=>{
      const fixture=document.createElement('section');
      fixture.id='keyboard-qa-fixture';
      fixture.innerHTML=`
        <form id="kb-form"><input id="kb-first" type="text"><input id="kb-second" type="text"><button id="kb-submit" type="submit">Save</button></form>
        <div id="kb-list" role="listbox"><button id="kb-option-one" role="option">One</button><button id="kb-option-two" role="option">Two</button></div>
        <div id="kb-tabs" role="tablist" dir="rtl"><button id="kb-tab-one" role="tab" aria-selected="true">One</button><button id="kb-tab-two" role="tab" aria-selected="false">Two</button></div>
        <div id="kb-space" role="button" tabindex="0">Space action</div>
        <button id="kb-open" type="button" aria-controls="kb-dialog">Open dialog</button>
        <dialog id="kb-dialog"><input id="kb-dialog-input"><button type="button">Close</button></dialog>
        <details id="kb-details" open><summary id="kb-summary">Details</summary><input id="kb-details-input"></details>`;
      document.body.append(fixture);
      document.getElementById('kb-form').addEventListener('submit',event=>{event.preventDefault();event.currentTarget.dataset.submitted='yes';});
      document.getElementById('kb-space').addEventListener('click',event=>{event.currentTarget.dataset.clicked='yes';});
    });

    await page.locator('#kb-first').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kb-second',pagePath+': Enter did not advance to the next form field');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#kb-form').getAttribute('data-submitted'),'yes',pagePath+': Enter did not submit the completed form');

    await page.locator('#kb-first').focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kb-first',pagePath+': ArrowUp stole focus from a text input');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kb-first',pagePath+': ArrowDown stole focus from a text input');

    await page.locator('#kb-option-one').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kb-option-two',pagePath+': ArrowDown did not move within a list');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kb-option-one',pagePath+': Home did not move to the first list item');

    await page.locator('#kb-tab-one').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kb-tab-two',pagePath+': RTL tab ArrowLeft did not move to the next tab');
    assert.equal(await page.locator('#kb-tab-two').getAttribute('aria-selected'),'true',pagePath+': arrow navigation did not activate the selected tab');

    await page.locator('#kb-space').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#kb-space').getAttribute('data-clicked'),'yes',pagePath+': Enter did not activate a custom button');
    await page.locator('#kb-space').evaluate(el=>el.removeAttribute('data-clicked'));
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#kb-space').getAttribute('data-clicked'),'yes',pagePath+': Space did not activate a custom button');

    await page.locator('#kb-open').click();
    await page.locator('#kb-dialog').evaluate(dialog=>dialog.showModal());
    await page.locator('#kb-dialog-input').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#kb-dialog').evaluate(dialog=>dialog.open),false,pagePath+': Escape did not close a dialog');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kb-open',pagePath+': Escape did not restore focus to dialog trigger');

    await page.locator('#kb-details-input').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#kb-details').evaluate(details=>details.open),false,pagePath+': Escape did not close an open details section');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'kb-summary',pagePath+': Escape did not focus the details summary');

    await page.close();
  }
}catch(error){
  failures.push(error.stack||String(error));
}finally{
  if(browser) await browser.close();
  server.close();
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log('Keyboard QA passed: '+pages.length+' pages; Enter, Tab/Shift+Tab, arrows, Home, Space, Escape, dialogs, lists and form flow.');
