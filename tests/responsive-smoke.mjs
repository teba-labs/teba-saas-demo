import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json',
  '.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const decoded = decodeURIComponent(url.pathname);
    const file = path.resolve(root, '.' + decoded);
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error('path traversal');
    const target = (await stat(file)).isDirectory() ? path.join(file, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, {'content-type': mime[path.extname(target)] || 'application/octet-stream','cache-control':'no-store'});
    res.end(body);
  } catch {
    res.writeHead(404, {'content-type':'text/plain; charset=utf-8'});
    res.end('Not found');
  }
});
await new Promise(resolve => server.listen(4178, '127.0.0.1', resolve));

const routes = [
  '/app/index.html','/app/reception.html','/app/workday.html',
  '/app/results-workbench.html','/app/result-entry.html','/app/sync-center.html',\n  '/app/catalog.html','/app/dashboard.html','/app/settings.html','/app/cms-editor.html',\n  '/app/site-management.html','/app/site-preview.html','/app/data-import.html','/app/platform-admin.html','/portal/index.html'
];
const devices = [
  {name:'Android small 360x800',width:360,height:800,isMobile:true},
  {name:'Android Pixel 412x915',width:412,height:915,isMobile:true},
  {name:'iPhone SE 375x667',width:375,height:667,isMobile:true},
  {name:'iPhone large 430x932',width:430,height:932,isMobile:true},
  {name:'Tablet 768x1024',width:768,height:1024,isMobile:true},
  {name:'Desktop 1366x900',width:1366,height:900,isMobile:false}
];
let failures = [];
const browser = await chromium.launch({headless:true});
try {
  for (const device of devices) {
    const context = await browser.newContext({
      viewport:{width:device.width,height:device.height},
      deviceScaleFactor:device.isMobile?2:1,
      isMobile:device.isMobile,
      hasTouch:device.isMobile,
      serviceWorkers:'block'
    });
    for (const route of routes) {
      const page = await context.newPage();
      try {
        await page.goto('http://127.0.0.1:4178' + route, {waitUntil:'domcontentloaded',timeout:30000});
        if (route === '/app/index.html' || route === '/app/reception.html') {\n          const email = page.locator('#email');\n          const password = page.locator('#password');\n          if (await email.count()) await email.fill('responsive-smoke@example.invalid');\n          if (await password.count()) await password.fill('not-a-real-password');\n          if (await email.count() && await email.inputValue() !== 'responsive-smoke@example.invalid') failures.push(`${device.name} ${route}: email field did not accept input`);\n          if (await password.count() && await password.inputValue() !== 'not-a-real-password') failures.push(`${device.name} ${route}: password field did not accept input`);\n        }\n        const result = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          const scroll = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
          const viewport = document.querySelector('meta[name="viewport"]')?.content || '';
          const controls = [...document.querySelectorAll('input,select,textarea,button')].filter(el => {
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length;
          });
          const overflowing = controls.filter(el => {
            const r = el.getBoundingClientRect();
            return r.left < -1 || r.right > width + 1;
          }).slice(0,5).map(el => el.id || el.tagName.toLowerCase());
          return {width,scroll,viewport,overflowing,title:document.title};
        });
        if (!result.viewport.includes('width=device-width')) failures.push(`${device.name} ${route}: missing responsive viewport meta`);
        if (result.scroll > result.width + 1) failures.push(`${device.name} ${route}: horizontal page overflow ${result.scroll}>${result.width}`);
        if (result.overflowing.length) failures.push(`${device.name} ${route}: controls outside viewport: ${result.overflowing.join(',')}`);
        if (!result.title) failures.push(`${device.name} ${route}: missing document title`);
      } catch (error) {
        failures.push(`${device.name} ${route}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
    await context.close();
  }
  const pwaContext = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
  const pwaPage = await pwaContext.newPage();
  try {
    await pwaPage.goto('http://127.0.0.1:4178/app/index.html',{waitUntil:'domcontentloaded',timeout:30000});
    const manifest = await pwaPage.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      if (!link) return null;
      const response = await fetch(link.href);
      return response.ok ? response.json() : null;
    });
    if (!manifest || manifest.display !== 'standalone') failures.push('PWA: manifest is not reachable or is not standalone');
    await pwaPage.evaluate(async () => { await navigator.serviceWorker.ready; return true; });
    await pwaPage.reload({waitUntil:'domcontentloaded'});
    await pwaPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {timeout:30000});
    const cacheCheck = await pwaPage.evaluate(async () => {
      const names = await caches.keys();
      const name = names.find(value => value === 'taiba-smart-lab-shell-v104');
      if (!name) return {name:null,manifest:false,icon:false};
      const cache = await caches.open(name);
      return {
        name,
        manifest:Boolean(await cache.match(new URL('./manifest.webmanifest',location.href).href)),
        icon:Boolean(await cache.match(new URL('./icons/icon-192.svg',location.href).href))
      };
    });
    if (!cacheCheck.name || !cacheCheck.manifest || !cacheCheck.icon) failures.push('PWA: active service worker cache is missing the manifest or local icon');
    await pwaContext.setOffline(true);
    await pwaPage.goto('http://127.0.0.1:4178/app/reception.html',{waitUntil:'domcontentloaded',timeout:20000});
    if (!(await pwaPage.title()).includes('Taiba Smart Lab')) failures.push('PWA: cached reception page did not open while offline');
  } catch (error) {
    failures.push(`PWA/offline smoke: ${error.message}`);
  } finally {
    try { await pwaContext.setOffline(false); } catch {}
    await pwaContext.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
if (failures.length) {
  console.error('Responsive smoke failures:\\n' + failures.join('\\n'));
  process.exitCode = 1;
} else {
  console.log(`Responsive smoke passed: ${routes.length} routes x ${devices.length} emulated viewports = ${routes.length*devices.length} page checks.`);
}
