import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const GENERIC_ERROR = { ok: false, message: 'تعذر إرسال الطلب الآن. حاول مرة أخرى لاحقًا أو تواصل مع المعمل.' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200, origin = '') {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Vary': 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type',
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function digest(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async req => {
  const allowed = (Deno.env.get('PUBLIC_SITE_ALLOWED_ORIGINS') ?? Deno.env.get('PORTAL_ALLOWED_ORIGINS') ?? '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const origin = req.headers.get('origin') ?? '';
  if (!allowed.length) return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503);
  if (req.method === 'OPTIONS') return json({ ok: true }, 200, allowed.includes(origin) ? origin : '');
  if (req.method !== 'POST') return json({ ok: false, message: 'Method not allowed.' }, 405, allowed.includes(origin) ? origin : '');
  if (!origin || !allowed.includes(origin)) return json({ ok: false, message: 'Origin not allowed.' }, 403);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json(GENERIC_ERROR, 400, origin); }

  const slug = String(payload.slug ?? '').trim().toLowerCase();
  const requestType = String(payload.request_type ?? '');
  const fullName = String(payload.full_name ?? '').trim().replace(/\\s+/gu, ' ');
  const phone = String(payload.phone ?? '').trim().replace(/[\\s()\\-]/g, '');
  const preferredDate = String(payload.preferred_date ?? '').trim();
  const preferredPeriod = String(payload.preferred_period ?? '').trim();
  const message = String(payload.message ?? '').trim();
  const branchId = String(payload.branch_id ?? '').trim();
  const packageId = String(payload.package_id ?? '').trim();

  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)
    || !['home_sampling', 'package_inquiry'].includes(requestType)
    || fullName.length < 2 || fullName.length > 160
    || !/^\\+?[0-9]{7,20}$/.test(phone)
    || message.length > 1000
    || (preferredPeriod && !['morning', 'afternoon', 'evening'].includes(preferredPeriod))
    || (branchId && !UUID.test(branchId))
    || (requestType === 'package_inquiry' && !UUID.test(packageId))
    || (requestType === 'home_sampling' && packageId)) {
    return json(GENERIC_ERROR, 400, origin);
  }
  if (preferredDate) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(preferredDate)) return json(GENERIC_ERROR, 400, origin);
    const date = new Date(preferredDate + 'T00:00:00.000Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== preferredDate
      || preferredDate < new Date().toISOString().slice(0, 10)) return json(GENERIC_ERROR, 400, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const hashSecret = Deno.env.get('PORTAL_HASH_SECRET');
  if (!supabaseUrl || !serviceKey || !hashSecret) return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: tenant, error: tenantError } = await admin.from('tenants')
    .select('id, slug, status').eq('slug', slug).in('status', ['trial', 'active']).maybeSingle();
  if (tenantError || !tenant) return json(GENERIC_ERROR, 404, origin);

  const { data: site, error: siteError } = await admin.from('site_settings')
    .select('is_published').eq('tenant_id', tenant.id).maybeSingle();
  if (siteError || !site?.is_published) return json(GENERIC_ERROR, 404, origin);

  let branchIdToSave: string | null = null;
  if (branchId) {
    const { data: branch, error } = await admin.from('site_branch_profiles')
      .select('branch_id').eq('tenant_id', tenant.id).eq('branch_id', branchId)
      .eq('show_on_site', true).eq('is_published', true).maybeSingle();
    if (error || !branch?.branch_id) return json(GENERIC_ERROR, 400, origin);
    branchIdToSave = branch.branch_id;
  }

  let packageIdToSave: string | null = null;
  let packageTitle: string | null = null;
  if (requestType === 'package_inquiry') {
    const { data: pack, error } = await admin.from('site_packages')
      .select('id, title').eq('tenant_id', tenant.id).eq('id', packageId)
      .eq('is_active', true).eq('is_published', true).maybeSingle();
    if (error || !pack) return json(GENERIC_ERROR, 400, origin);
    packageIdToSave = pack.id;
    packageTitle = pack.title;
  }

  const clientIp = req.headers.get('cf-connecting-ip')?.trim()
    || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')?.trim();
  if (!clientIp) return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  const ipHash = await digest(hashSecret, 'public-site|' + clientIp);
  const { data: limit, error: limitError } = await admin.rpc('consume_site_request_attempt', {
    p_tenant_id: tenant.id, p_ip_hash: ipHash,
  });
  if (limitError || !limit) return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  if (limit.allowed !== true) return json({ ok: false, message: 'وصلت لعدد الطلبات المسموح به مؤقتًا. حاول بعد ساعة.' }, 429, origin);

  const { error: insertError } = await admin.from('site_booking_requests').insert({
    tenant_id: tenant.id,
    request_type: requestType,
    full_name: fullName,
    phone,
    branch_id: branchIdToSave,
    package_id: packageIdToSave,
    package_title_snapshot: packageTitle,
    preferred_date: preferredDate || null,
    preferred_period: preferredPeriod || null,
    message: message || null,
  });
  if (insertError) {
    console.error('Public site request insert failed.', insertError.message);
    return json({ ok: false, message: 'تعذر حفظ الطلب الآن. حاول مرة أخرى لاحقًا.' }, 503, origin);
  }

  return json({ ok: true, message: 'تم استلام طلبك. سيتواصل معك فريق المعمل لتأكيد التفاصيل.' }, 201, origin);
});
