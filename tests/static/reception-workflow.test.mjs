import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('reception intake captures age value and unit and generates patient and visit references', () => {
  const html = read('app/reception.html');
  const js = read('assets/js/reception.js');
  const repository = read('modules/reception/repository.js');
  const migration = read('database/migrations/055_patient_age_units.sql');
  assert.match(html, /id="patientAgeUnit"/);
  assert.match(html, /id="patientSex" required/);
  assert.match(html, /id="patientNumberPreview" readonly/);
  assert.match(html, /id="visitNumber" readonly/);
  assert.match(html, /id="visitDate" readonly/);
  assert.doesNotMatch(html, /for="patientAddress"|id="patientAddress"/);
  assert.match(js, /focusNewPatient|patientName/);
  assert.match(js, /ageValue:age,ageUnit:unit/);
  assert.match(repository, /age_value: ageValue, age_unit: ageUnit/);
  assert.match(repository, /patient_number: patient\.patientNumber \?\? referenceCode\('P'\)/);
  assert.match(migration, /age_unit in \('days','months','years'\)/);
});

test('reception allows zero-price catalog tests without granting staff price-edit permissions', () => {
  const js = read('assets/js/reception.js');
  const catalogRenderer = js.slice(js.indexOf('function renderCatalog()'), js.indexOf('async function saveQuickCatalogPrice'));
  assert.match(catalogRenderer, /data-test=.*aria-label/);
  assert.doesNotMatch(catalogRenderer, /\$\{!price\?'disabled'/);
  assert.match(catalogRenderer, /price\?\.selling_price\?\?0/);
  assert.match(catalogRenderer, /بدون سجل سعر — يُعامل بصفر تشغيليًا/);
  assert.match(js, /if\(state\.tenant\?\.accountType!==\'owner\'\)/);
});

test('reception provides complete post-save actions and direct visit-scoped results navigation', () => {
  const html = read('app/reception.html');
  const js = read('assets/js/reception.js');
  const lab = read('modules/laboratory/repository.js');
  assert.match(html, /id="postSaveActions"/);
  assert.match(html, /id="goToResults"/);
  assert.match(html, /id="newPatientAfterSave"/);
  assert.match(js, /function goToResults/);
  assert.match(js, /newPatientAfterSave.*focusNewPatient/s);
  assert.match(js, /searchParams\.set\('visit_id',visitId\)/);
  assert.match(lab, /requestedVisitId/);
  assert.match(lab, /query = query\.eq\('visit_id', requestedVisitId\)/);
});

test('reception exposes working keyboard, catalog, billing, payment and print controls', () => {
  const html = read('app/reception.html');
  const js = read('assets/js/reception.js');
  const css = read('assets/css/reception.css');
  for (const id of ['patientSearch','catalogSearch','discount','initialPayment','createVisit','resetSelection','clearIntake','refreshRecent','refreshBalances','printPaymentReceipt']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(js, /addEventListener\('keydown'/);
  assert.match(js, /ArrowDown/);
  assert.match(js, /addEventListener\('click'/);
  assert.match(js, /recordPayment/);
  assert.match(js, /window\.print\(\)/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /:focus-visible/);
});

test('new patient requires manually entered age and unit while birth date stays optional',()=>{
  const html=read('app/reception.html');
  const js=read('assets/js/reception.js');
  assert.match(html,/id="patientPhone"[^>]*>/);
  assert.doesNotMatch(html,/id="patientPhone"[^>]*required/);
  assert.match(html,/id="patientAge"[^>]*required/);
  assert.match(html,/id="patientAgeUnit"[^>]*required/);
  assert.match(html,/id="patientDob"/);
  assert.doesNotMatch(html,/id="patientDob"[^>]*required/);
  assert.match(js,/dateOfBirth/);
  assert.match(js,/ageValue:age,ageUnit:unit/);
  assert.match(js,/اكتب عمر المريض وحدد وحدته/);
  assert.doesNotMatch(js,/ageFromDateOfBirth/);
  assert.match(js,/newPatientForm'\)\.addEventListener\('keydown'/);
  assert.match(js,/fields\[index\+1\]/);
  assert.match(js,/if\(next\)\{next\.focus\(\);return;\}/);
  assert.match(js,/requestSubmit\(submit\)/);
});

test('reception is arranged as one numbered and readable sequence',()=>{
  const html=read('app/reception.html');
  const css=read('assets/css/reception.css');
  assert.match(html,/class="intake-content intake-flow"/);
  for(const label of ['بيانات المريض','بيانات الزيارة','اختيار التحاليل','التحاليل المختارة','الحساب والدفع']) {
    assert.ok(html.includes(label),`missing reception step: ${label}`);
  }
  assert.match(css,/grid-template-areas:"patient patient" "catalog cart"/);
  assert.match(css,/grid-template-areas:"patient" "catalog" "cart"/);
  assert.match(css,/\.main-actions \.button-primary/);
});


test('outstanding balances can be queued offline without printing a final receipt before server acknowledgement',()=>{
  const js=read('assets/js/reception.js');
  const repo=read('modules/reception/repository.js');
  assert.match(js,/recordPayment\(\{tenantId:state\.tenant\.id,branchId:state\.branch\.id,visitId:card\.dataset\.balanceVisit/);
  assert.match(js,/payment\?\.queued/);
  assert.match(js,/لا تطبع إيصالًا نهائيًا قبل تأكيد الخادم/);
  assert.doesNotMatch(js,/التحصيل اللاحق من هذه الشاشة يحتاج اتصالًا حاليًا/);
  assert.match(repo,/entityType: 'payment', action: 'create'/);
});
