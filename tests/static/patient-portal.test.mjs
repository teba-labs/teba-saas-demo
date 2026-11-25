import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('../../supabase/functions/patient-portal-lookup/index.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../../portal/index.html', import.meta.url), 'utf8');
const client = await readFile(new URL('../../portal/lookup.js', import.meta.url), 'utf8');
const resultsWorkbench = await readFile(new URL('../../assets/js/results-workbench.js', import.meta.url), 'utf8');
const portalConfig = await readFile(new URL('../../supabase/functions/patient-portal-config/index.ts', import.meta.url), 'utf8');
const publishFunction = await readFile(new URL('../../supabase/functions/publish-report/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../database/migrations/002_patient_portal_hardening.sql', import.meta.url), 'utf8');
const atomicLimiter = await readFile(new URL('../../database/migrations/016_atomic_patient_portal_rate_limit.sql', import.meta.url), 'utf8');
const supabaseConfig = await readFile(new URL('../../supabase/config.toml', import.meta.url), 'utf8');

test('patient portal keeps privileged credentials server-side', () => {
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(client, /SERVICE_ROLE|service_role/i);
  assert.match(edge, /PORTAL_HASH_SECRET/);
});

test('portal lookup is exact, tenant-scoped, and only returns published final or partial report versions', () => {
  assert.match(edge, /\.eq\('slug', slug\)/);
  assert.match(edge, /\.eq\('tenant_id', tenant\.id\)/);
  assert.match(edge, /normalizeName\(String\(\(row\.patients/);
  assert.match(edge, /\.eq\('is_published', true\)/);
  assert.match(edge, /portalConfig\?\.portal_settings\?\.enabled !== true/);
  assert.match(edge, /Patient portal enablement check failed/);
  assert.match(edge, /\.order\('version_number', \{ ascending: false \}\)/);
  assert.match(edge, /publication_type/);
  assert.match(edge, /isPartial/);
  assert.doesNotMatch(edge, /\.eq\('visit_number', visitNumber\)\.eq\('is_published', true\)/);
  assert.match(client, /data\.isPartial/);
  assert.match(page, /data-portal-partial/);
});

test('portal uses short-lived private report links and generic lookup failures', () => {
  assert.match(edge, /createSignedUrl\(String\(report\.storage_path\), 120\)/);
  assert.match(edge, /التحاليل قيد الاختبار والمراجعة/);
  assert.match(edge, /rpc\('consume_patient_portal_attempt'/);
  assert.match(edge, /rateLimit\.allowed/);
  assert.doesNotMatch(edge, /from\('portal_access_attempts'\)\s*\.select/);
});

test('portal attempts are not exposed to browser roles', () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke all on public\.portal_access_attempts from anon, authenticated/i);
});

test('patient portal page collects only the agreed lookup fields', () => {
  assert.match(page, /name="slug"/);
  assert.match(page, /name="patientName"/);
  assert.match(page, /name="visitNumber"/);
  assert.match(client, /functions\/v1\/patient-portal-lookup/);
});

test('public lookup function is configured for anonymous invocation', () => {
  assert.match(supabaseConfig, /\[functions\.patient-portal-lookup\]/);
  assert.match(supabaseConfig, /verify_jwt\s*=\s*false/);
});

test('portal rate limiting is atomic and callable only by the Edge service role', () => {
  assert.match(atomicLimiter, /pg_advisory_xact_lock/);
  assert.match(atomicLimiter, /v_lookup_count >= 5/);
  assert.match(atomicLimiter, /v_ip_count >= 20/);
  assert.match(atomicLimiter, /revoke all on function public\.consume_patient_portal_attempt\(uuid,text,text\) from public, anon, authenticated/i);
  assert.match(atomicLimiter, /grant execute on function public\.consume_patient_portal_attempt\(uuid,text,text\) to service_role/i);
});


test('patient portal functions allow the deployed GitHub Pages origin without an unprovisioned allowlist secret', () => {
  assert.match(portalConfig, /https:\/\/teba-labs\.github\.io/);
  assert.match(portalConfig, /settings\.enabled = settings\.enabled === true/);
  assert.match(edge, /https:\/\/teba-labs\.github\.io/);
  assert.match(edge, /SUPABASE_SECRET_KEYS/);
  assert.match(edge, /PORTAL_HASH_SECRET/);
  assert.match(publishFunction, /https:\/\/teba-labs\.github\.io/);
  assert.match(publishFunction, /REPORT_ALLOWED_ORIGINS/);
});

test('final published reports can open a WhatsApp message with patient and visit lookup details', () => {
  assert.match(resultsWorkbench, /share-published-report/);
  assert.match(resultsWorkbench, /sharePublishedReport/);
  assert.match(resultsWorkbench, /اسم المريض:/);
  assert.match(resultsWorkbench, /رقم الزيارة:/);
  assert.match(resultsWorkbench, /https:\/\/wa\.me\//);
  assert.match(resultsWorkbench, /portalUrl\.href/);
});
