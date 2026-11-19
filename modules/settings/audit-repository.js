import { getSupabaseClient } from '../../core/supabase-client.js';

const db = () => getSupabaseClient();

/** Owner-only, tenant-scoped audit metadata. Deliberately returns metadata only. */
export async function listOwnerAuditLogs({ tenantId, limit = 50 } = {}) {
  if (!tenantId) throw new Error('tenantId is required.');
  const safeLimit = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50));
  const client = db();
  const { data, error } = await client.from('audit_logs')
    .select('id, branch_id, actor_user_id, actor_staff_id, action, table_name, occurred_at')
    .eq('tenant_id', tenantId)
    .order('occurred_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  const rows = data ?? [];
  const userIds = [...new Set(rows.map(row => row.actor_user_id).filter(Boolean))];
  const staffIds = [...new Set(rows.map(row => row.actor_staff_id).filter(Boolean))];
  const [membershipsResult, staffResult] = await Promise.all([
    userIds.length
      ? client.from('tenant_memberships').select('user_id, account_type').eq('tenant_id', tenantId).in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    staffIds.length
      ? client.from('staff_directory').select('id, display_name').eq('tenant_id', tenantId).in('id', staffIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (membershipsResult.error) throw membershipsResult.error;
  if (staffResult.error) throw staffResult.error;
  const roles = new Map((membershipsResult.data ?? []).map(row => [row.user_id, row.account_type]));
  const staff = new Map((staffResult.data ?? []).map(row => [row.id, row.display_name]));
  return rows.map(row => ({
    ...row,
    actor_label: roles.get(row.actor_user_id) === 'owner'
      ? 'مالك المعمل'
      : staff.get(row.actor_staff_id) || (row.actor_user_id ? 'حساب موظف' : 'غير محدد'),
  }));
}
