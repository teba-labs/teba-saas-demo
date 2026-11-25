import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();
const AUDIENCE = 'taiba-smart-lab-offline';
const MAX_OFFLINE_DAYS = 35;
const DEFAULT_GRACE_DAYS = 3;
const KEY_ID = Deno.env.get('OFFLINE_ENTITLEMENT_KEY_ID') || 'taiba-offline-es256-v1';
const allowedOrigins = new Set([
  'https://teba-labs.github.io',
  'https://teba-labs.com',
  'https://www.teba-labs.com',
  'http://localhost:4174',
  'http://127.0.0.1:4174',
]);

function json(body: unknown, status = 200, origin = '') {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  if (allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}
function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function encodeSegment(value: unknown) {
  return encodeBase64Url(encoder.encode(JSON.stringify(value)));
}
function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function keyThumbprint(jwk: JsonWebKey) {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || jwk.d) {
    throw new Error('A public P-256 device key is required.');
  }
  const canonical = JSON.stringify({ crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y });
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical))));
}
function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return json({ ok: true }, 204, origin);
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);

  try {
    const authorization = request.headers.get('Authorization') || '';
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return json({ error: 'Authentication required.' }, 401, origin);

    const url = Deno.env.get('SUPABASE_URL') || '';
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const publishableKey = publishableKeys.default;
    const secretKey = secretKeys.default;
    if (!url || !publishableKey || !secretKey) {
      return json({ error: 'Server authentication configuration is incomplete.' }, 503, origin);
    }
    const userClient = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(bearer);
    if (authError || !authData.user) return json({ error: 'Authentication required.' }, 401, origin);

    const body = await request.json();
    const tenantId = body?.tenant_id;
    const branchId = body?.branch_id;
    const deviceId = body?.device_id;
    if (!isUuid(tenantId) || !isUuid(branchId) || !isUuid(deviceId)) {
      return json({ error: 'Valid tenant, branch and device identifiers are required.' }, 400, origin);
    }
    const deviceThumbprint = await keyThumbprint(body?.device_public_key || {});

    // The admin client is used only after validating the caller's JWT. Every
    // authorization lookup below is constrained by the authenticated user ID.
    const admin = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userId = authData.user.id;
    const { data: membership, error: membershipError } = await admin
      .from('tenant_memberships')
      .select('id, account_type, is_active')
      .eq('tenant_id', tenantId).eq('user_id', userId).eq('is_active', true).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return json({ error: 'Active tenant membership was not found.' }, 403, origin);

    const { data: tenant, error: tenantError } = await admin
      .from('tenants').select('id, status').eq('id', tenantId).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant || !['active', 'trial'].includes(String(tenant.status).toLowerCase())) {
      return json({ error: 'This laboratory is not active for offline operation.' }, 403, origin);
    }

    const { data: branch, error: branchError } = await admin
      .from('branches').select('id, tenant_id, is_active')
      .eq('id', branchId).eq('tenant_id', tenantId).eq('is_active', true).maybeSingle();
    if (branchError) throw branchError;
    if (!branch) return json({ error: 'Active branch was not found for this laboratory.' }, 403, origin);

    if (membership.account_type !== 'owner') {
      const { data: branchMembership, error: branchMembershipError } = await admin
        .from('branch_memberships').select('id')
        .eq('tenant_id', tenantId).eq('branch_id', branchId)
        .eq('user_id', userId).eq('is_active', true).maybeSingle();
      if (branchMembershipError) throw branchMembershipError;
      if (!branchMembership) return json({ error: 'This user is not assigned to the selected branch.' }, 403, origin);
    }

    const { data: subscription, error: subscriptionError } = await admin
      .from('subscriptions')
      .select('id, status, starts_at, ends_at, trial_ends_at, plan_id')
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    const now = Math.floor(Date.now() / 1000);
    if (!subscription || !['active', 'trial', 'trialing'].includes(String(subscription.status).toLowerCase())) {
      return json({ error: 'No active subscription is available for offline operation.' }, 403, origin);
    }
    const startsAt = timestamp(subscription.starts_at);
    if (startsAt !== null && startsAt > now) return json({ error: 'The subscription has not started yet.' }, 403, origin);
    const periodEnds = [timestamp(subscription.ends_at), timestamp(subscription.trial_ends_at)].filter(value => value !== null);
    const periodEnd = periodEnds.length ? Math.min(...periodEnds) : null;
    const configuredGrace = Number(Deno.env.get('OFFLINE_RENEWAL_GRACE_DAYS') || DEFAULT_GRACE_DAYS);
    const graceDays = Math.min(7, Math.max(0, Number.isFinite(configuredGrace) ? configuredGrace : DEFAULT_GRACE_DAYS));
    const graceUntil = periodEnd === null ? null : periodEnd + graceDays * 86400;
    if (graceUntil !== null && graceUntil <= now) {
      return json({ error: 'The subscription period and renewal grace have expired.' }, 403, origin);
    }

    let plan = null;
    if (subscription.plan_id) {
      const { data, error } = await admin.from('subscription_plans')
        .select('plan_code, plan_name').eq('id', subscription.plan_id).maybeSingle();
      if (error) throw error;
      plan = data;
    }

    const privateJwkRaw = Deno.env.get('OFFLINE_ENTITLEMENT_PRIVATE_JWK');
    if (!privateJwkRaw) return json({ error: 'Offline entitlement signing key is not configured.' }, 503, origin);
    const privateJwk = JSON.parse(privateJwkRaw) as JsonWebKey;
    if (privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || !privateJwk.d || !privateJwk.x || !privateJwk.y) {
      return json({ error: 'Offline entitlement signing key is invalid.' }, 503, origin);
    }
    const signingKey = await crypto.subtle.importKey(
      'jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
    );

    const exp = Math.min(now + MAX_OFFLINE_DAYS * 86400, graceUntil ?? Number.MAX_SAFE_INTEGER);
    const claims = {
      iss: `${url}/functions/v1/issue-offline-entitlement`,
      aud: AUDIENCE,
      sub: userId,
      user_id: userId,
      tenant_id: tenantId,
      branch_id: branchId,
      device_id: deviceId,
      device_key_thumbprint: deviceThumbprint,
      subscription_id: subscription.id,
      subscription_status: subscription.status,
      plan_code: plan?.plan_code ?? null,
      plan_name: plan?.plan_name ?? null,
      iat: now,
      nbf: now - 30,
      exp,
      max_offline_days: MAX_OFFLINE_DAYS,
      renewal_grace_days: graceDays,
    };
    const header = { alg: 'ES256', typ: 'JWT', kid: KEY_ID };
    const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(signingInput),
    );
    return json({ token: `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`, expires_at: new Date(exp * 1000).toISOString() }, 200, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to issue offline entitlement.' }, 400, origin);
  }
});
