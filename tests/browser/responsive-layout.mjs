import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'artifacts','responsive-zoom');
await mkdir(output,{recursive:true});
const pages=[
  'app/index.html','app/dashboard.html','app/settings.html','app/catalog.html',
  'app/data-import.html','app/reception.html','app/results-workbench.html',
  'app/result-entry.html','app/workday.html','app/cms-editor.html',
  'app/platform-admin.html','app/site-management.html','app/site-preview.html',
  'app/sync-center.html','portal/index.html','website/index.html'
];
const viewports=[
  {width:1708,label:'zoom-80'},
  {width:1518,label:'zoom-90'},
  {width:1366,label:'zoom-100'},
  {width:1093,label:'zoom-125'},
  {width:911,label:'zoom-150'},
  {width:683,label:'zoom-200'},
  {width:390,label:'mobile-390'}
];
const mime={
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json','.svg':'image/svg+xml','.png':'image/png',
  '.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'
};
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const relative=pathname==='/'?'app/index.html':pathname.replace(/^\/+/, '');
    const file=path.resolve(root,relative);
    assert.ok(file===root||file.startsWith(root+path.sep),'path escaped repository');
    const body=await readFile(file);
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});
    res.end(body);
  }catch(error){res.writeHead(404);res.end(String(error));}
});
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
let browser;
let checked=0;
const failures=[];
try{
  browser=await chromium.launch({headless:true});
  for(const pagePath of pages){
    const page=await browser.newPage({viewport:{width:1366,height:960}});
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='127.0.0.1'||url.hostname==='localhost') return route.continue();
      return route.abort();
    });
    await page.goto('http://127.0.0.1:4173/'+pagePath,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      document.querySelectorAll('[hidden]').forEach(element=>element.removeAttribute('hidden'));
      document.documentElement.style.scrollBehavior='auto';
    });
    for(const viewport of viewports){
      await page.setViewportSize({width:viewport.width,height:960});
      await page.waitForTimeout(25);
      const result=await page.evaluate(()=>{
        const width=window.innerWidth;
        const documentWidth=document.documentElement.scrollWidth;
        const bodyWidth=document.body.scrollWidth;
        const offenders=[];
        for(const element of document.body.querySelectorAll('*')){
          if(['SCRIPT','STYLE','LINK','META','TITLE'].includes(element.tagName)) continue;
          const style=getComputedStyle(element);
          if(style.display==='none'||style.visibility==='hidden'||style.position==='fixed') continue;
          const rect=element.getBoundingClientRect();
          if(rect.width<1||rect.height<1) continue;
          let parent=element.parentElement;
          let insideScroller=false;
          while(parent&&parent!==document.body){
            const overflow=getComputedStyle(parent).overflowX;
            if(overflow==='auto'||overflow==='scroll'){insideScroller=true;break;}
            parent=parent.parentElement;
          }
          if(!insideScroller&&(rect.left < -1 || rect.right > width+1)){
            offenders.push({tag:element.tagName,cls:typeof element.className==='string'?element.className:'',id:element.id,left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)});
          }
        }
        return {width,documentWidth,bodyWidth,offenders:offenders.slice(0,12)};
      });
      checked++;
      if(result.documentWidth>result.width+1||result.bodyWidth>result.width+1||result.offenders.length){
        failures.push({page:pagePath,viewport:viewport.label,...result});
      }
      if([1366,1093,390].includes(viewport.width)){
        const fileName=pagePath.replaceAll('/','__').replace('.html','')+'__'+viewport.label+'.png';
        await page.screenshot({path:path.join(output,fileName),fullPage:true,animations:'disabled'});
      }
    }
    await page.close();
  }
}finally{
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({pages:pages.length,viewports:viewports.length,checks:checked,screenshots:pages.length*3,failures},null,2));
assert.equal(failures.length,0,'Responsive viewport overflow detected. Inspect the responsive-zoom screenshot artifact.');
