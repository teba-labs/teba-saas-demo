import { getSupabaseClient } from '../../core/supabase-client.js';
const db = () => getSupabaseClient();
const need = (v, n) => { if (!v) throw new Error(`${n} is required.`); };

export async function getLabSettings({ tenantId } = {}) {
  need(tenantId, 'tenantId');
  const { data, error } = await db().from('lab_settings')
    .select('tenant_id, laboratory_name, doctor_name, logo_path, phone, whatsapp, address, report_footer, whatsapp_template, settings_json, updated_at')
    .eq('tenant_id', tenantId).single();
  if (error) throw error;
  return data;
}

/** Owner-only by RLS; never trusts a client-side role flag. */
export async function updateLabSettings({ tenantId, patch } = {}) {
  need(tenantId, 'tenantId'); need(patch && typeof patch === 'object', 'patch');
  const allowed = ['laboratory_name','doctor_name','logo_path','phone','whatsapp','address','report_footer','whatsapp_template','settings_json'];
  const payload = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(payload).length) throw new Error('No supported settings were supplied.');
  const { data, error } = await db().from('lab_settings')
    .update(payload).eq('tenant_id', tenantId).select().single();
  if (error) throw error;
  return data;
}

export async function getPrintSettings({ tenantId, branchId = null } = {}) {
  need(tenantId, 'tenantId');
  let query = db().from('print_settings').select('id, tenant_id, branch_id, settings_json, updated_at').eq('tenant_id', tenantId);
  query = branchId ? query.eq('branch_id', branchId) : query.is('branch_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

/** Owner-only through database RLS. A null branch_id means tenant-wide defaults. */
export async function savePrintSettings({ tenantId, branchId = null, settings } = {}) {
  need(tenantId, 'tenantId');
  need(settings && typeof settings === 'object' && !Array.isArray(settings), 'settings');
  const serialized = JSON.stringify(settings);
  if (serialized.length > 20000) throw new Error('Print settings exceed the 20 KB limit.');
  const { data, error } = await db().from('print_settings')
    .upsert({ tenant_id: tenantId, branch_id: branchId, settings_json: settings }, { onConflict: 'tenant_id,branch_id' })
    .select('id, tenant_id, branch_id, settings_json, updated_at').single();
  if (error) throw error;
  return data;
}

/** Owner-only through branches RLS. Branches are deactivated, never hard-deleted. */
export async function createBranch({ tenantId, name, address = null, phone = null, mapLink = null } = {}) {
  need(tenantId, 'tenantId');
  const cleanName = String(name ?? '').trim();
  if (cleanName.length < 2 || cleanName.length > 120) throw new Error('Branch name must be between 2 and 120 characters.');
  const payload = { tenant_id: tenantId, name: cleanName, address: String(address ?? '').trim() || null, phone: String(phone ?? '').trim() || null, map_link: String(mapLink ?? '').trim() || null };
  const { data, error } = await db().from('branches').insert(payload).select('id, tenant_id, name, address, phone, map_link, is_active, created_at').single();
  if (error) throw error;
  return data;
}

export async function setBranchActive({ tenantId, branchId, isActive } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  const { data, error } = await db().from('branches').update({ is_active: Boolean(isActive) })
    .eq('tenant_id', tenantId).eq('id', branchId)
    .select('id, tenant_id, name, address, phone, map_link, is_active, updated_at').single();
  if (error) throw error;
  return data;
}
