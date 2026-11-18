import { getSupabaseClient } from '../../core/supabase-client.js';
import { TABLES, RPC } from '../../core/data/schema-contract.js';
const db = () => getSupabaseClient();
const uuid = () => crypto.randomUUID();

export async function listExpenseCategories({ tenantId } = {}) {
  if (!tenantId) throw new Error('tenantId is required.');
  const { data, error } = await db().from(TABLES.expenseCategories)
    .select('id, name, is_active').eq('tenant_id', tenantId).eq('is_active', true).order('name');
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
