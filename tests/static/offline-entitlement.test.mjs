import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('offline entitlement bootstraps and persists only the public ES256 verification key from Supabase', () => {
  const client = read('offline/entitlement.js');
  const key = read('offline/entitlement-public-key.js');
  const edge = read('supabase/functions/issue-offline-entitlement/index.ts');
  assert.match(client, /name: 'ECDSA', hash: 'SHA-256'/);
  assert.match(client, /OFFLINE_ENTITLEMENT_PUBLIC_JWK/);
  assert.match(client, /if \(!configuredPublicKey\(publicJwk\)\)/);
  assert.match(key, /OFFLINE_ENTITLEMENT_PUBLIC_JWK = null/);
  assert.match(client, /method: 'GET'/);
  assert.match(client, /public_jwk: publicJwk/);
  assert.match(client, /row\.public_jwk/);
  assert.match(edge, /request\.method === 'GET'/);
  assert.match(edge, /public_jwk: \{ kty: 'EC', crv: 'P-256'/);
  assert.doesNotMatch(edge, /public_jwk: privateJwk/);
  assert.match(edge, /OFFLINE_ENTITLEMENT_PRIVATE_JWK/);
  assert.match(edge, /name: 'ECDSA', hash: 'SHA-256'/);
  assert.match(edge, /MAX_OFFLINE_DAYS = 35/);
});

test('entitlement is scoped to tenant, branch, user, device and a P-256 device key thumbprint', () => {
  const client = read('offline/entitlement.js');
  const edge = read('supabase/functions/issue-offline-entitlement/index.ts');
  assert.match(client, /tenant_id/);
  assert.match(client, /branch_id/);
  assert.match(client, /device_key_thumbprint/);
  assert.match(client, /assertMonotonicDeviceClock/);
  assert.match(client, /last_seen_at/);
  assert.match(client, /proveDeviceKey/);
  assert.match(edge, /tenant_memberships/);
  assert.match(edge, /branch_memberships/);
  assert.match(edge, /device_key_thumbprint: deviceThumbprint/);
  assert.match(edge, /subscription_id/);
});

test('offline entitlement expiry blocks new outbox operations but never blocks synchronization', () => {
  const outbox = read('offline/outbox.js');
  const adapters = read('offline/supabase-adapters.js');
  const policy = read('offline/queue-policy.js');
  assert.match(outbox, /assertQueueAllowed/);
  assert.doesNotMatch(outbox, /subscription|entitlement|expires_at/i);
  assert.match(policy, /assertOfflineEntitlement/);
  assert.match(adapters, /createSupabaseSyncHandlers/);
});

test('offline auth fallback requires a previously entitled device session', () => {
  const session = read('core/auth/session.js');
  const identity = read('offline/device-identity.js');
  assert.match(session, /getCachedOfflineUser/);
  assert.match(identity, /offline_session_ready/);
  assert.match(identity, /private_key/);
});

test('device identity is local-only and excluded from portable backup exports', () => {
  const database = read('offline/database.js');
  const backup = read('offline/backup.js');
  assert.match(database, /device_identity/);
  assert.doesNotMatch(backup, /device_identity/);
});
