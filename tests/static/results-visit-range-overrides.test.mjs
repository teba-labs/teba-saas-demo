import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const repo=read('modules/results/repository.js');
const reportRepo=read('modules/reports/repository.js');
const correctionMigration=read('database/migrations/062_correct_completed_visit_result.sql');
const reception=read('modules/reception/repository.js');
const ui=read('assets/js/results-workbench.js');
const migration=read('database/migrations/059_visit_parameter_range_overrides.sql');

test('reference range overrides are loaded and saved by visit-test and parameter key',()=>{
 for(const value of ['listVisitParameterRangeOverrides','saveVisitParameterRangeOverride','set_visit_parameter_range_override']) assert.ok(repo.includes(value),value);
 for(const value of ['rangeOverridesByKey','edit-reference-range','saveVisitParameterRangeOverride']) assert.ok(ui.includes(value),value);
});

test('range editing is available before approval, including a previously completed test, but not after publication',()=>{
 assert.ok(ui.includes("isPublished || (group.visit?.status !== 'approved' && group.visit?.status !== 'cancelled')"));
 assert.ok(ui.includes('تصحيح رينج التقرير المنشور'));
 assert.ok(ui.includes('التقرير السابق محفوظ'));
 assert.ok(migration.includes('app.result_correction'));
 assert.ok(migration.includes("v_test.status='cancelled'"));
 assert.ok(migration.includes('An approved but unpublished visit must be reopened'));
 assert.ok(migration.includes('app.result_correction'));
});

test('range edits are visit-local, audited and never update the catalog',()=>{
 for(const value of ['visit_test_parameter_range_events','old_reference_ranges','new_reference_ranges','actor_user_id','actor_staff_id']) assert.ok(migration.includes(value),value);
 assert.ok(!migration.toLowerCase().includes('update public.tests_catalog'));
 assert.ok(ui.includes('لم يتغير كتالوج التحاليل أو أي زيارة أخرى'));
});

test('completed result corrections remain visit-scoped and audited before and after publication',()=>{
 assert.ok(reportRepo.includes('correctCompletedVisitResult'));
 assert.ok(ui.includes('correct-unpublished-test'));
 assert.ok(ui.includes('correctPublishedResult'));
 assert.ok(correctionMigration.includes('correction_reason'));
 assert.ok(correctionMigration.includes('v_visit.is_published'));
});

test('adding a test to an existing visit uses the atomic no-duplicate operation and preserves actor attribution',()=>{
 for(const value of ['add_test_to_visit_atomic','p_staff_id: staffId','An active staff identity is required']) assert.ok(reception.includes(value),value);
});
