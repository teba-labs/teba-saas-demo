import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('development bypass is explicit and limited to the commercial offline entitlement gate', () => {
  const env = read('config/environment.js');
  const entitlement = read('offline/entitlement.js');
  const policy = read('offline/queue-policy.js');
  assert.match(env, /offlineLicenseMode:\s*'development-bypass'/);
  assert.match(entitlement, /APP_ENV\.offlineLicenseMode === 'development-bypass'/);
  assert.match(entitlement, /status: 'bypassed'/);
  assert.match(entitlement, /mode: 'development-bypass'/);
  assert.match(policy, /if \(isOfflineEntitlementBypassed\(\)\)/);
  assert.match(policy, /tenantId.*branchId|tenantId.*required/);
});

test('preparation accepts bypass status without skipping real data completeness checks', () => {
  const prepare = read('offline/prepare.js');
  assert.match(prepare, /isOfflineEntitlementBypassed/);
  assert.match(prepare, /entitlement\.status !== 'valid'/);
  assert.match(prepare, /if \(!isOfflineEntitlementBypassed\(\)/);
  assert.match(prepare, /if \(!catalog\.length\)/);
  assert.match(prepare, /if \(!staff\.length\)/);
  assert.match(prepare, /patients\.truncated/);
  assert.match(prepare, /worklistTruncated/);
});

test('offline accounts are device-bound and require a password verifier, never a stored password', () => {
  const database = read('offline/database.js');
  const identity = read('offline/device-identity.js');
  const auth = read('core/auth/session.js');
  const backup = read('offline/backup.js');
  assert.match(database, /version\(6\).*offline_sessions/s);
  assert.match(identity, /PBKDF2/);
  assert.match(identity, /password_salt/);
  assert.match(identity, /password_hash/);
  assert.match(identity, /row\.device_id !== device\.device_id/);
  assert.match(identity, /authenticateCachedOfflineUser/);
  assert.match(identity, /if \(active\?\.user_id\)[\s\S]*?return null/);
  assert.match(auth, /auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(auth, /authenticateCachedOfflineUser\(email, password\)/);
  assert.match(auth, /rememberOfflineUser\(data\.user, password\)/);
  assert.match(auth, /authenticateCachedOfflineUser\(email, password\)/);
  assert.match(auth, /fetch\|network\|timeout\|connection\|offline/);
  assert.doesNotMatch(identity, /password:\s*password/);
  assert.doesNotMatch(backup, /offline_sessions|device_identity/);
});

test('licensing issuer, ES256 verification and private-key boundary remain in source', () => {
  const entitlement = read('offline/entitlement.js');
  const edge = read('supabase/functions/issue-offline-entitlement/index.ts');
  const publicKey = read('offline/entitlement-public-key.js');
  assert.match(entitlement, /verifyOfflineEntitlement/);
  assert.match(entitlement, /crypto\.subtle\.verify/);
  assert.match(edge, /OFFLINE_ENTITLEMENT_PRIVATE_JWK/);
  assert.match(edge, /crypto\.subtle\.sign/);
  assert.match(publicKey, /OFFLINE_ENTITLEMENT_KEY_ID/);
  assert.doesNotMatch(publicKey, /"d"\s*:/);
});
