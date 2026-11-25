import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('offline result entry caches the exact queued values for local review and approval',()=>{
  const repository=read('modules/results/repository.js');
  assert.match(repository,/entityType: 'draft_results'/);
  assert.match(repository,/local_operation_id:operationId/);
  assert.match(repository,/cacheRows\('test_results',localRows\)/);
});

test('local approval is distinct from final publication and depends on queued work',()=>{
  const repository=read('modules/results/repository.js');
  const ui=read('assets/js/results-workbench.js');
  const reports=read('modules/reports/repository.js');
  assert.match(repository,/entityType:'visit_approval'/);
  assert.match(repository,/result_fingerprint/);
  assert.match(repository,/actor_user_id/);
  assert.match(repository,/dependsOn/);
  assert.match(repository,/local_approval_status:'pending_server_validation'/);
  assert.match(repository,/key:`approval:/);
  assert.match(adapters,/setApprovalMarker/);
  assert.match(ui,/approvalByVisit/);
  assert.match(ui,/اعتماد محلي — بانتظار المزامنة/);
  assert.match(ui,/النشر النهائي يظل خطوة منفصلة/);
  assert.match(reports,/publish_report_version|publishReportVersion/);
});

test('approval sync rechecks original user, visit scope and unchanged clinical result fingerprint',()=>{
  const adapters=read('offline/supabase-adapters.js');
  assert.match(adapters,/visit_approval: async operation/);
  assert.match(adapters,/session\.user\.id!==p\.actor_user_id/);
  assert.match(adapters,/fingerprintVisitResults/);
  assert.match(adapters,/serverFingerprint!==p\.result_fingerprint/);
  assert.match(adapters,/newerDrafts/);
  assert.match(adapters,/approve_visit_with_auto_completion/);
  assert.match(adapters,/approved_by_staff_id!==p\.staff_id/);
});

test('offline report preview uses cached patient data, visit ranges and work-copy printing',()=>{
  const laboratory=read('modules/laboratory/repository.js');
  const results=read('assets/js/results-workbench.js');
  const repository=read('modules/results/repository.js');
  const prepare=read('offline/prepare.js');
  assert.match(laboratory,/localReportWork/);
  assert.match(laboratory,/getCachedRows\('patients'/);
  assert.match(results,/const localOffline = globalThis\.navigator\?\.onLine === false/);
  assert.match(results,/approvalMarker/);
  assert.match(repository,/range-override:/);
  assert.match(prepare,/listVisitParameterRangeOverrides/);
});

test('offline work-copy delivery is an auditable local event and is not final publication',()=>{
  const reports=read('modules/reports/repository.js');
  const adapters=read('offline/supabase-adapters.js');
  const edge=read('supabase/functions/record-local-delivery/index.ts');
  const ui=read('assets/js/results-workbench.js');
  assert.match(reports,/entityType:'report_delivery'/);
  assert.match(adapters,/report_delivery: async operation/);
  assert.match(edge,/audit_logs/);
  assert.match(edge,/report_work_copy_handed_over/);
  assert.match(ui,/mark-work-copy-delivered/);
  assert.match(ui,/لا يعني اعتمادًا نهائيًا أو نشرًا/);
});

test('local clinical fingerprints ignore local UUID aliases but include test and result values',()=>{
  const fingerprint=read('offline/result-fingerprint.js');
  assert.match(fingerprint,/test_id:row\.test_id/);
  assert.match(fingerprint,/parameter_code/);
  assert.match(fingerprint,/value_numeric/);
  assert.match(fingerprint,/value_text/);
  assert.match(fingerprint,/SHA-256/);
});
