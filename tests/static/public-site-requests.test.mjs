import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const html=readFileSync(path.join(root,'website/index.html'),'utf8');
const js=readFileSync(path.join(root,'website/public-site-page.js'),'utf8');
const css=readFileSync(path.join(root,'website/site.css'),'utf8');
const ui=readFileSync(path.join(root,'website/public-site-ui.js'),'utf8');
const workflow=readFileSync(path.join(root,'.github/workflows/public-website-preview.yml'),'utf8');
const migration=readFileSync(path.join(root,'database/migrations/113_public_site_booking_requests.sql'),'utf8');
const hardening=readFileSync(path.join(root,'database/migrations/114_public_site_request_privilege_hardening.sql'),'utf8');
const edge=readFileSync(path.join(root,'supabase/functions/submit-site-request/index.ts'),'utf8');
const repository=readFileSync(path.join(root,'website/cms-repository.js'),'utf8');
const studio=readFileSync(path.join(root,'app/cms-editor.html'),'utf8');
const editor=readFileSync(path.join(root,'assets/js/cms-editor.js'),'utf8');

test('public website uses the approved Taiba premium design system',()=>{
  assert.match(html,/family=Almarai/);
  assert.match(css,/#0a6847/);
  assert.match(css,/#eab308/);
  assert.match(css,/data-theme="dark"/);
  assert.match(css,/@media\(max-width:720px\)/);
});
test('homepage does not render or link to the medical test catalog',()=>{
  assert.doesNotMatch(html,/id="tests"|href="#tests"|testCards/);
  assert.doesNotMatch(js,/cards\('testCards'/);
  assert.match(js,/x\.section_key!=='tests'/);
});
test('public site keeps CMS content and patient portal entry points',()=>{
  for(const id of ['heroTitle','servicesTextPublic','packageCards','articleCards','faqCards','branchCards','contactDetails','patientAccess']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(js,/loadPublishedSite/);
  assert.match(js,/portal\/index\.html\?lab=/);
});
test('mobile navigation and patient access controls are interactive',()=>{
  assert.match(html,/id="mobileMenuToggle"/);
  assert.match(ui,/classList\.toggle\('is-open'\)/);
  assert.match(ui,/showModal\(\)/);
  assert.match(ui,/close\(\)/);
});
test('preview deployment uses GitHub Pages from main without Netlify credentials',()=>{
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/actions\/deploy-pages@v4/);
  assert.match(workflow,/enablement: true/);
  assert.doesNotMatch(workflow,/NETLIFY_|netlify-cli/);
});
test('home sampling and package inquiry requests are submitted to the secure cloud endpoint',()=>{
  assert.match(html,/id="homeSamplingRequest"/);
  assert.match(html,/id="siteRequestForm"/);
  assert.match(js,/functions\.invoke\('submit-site-request'/);
  assert.match(js,/data-package-request/);
  assert.match(edge,/site_booking_requests/);
  assert.match(edge,/PORTAL_HASH_SECRET/);
  assert.match(edge,/consume_site_request_attempt/);
  assert.match(edge,/\.eq\('tenant_id', tenant\.id\)/);
});
test('public request data is private to the tenant owner and rate limited',()=>{
  assert.match(migration,/create table if not exists public\.site_booking_requests/i);
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/private\.is_tenant_owner\(tenant_id\)/);
  assert.match(migration,/revoke all on table public\.site_booking_requests from public, anon/i);
  assert.match(migration,/consume_site_request_attempt/);
  assert.doesNotMatch(migration,/grant .* to anon/i);
  assert.match(hardening,/revoke all on table public\\.site_booking_requests from public, anon, authenticated/i);
  assert.match(hardening,/grant select, update on table public\\.site_booking_requests to authenticated/i);
});
test('website studio can review requests and update status without deleting them',()=>{
  assert.match(studio,/id="view-requests"/);
  assert.match(editor,/listSiteRequests/);
  assert.match(editor,/updateSiteRequestStatus/);
  assert.match(repository,/\.eq\('tenant_id', tenantId\)/);
  assert.doesNotMatch(repository,/\.delete\(\)/);
});
