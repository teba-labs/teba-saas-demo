import { offlineDb, assertOfflineDatabaseReady } from './database.js';

const DEVICE_ID = 'primary';
const ACTIVE_USER_KEY = 'active-offline-user';
const PASSWORD_ITERATIONS = 310000;
const encoder = new TextEncoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function deriveOfflinePassword(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits'],
  );
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS },
    material, 256,
  ));
}
function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function getDeviceIdentity() {
  await assertOfflineDatabaseReady();
  let row = await offlineDb.device_identity.get(DEVICE_ID);
  if (row?.device_id && row?.private_key && row?.public_key) return row;
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) {
    throw new Error('هذا المتصفح لا يدعم إنشاء هوية جهاز آمنة للأوف لاين.');
  }
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'],
  );
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  row = {
    id: DEVICE_ID,
    device_id: crypto.randomUUID(),
    private_key: pair.privateKey,
    public_key: publicKey,
    user_id: null,
    email: null,
    offline_session_ready: false,
    created_at: new Date().toISOString(),
  };
  await offlineDb.device_identity.put(row);
  return row;
}

/**
 * Cache an authenticated account on this device. The password is never stored:
 * only a salted PBKDF2 verifier is retained to authenticate that account later
 * when the network is unavailable. Calls without a password preserve the
 * verifier already created by signInWithEmail.
 */
export async function rememberOfflineUser(user, password) {
  if (!user?.id) return null;
  const device = await getDeviceIdentity();
  const existing = await offlineDb.offline_sessions.get(user.id);
  let passwordSalt = existing?.password_salt ?? null;
  let passwordHash = existing?.password_hash ?? null;
  if (typeof password === 'string' && password.length) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    passwordSalt = toBase64(salt);
    passwordHash = toBase64(await deriveOfflinePassword(password, salt));
  }
  const next = {
    user_id: user.id,
    email: String(user.email || existing?.email || '').trim().toLowerCase(),
    device_id: device.device_id,
    password_salt: passwordSalt,
    password_hash: passwordHash,
    offline_session_ready: true,
    last_authenticated_at: new Date().toISOString(),
  };
  await offlineDb.offline_sessions.put(next);
  await offlineDb.sync_meta.put({ key: ACTIVE_USER_KEY, user_id: user.id, cached_at: new Date().toISOString() });
  await offlineDb.device_identity.put({
    ...device, user_id: user.id, email: next.email, offline_session_ready: true,
    last_authenticated_at: next.last_authenticated_at,
  });
  return next;
}

function asOfflineUser(row) {
  return {
    id: row.user_id,
    email: row.email || undefined,
    app_metadata: {},
    user_metadata: {},
  };
}

export async function getCachedOfflineUser() {
  await assertOfflineDatabaseReady();
  const active = await offlineDb.sync_meta.get(ACTIVE_USER_KEY);
  if (active?.user_id) {
    const row = await offlineDb.offline_sessions.get(active.user_id);
    const device = await offlineDb.device_identity.get(DEVICE_ID);
    if (row?.offline_session_ready && row.device_id === device?.device_id) return asOfflineUser(row);
    return null;
  }
  if (await offlineDb.offline_sessions.count()) return null;
  // Backward compatibility for devices prepared by the previous single-user model.
  const legacy = await offlineDb.device_identity.get(DEVICE_ID);
  if (legacy?.offline_session_ready && legacy.user_id) {
    return { id: legacy.user_id, email: legacy.email ?? undefined, app_metadata: {}, user_metadata: {} };
  }
  return null;
}

/** Verify a previously online-authenticated account before allowing offline sign-in. */
export async function authenticateCachedOfflineUser(email, password) {
  await assertOfflineDatabaseReady();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const rows = await offlineDb.offline_sessions.where('email').equals(normalizedEmail).toArray();
  const device = await getDeviceIdentity();
  for (const row of rows) {
    if (!row.offline_session_ready || row.device_id !== device.device_id
        || !row.password_salt || !row.password_hash) continue;
    const candidate = await deriveOfflinePassword(password, fromBase64(row.password_salt));
    if (!sameBytes(candidate, fromBase64(row.password_hash))) continue;
    await offlineDb.sync_meta.put({ key: ACTIVE_USER_KEY, user_id: row.user_id, cached_at: new Date().toISOString() });
    return asOfflineUser(row);
  }
  throw new Error('بيانات الدخول غير صحيحة أو لم يتم تسجيل هذا الحساب على الجهاز أثناء الاتصال بالإنترنت.');
}

export async function setOfflineSessionReady(ready) {
  const device = await getDeviceIdentity();
  const active = await offlineDb.sync_meta.get(ACTIVE_USER_KEY);
  const userId = active?.user_id || device.user_id;
  if (userId) {
    const session = await offlineDb.offline_sessions.get(userId);
    if (session) await offlineDb.offline_sessions.put({ ...session, offline_session_ready: Boolean(ready) });
  }
  await offlineDb.device_identity.put({ ...device, offline_session_ready: Boolean(ready) });
}

export async function clearCachedOfflineUser() {
  const device = await offlineDb.device_identity.get(DEVICE_ID);
  await offlineDb.sync_meta.delete(ACTIVE_USER_KEY);
  if (device) {
    await offlineDb.device_identity.put({
      ...device, user_id: null, email: null, offline_session_ready: false,
      last_signed_out_at: new Date().toISOString(),
    });
  }
}
