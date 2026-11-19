import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [ui,importer,repoSource,migration,sw,html]=await Promise.all([
 read('assets/js/data-import.js'),
 read('modules/migration/price-importer.js'),
 read('modules/catalog/repository.js'),
 read('database/migrations/014_branch_specific_test_prices.sql'),
 read('service-worker.js'),
 read('app/data-import.html')
]);
assert.match(ui,/importNewBasePrices/);
assert.match(ui,/listCurrentBasePrices,addBasePriceIfMissing/);
assert.match(ui,/async function importBasePricesSheet/);
assert.match(ui,/const fields=getEntityFields\\(s\\.entityType\\)/);
assert.match(ui,/fieldKey==='price'/);
assert.match(ui,/navigator\.onLine===false/);
assert.match(ui,/لا يتغير سعر قائم أو سعر خاص بفرع/);
assert.match(importer,/current-base-price-exists/);
assert.match(importer,/branch_id==null/);
assert.match(importer,/أكواد أسعار لا تطابق تحاليل نشطة/);
assert.match(importer,/كود مكرر داخل ملف Excel/);
assert.doesNotMatch(importer,/\.update\(|\.upsert\(/);
assert.match(repoSource,/export async function listCurrentBasePrices/);
assert.match(repoSource,/export async function addBasePriceIfMissing/);
assert.match(repoSource,/\.is\('branch_id', null\)/);
assert.match(repoSource,/\.insert\(\{/);
assert.match(repoSource,/error\.code === '23505'/);
assert.match(repoSource,/scope: 'base'/);
assert.match(migration,/uq_test_prices_current_base/);
assert.match(migration,/uq_test_prices_current_branch/);
assert.match(sw,/taiba-smart-lab-shell-v9/);
assert.match(sw,/modules\/migration\/price-importer\.js/);
assert.match(html,/أسعار البيع العامة/);
console.log('PASS: base-price importer is insert-only, owner-repository scoped, branch-override-safe and cached in shell v9.');
