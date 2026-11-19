import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const page = fs.readFileSync(path.join(root, 'app/results-workbench.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/js/results-workbench.js'), 'utf8');
const repository = fs.readFileSync(path.join(root, 'modules/results/repository.js'), 'utf8');

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

test('workbench separates draft entry, approval, audited correction and PDF publication actions', () => {
  assert.match(script, /saveDraftResults/);
  assert.match(script, /completeVisitTest/);
  assert.match(script, /approveVisit/);
  assert.match(script, /correctPublishedResult/);
  assert.match(script, /publishReportVersion/);
  assert.match(script, /صحح نتيجة واحدة في كل مرة/);
});

test('result repository supports numeric and non-numeric catalog parameter types', () => {
  assert.match(repository, /const isText = valueType !== 'numeric'/);
  assert.match(repository, /Number\.isFinite\(numeric\)/);
  assert.match(repository, /value_text: isText \? rawValue : null/);
});
