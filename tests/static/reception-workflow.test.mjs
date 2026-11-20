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
