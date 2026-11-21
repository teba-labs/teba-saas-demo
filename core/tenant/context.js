import { getSupabaseClient } from '../supabase-client.js';
import { getCurrentSession } from '../auth/session.js';
import { offlineDb } from '../../offline/database.js';

/**
 * Resolve tenant/branch access from authenticated database memberships.
 * localStorage values are deliberately NOT accepted as authorization context.
 */
export async function loadMyTenantContext() {
  const session = await getCurrentSession();
  if (!session?.user?.id) throw new Error('Authentication required.');
  const cachedContext = async () => {
    const cached = await offlineDb.sync_meta.get(`tenant-context:${session.user.id}`);
    if (!cached?.value) throw new Error('لا توجد بيانات فرع محفوظة على هذا الجهاز. افتح النظام أثناء الاتصال أولًا.');
    return { user: session.user, tenants: cached.value };
  };
  if (globalThis.navigator?.onLine === false) return cachedContext();
  const db = getSupabaseClient();

  const { data: memberships, error: membershipError } = await db
    .from('tenant_memberships')
    .select('tenant_id, account_type, is_active')
    .eq('user_id', session.user.id)
    .eq('is_active', true);
  if (membershipError) { if (/fetch|network|offline/i.test(membershipError.message || '')) return cachedContext(); throw membershipError; }
  if (!memberships?.length) return { user: session.user, memberships: [], tenants: [] };

  const tenantIds = [...new Set(memberships.map(row => row.tenant_id))];
  const { data: tenants, error: tenantError } = await db
    .from('tenants')
    .select('id, name, slug, status, timezone, currency_code')
    .in('id', tenantIds);
  if (tenantError) { if (/fetch|network|offline/i.test(tenantError.message || '')) return cachedContext(); throw tenantError; }

  // Owners need inactive branches for history and controlled reactivation.
  // Employee visibility is filtered below and enforced again by RLS.
  const { data: branches, error: branchError } = await db
    .from('branches')
    .select('id, tenant_id, name, address, phone, map_link, is_active')
    .in('tenant_id', tenantIds);
  if (branchError) { if (/fetch|network|offline/i.test(branchError.message || '')) return cachedContext(); throw branchError; }

  const { data: branchMemberships, error: branchMembershipError } = await db
    .from('branch_memberships')
    .select('tenant_id, branch_id, is_active')
    .eq('user_id', session.user.id)
    .eq('is_active', true);
  if (branchMembershipError) { if (/fetch|network|offline/i.test(branchMembershipError.message || '')) return cachedContext(); throw branchMembershipError; }

  const tenantsWithAccess = (tenants ?? []).map(tenant => {
    const membership = memberships.find(m => m.tenant_id === tenant.id);
    const isOwner = membership?.account_type === 'owner';
    const allowedIds = new Set((branchMemberships ?? [])
      .filter(m => m.tenant_id === tenant.id).map(m => m.branch_id));
    const tenantBranches = (branches ?? []).filter(branch => branch.tenant_id === tenant.id);
    const visibleBranches = tenantBranches.filter(branch =>
      branch.is_active && (isOwner || allowedIds.has(branch.id)));
    // Keep the normal operational branch list active-only. Only owners receive
    // the separate allBranches list for history and the settings center.
    return { ...tenant, accountType: membership.account_type, branches: visibleBranches, allBranches: isOwner ? tenantBranches : visibleBranches };
  });

  await offlineDb.sync_meta.put({ key: `tenant-context:${session.user.id}`, value: tenantsWithAccess, cached_at: new Date().toISOString() });
  return { user: session.user, tenants: tenantsWithAccess };
}
