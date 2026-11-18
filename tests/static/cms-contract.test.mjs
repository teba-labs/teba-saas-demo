import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const cms = fs.readFileSync(path.join(root, 'website/cms-repository.js'), 'utf8');
const site = fs.readFileSync(path.join(root, 'website/public-site.js'), 'utf8');

test('CMS contract restricts table names, scopes writes by tenant and relies on RLS', () => {
  assert.match(cms, /const COLLECTIONS = Object\.freeze/);
  assert.match(cms, /\.eq\('tenant_id', tenantId\)/);
  assert.match(cms, /site_settings/);
  assert.match(cms, /Unsupported CMS collection/);
  assert.match(cms, /RLS remains the authority/);
  assert.doesNotMatch(cms, /\.delete\(\)/);
});

test('Public site loader resolves published slug and reads only public CMS collections', () => {
  assert.match(site, /get_public_tenant_by_slug/);
  assert.match(site, /Database RLS additionally filters every collection/);
  for (const table of ['site_settings','site_sections','site_test_catalog','site_packages','site_articles','site_faqs','site_testimonials','site_offers','site_branch_profiles']) {
    assert.ok(site.includes(table), `missing ${table}`);
  }
  assert.doesNotMatch(site, /patients|test_results|report_versions/);
});
