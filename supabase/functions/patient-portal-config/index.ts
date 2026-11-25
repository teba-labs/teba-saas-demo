import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const DEFAULTS = {
  enabled: false,
  title: 'بوابة نتائج التحاليل',
  intro: 'أدخل اسم المريض ورقم الزيارة كما هو موضح في إيصال المعمل لعرض أحدث تقرير معتمد.',
  patient_name_label: 'اسم المريض بالكامل',
  visit_number_label: 'رقم الزيارة',
  submit_label: 'عرض التقرير',
  help_text: 'لا تشارك رابط التقرير مع أي شخص آخر. رابط التحميل مؤقت.',
  accent_color: '#147c72',
};
const DEFAULT_ALLOWED_ORIGINS = [
  'https://teba-labs.github.io',
  'https://teba-labs.com',
  'https://www.teba-labs.com',
];
function allowedOrigins() {
  const configured = (Deno.env.get('PORTAL_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];
}
function response(body: unknown, status = 200, origin = '') {
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
function defaultSecretKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof keys.default === 'string' && keys.default) return keys.default;
  } catch {}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}
Deno.serve(async req => {
  const allowed = allowedOrigins();
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') {
    return allowed.includes(origin)
      ? response({ ok: true }, 200, origin)
      : response({ ok: false }, 403);
  }
  if (!origin || !allowed.includes(origin)) return response({ ok: false }, 403);
  if (req.method !== 'POST') return response({ ok: false }, 405, origin);
  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return response({ ok: false }, 400, origin); }
  const slug = String(payload.slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) return response({ ok: false }, 400, origin);
  const url = Deno.env.get('SUPABASE_URL');
  const key = defaultSecretKey();
  if (!url || !key) return response({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: tenant, error: tenantError } = await admin.from('tenants')
    .select('id,name,slug').eq('slug', slug).in('status', ['trial', 'active']).maybeSingle();
  if (tenantError || !tenant) return response({ ok: false }, 404, origin);
  const { data: site, error } = await admin.from('site_settings')
    .select('portal_settings').eq('tenant_id', tenant.id).maybeSingle();
  if (error) return response({ ok: false, message: 'تعذر تحميل إعدادات البوابة.' }, 503, origin);
  const raw = site?.portal_settings && typeof site.portal_settings === 'object' ? site.portal_settings : {};
  const settings = { ...DEFAULTS, ...raw };
  settings.enabled = settings.enabled === true;
  settings.accent_color = /^#[0-9a-f]{6}$/i.test(String(settings.accent_color))
    ? settings.accent_color : DEFAULTS.accent_color;
  return response({ ok: true, labName: tenant.name, slug: tenant.slug, settings }, 200, origin);
});
