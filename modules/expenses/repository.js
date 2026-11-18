import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES, RPC } from '../../core/data/schema-contract.js';
const db = () => getSupabaseClient();
const uuid = () => crypto.randomUUID();

export async function listExpenseCategories({ tenantId, includeInactive = false } = {}) {
  if (!tenantId) throw new Error('tenantId is required.');
  let query = db().from(TABLES.expenseCategories)
    .select('id, name, is_active').eq('tenant_id', tenantId).order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  if (error) throw error;
  return data ?? [];
}

export async function recordExpense({ tenantId, branchId, categoryId, amount, description, staffId } = {}) {
  for (const [value, name] of [[tenantId, 'tenantId'], [branchId, 'branchId'], [categoryId, 'categoryId'], [staffId, 'staffId']]) {
    if (!value) throw new Error(`${name} is required.`);
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Expense amount must be greater than zero.');
  const { data, error } = await db().rpc(RPC.recordBranchExpense, {
    p_tenant_id: tenantId, p_branch_id: branchId, p_category_id: categoryId,
    p_amount: value, p_description: description ?? null,
    p_idempotency_key: uuid(), p_staff_id: staffId,
  });
  if (error) throw error;
  return data;
}

/** Owner-only through expense_categories RLS. Names are unique per tenant. */
export async function saveExpenseCategory({ tenantId, name, id } = {}) {
  if (!tenantId) throw new Error('tenantId is required.');
  const cleanName = String(name ?? '').trim();
  if (cleanName.length < 2 || cleanName.length > 80) throw new Error('اسم بند المصروف يجب أن يكون بين حرفين و80 حرفًا.');
  const payload = { tenant_id: tenantId, name: cleanName, is_active: true, ...(id ? { id } : {}) };
  const { data, error } = await db().from(TABLES.expenseCategories).upsert(payload, { onConflict: 'tenant_id,name' }).select('id, tenant_id, name, is_active').single();
  if (error) throw error;
  return data;
}

export async function setExpenseCategoryActive({ tenantId, categoryId, isActive } = {}) {
  if (!tenantId || !categoryId) throw new Error('tenantId and categoryId are required.');
  const { data, error } = await db().from(TABLES.expenseCategories).update({ is_active: Boolean(isActive) })
    .eq('tenant_id', tenantId).eq('id', categoryId).select('id, tenant_id, name, is_active').single();
  if (error) throw error;
  return data;
}
