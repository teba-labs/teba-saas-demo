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


export async function saveBranch({ tenantId, branchId = null, name, address = null, phone = null } = {}) {
  need(tenantId, 'tenantId');
  const cleanName = String(name ?? '').trim();
  if (cleanName.length < 2) throw new Error('Branch name must contain at least 2 characters.');
  const payload = { tenant_id: tenantId, name: cleanName, address: String(address ?? '').trim() || null, phone: String(phone ?? '').trim() || null, is_active: true };
  let query = db().from('branches');
  const result = branchId
    ? await query.update(payload).eq('tenant_id', tenantId).eq('id', branchId).select('id, tenant_id, name, address, phone, is_active').single()
    : await query.insert(payload).select('id, tenant_id, name, address, phone, is_active').single();
  if (result.error) throw result.error;
  return result.data;
}

export async function setBranchActive({ tenantId, branchId, isActive } = {}) {
  need(tenantId, 'tenantId'); need(branchId, 'branchId');
  const { data, error } = await db().from('branches')
    .update({ is_active: Boolean(isActive) }).eq('tenant_id', tenantId).eq('id', branchId)
    .select('id, tenant_id, name, address, phone, is_active').single();
  if (error) throw error;
  return data;
}

export async function listExpenseCategoriesForOwner({ tenantId } = {}) {
  need(tenantId, 'tenantId');
  const { data, error } = await db().from('expense_categories')
    .select('id, name, is_active').eq('tenant_id', tenantId).order('name');
  if (error) throw error;
  return data ?? [];
}

export async function addExpenseCategory({ tenantId, name } = {}) {
  need(tenantId, 'tenantId');
  const cleanName = String(name ?? '').trim();
  if (cleanName.length < 2) throw new Error('Category name must contain at least 2 characters.');
  const { data, error } = await db().from('expense_categories')
    .insert({ tenant_id: tenantId, name: cleanName, is_active: true })
    .select('id, name, is_active').single();
  if (error) throw error;
  return data;
}

export async function setExpenseCategoryActive({ tenantId, categoryId, isActive } = {}) {
  need(tenantId, 'tenantId'); need(categoryId, 'categoryId');
  const { data, error } = await db().from('expense_categories')
    .update({ is_active: Boolean(isActive) }).eq('tenant_id', tenantId).eq('id', categoryId)
    .select('id, name, is_active').single();
  if (error) throw error;
  return data;
}

export async function savePrintSettings({ tenantId, branchId = null, settings, existingId = null } = {}) {
  need(tenantId, 'tenantId');
  need(settings && typeof settings === 'object' && !Array.isArray(settings), 'settings');
  const payload = { tenant_id: tenantId, branch_id: branchId, settings_json: settings };
  const result = existingId
    ? await db().from('print_settings').update({ settings_json: settings }).eq('tenant_id', tenantId).eq('id', existingId).select('id, tenant_id, branch_id, settings_json, updated_at').single()
    : await db().from('print_settings').insert(payload).select('id, tenant_id, branch_id, settings_json, updated_at').single();
  if (result.error) throw result.error;
  return result.data;
}

export async function listBranchesForOwner({ tenantId } = {}) {
  need(tenantId, 'tenantId');
  const { data, error } = await db().from('branches')
    .select('id, tenant_id, name, address, phone, is_active').eq('tenant_id', tenantId).order('name');
  if (error) throw error;
  return data ?? [];
}
