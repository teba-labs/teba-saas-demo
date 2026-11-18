import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const sql=read('database/migrations/006_platform_admin_console.sql');
const html=read('app/platform-admin.html');
const js=read('assets/js/platform-admin.js');

test('platform console is a separate Arabic RTL screen with authentication',()=>{
 assert.match(html,/<html lang="ar" dir="rtl">/);assert.match(html,/id="loginForm"/);assert.match(html,/id="workspace"/);assert.match(js,/signInWithEmail/);assert.match(js,/getCurrentSession/);
});
test('platform RPCs fail closed for non platform administrators',()=>{
 const matches=sql.match(/if not private\.is_platform_admin\(\) then raise exception 'Platform administrator required'/g)||[];assert.equal(matches.length,5);
});
test('tenant onboarding requires an existing registered owner and creates isolated tenant foundations',()=>{
 assert.match(sql,/from auth\.users u where lower\(u\.email\)=v_email/);assert.match(sql,/Owner must register an account before lab creation/);assert.match(sql,/insert into public\.tenant_memberships\(tenant_id,user_id,account_type,is_active\)/);assert.match(sql,/insert into public\.lab_settings/);assert.match(sql,/insert into public\.site_settings/);assert.match(sql,/insert into public\.tenant_usage/);assert.match(sql,/insert into public\.subscriptions/);
});
test('platform tenant list returns aggregate metadata and excludes patient-level and clinical fields',()=>{
 const body=sql.slice(sql.indexOf('create or replace function public.platform_list_tenants'),sql.indexOf('create or replace function public.platform_create_tenant_for_email'));
 for(const field of ['branch_count','patient_count','visit_count','storage_bytes','subscription_status'])assert.match(body,new RegExp(field));
 for(const forbidden of ['full_name','patient_name','test_results','report_versions','financial_ledger','pdf_path'])assert.doesNotMatch(body,new RegExp(forbidden));
});
test('platform admin can update tenant and subscription states through guarded RPCs',()=>{
 assert.match(sql,/platform_update_tenant_status/);assert.match(sql,/platform_update_subscription/);assert.match(sql,/grant execute on function public\.platform_update_subscription/);
});
test('plan editor and tenant console are wired to platform RPCs and plan metadata only',()=>{
 assert.match(html,/id="tenantForm"/);assert.match(html,/id="planForm"/);assert.match(js,/platform_list_tenants/);assert.match(js,/platform_create_tenant_for_email/);assert.match(js,/platform_update_tenant_and_subscription/);assert.match(js,/from\('subscription_plans'\)/);
 for(const forbidden of ["from('patients')","from('visits')","from('test_results')","from('financial_ledger')"])assert.doesNotMatch(js,new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
test('migration locks down platform RPCs from anonymous and public roles',()=>{
 assert.match(sql,/revoke all on function public\.platform_list_tenants\(\) from public,anon/);assert.match(sql,/grant execute on function public\.platform_list_tenants\(\) to authenticated/);
});
test('platform screen assets exist',()=>{assert.ok(existsSync(new URL('assets/css/platform-admin.css',root)));assert.ok(existsSync(new URL('assets/js/platform-admin.js',root)));});
