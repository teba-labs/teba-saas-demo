import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const page = fs.readFileSync(path.join(root, 'app/results-workbench.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/js/results-workbench.js'), 'utf8');
const repository = fs.readFileSync(path.join(root, 'modules/results/repository.js'), 'utf8');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('results workbench is a separate authenticated page and imports tenant-scoped repositories', () => {
  assert.match(page, /lang="ar" dir="rtl"/);
  assert.match(script, /signInWithEmail/);
  assert.match(script, /loadMyTenantContext/);
  assert.match(script, /listBranchWorkPage\(\{ tenantId: state\.tenant\.id, branchId: state\.branch\.id, page: state\.workPage, pageSize: state\.workPageSize \}\)/);
  assert.match(script, /listResultsForVisitTests\(/);
  assert.match(repository, /\.in\('visit_test_id', chunk\)/);
  assert.match(page, /id="workPager"/);
  assert.match(script, /prevWorkPage/);
  assert.match(script, /nextWorkPage/);
});

test('workbench accepts saved results and retains audited correction and PDF publication', () => {
  assert.match(script, /saveDraftResults/);
  assert.doesNotMatch(script, /approveVisitWithAutoCompletion/);
  assert.doesNotMatch(script, /approve-visit/);
  assert.match(script, /حفظ النتائج/);
  assert.match(script, /correctVisitResultWithFlag/);
  assert.match(script, /publishReportVersion/);
  assert.match(script, /صحح نتيجة واحدة في كل مرة/);
});

test('result repository supports numeric and non-numeric catalog parameter types', () => {
  assert.match(repository, /prepareResultInput/);
  assert.match(repository, /save_draft_results_idempotent/);
  const inputModes = read('modules/results/input-mode.js');
  for (const mode of ['numeric_integer','numeric_decimal','numeric_comparator','text','positive_negative','boolean','single_choice','multi_choice','graded_multi_choice']) {
    assert.ok(inputModes.includes(mode), 'missing result input mode '+mode);
  }
  assert.match(script, /renderResultControl/);
  assert.match(script, /evaluateDisplayRules/);
  assert.match(script, /data-display-rules/);
  assert.match(script, /multi-choice-editor/);
});

test('save and correction actions resolve the containing test card, not the action button itself', () => {
  assert.equal(script.split("button.closest('.parameter[data-test-id]')").length - 1, 1);
  assert.doesNotMatch(script, /button\.closest\('\[data-test-id\]'\)/);
  assert.match(script, /const inputs = \[\.\.\.section\.querySelectorAll\('\[data-param-code\]'\)\]/);
});

test('operator can save, preview, print and publish results without visit-wide approval', () => {
  assert.doesNotMatch(script, /async function approve\(button\)/);
  assert.match(script, /state\.work\.filter\(item => item\.visit_id === visitId/);
  assert.match(script, /await saveDraftResults\(/);
  assert.match(script, /await completeVisitTestAtomic\(/);
  assert.doesNotMatch(script, /approveVisitWithAutoCompletion/);
  assert.match(script, /partialReport/);
  assert.match(script, /SAVED RESULTS REPORT/);
  assert.doesNotMatch(script, /PARTIAL REPORT/);
  assert.match(repository, /complete_visit_test_atomic/);
  assert.match(repository, /approve_visit_with_auto_completion/);
});
