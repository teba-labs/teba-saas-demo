import { getSupabaseClient } from '../../core/supabase-client.js';
const db = () => getSupabaseClient();
const need = (v, n) => { if (!v) throw new Error(`${n} is required.`); };

export async function listBranchStaff({ tenantId, branchId, includeInactive = false } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  let query = db().from('staff_directory')
    .select('id, tenant_id, branch_id, display_name, is_active, created_at, updated_at')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).order('display_name');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** Database policy restricts staff-directory maintenance to tenant owners. */
export async function saveStaffName({ tenantId, branchId, displayName, id } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  const name = String(displayName ?? '').trim();
  if (!name) throw new Error('displayName is required.');
  const payload = { tenant_id: tenantId, branch_id: branchId, display_name: name, is_active: true, ...(id ? { id } : {}) };
  const { data, error } = await db().from('staff_directory').upsert(payload, { onConflict: 'tenant_id,branch_id,display_name' }).select().single();
  if (error) throw error;
  return data;
}

export async function setStaffActive({ tenantId, branchId, staffId, isActive } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId'); need(staffId, 'staffId');
  const { data, error } = await db().from('staff_directory').update({ is_active: Boolean(isActive) })
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('id', staffId).select().single();
  if (error) throw error;
  return data;
}
