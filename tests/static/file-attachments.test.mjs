import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge=fs.readFileSync(new URL('../../supabase/functions/upload-attachment/index.ts',import.meta.url),'utf8');
const repo=fs.readFileSync(new URL('../../modules/files/repository.js',import.meta.url),'utf8');
const config=fs.readFileSync(new URL('../../supabase/config.toml',import.meta.url),'utf8');

test('attachment upload requires JWT, exact allowed origin, bounded allowlisted file types and magic bytes',()=>{
  assert.match(edge,/auth\.getUser\(bearer\)/);
  assert.match(edge,/ATTACHMENT_ALLOWED_ORIGINS/);
  assert.match(edge,/MAX_BYTES = 10 \* 1024 \* 1024/);
  assert.match(edge,/application\/pdf/);
  assert.match(edge,/image\/jpeg/);
  assert.match(edge,/image\/png/);
  assert.match(edge,/type\.signature\.every/);
});

test('attachment object and tenant/branch metadata are created through the authorized user context',()=>{
  assert.match(edge,/user\.storage\.from\('tenant-attachments'\)\.upload/);
  assert.match(edge,/user\.from\('file_metadata'\)\.insert/);
  assert.match(edge,/tenant_id:tenantId,branch_id:branchId,related_visit_id:visitId/);
  assert.match(edge,/admin\.storage\.from\('tenant-attachments'\)\.remove/);
  assert.doesNotMatch(repo,/SERVICE_ROLE|service_role/i);
});

test('attachment downloads first verify RLS-scoped metadata and use short-lived signed URLs',()=>{
  assert.match(repo,/\.eq\('tenant_id',tenantId\)\.eq\('branch_id',branchId\)/);
  assert.match(repo,/createSignedUrl\(file\.storage_path,seconds\)/);
});

test('attachment Edge Function keeps JWT verification enabled',()=>{
  assert.match(config,/\[functions\.upload-attachment\][\s\S]*verify_jwt\s*=\s*true/);
});
