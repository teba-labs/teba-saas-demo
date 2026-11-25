import { APP_ENV } from '../config/environment.js';
import { getSupabaseClient } from '../core/supabase-client.js';
import { getCurrentSession } from '../core/auth/session.js';
import { offlineDb } from './database.js';
import {
  getDeviceIdentity,
  rememberOfflineUser,
  setOfflineSessionReady,
} from './device-identity.js';
import {
  OFFLINE_ENTITLEMENT_KEY_ID,
  OFFLINE_ENTITLEMENT_PUBLIC_JWK,
} from './entitlement-public-key.js';

const AUDIENCE = 'taiba-smart-lab-offline';
const MAX_LEASE_SECONDS = 35 * 24 * 60 * 60;
const REFRESH_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
const entitlementKey = ({ tenantId, branchId, userId, deviceId }) =>
  `offline-entitlement:${tenantId}:${branchId}:${userId}:${deviceId}`;

function configuredPublicKey(publicJwk = OFFLINE_ENTITLEMENT_PUBLIC_JWK) {
  return Boolean(publicJwk?.kty === 'EC' && publicJwk?.crv === 'P-256'
    && typeof publicJwk.x === 'string' && typeof publicJwk.y === 'string'
    && publicJwk.x.length > 20 && publicJwk.y.length > 20);
}
function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}
function base64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function deviceKeyThumbprint(jwk) {
  const canonical = JSON.stringify({ crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y });
  return base64Url(await crypto.subtle.digest('SHA-256', encoder.encode(canonical)));
}
async function assertMonotonicDeviceClock(device) {
  const key=`offline-clock:${device.device_id}`;
  const now=Date.now();
  const previous=await offlineDb.sync_meta.get(key);
  const last=Date.parse(previous?.last_seen_at||'');
  if(Number.isFinite(last)&&now+5*60*1000<last){
    throw new Error('ساعة الجهاز رجعت إلى وقت سابق؛ اضبط التاريخ والوقت قبل متابعة العمل أوف لاين.');
  }
  if(!Number.isFinite(last)||now-last>=60*60*1000){
    await offlineDb.sync_meta.put({key,device_id:device.device_id,last_seen_at:new Date(now).toISOString()});
  }
}
async function proveDeviceKey(device) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, device.private_key, challenge,
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk', device.public_key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, challenge,
  );
  if (!valid) throw new Error('تعذر إثبات هوية هذا الجهاز؛ لن نسمح بعمليات أوف لاين جديدة.');
}
export async function verifyOfflineEntitlement(token, expected = {}, options = {}) {
  const publicJwk = options.publicJwk ?? OFFLINE_ENTITLEMENT_PUBLIC_JWK;
  if (!configuredPublicKey(publicJwk)) {
    throw new Error('مفتاح التحقق العام للترخيص لم يُضبط بعد.');
  }
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('صيغة الترخيص الإلكتروني غير صحيحة.');
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJsonSegment(encodedHeader);
  const claims = decodeJsonSegment(encodedClaims);
  if (header.alg !== 'ES256' || header.typ !== 'JWT' || header.kid !== OFFLINE_ENTITLEMENT_KEY_ID) {
    throw new Error('خوارزمية أو هوية مفتاح الترخيص غير معتمدة.');
  }
  const now = Math.floor(Date.now() / 1000);
  const issuer = `${APP_ENV.supabase.url}/functions/v1/issue-offline-entitlement`;
  if (claims.iss !== issuer || claims.aud !== AUDIENCE
      || !claims.sub || claims.sub !== claims.user_id
      || !claims.tenant_id || !claims.branch_id || !claims.device_id
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.nbf)
      || !Number.isInteger(claims.exp) || claims.exp <= claims.iat
      || claims.exp - claims.iat > MAX_LEASE_SECONDS + 300
      || claims.iat > now + 300 || claims.nbf > now + 300) {
    throw new Error('بيانات الترخيص أو مدته أو نطاقه غير صالحة.');
  }
  if (claims.nbf > now) throw new Error('لم يبدأ سريان الترخيص بعد.');
  if (!options.allowExpired && claims.exp <= now) throw new Error('انتهت صلاحية الترخيص المحلي. اتصل بالإنترنت لتجديده.');
  for (const field of ['tenantId', 'branchId', 'userId', 'deviceId']) {
    const claim = field === 'tenantId' ? 'tenant_id'
      : field === 'branchId' ? 'branch_id'
      : field === 'userId' ? 'user_id' : 'device_id';
    if (expected[field] && claims[claim] !== expected[field]) {
      throw new Error('الترخيص لا يخص هذا المعمل أو الفرع أو المستخدم أو الجهاز.');
    }
  }
  const key = await crypto.subtle.importKey(
    'jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    decodeBase64Url(encodedSignature),
    encoder.encode(`${encodedHeader}.${encodedClaims}`),
  );
  if (!verified) throw new Error('التوقيع الإلكتروني للترخيص غير صحيح.');
  return claims;
}

