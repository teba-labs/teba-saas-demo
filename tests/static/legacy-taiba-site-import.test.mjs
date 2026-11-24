import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261125000100_import_legacy_taiba_public_site.sql'),'utf8');
const editorHtml=fs.readFileSync(path.join(root,'app/cms-editor.html'),'utf8');
const editorJs=fs.readFileSync(path.join(root,'assets/js/cms-editor.js'),'utf8');
const page=fs.readFileSync(path.join(root,'website/public-site-page.js'),'utf8');
const websiteHtml=fs.readFileSync(path.join(root,'website/index.html'),'utf8');

test('legacy Taiba website import is complete, scoped and idempotent',()=>{
  const match=migration.match(/\$payload\$([\s\S]*?)\$payload\$::jsonb/);
  assert.ok(match,'migration must carry the reviewed legacy CMS payload');
  const payload=JSON.parse(match[1]);
  assert.equal(payload.tests.length,495);
  assert.equal(payload.packages.length,6);
  assert.equal(payload.articles.length,8);
  assert.equal(payload.faqs.length,5);
  assert.equal(payload.testimonials.length,6);
  assert.equal(payload.sections.length,11);
  assert.match(migration,/where slug='teba-labs'/);
  assert.match(migration,/on conflict\(tenant_id,code\) do nothing/);
  assert.match(migration,/on conflict\(tenant_id,section_key\) do nothing/);
  assert.match(migration,/not exists\(select 1 from public\.site_packages/);
  assert.doesNotMatch(migration,/delete from public\.(patients|visits|test_results|branches)/i);
  assert.doesNotMatch(migration,/update public\.site_settings[^;]*is_published\s*=/i);
  assert.doesNotMatch(migration,/portal_settings|patient_portal_enabled/i);
});

test('Taiba studio exposes legacy public contact and homepage fields as guided inputs',()=>{
  for(const id of ['sitePhone','siteWhatsapp','siteFacebook','siteAddress','siteDoctor','heroImageUrl','branchHoursText']) assert.match(editorHtml,new RegExp('id="'+id+'"'));
  for(const key of ['phone_display','whatsapp_display','facebook_url','doctor_name','hero_image_url','branch_hours_text']) assert.ok(editorJs.includes(key));
  assert.match(editorJs,/replace\(\/\\D\/g,''\)/);
});

test('public site renders imported contact, branch hours, hero image and current offers safely',()=>{
  for(const id of ['facebookCta','branchHoursPublic','contactDetails']) assert.match(websiteHtml,new RegExp('id="'+id+'"'));
  assert.match(page,/safeUrl\(content\.hero_image_url\)/);
  assert.match(page,/https:\/\/wa\.me\//);
  assert.match(page,/new Date\(x\.ends_at\)/);
  assert.match(page,/sectionVisibility/);
});
