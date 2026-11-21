import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const html=readFileSync(new URL('app/platform-admin.html',root),'utf8');
const js=readFileSync(new URL('assets/js/platform-admin.js',root),'utf8');
const sql=readFileSync(new URL('database/migrations/072_platform_subscription_period_management.sql',root),'utf8');
test('platform admin exposes trial and subscription end date controls',()=>{
 assert.match(js,/data-trial-end/);assert.match(js,/data-sub-end/);
 assert.match(js,/platform_update_tenant_subscription_period/);
 assert.match(js,/p_trial_ends_at/);assert.match(js,/p_subscription_ends_at/);
});
test('period management RPC is platform-admin-only and validates period and plan',()=>{
 assert.match(sql,/private\.is_platform_admin\(\)/);
 assert.match(sql,/p_subscription_ends_at < p_trial_ends_at/);
 assert.match(sql,/Selected plan unavailable/);
 assert.match(sql,/revoke all on function public\.platform_update_tenant_subscription_period/);
});
