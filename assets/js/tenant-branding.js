import { getSupabaseClient } from '../../core/supabase-client.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId } from '../../core/tenant/workspace-selection.js';
import { getLabSettings, getPrintSettings } from '../../modules/settings/repository.js';
import { getLabAssetPublicUrl } from '../../modules/settings/assets-repository.js';

const state = { tenantId: null, branchId: null, settings: null, originalTitle: null };
const $ = (selector) => document.querySelector(selector);

function renderHeader(settings) {
  const name = String(settings?.laboratory_name || '').trim();
  const path = settings?.logo_path || '';
  const url = path ? getLabAssetPublicUrl(path) : '';
  const header = $('header');
  if (!header) return;
  const root = header.querySelector('.brand') || header.querySelector(':scope > a') ||
    header.querySelector('.topbar > div') || header.querySelector(':scope > div');
  if (!root) return;
  const title = root.querySelector('strong');
  if (title && state.originalTitle === null) state.originalTitle = title.textContent;
  if (title) title.textContent = name || state.originalTitle || 'Taiba Smart Lab';
  let branchBadge = root.querySelector('[data-tenant-branch-label]');
  const branchName = state.branchName || '';
  if (branchName) {
    if (!branchBadge) { branchBadge = document.createElement('small'); branchBadge.dataset.tenantBranchLabel = 'true'; branchBadge.style.cssText = 'display:inline-block;margin-inline:8px;padding:3px 8px;border-radius:999px;background:#ffffff22;font-size:11px;'; root.append(branchBadge); }
    branchBadge.textContent = branchName;
  } else branchBadge?.remove();

  let mark = root.querySelector('.brand-mark, .mark');
  let image = root.querySelector('[data-tenant-brand-logo]');
  if (url) {
    if (!image) {
      image = document.createElement('img');
      image.dataset.tenantBrandLogo = 'true';
      image.alt = 'شعار المعمل';
      image.width = 40;
      image.height = 40;
      image.style.cssText = 'width:40px;height:40px;max-width:40px;max-height:40px;object-fit:contain;border-radius:8px;flex:0 0 40px;';
      if (mark) {
        mark.textContent = '';
        mark.style.cssText += ';display:inline-flex;align-items:center;justify-content:center;background:transparent;padding:0;overflow:hidden;';
        mark.append(image);
      } else {
        root.insertBefore(image, title || root.firstChild);
      }
    }
    if (image.src !== url) image.src = url;
    image.hidden = false;
  } else {
    image?.remove();
    if (mark) {
      mark.textContent = 'T';
      mark.removeAttribute('style');
    }
  }
}

async function refreshTenantBranding() {
  const sessionResult = await getSupabaseClient().auth.getSession();
  if (!sessionResult.data?.session?.user?.id) return;
  const context = await loadMyTenantContext();
  const tenants = context.tenants || [];
  if (!tenants.length) return;
  const tenantId = getPreferredTenantId(tenants);
  const tenant = tenants.find(item => item.id === tenantId) || tenants[0];
  const branches = tenant.branches || [];
  const branchId = getPreferredBranchId(tenant.id, branches) || branches[0]?.id || null;
  if (state.tenantId === tenant.id && state.branchId === branchId && state.settings) {
    renderHeader(state.settings);
    return;
  }
  const [settings, printRow] = await Promise.all([
    getLabSettings({ tenantId: tenant.id }),
    getPrintSettings({ tenantId: tenant.id, branchId }).catch(() => null),
  ]);
  state.tenantId = tenant.id;
  state.branchId = branchId;
  state.branchInfo = branches.find(item => item.id === branchId) || null;
  state.branchName = state.branchInfo?.name || '';
  state.settings = settings || {};
  state.printSettings = printRow?.settings_json || {};
  renderHeader(state.settings);
  globalThis.__taibaTenantBrand = { tenantId: tenant.id, branchId, branchName: state.branchName, branch: state.branchInfo, settings: state.settings, printSettings: state.printSettings };
  document.documentElement.dataset.tenantBrandReady = 'true';
  document.dispatchEvent(new CustomEvent('taiba:tenant-branding-ready', { detail: globalThis.__taibaTenantBrand }));
}

function safelyRefresh() {
  refreshTenantBranding().catch(error => {
    console.warn('Tenant branding could not be loaded:', error?.message || error);
  });
}

const client = getSupabaseClient();
client.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
    queueMicrotask(safelyRefresh);
  }
  if (event === 'SIGNED_OUT') {
    state.tenantId = null; state.branchId = null; state.settings = null; state.branchName = ''; state.printSettings = {}; globalThis.__taibaTenantBrand = null;
    renderHeader({});
  }
});
document.addEventListener('taiba:tenant-settings-updated', () => {
  state.tenantId = null; state.branchId = null; state.settings = null;
  safelyRefresh();
});
document.addEventListener('change', event => {
  if (event.target?.id === 'tenantSelect' || event.target?.id === 'branchSelect') {
    state.tenantId = null; state.branchId = null; state.settings = null;
    safelyRefresh();
  }
});
safelyRefresh();
