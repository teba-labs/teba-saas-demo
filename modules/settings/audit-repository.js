import { getSupabaseClient } from '../../core/supabase-client.js';

const db = () => getSupabaseClient();

/** Owner-only, tenant-scoped audit metadata. Deliberately excludes old_data/new_data. */
export async function listOwnerAuditLogs({ tenantId, limit = 50 } = {}) {
  if (!tenantId) throw new Error('tenantId is required.');
  const safeLimit = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50));
  const { data, error } = await db().from('audit_logs')
    .select('id, branch_id, action, table_name, occurred_at')
    .eq('tenant_id', tenantId)
    .order('occurred_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return data ?? [];
}
