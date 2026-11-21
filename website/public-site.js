import { getSupabaseClient } from '../core/supabase-client.js';
const db = () => getSupabaseClient();

/** Resolve only tenants whose public site is published and whose tenant is active/trial. */
export async function resolvePublishedSite(slug) {
  const cleanSlug = String(slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(cleanSlug)) throw new Error('Invalid laboratory site address.');
  const { data, error } = await db().rpc('get_public_tenant_by_slug', { p_slug: cleanSlug });
  if (error) throw error;
  const tenant = Array.isArray(data) ? data[0] : data;
  if (!tenant?.tenant_id) return null;
  return { ...tenant, slug: cleanSlug };
}

/** Public content only. Database RLS additionally filters every collection to published rows. */
export async function loadPublishedSite(slug) {
  const tenant = await resolvePublishedSite(slug);
  if (!tenant) return null;
  const tenantId = tenant.tenant_id;
  const queries = [
    ['settings', 'site_settings', 'tenant_id, public_content, theme_json'],
    ['sections', 'site_sections', '*'],
    ['tests', 'site_test_catalog', '*'],
    ['packages', 'site_packages', '*'],
    ['articles', 'site_articles', '*'],
    ['faqs', 'site_faqs', '*'],
    ['testimonials', 'site_testimonials', '*'],
    ['offers', 'site_offers', '*'],
    ['branches', 'site_branch_profiles', '*'],
  ];
  const results = await Promise.all(queries.map(async ([key, table, columns]) => {
    let query = db().from(table).select(columns).eq('tenant_id', tenantId);
    if (key === 'settings') query = query.maybeSingle();
    if (key !== 'settings') {
      const order = ['sections','tests','packages','faqs','testimonials','branches'].includes(key) ? 'display_order' : 'created_at';
      query = query.order(order, { ascending: true });
    }
    const { data, error } = await query;
    if (error) throw error;
    return [key, key === 'settings' ? data : (data ?? [])];
  }));
  return { tenant, ...Object.fromEntries(results) };
}