export async function getOfflineEntitlement({ tenantId, branchId, allowExpired = true } = {}) {
  const device = await getDeviceIdentity();
  if (!device.user_id || !tenantId || !branchId) return null;
  const key = entitlementKey({ tenantId, branchId, userId: device.user_id, deviceId: device.device_id });
  const row = await offlineDb.sync_meta.get(key);
  if (!row?.token) return null;
  const claims = await verifyOfflineEntitlement(row.token, {
    tenantId, branchId, userId: device.user_id, deviceId: device.device_id,
  }, { allowExpired });
  const thumbprint = await deviceKeyThumbprint(device.public_key);
  if (claims.device_key_thumbprint !== thumbprint) throw new Error('الترخيص غير مرتبط بمفتاح هذا الجهاز.');
  await assertMonotonicDeviceClock(device);
  await proveDeviceKey(device);
  return { ...row, claims, expired: claims.exp <= Math.floor(Date.now() / 1000) };
}

export async function assertOfflineEntitlement({ tenantId, branchId } = {}) {
  const device = await getDeviceIdentity();
  if (!device.user_id || !device.offline_session_ready) {
    throw new Error('هذا الجهاز غير مجهز بترخيص أوف لاين لهذا المستخدم. اتصل بالإنترنت وجهّز الجهاز أولًا.');
  }
  const entitlement = await getOfflineEntitlement({ tenantId, branchId, allowExpired: false });
  if (!entitlement) throw new Error('لا يوجد ترخيص أوف لاين لهذا الفرع. اتصل بالإنترنت لتجهيزه.');
  return entitlement.claims;
}

export async function getOfflineEntitlementStatus({ tenantId, branchId } = {}) {
  if (!configuredPublicKey()) return { status: 'key-not-configured', expiresAt: null, daysRemaining: 0 };
  try {
    const entitlement = await getOfflineEntitlement({ tenantId, branchId, allowExpired: true });
    if (!entitlement) return { status: 'missing', expiresAt: null, daysRemaining: 0 };
    const remaining = Math.floor((entitlement.claims.exp * 1000 - Date.now()) / 86400000);
    return {
      status: entitlement.expired ? 'expired' : 'valid',
      expiresAt: new Date(entitlement.claims.exp * 1000).toISOString(),
      daysRemaining: Math.max(0, remaining),
      planName: entitlement.claims.plan_name ?? null,
    };
  } catch (error) {
    return { status: 'invalid', expiresAt: null, daysRemaining: 0, message: error.message };
  }
}

export async function refreshOfflineEntitlement({ tenantId, branchId, force = false } = {}) {
  if (globalThis.navigator?.onLine === false) throw new Error('تجديد الترخيص يحتاج اتصالًا بالإنترنت.');
  if (!tenantId || !branchId) throw new Error('اختَر المعمل والفرع قبل تجديد الترخيص.');
  if (!configuredPublicKey()) throw new Error('مفتاح التحقق العام غير مضبوط. جهّز زوج مفاتيح ES256 قبل تفعيل الترخيص.');
  const session = await getCurrentSession();
  if (!session?.user?.id || !session.access_token) throw new Error('سجّل الدخول أثناء الاتصال لتجديد الترخيص.');
  const device = await getDeviceIdentity();
  await rememberOfflineUser(session.user);
  const current = await getOfflineEntitlement({ tenantId, branchId, allowExpired: true }).catch(() => null);
  const now = Math.floor(Date.now() / 1000);
  if (!force && current && current.claims.exp - now > REFRESH_WINDOW_SECONDS) return current;
  const { data, error } = await getSupabaseClient().functions.invoke('issue-offline-entitlement', {
    body: {
      tenant_id: tenantId,
      branch_id: branchId,
      device_id: device.device_id,
      device_public_key: device.public_key,
    },
  });
  if (error) throw new Error(error.message || 'تعذر إصدار الترخيص من الخادم.');
  if (!data?.token) throw new Error('الخادم لم يُرجع ترخيصًا موقّعًا.');
  const claims = await verifyOfflineEntitlement(data.token, {
    tenantId, branchId, userId: session.user.id, deviceId: device.device_id,
  });
  await offlineDb.sync_meta.put({
    key: entitlementKey({ tenantId, branchId, userId: session.user.id, deviceId: device.device_id }),
    tenant_id: tenantId,
    branch_id: branchId,
    user_id: session.user.id,
    device_id: device.device_id,
    token: data.token,
    claims,
    cached_at: new Date().toISOString(),
  });
  const verified = await getOfflineEntitlement({ tenantId, branchId, allowExpired: false });
  if (!verified) throw new Error('تعذر تثبيت الترخيص بعد التحقق من توقيعه وهوية الجهاز.');
  await setOfflineSessionReady(true);
  return verified;
}
