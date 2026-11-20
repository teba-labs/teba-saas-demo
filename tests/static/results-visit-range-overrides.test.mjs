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
 for(const value of ['listVisitParameterRangeOverrides','saveVisitParameterRangeOverride','set_visit_parameter_range_override']) assert.ok(repo.includes(value),value);
 for(const value of ['rangeOverridesByKey','edit-reference-range','saveVisitParameterRangeOverride']) assert.ok(ui.includes(value),value);
});

test('range editing is available before approval, including a previously completed test, but not after publication',()=>{
 assert.ok(ui.includes("isPublished || group.visit?.status !== 'approved'"));
 assert.ok(ui.includes('تصحيح رينج التقرير المنشور'));
 assert.ok(ui.includes('التقرير السابق محفوظ'));
 assert.ok(migration.includes('app.result_correction'));
 assert.ok(migration.includes("v_test.status='cancelled'"));
 assert.ok(migration.includes('Approved or published visits cannot have their reference ranges changed'));
});

test('range edits are visit-local, audited and never update the catalog',()=>{
 for(const value of ['visit_test_parameter_range_events','old_reference_ranges','new_reference_ranges','actor_user_id','actor_staff_id']) assert.ok(migration.includes(value),value);
 assert.ok(!migration.toLowerCase().includes('update public.tests_catalog'));
 assert.ok(ui.includes('لم يتغير كتالوج التحاليل أو أي زيارة أخرى'));
});

test('adding a test to an existing visit uses the atomic no-duplicate operation and preserves actor attribution',()=>{
 for(const value of ['add_test_to_visit_atomic','p_staff_id: staffId','An active staff identity is required']) assert.ok(reception.includes(value),value);
});
