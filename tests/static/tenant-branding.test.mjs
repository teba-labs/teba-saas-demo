import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const branding=fs.readFileSync(new URL('assets/js/tenant-branding.js',root),'utf8');
const worker=fs.readFileSync(new URL('service-worker.js',root),'utf8');
const reception=fs.readFileSync(new URL('assets/js/reception.js',root),'utf8');
const settings=fs.readFileSync(new URL('assets/js/settings-center.js',root),'utf8');
assert.match(branding,/getLabSettings/);
assert.match(branding,/getLabAssetPublicUrl/);
assert.match(branding,/onAuthStateChange/);
assert.match(branding,/SIGNED_IN/);
assert.match(branding,/SIGNED_OUT/);
assert.match(branding,/laboratory_name/);
assert.match(branding,/logo_path/);
assert.match(branding,/taiba:tenant-branding-ready/);
assert.match(branding,/taiba:tenant-settings-updated/);
assert.match(reception,/__taibaTenantBrand/);
assert.match(reception,/getLabAssetPublicUrl/);
assert.match(reception,/print\.paperSize/);
assert.match(reception,/print\.signaturePath/);
assert.match(settings,/notifyTenantSettingsUpdated/);
assert.match(settings,/taiba:tenant-settings-updated/);
assert.match(worker,/taiba-smart-lab-shell-v15/);
assert.match(worker,/assets\/js\/tenant-branding\.js/);
for (const page of ['index','reception','workday','results-workbench','catalog','dashboard','cms-editor','sync-center','settings','data-import']) {
  const html=fs.readFileSync(new URL(`app/${page}.html`,root),'utf8');
  assert.match(html,/assets\/js\/tenant-branding\.js/, `${page} must load shared tenant branding`);
}
console.log('PASS: tenant identity module is included in all owner/staff workspaces and cached by the updated service worker.');
