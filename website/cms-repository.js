import { getSupabaseClient } from '../core/supabase-client.js';

const db = () => getSupabaseClient();
const need = (value, name) => { if (!value) throw new Error(`${name} is required.`); };

const COLLECTIONS = Object.freeze({
  sections: { table: 'site_sections', order: 'display_order' },
  tests: { table: 'site_test_catalog', order: 'display_order' },
  packages: { table: 'site_packages', order: 'display_order' },
  articles: { table: 'site_articles', order: 'created_at' },
  faqs: { table: 'site_faqs', order: 'display_order' },
  testimonials: { table: 'site_testimonials', order: 'display_order' },
  offers: { table: 'site_offers', order: 'created_at' },
  branches: { table: 'site_branch_profiles', order: 'display_order' },
});

function collection(name) {
  const value = COLLECTIONS[name];
  if (!value) throw new Error(`Unsupported CMS collection: ${name}`);
  return value;
}

/** Owner authorization is enforced by Supabase RLS, not by a client-side role flag. */
export async function getCmsSettings({ tenantId } = {}) {
  need(tenantId, 'tenantId');
  const { data, error } = await db().from('site_settings')
    .select('tenant_id, public_content, theme_json, is_published, updated_at')
    .eq('tenant_id', tenantId).single();
  if (error) throw error;
  return data;
}

export async function saveCmsSettings({ tenantId, patch } = {}) {
  need(tenantId, 'tenantId');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch must be an object.');
  const allowed = ['public_content', 'theme_json', 'is_published'];
  const payload = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(payload).length) throw new Error('No supported CMS settings were supplied.');
  const { data, error } = await db().from('site_settings').update(payload)
    .eq('tenant_id', tenantId).select().single();
  if (error) throw error;
  return data;
}

export async function listCmsItems({ tenantId, collection: name } = {}) {
  need(tenantId, 'tenantId');
  const spec = collection(name);
  const { data, error } = await db().from(spec.table).select('*')
    .eq('tenant_id', tenantId).order(spec.order, { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Upsert only by row id supplied by the editor; RLS remains the authority for tenant ownership. */
export async function saveCmsItem({ tenantId, collection: name, item } = {}) {
  need(tenantId, 'tenantId');
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('item must be an object.');
  const spec = collection(name);
  const { id, ...fields } = item;
  const payload = { ...fields, tenant_id: tenantId };
  const query = db().from(spec.table);
  const result = id
    ? await query.update(payload).eq('tenant_id', tenantId).eq('id', id).select().single()
    : await query.insert(payload).select().single();
  if (result.error) throw result.error;
  return result.data;
}

/** Prefer archival/unpublishing over hard deletion so tenant content can be restored. */
export async function setCmsItemVisibility({ tenantId, collection: name, id, visible } = {}) {
  need(tenantId, 'tenantId'); need(id, 'id');
  if (typeof visible !== 'boolean') throw new Error('visible must be boolean.');
  const spec = collection(name);
  const patch = name === 'sections' || name === 'tests'
    ? { is_visible: visible }
    : name === 'packages' || name === 'offers'
      ? { is_active: visible }
      : name === 'branches'
        ? { show_on_site: visible }
        : { is_published: visible };
  const { data, error } = await db().from(spec.table).update(patch)
    .eq('tenant_id', tenantId).eq('id', id).select().single();
  if (error) throw error;
  return data;
}


/** Owner-only public CMS image upload. Storage RLS checks the tenant folder; no patient files use this bucket. */
export async function uploadCmsAsset({ tenantId, file } = {}) {
  need(tenantId, 'tenantId'); need(file, 'file');
  if (!(file instanceof File)) throw new Error('A valid image file is required.');
  const allowed = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']]);
  const extension = allowed.get(file.type);
  if (!extension) throw new Error('المسموح صور JPG أو PNG أو WebP فقط.');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('حجم الصورة يجب ألا يتجاوز 10 ميجابايت.');
  const path = `${tenantId}/cms/${crypto.randomUUID()}.${extension}`;
  const client = db();
  const { error } = await client.storage.from('tenant-site-assets').upload(path, file, {
    cacheControl: '3600', contentType: file.type, upsert: false,
  });
  if (error) throw error;
  const { data } = client.storage.from('tenant-site-assets').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('تعذر إنشاء رابط الصورة العامة.');
  return { path, publicUrl: data.publicUrl, sizeBytes: file.size, mimeType: file.type };
}

export const cmsCollectionNames = Object.freeze(Object.keys(COLLECTIONS));
