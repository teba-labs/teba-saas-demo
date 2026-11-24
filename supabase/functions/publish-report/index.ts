import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200, origin = '') {
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

Deno.serve(async (req) => {
  const allowed = (Deno.env.get('REPORT_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return reply({ ok: true }, 200, allowed.includes(origin) ? origin : '');
  if (req.method !== 'POST') return reply({ ok: false, message: 'Method not allowed.' }, 405);
  if (!allowed.length || !origin || !allowed.includes(origin)) return reply({ ok: false, message: 'Origin not allowed.' }, 403);

  const authorization = req.headers.get('authorization') ?? '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply({ ok: false, message: 'Authentication required.' }, 401, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    console.error('Report publication server configuration is incomplete.');
    return reply({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(bearer);
  if (authError || !authData.user) return reply({ ok: false, message: 'Authentication required.' }, 401, origin);

  let form: FormData;
  try { form = await req.formData(); } catch { return reply({ ok: false, message: 'Invalid request.' }, 400, origin); }
  const tenantId = String(form.get('tenantId') ?? '');
  const branchId = String(form.get('branchId') ?? '');
  const visitId = String(form.get('visitId') ?? '');
  const staffId = String(form.get('staffId') ?? '');
  const reason = String(form.get('changeReason') ?? '').trim();
  const file = form.get('report');
  if (![tenantId, branchId, visitId, staffId].every(v => UUID.test(v)) || !(file instanceof File)) {
    return reply({ ok: false, message: 'بيانات الطلب غير مكتملة.' }, 400, origin);
  }
  if (file.type !== 'application/pdf' || file.size < 8 || file.size > MAX_PDF_BYTES) {
    return reply({ ok: false, message: 'يجب رفع ملف PDF لا يتجاوز 10 ميجابايت.' }, 400, origin);
  }
  if (reason.length > 500) return reply({ ok: false, message: 'سبب التعديل أطول من المسموح.' }, 400, origin);

  const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(signature) !== '%PDF-') {
    return reply({ ok: false, message: 'الملف المرفوع ليس ملف PDF صالحًا.' }, 400, origin);
  }

  const storagePath = `${tenantId}/${visitId}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await userClient.storage.from('tenant-reports').upload(storagePath, file, {
    contentType: 'application/pdf', upsert: false, cacheControl: '0',
  });
  if (uploadError) {
    console.error('Report upload failed:', uploadError.message);
    return reply({ ok: false, message: 'تعذر رفع التقرير. تحقق من صلاحيات الفرع وحاول مرة أخرى.' }, 403, origin);
  }

  const { data: version, error: publishError } = await userClient.rpc('publish_report_version', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_visit_id: visitId,
    p_storage_path: storagePath,
    p_change_reason: reason || null,
    p_staff_id: staffId,
  });

  if (publishError || !version) {
    // Compensating cleanup is server-side only; the service key never reaches the browser.
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: cleanupError } = await admin.storage.from('tenant-reports').remove([storagePath]);
    if (cleanupError) console.error('Orphan report cleanup failed:', cleanupError.message, storagePath);
    console.error('Atomic report publication failed:', publishError?.message);
    return reply({ ok: false, message: publishError?.message?.includes('reason')
      ? 'اكتب سبب التصحيح قبل نشر نسخة جديدة.'
      : publishError?.message?.includes('Patient portal is disabled')
        ? 'بوابة المرضى غير مفعلة لهذا المعمل. يمكنك طباعة التقرير وتسليمه دون نشره على البوابة.'
        : 'لم يتم نشر التقرير. راجع اكتمال النتائج واعتماد الزيارة وصلاحيات الفرع.' }, 409, origin);
  }

  return reply({
    ok: true,
    reportVersionId: version.id,
    versionNumber: version.version_number,
    message: 'تم نشر التقرير وحفظ سجل النسخة بنجاح.',
  }, 200, origin);
});
