import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [site, siteClient, reception, results, portalPage, portalClient, lookupEdge, limiter] = await Promise.all([
  read('../../website/index.html'),
  read('../../website/public-site-page.js'),
  read('../../assets/js/reception.js'),
  read('../../assets/js/results-workbench.js'),
  read('../../portal/index.html'),
  read('../../portal/lookup.js'),
  read('../../supabase/functions/patient-portal-lookup/index.ts'),
  read('../../database/migrations/112_patient_portal_ip_lockout.sql'),
]);

test('public site adds only a role chooser and preserves the public-site content', () => {
  assert.match(site, /id="portalLink"[^>]*>تسجيل الدخول/);
  assert.match(site, /id="accessDialog"/);
  assert.match(site, /id="employeeAccess"/);
  assert.match(site, /id="ownerAccess"/);
  assert.match(site, /id="patientAccess"/);
  assert.match(site, /id="heroTitle"/);
  assert.match(site, /id="branchCards"/);
  assert.match(siteClient, /employeeAccess.*app\/index\.html/);
  assert.match(siteClient, /ownerAccess.*app\/index\.html/);
  assert.match(siteClient, /patientAccess.*portal\/index\.html\?lab=/);
});

test('visit number keeps the existing tenant/branch generator and stored value', () => {
  assert.match(reception, /rpc\('reserve_branch_visit_number'/);
  assert.match(reception, /const visitNumber=\$\('visitNumber'\)\.value\|\|makeCode\('V'\)/);
  assert.match(reception, /visitNumber,staffId:currentStaff\(\)/);
  assert.match(results, /dataset\.visitNumber = group\.visit\?\.visit_number/);
  assert.match(results, /const visitNumber=String\(card\?\.dataset\.visitNumber\|\|''\)\.trim\(\)/);
});

test('WhatsApp sends the exact saved visit number and tenant portal link', () => {
  assert.match(results, /portalUrl\.searchParams\.set\('lab',state\.tenant\.slug\)/);
  assert.match(results, /رقم الزيارة: '\+visitNumber/);
  assert.match(results, /portalUrl\.href/);
  assert.match(lookupEdge, /\.eq\('visit_number', visitNumber\)/);
  assert.match(lookupEdge, /visitNumber: visit\.visit_number/);
});

test('patient portal asks only for the registered name and visit number', () => {
  assert.match(portalPage, /name="slug" type="hidden"/);
  assert.match(portalPage, /name="patientName"/);
  assert.match(portalPage, /name="visitNumber"/);
  assert.doesNotMatch(portalPage, /رمز المعمل/);
  assert.match(portalClient, /get\('lab'\)/);
  assert.match(portalClient, /افتح بوابة النتائج من الموقع الرسمي للمعمل/);
  assert.match(lookupEdge, /const GENERIC_FAILURE/);
  assert.match(lookupEdge, /التحاليل قيد الاختبار والمراجعة/);
});

test('published-only lookup and partial reports remain tenant-scoped and privacy-preserving', () => {
  assert.match(lookupEdge, /\.eq\('tenant_id', tenant\.id\)/);
  assert.match(lookupEdge, /\.eq\('is_published', true\)/);
  assert.match(lookupEdge, /publication_type/);
  assert.match(lookupEdge, /createSignedUrl\(String\(report\.storage_path\), 120\)/);
  assert.match(lookupEdge, /Cache-Control.*no-store/);
});

test('rate limiting locks only tenant plus source IP, never a patient or visit', () => {
  assert.match(limiter, /portal_ip_rate_limits/);
  assert.match(limiter, /succeeded = false/);
  assert.match(limiter, /interval '5 minutes'/);
  assert.match(limiter, /v_failures >= 6/);
  assert.match(limiter, /interval '1 hour'/);
  assert.match(limiter, /tenant_id.*ip_hash/);
  assert.doesNotMatch(limiter, /portal-lookup:/);
  assert.match(limiter, /revoke all on table public\.portal_ip_rate_limits from public, anon, authenticated/i);
  assert.match(limiter, /grant execute on function public\.consume_patient_portal_attempt\(uuid,text,text\) to service_role/i);
});
