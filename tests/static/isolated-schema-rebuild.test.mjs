import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL(`../../${name}`, import.meta.url), 'utf8');

test('isolated rebuild is pinned to the integration branch and a disposable local stack', async () => {
  const workflow = await read('.github/workflows/supabase-schema-rebuild-audit.yml');
  assert.match(workflow, /ref: integration\\/unified-test-2026-11-19/);
  assert.match(workflow, /supabase\\/setup-cli@v3[\\s\\S]*version: 3\\.2\\.0/);
  assert.match(workflow, /supabase start/);
  assert.match(workflow, /supabase stop/);
  assert.match(workflow, /supabase status -o env/);
  assert.doesNotMatch(workflow, /supabase link|--remote|db push|migration repair/i);
});

test('isolated rebuild packages legacy 001-011 into a CLI baseline and resets only local DB', async () => {
  const workflow = await read('.github/workflows/supabase-schema-rebuild-audit.yml');
  assert.match(workflow, /source "$RUNNER_TEMP\\/supabase-local\\.env"/);
  assert.match(workflow, /supabase migration new taiba_legacy_baseline_001_011/);
  assert.match(workflow, /20261118005154_taiba_legacy_baseline_001_011\\.sql/);
  assert.match(workflow, /supabase db reset/);
  assert.match(workflow, /sed -E.*BEGIN\\|COMMIT/);
  assert.match(workflow, /database\\/migrations\\/0\\{01\\.\\.09\\}_\\*\\.sql/);
  assert.match(workflow, /database\\/migrations\\/01\\{0,1\\}_\\*\\.sql/);
});

test('012-023 are generated with Supabase CLI and applied locally without remote credentials', async () => {
  const workflow = await read('.github/workflows/supabase-schema-rebuild-audit.yml');
  assert.match(workflow, /supabase migration new "$name"/);
  assert.match(workflow, /supabase db reset/);
  assert.match(workflow, /Unexpected hosted database credential/);
  for (const version of ['20261118225924','20261118230038','20261118230051','20261118230054','20261118230057','20261118230348','20261118230358','20261118230400','20261118230402','20261118231112','20261118232302','20261119160000']) {
    assert.ok(workflow.includes(version), `missing TEST ledger version ${version}`);
  }
});

test('private offline intake receipt is protected by RLS and has no public policies', async () => {
  const migration = await read('database/migrations/007_offline_idempotent_visit_intake.sql');
  assert.match(migration, /alter table private\\.offline_visit_intake_receipts enable row level security/i);
  assert.match(migration, /revoke all on table private\\.offline_visit_intake_receipts from public, anon, authenticated/i);
});

test('local tenant isolation checks use synthetic identities and roll back all test data', async () => {
  const sql = await read('database/tests/verify_tenant_isolation.sql');
  assert.match(sql, /begin;/i);
  assert.match(sql, /set local role authenticated/i);
  assert.match(sql, /RLS FAIL: Employee A1 sees foreign patient/i);
  assert.match(sql, /RLS FAIL: Tenant B isolation/i);
  assert.match(sql, /rollback;/i);
});

test('test-branch preview deploys only a Netlify draft and requires preconfigured credentials', async () => {
  const workflow = await read('.github/workflows/netlify-test-preview.yml');
  assert.match(workflow, /branches:[\\s\\S]*integration\\/unified-test-2026-11-19/);
  assert.match(workflow, /secrets\\.NETLIFY_AUTH_TOKEN/);
  assert.match(workflow, /secrets\\.NETLIFY_SITE_ID/);
  assert.match(workflow, /netlify-cli@27\\.20\\.0/);
  assert.match(workflow, /--dir=dist/);
  assert.ok(workflow.includes('test ! -e dist/database'));
  assert.ok(workflow.includes('test ! -e dist/supabase'));
  assert.match(workflow, /--alias=taiba-unified-test/);
  assert.doesNotMatch(workflow, /--prod\\b|prod-if-unlocked|functions deploy/i);
});

test('development source backup is packaged only after the exact triggering commit passes checks', async () => {
  const workflow = await read('.github/workflows/static-contract-tests.yml');
  assert.ok(workflow.includes('ref: ${{ github.sha }}'));
  assert.ok(workflow.includes('node --test tests/static/*.test.mjs'));
  assert.ok(workflow.includes('node --experimental-default-type=module --check'));
  assert.ok(workflow.includes('git archive --format=zip'));
  assert.ok(workflow.includes('actions/upload-artifact@v4'));
  assert.ok(workflow.includes('retention-days: 30'));
});
