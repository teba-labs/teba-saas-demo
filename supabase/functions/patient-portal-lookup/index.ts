import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const GENERIC_FAILURE = { ok: false, message: 'لا توجد نتائج منشورة متاحة بهذه البيانات حاليًا. قد تكون التحاليل قيد الاختبار والمراجعة.' };

function json(body: unknown, status = 200, origin = '') {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Vary': 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeName(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ar');
}

async function digest(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const allowed = allowedOrigins();
  const origin = req.headers.get('origin') ?? '';
  if (!allowed.length) {
    console.error('Patient portal origin allowlist is not configured.');
    return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503);
  }
  if (req.method === 'OPTIONS') return json({ ok: true }, 200, allowed.includes(origin) ? origin : '');
  if (req.method !== 'POST') return json({ ok: false, message: 'Method not allowed.' }, 405);
  if (!origin || !allowed.includes(origin)) return json({ ok: false, message: 'Origin not allowed.' }, 403);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json(GENERIC_FAILURE, 400, origin); }
  const slug = String(payload.slug ?? '').trim().toLowerCase();
  const patientName = String(payload.patientName ?? '').trim();
  const visitNumber = String(payload.visitNumber ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug) || patientName.length < 2 || patientName.length > 160 || visitNumber.length < 1 || visitNumber.length > 40) {
    return json(GENERIC_FAILURE, 200, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const pepper = Deno.env.get('PORTAL_HASH_SECRET');
  if (!supabaseUrl || !serviceKey || !pepper) {
    console.error('Patient portal server secrets are not configured.');
    return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: tenant, error: tenantError } = await admin.from('tenants')
    .select('id, name, slug').eq('slug', slug).in('status', ['trial', 'active']).maybeSingle();
  if (tenantError || !tenant) return json(GENERIC_FAILURE, 200, origin);
  const { data: portalConfig, error: portalConfigError } = await admin.from('site_settings')
    .select('portal_settings').eq('tenant_id', tenant.id).maybeSingle();
  if (portalConfigError) {
    console.error('Patient portal enablement check failed.', portalConfigError.message);
    return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  }
  if (portalConfig?.portal_settings?.enabled !== true) return json(GENERIC_FAILURE, 200, origin);

  const lookupHash = await digest(pepper, `lookup|${slug}|${normalizeName(patientName)}|${visitNumber.toLowerCase()}`);
  const clientIp = req.headers.get('cf-connecting-ip')?.trim()
    || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')?.trim();
  if (!clientIp) {
    console.error('Patient portal request did not include a trusted client IP.');
    return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  }
  const ipHash = await digest(pepper, `ip|${clientIp}`);
  const { data: rateLimit, error: rateLimitError } = await admin.rpc('consume_patient_portal_attempt', {
    p_tenant_id: tenant.id, p_lookup_hash: lookupHash, p_ip_hash: ipHash,
  });
  if (rateLimitError || !rateLimit) {
    console.error('Atomic portal rate-limit failed.', rateLimitError?.message);
    return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  }
  if (!rateLimit.allowed) {
    return json({ ok: false, message: 'تم إيقاف المحاولات مؤقتًا لحماية البوابة. حاول مرة أخرى بعد ساعة.' }, 429, origin);
  }
  const attemptId = String(rateLimit.attempt_id ?? '');

  const wantedName = normalizeName(patientName);
  const matchingVisits: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data: visitRows, error: visitError } = await admin.from('visits')
      .select('id, tenant_id, branch_id, visit_number, is_published, patients!inner(full_name)')
      .eq('tenant_id', tenant.id).eq('visit_number', visitNumber)
      .order('id', { ascending: true }).range(offset, offset + 499);
    if (visitError) {
      console.error('Portal visit lookup failed.', visitError.message);
      return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
    }
    matchingVisits.push(...(visitRows ?? []).filter(row =>
      normalizeName(String((row.patients as { full_name?: string })?.full_name ?? '')) === wantedName
    ));
    // Continue across all branches; the eligible report versions are resolved below.
    if ((visitRows ?? []).length < 500) break;
  }
  const candidateIds = matchingVisits.map(row => String(row.id));
  const latestReports = new Map<string, Record<string, unknown>>();
  if (candidateIds.length) {
    const { data: reports, error: reportError } = await admin.from('report_versions')
      .select('visit_id, storage_path, version_number, publication_type')
      .eq('tenant_id', tenant.id).in('visit_id', candidateIds).eq('is_published', true)
      .order('version_number', { ascending: false });
    if (reportError) {
      console.error('Portal report lookup failed.', reportError.message);
      return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
    }
    for (const row of reports ?? []) {
      const id = String(row.visit_id);
      if (!latestReports.has(id)) latestReports.set(id, row);
    }
  }
  // Visit numbers are unique per branch, not per tenant. Only a single
  // patient match with an actually published report (final or partial) is eligible.
  const eligibleVisits = matchingVisits.filter(row => latestReports.has(String(row.id)));
  const visit = eligibleVisits.length === 1 ? eligibleVisits[0] : undefined;
  const report = visit ? latestReports.get(String(visit.id)) : undefined;

  let signedUrl: string | null = null;
  let reportVersion: number | null = null;
  let isPartial = false;
  if (report?.storage_path) {
    const { data: signed, error: signedError } = await admin.storage.from('tenant-reports')
      .createSignedUrl(String(report.storage_path), 120);
    if (signedError) {
      console.error('Portal signed URL failed.', signedError.message);
      return json({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
    }
    signedUrl = signed.signedUrl;
    reportVersion = Number(report.version_number);
    isPartial = report.publication_type === 'partial';
  }

  if (signedUrl && attemptId) {
    const { error: markError } = await admin.from('portal_access_attempts')
      .update({ succeeded: true }).eq('tenant_id', tenant.id).eq('id', attemptId);
    if (markError) console.error('Portal success audit update failed.', markError.message);
  }

  if (!signedUrl) return json(GENERIC_FAILURE, 200, origin);
  return json({
    ok: true,
    laboratoryName: tenant.name,
    visitNumber: visit.visit_number,
    reportVersion,
    isPartial,
    reportUrl: signedUrl,
    expiresInSeconds: 120,
  }, 200, origin);
});
