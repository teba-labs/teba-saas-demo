import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('doctor-facing configuration fields accept plain text and never ask users for JSON', () => {
  const pages = ['app/catalog.html','app/platform-admin.html','app/cms-editor.html','app/dashboard.html','app/data-import.html','app/index.html','app/reception.html','app/result-entry.html','app/results-workbench.html','app/settings.html','app/site-management.html','app/site-preview.html','app/sync-center.html','app/workday.html','portal/index.html','website/index.html'];
  const html = pages.map(read).join(' ');
  const js = read('assets/js/catalog.js');
  const platformJs = read('assets/js/platform-admin.js');
  assert.equal(html.includes('JSON<textarea'), false);
  assert.equal(html.includes('JSON</label>'), false);
  assert.equal(html.includes('(JSON)'), false);
  assert.equal(html.includes("placeholder='{" ), false);
  assert.equal(platformJs.includes("JSON.parse($('planLimits')"), false);
  assert.equal(platformJs.includes("JSON.parse($('planFeatures')"), false);
  assert.equal(js.includes('parseJsonField'), false);
  assert.equal(js.includes('parseJsonObjectField'), false);
  assert.equal(js.includes('parseJsonArrayField'), false);
  for (const id of ['testPreparation','testCollection','testSpecimenRequirements','testTransport','testStability','testCriticalPolicy','testSources','parameterAlternateUnits','parameterCriticalRanges','parameterInterpretation','parameterApplicability','parameterClinicalMetadata','parameterSources']) {
    assert.ok(html.includes('id="' + id + '"'));
  }
  assert.ok(js.includes('parseTextObject'));
  assert.ok(js.includes('parseTextReferences'));
  assert.ok(js.includes('parseAlternateUnits'));
  assert.ok(js.includes('parseCriticalRanges'));
  assert.ok(js.includes('parseApplicability'));
  assert.ok(platformJs.includes('parseTextMap'));
});

test('master formula import compiles doctor-authored arithmetic text, not serialized JSON text', () => {
  const migration = read('database/migrations/120_master_formulas_are_plain_text.sql');
  const formulaGuard = read('database/migrations/124_require_parameter_references_in_text_formulas.sql');
  assert.ok(migration.includes('master_formula_text_to_jsonb'));
  assert.ok(migration.includes('parse_formula_expression'));
  assert.ok(migration.includes('regexp_matches'));
  assert.ok(migration.includes('set formula=formula_expression'));
  assert.ok(migration.includes('Human-readable arithmetic expression text'));
  assert.ok(formulaGuard.includes('formula_ast_has_parameter'));
  assert.ok(formulaGuard.includes('المعادلة يجب أن تعتمد على بارامتر واحد على الأقل'));
});

test('published master catalog recognizes readable formulas without JSON parsing', () => {
  const repository = read('modules/catalog/repository.js');
  assert.ok(repository.includes('function hasMasterFormulaText(value)'));
  assert.ok(repository.includes('typeof value === \'string\''));
  assert.ok(repository.includes('!hasMasterFormulaText(parameter.formula)'));
  assert.equal(repository.includes('function parseMasterFormulaAst(value)'), false);
  assert.ok(repository.includes("return typeof value === 'string' && value.trim().length > 0;"));
  const expressionOnly = read('database/migrations/126_expression_text_only_formula_compiler.sql');
  assert.ok(expressionOnly.includes('JSON text input is explicitly rejected'));\n  assert.ok(expressionOnly.includes('left(v_text,1) in (\'{\',\'[\')'));
  assert.equal(expressionOnly.includes('v_text::jsonb'), false);
});
