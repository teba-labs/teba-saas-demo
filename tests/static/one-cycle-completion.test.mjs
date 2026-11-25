import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('reception is a simple patient, catalog, and billing flow with a live removable cart',async()=>{
  const html=await read('app/reception.html');
  const js=await read('assets/js/reception.js');
  const css=await read('assets/css/reception.css');
  assert.match(html,/class="intake-column patient-column"/);
  assert.match(html,/class="intake-column cart-column"/);
  assert.match(html,/class="intake-column catalog-column"/);
  assert.match(html,/id="selectedTestsList"/);
  assert.ok(html.indexOf('patient-column')<html.indexOf('catalog-column'));
  assert.ok(html.indexOf('catalog-column')<html.indexOf('cart-column'));
  assert.match(js,/function renderSelectedTests\(/);
  assert.match(js,/data-remove-selected/);
  assert.match(html,/class="intake-content intake-flow"/);
  assert.match(css,/grid-template-areas:"patient patient" "catalog cart"/);
  assert.match(css,/grid-template-areas:"patient" "catalog" "cart"/);
});

test('results workbench uses three desktop sections and mobile tabs instead of stacked columns',async()=>{
  const html=await read('app/results-workbench.html');
  const layout=await read('assets/js/results-workbench-layout.js');
  const css=await read('assets/css/results-workbench.css');
  assert.match(html,/<body class="results-workbench-page">/);
  for(const tab of ['visits','individual','profiles'])assert.ok(layout.includes(`data-results-tab="${tab}"`));
  assert.match(layout,/setMobileColumn/);
  assert.match(layout,/\['panel','group'\]/);
  assert.match(css,/\.results-mobile-tabs\{display:grid/);
  assert.match(css,/\.results-workbench-page \.results-columns\{display:block!important/);
});

test('master catalog supports bulk import, groups, formula text parsing, and numeric display conditions',async()=>{
  const html=await read('app/catalog.html');
  const js=await read('assets/js/catalog.js');
  const repository=await read('modules/catalog/repository.js');
  assert.match(html,/id="importAllMasterLibrary"/);
  assert.match(html,/id="masterImportStatus"/);
  assert.match(html,/option value="group"/);
  for(const operator of ['lt','lte','gt','gte'])assert.ok(html.includes(`value="${operator}"`));
  assert.match(js,/importAllMasterLibrary/);
  assert.match(js,/موجود في المعمل/);
  assert.match(repository,/parseMasterFormulaAst/);
  assert.match(repository,/supportedOperators = \['equals','not_equals','lt','lte','gt','gte'\]/);
});

test('patient portal publishing creates the PDF from the same report preview without manual file upload',async()=>{
  const js=await read('assets/js/results-workbench.js');
  assert.match(js,/reportPreviewHtml\.set\(visitId,reportHtml\)/);
  assert.match(js,/ensureHtml2Pdf/);
  assert.match(js,/outputPdf\('blob'\)/);
  assert.match(js,/publishReportVersion\(/);
  assert.doesNotMatch(js,/data-report-file/);
});

test('core catalog migration promotes nine verified profiles, validates formulas, and seeds zero prices',async()=>{
  const migration=await read('database/migrations/109_promote_verified_profiles_enable_zero_price_and_master_import.sql');
  const links=await read('database/migrations/110_repair_taiba_master_catalog_links.sql');
  for(const code of ['HEM_CBC','UA_COMPLETE','STOOL_EXAM','HOMA_IR','IRON_PROFILE','LIPID_PROFILE','LIVER_PROFILE','PROTEIN_PROFILE','SEMEN_ANALYSIS'])assert.ok(migration.includes(code));
  assert.match(migration,/UA_CRYSTAL_TYPES/);
  assert.match(migration,/ensure_zero_base_price_for_new_test/);
  assert.match(migration,/import_master_catalog_test_unchecked/);
  assert.match(migration,/jsonb_path_query/);
  assert.match(links,/Expected nine repaired source-profile links/);
});
