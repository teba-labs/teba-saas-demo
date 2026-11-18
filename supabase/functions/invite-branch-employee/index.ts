import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const allowed = (Deno.env.get('STAFF_INVITE_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean);
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return reply({ ok: true }, 200, allowed.includes(origin) ? origin : '');
  if (req.method !== 'POST') return reply({ ok: false, message: 'Method not allowed.' }, 405);
  if (!allowed.length || !origin || !allowed.includes(origin)) return reply({ ok: false, message: 'Origin not allowed.' }, 403);

  const bearer = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply({ ok: false, message: 'Authentication required.' }, 401, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    console.error('Staff invitation server configuration is incomplete.');
    return reply({ ok: false, message: 'الخدمة غير متاحة مؤقتًا.' }, 503, origin);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(bearer);
  if (authError || !authData.user) return reply({ ok: false, message: 'Authentication required.' }, 401, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ ok: false, message: 'Invalid request.' }, 400, origin); }
  const tenantId = String(body.tenantId ?? '');
  const branchId = String(body.branchId ?? '');
  const staffId = String(body.staffId ?? '');
  const email = String(body.email ?? '').trim().toLowerCase();
  if (![tenantId, branchId, staffId].every(v => UUID.test(v)) || email.length > 254 || !EMAIL.test(email)) {
    return reply({ ok: false, message: 'راجع البريد الإلكتروني والفرع واسم الموظف.' }, 400, origin);
  }

  const { data: owner, error: ownerError } = await userClient.from('tenant_memberships')
    .select('tenant_id').eq('tenant_id', tenantId).eq('user_id', authData.user.id)
    .eq('account_type', 'owner').eq('is_active', true).maybeSingle();
  if (ownerError || !owner) return reply({ ok: false, message: 'هذه العملية متاحة لمالك المعمل فقط.' }, 403, origin);

  const action = String(body.action ?? 'invite');
  const [{ data: branch, error: branchError }, { data: staff, error: staffError }] = await Promise.all([
    userClient.from('branches').select('id').eq('id', branchId).eq('tenant_id', tenantId).eq('is_active', true).maybeSingle(),
    userClient.from('staff_directory').select('id, auth_user_id, is_active').eq('id', staffId)
      .eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle(),
  ]);
  if (branchError || staffError || !branch || !staff) {
    return reply({ ok: false, message: 'الفرع أو الاسم التشغيلي غير موجود أو غير نشط.' }, 404, origin);
  }
  const action = String(body.action ?? 'invite');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === 'set-active') {
    if (!staff.auth_user_id || typeof body.isActive !== 'boolean') {
      return reply({ ok: false, message: 'لا يوجد حساب موظف مرتبط أو حالة التفعيل غير صحيحة.' }, 400, origin);
    }
    const { error } = await admin.rpc('owner_set_branch_employee_active', {
      p_owner_user_id: authData.user.id,
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_staff_id: staffId,
      p_is_active: body.isActive,
    });
    if (error) {
      console.error('Employee access update failed:', error.message);
      return reply({ ok: false, message: 'تعذر تحديث صلاحية دخول الموظف.' }, 409, origin);
    }
    return reply({ ok: true, message: body.isActive ? 'تم تفعيل حساب الموظف في هذا الفرع.' : 'تم إيقاف حساب الموظف وسحب وصوله إلى هذا الفرع.' }, 200, origin);
  }

  if (action !== 'invite') return reply({ ok: false, message: 'Unsupported action.' }, 400, origin);
  if (action === 'invite' && staff.auth_user_id) return reply({ ok: false, message: 'هذا الاسم التشغيلي مرتبط بحساب دخول بالفعل.' }, 409, origin);

  let employeeUser: { id: string } | null = null;
  let newlyInvited = false;
  try {
    // Reuse an existing Auth identity if the employee already has an account.
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
      if (error) throw error;
      const match = data.users.find(user => user.email?.toLowerCase() === email);
      if (match) { employeeUser = { id: match.id }; break; }
      if (data.users.length < 500) break;
    }

    if (!employeeUser) {
      const redirectTo = Deno.env.get('STAFF_INVITE_REDIRECT_URL');
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error || !data.user) throw error ?? new Error('Invitation did not create an Auth user.');
      employeeUser = { id: data.user.id };
      newlyInvited = true;
    }

    const { error: assignError } = await admin.rpc('owner_assign_branch_employee', {
      p_owner_user_id: authData.user.id,
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_staff_id: staffId,
      p_employee_user_id: employeeUser.id,
    });
    if (assignError) throw assignError;
  } catch (error) {
    if (newlyInvited && employeeUser) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(employeeUser.id);
      if (cleanupError) console.error('Failed to clean up an unassigned invited account:', cleanupError.message);
    }
    console.error('Branch employee assignment failed:', error instanceof Error ? error.message : 'Unknown error');
    return reply({ ok: false, message: 'تعذر ربط حساب الموظف. لم يتم تأكيد الإضافة؛ راجع البيانات وحاول مرة أخرى.' }, 409, origin);
  }

  return reply({
    ok: true,
    invited: newlyInvited,
    message: newlyInvited
      ? 'تم إرسال دعوة الدخول وربط الحساب بالفرع.'
      : 'تم ربط حساب الدخول الموجود بالاسم التشغيلي والفرع.',
  }, 200, origin);
});
