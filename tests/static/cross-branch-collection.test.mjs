import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('cross-branch collection keeps visit origin separate from cash collection branch',()=>{
 const sql=read('database/migrations/013_cross_branch_debt_collection.sql');
 assert.match(sql,/add column if not exists origin_branch_id uuid/i);
 assert.match(sql,/foreign key \(tenant_id, origin_branch_id, visit_id\)[\s\S]*?references public\.visits\(tenant_id, branch_id, id\)/i);
 assert.match(sql,/values\s*\(\s*p_tenant_id,\s*v_collection_branch_id,\s*v_origin_branch_id,\s*p_visit_id/i);
});

test('payment ledger attributes collected cash to the collecting branch and workday',()=>{
 const sql=read('database/migrations/013_cross_branch_debt_collection.sql');
 assert.match(sql,/branch_id = v_collection_branch_id[\s\S]*?status = 'open'/i);
 assert.match(sql,/private\.can_access_branch\(p_tenant_id, v_collection_branch_id\)/i);
 const trigger=read('database/migrations/001_initial_schema_v1.sql');
 assert.match(trigger,/new\.branch_id, 'payment', new\.id, 'inflow'/i);
});

test('offline payment queue follows the cash-collecting branch rather than the visit origin',()=>{
 const repo=read('modules/reception/repository.js');
 assert.match(repo,/const collectionBranchId = collector\.branch_id/);
 assert.match(repo,/enqueueOperation\(\{ tenantId, branchId: collectionBranchId, entityType: 'payment'/);
 const adapter=read('offline/supabase-adapters.js');
 assert.match(adapter,/collecting \)\?branch workday/);
 assert.match(adapter,/payment collection branch is not accessible/);
});

test('payment retries are acknowledged before staff-active and workday validation',()=>{
 const sql=read('database/migrations/015_cross_branch_payment_retry_hardening.sql');
 const replay=sql.indexOf('select * into v_existing');
 const staff=sql.indexOf('from public.staff_directory');
 const workday=sql.indexOf('from public.branch_workdays');
 assert.ok(replay>=0 && replay<staff && replay<workday);
 assert.match(sql,/private\.can_access_branch\(p_tenant_id,v_existing\.branch_id\)/);
 assert.match(sql,/v_existing\.received_by_staff_id is distinct from p_staff_id/);
 assert.match(sql,/revoke all on function public\.record_patient_payment[\s\S]*?from public,anon/i);
 assert.match(sql,/grant execute on function public\.record_patient_payment[\s\S]*?to authenticated/i);
});
