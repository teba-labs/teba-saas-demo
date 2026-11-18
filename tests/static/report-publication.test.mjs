import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../database/migrations/003_atomic_report_publication.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../../supabase/functions/publish-report/index.ts', import.meta.url), 'utf8');
const repo = await readFile(new URL('../../modules/reports/repository.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../../supabase/config.toml', import.meta.url), 'utf8');

 test('publication is a single authenticated database transaction', () => {
  assert.match(migration, /create or replace function public\.publish_report_version/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /set status='published',is_published=true/i);
  assert.match(migration, /revoke insert, update, delete on public\.report_versions from authenticated/i);
  assert.match(migration, /grant execute on function public\.publish_report_version[\s\S]*to authenticated/i);
});

test('publication enforces branch membership, active staff, approval and required results', () => {
  assert.match(migration, /private\.can_access_branch\(p_tenant_id,p_branch_id\)/);
  assert.match(migration, /staff_directory sd[\s\S]*sd\.is_active/);
  assert.match(migration, /Visit must be approved before publication/);
  assert.match(migration, /every required parameter[\s\S]*must have a result/i);
});

test('corrections require a reason and use audited before/after updates', () => {
  assert.match(migration, /create or replace function public\.correct_published_result/i);
  assert.match(migration, /correction_reason=trim\(p_reason\)/);
  assert.match(migration, /set_config\('app\.result_correction','on',true\)/);
  assert.match(migration, /Use the authorized result correction workflow/);
  assert.match(migration, /audit_logs/i);
  assert.match(migration, /published_by_staff_id/);
});

test('published report versions are immutable and append-only', () => {
  assert.match(migration, /trg_report_versions_immutable/);
  assert.match(migration, /Published report versions are immutable/);
  assert.match(migration, /into v_version/i);
});

test('Edge Function verifies user identity and keeps service key server-side', () => {
  assert.match(edge, /auth\.getUser\(bearer\)/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /userClient\.storage\.from\('tenant-reports'\)\.upload/);
  assert.match(edge, /admin\.storage\.from\('tenant-reports'\)\.remove/);
  assert.doesNotMatch(repo, /SERVICE_ROLE|service_role/i);
});

test('Edge Function accepts only bounded PDF files and reports RPC success', () => {
  assert.match(edge, /MAX_PDF_BYTES = 10 \* 1024 \* 1024/);
  assert.match(edge, /%PDF-/);
  assert.match(edge, /userClient\.rpc\('publish_report_version'/);
  assert.match(edge, /versionNumber: version\.version_number/);
});

test('staff publication endpoint keeps JWT verification enabled', () => {
  assert.match(config, /\[functions\.publish-report\][\s\S]*verify_jwt\s*=\s*true/);
});

 test('browser repository calls server workflow rather than inserting report rows', () => {
  assert.match(repo, /functions\.invoke\('publish-report'/);
  assert.match(repo, /rpc\('correct_published_result'/);
  assert.doesNotMatch(repo, /from\('report_versions'\)\s*\.insert/);
});

test('report publication status reflects deployed TEST function and pending origin configuration', () => {
  assert.match(repo, /deployedToTest: true/);
  assert.match(repo, /requiredSecrets: \['REPORT_ALLOWED_ORIGINS'\]/);
  assert.match(repo, /Configure REPORT_ALLOWED_ORIGINS/);
});
