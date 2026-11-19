import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const context = read('core/tenant/context.js');
const offlineDatabase = read('offline/database.js');
const settings = read('assets/js/settings-center.js');
const html = read('app/settings.html');
const migration = read('database/migrations/023_branch_archive_access.sql');

// Operational lists remain active-only, while owners receive a separate history list.
assert.match(context, /branch\.is_active\s*&&\s*\(isOwner\s*\|\|\s*allowedIds\.has\(branch\.id\)\)/);
assert.match(context, /allBranches:\s*isOwner\s*\?\s*tenantBranches\s*:\s*visibleBranches/);
assert.match(settings, /state\.tenant\.allBranches\s*\|\|\s*active/);
assert.match(settings, /BRANCH_ARCHIVE_READY\s*=\s*false/);
assert.match(settings, /data-branch-toggle/);
assert.match(settings, /setBranchActive\(/);
assert.match(settings, /if\(!BRANCH_ARCHIVE_READY\)/);
assert.match(html, /الأرشفة وإعادة التفعيل/);
assert.match(html, /معطلة حتى اجتياز اختبار صلاحيات الوصول/);

// SQL keeps owner access to historical rows but requires an active branch for employees.
assert.match(migration, /private\.is_tenant_owner\(p_tenant_id\)/);
assert.match(migration, /from public\.branches b/);
assert.match(migration, /and b\.is_active/);
assert.match(migration, /bm\.is_active/);
assert.match(migration, /tm\.is_active/);
assert.match(migration, /tm\.account_type = 'employee'/);
assert.match(migration, /grant execute on function private\.can_access_branch\(uuid,uuid\) to authenticated/);
assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
assert.doesNotMatch(migration, /\bupdate\s+public\./i);
assert.match(migration, /No branch, membership, patient, visit, result, or financial row is deleted or rewritten/);


// Offline boundary: an employee device may still use previously cached context/data
// until it reconnects. Archival is server-side authorization, not remote cache erasure.
assert.match(context, /if \(globalThis\.navigator\?\.onLine === false\) return cachedContext\(\)/);
assert.match(context, /offlineDb\.sync_meta\.put/);
assert.match(offlineDatabase, /Dexie/);
assert.doesNotMatch(migration, /Dexie|offlineDb|clear\(/i);

console.log('PASS: branch archive static contract and offline-cache boundary (no runtime RLS claim).');
