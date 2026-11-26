import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('doctor-facing catalog metadata fields accept plain text and never ask for JSON', () => {
  const pages = ['app/catalog.html','app/platform-admin.html','app/cms-editor.html','app/dashboard.html','app/data-import.html','app/index.html','app/reception.html','app/result-entry.html','app/results-workbench.html','app/settings.html','app/site-management.html','app/site-preview.html','app/sync-center.html','app/workday.html','portal/index.html','website/index.html'];
  const html = pages.map(read).join('\\n');
  const catalog = read('app/catalog.html');
  const js = read('assets/js/catalog.js');
  const platformJs = read('assets/js/platform-admin.js');
  assert.doesNotMatch(html, /JSON\\s*<textarea|\\(JSON\\)/i);
  assert.equal(html.includes("placeholder='{"), false);
  assert.doesNotMatch(platformJs, /JSON\\.parse\\(\\$\\('plan/);
  assert.doesNotMatch(js, /parseJsonField|parseJsonObjectField|parseJsonArrayField/);
  for (const id of ['testPreparation','testCollection','testSpecimenRequirements','testTransport','testStability','testCriticalPolicy','testSources','parameterAlternateUnits','parameterCriticalRanges','parameterInterpretation','parameterApplicability','parameterClinicalMetadata','parameterSources']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(js, /parseTextObject/);
  assert.match(js, /parseTextReferences/);
  assert.match(js, /parseAlternateUnits/);
  assert.match(js, /parseCriticalRanges/);
  assert.match(js, /parseApplicability/);\n  assert.match(platformJs, /parseTextMap/);
});

test('master formula import compiles doctor-authored arithmetic text, not serialized JSON text', () => {
  const migration = read('database/migrations/120_master_formulas_are_plain_text.sql');
  assert.match(migration, /master_formula_text_to_jsonb/);
  assert.match(migration, /parse_formula_expression/);
  assert.match(migration, /regexp_matches/);
  assert.match(migration, /update public\.master_catalog_parameters[\s\S]*set formula=formula_expression/);
  assert.match(migration, /Human-readable arithmetic expression text/i);
});
