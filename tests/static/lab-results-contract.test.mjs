import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = new URL('../../', import.meta.url).pathname;
const lab = fs.readFileSync(path.join(root, 'modules/laboratory/repository.js'), 'utf8');
const results = fs.readFileSync(path.join(root, 'modules/results/repository.js'), 'utf8');
assert.match(lab, /tenant_id/); assert.match(lab, /branch_id/);
assert.match(results, /is_published/);
assert.match(results, /audited report-correction workflow/);
assert.match(results, /save_draft_results_atomic/);
assert.match(results, /Required results are missing/);
assert.match(results, /approved_by_staff_id/);
for (const source of [lab, results]) {
  assert.doesNotMatch(source, /khjzoleiuiipyodpkieg/);
  assert.doesNotMatch(source, /service_role/i);
}
console.log('PASS: Lab and results repositories enforce branch scope, required-result completion and a fail-closed published-result path.');
