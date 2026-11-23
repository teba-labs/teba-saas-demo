import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root=new URL('../../',import.meta.url);
const migration=readFileSync(new URL('database/migrations/073_patient_portal_presentation_settings.sql',root),'utf8');
const edge=readFileSync(new URL('supabase/functions/patient-portal-config/index.ts',root),'utf8');
const portal=readFileSync(new URL('portal/lookup.js',root),'utf8');
const manager=readFileSync(new URL('assets/js/site-management.js',root),'utf8');
test('tenant portal presentation settings have safe defaults and object-only storage',()=>{
 assert.match(migration,/portal_settings jsonb not null default/i);
 assert.match(migration,/jsonb_typeof\(portal_settings\) = 'object'/i);
});
test('public portal config endpoint is origin restricted and returns presentation-only data',()=>{
 assert.match(edge,/PORTAL_ALLOWED_ORIGINS/);
 assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(edge,/select\('portal_settings'\)/);
 assert.match(edge,/enabled: false/);
 assert.match(edge,/settings\.enabled=settings\.enabled===true/);
 assert.match(manager,/const portalDefaults=\{enabled:false/);
 assert.doesNotMatch(edge,/from\('patients'\)|from\('visits'\)|from\('report_versions'\)/);
});
test('portal applies tenant presentation settings without changing report lookup inputs',()=>{
 assert.match(portal,/patient-portal-config/);
 assert.match(portal,/portalTitle/);
 assert.match(portal,/portalNameLabel/);
 assert.match(portal,/portalVisitLabel/);
 assert.match(portal,/x.enabled === false/);
 assert.match(manager,/portalSettingsFromForm/);
 assert.match(manager,/\.update\(\{portal_settings\}\)/);
});
