import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('historical Excel archive is tenant-scoped in cloud storage and owner-only in the database',()=>{
 const sql=read('database/migrations/079_cloud_historical_workbook_archive.sql');
 assert.match(sql,/create table if not exists public\.owner_historical_workbooks/);
 assert.match(sql,/workbook_type text not null check/);
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/force row level security/i);
 assert.match(sql,/private\.is_tenant_owner\(tenant_id\)/);
 assert.match(sql,/grant select,insert,update,delete[\s\S]*to authenticated/i);
 assert.match(sql,/capture_audit_log/);
});

test('historical workbook cloud repository uses private tenant backup paths and verifies file content',()=>{
 const repo=read('modules/dashboard/historical-workbook-cloud.js');
 assert.match(repo,/owner_historical_workbooks/);
 assert.match(repo,/tenantId\+'\/historical-workbooks\//);
 assert.match(repo,/storage\.from\('tenant-backups'\)/);
 assert.match(repo,/SHA-256/);
 assert.match(repo,/downloadCloudHistoricalWorkbook/);
 assert.match(repo,/deleteCloudHistoricalWorkbook/);
});

test('historical dashboard keeps a local cache while syncing cloud archive separately from accountant imports',()=>{
 const js=read('assets/js/dashboard-history.js');
 assert.match(js,/saveCloudHistoricalWorkbook/);
 assert.match(js,/hydrateCloudArchive/);
 assert.match(js,/downloadCloudHistoricalWorkbook/);
 assert.match(js,/deleteCloudHistoricalWorkbook/);
 assert.match(js,/الأرشيف التاريخي مستقل عن التشغيل الحي ومسار المحاسب الشهري/);
 assert.match(js,/localHash===item\.file_sha256/);
});
