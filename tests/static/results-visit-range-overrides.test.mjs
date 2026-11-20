import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const repo=read('modules/results/repository.js');
const reception=read('modules/reception/repository.js');
const ui=read('assets/js/results-workbench.js');
const migration=read('database/migrations/059_visit_parameter_range_overrides.sql');

test('reference range overrides are loaded and saved by visit-test and parameter key',()=>{
 assert.match(repo,/listVisitParameterRangeOverrides/);
 assert.match(repo,/saveVisitParameterRangeOverride/);
 assert.match(repo,/set_visit_parameter_range_override/);
 assert.match(ui,/rangeOverridesByKey/);
 assert.match(ui,/edit-reference-range/);
 assert.match(ui,/saveVisitParameterRangeOverride/);
});

test('range editing is available before approval, including a previously completed test, but not after publication',()=>{
 assert.match(ui,/!isPublished && group\.visit\?\.status !== 'approved'/);
 assert.match(migration,/v_test\.status='cancelled'/);
 assert.match(migration,/Approved or published visits cannot have their reference ranges changed/);
});

test('range edits are visit-local, audited and never update the catalog',()=>{
 assert.match(migration,/visit_test_parameter_range_events/);
 assert.match(migration,/old_reference_ranges/);
 assert.match(migration,/new_reference_ranges/);
 assert.match(migration,/actor_user_id/);
 assert.match(migration,/actor_staff_id/);
 assert.doesNotMatch(migration,/update public\.tests_catalog/i);
 assert.match(ui,/لم يتغير كتالوج التحاليل أو أي زيارة أخرى/);
});

test('adding a test to an existing visit uses the atomic no-duplicate operation and preserves actor attribution',()=>{
 assert.match(reception,/add_test_to_visit_atomic/);
 assert.match(reception,/p_staff_id: staffId/);
 assert.match(reception,/An active staff identity is required/);
});
