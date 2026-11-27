import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL('../../'+name, import.meta.url), 'utf8');
const migration = await read('database/migrations/111_partial_report_publication.sql');
const workbench = await read('assets/js/results-workbench.js');
const repository = await read('modules/reports/repository.js');
const publishEdge = await read('supabase/functions/publish-report/index.ts');
const portalEdge = await read('supabase/functions/patient-portal-lookup/index.ts');
const portalClient = await read('portal/lookup.js');

test('partial report publication is a separate, explicit database workflow', () => {
  assert.match(migration, /publication_type text not null default 'final'/);
  assert.match(migration, /publish_partial_report_version/);
  assert.match(migration, /set_config\('app\.report_publication','partial',true\)/);
  assert.match(migration, /A partial report requires at least one saved result/);
  assert.match(migration, /Deliberately do not update visits\.status, visits\.is_published, or workday state/);
  assert.match(migration, /every required parameter of every requested test must have a result/i);
});

test('browser and Edge Function route partial publication explicitly and keep final RPC separate', () => {
  assert.match(repository, /form\.set\('partial', isPartial \? 'true' : 'false'\)/);
  assert.match(workbench, /publishReportVersion\(\{[\s\S]*isPartial:partial\}/);
  assert.match(publishEdge, /publish_partial_report_version/);
  assert.match(publishEdge, /publish_report_version/);
  assert.match(publishEdge, /isPartial,/);
});

test('partial printing includes saved results from incomplete tests and never invents missing ranges', () => {
  assert.match(workbench, /const hasSavedResults = rows\.length > 0/);
  assert.match(workbench, /rows\.some\(row => row\.visit_test_id === item\.id\)/);
  assert.match(workbench, /SAVED RESULTS REPORT — only saved results are shown/);
  assert.match(workbench, /return '';/);
  assert.match(workbench, /state\.portalEnabled && hasAnySavedResults/);
  assert.match(workbench, /functions\.invoke\('patient-portal-config'/);
  assert.match(workbench, /state\.portalEnabled && group\.visit\?\.patients\?\.phone/);
});

test('portal lookup accepts a published partial version without marking the visit final', () => {
  assert.match(portalEdge, /publication_type/);
  assert.match(portalEdge, /isPartial = report\.publication_type === 'partial'/);
  assert.match(portalEdge, /eligibleVisits/);
  assert.match(portalClient, /partialNotice\.hidden=!data\.isPartial/);
  assert.match(portalClient, /تقرير جزئي/);
});
