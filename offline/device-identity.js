import { offlineDb, assertOfflineDatabaseReady } from './database.js';

const ID = 'primary';

export async function getDeviceIdentity() {
  await assertOfflineDatabaseReady();
  let row = await offlineDb.device_identity.get(ID);
  if (row?.device_id && row?.private_key && row?.public_key) return row;
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) {
    throw new Error('هذا المتصفح لا يدعم إنشاء هوية جهاز آمنة للأوف لاين.');
  }
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  row = {
    id: ID,
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

export async function rememberOfflineUser(user) {
  if (!user?.id) return null;
  const device = await getDeviceIdentity();
  const sameUser = device.user_id === user.id;
  const next = {
    ...device,
    user_id: user.id,
    email: user.email ?? null,
    last_authenticated_at: new Date().toISOString(),
    offline_session_ready: sameUser ? Boolean(device.offline_session_ready) : false,
  };
  await offlineDb.device_identity.put(next);
  return next;
}

export async function getCachedOfflineUser() {
  const device = await offlineDb.device_identity.get(ID);
  if (!device?.offline_session_ready || !device.user_id) return null;
  return { id: device.user_id, email: device.email ?? undefined, app_metadata: {}, user_metadata: {} };
}

export async function setOfflineSessionReady(ready) {
  const device = await getDeviceIdentity();
  await offlineDb.device_identity.put({ ...device, offline_session_ready: Boolean(ready) });
}

export async function clearCachedOfflineUser() {
  const device = await offlineDb.device_identity.get(ID);
  if (!device) return;
  await offlineDb.device_identity.put({
    ...device,
    user_id: null,
    email: null,
    offline_session_ready: false,
    last_signed_out_at: new Date().toISOString(),
  });
}
