// Shared appearance controller: one system-wide default plus independent per-page overrides.
const GLOBAL_KEY = 'taiba.appearance.global';
const PAGE_PREFIX = 'taiba.appearance.page:';
const SCOPE_PREFIX = 'taiba.appearance.scope:';
const pageKey = PAGE_PREFIX + location.pathname.replace(/\/+$/, '') ;
const scopeKey = SCOPE_PREFIX + location.pathname.replace(/\/+$/, '');
const safeGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
const safeSet = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const globalTheme = () => safeGet(GLOBAL_KEY) === 'dark' ? 'dark' : 'light';
const pageTheme = () => safeGet(pageKey);
const currentTheme = () => pageTheme() === 'dark' || pageTheme() === 'light' ? pageTheme() : globalTheme();

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized;
  let meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    document.head.append(meta);
  }
  meta.content = normalized;
  const button = document.querySelector('[data-taiba-theme-toggle]');
  const scope = document.querySelector('.taiba-theme-scope');
  const targetTheme = scope?.value === 'global' ? globalTheme() : normalized;
  if (button) {
    button.textContent = targetTheme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي';
    button.setAttribute('aria-pressed', String(targetTheme === 'dark'));
    button.title = scope?.value === 'global' ? 'تغيير الوضع الافتراضي لكل صفحات النظام' : 'تغيير مظهر هذه الصفحة فقط';
  }
}
function clearPageOverrides() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {}
}
function buildControl() {
  if (document.querySelector('[data-taiba-theme-control]')) return;
  const host = document.querySelector('.top-actions') || document.querySelector('.topbar') || document.body;
  const wrap = document.createElement('div');
  wrap.className = 'taiba-theme-control';
  wrap.dataset.taibaThemeControl = 'true';
  const scope = document.createElement('select');
  scope.className = 'taiba-theme-scope';
  scope.setAttribute('aria-label', 'نطاق تغيير المظهر');
  scope.innerHTML = '<option value="global">كل النظام</option><option value="page">هذه الصفحة فقط</option>';
  const savedScope = safeGet(scopeKey);
  scope.value = savedScope === 'page' ? 'page' : 'global';
  scope.addEventListener('change', () => {\n    safeSet(scopeKey, scope.value);\n    // Switching to the global scope must immediately discard the visual effect of a page override.\n    applyTheme(scope.value === 'global' ? globalTheme() : currentTheme());\n  });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'taiba-theme-toggle';
  button.dataset.taibaThemeToggle = 'true';
  button.addEventListener('click', () => {
    const activeTarget = scope.value === 'page' ? currentTheme() : globalTheme();
    const next = activeTarget === 'dark' ? 'light' : 'dark';
    if (scope.value === 'page') safeSet(pageKey, next);
    else {
      safeSet(GLOBAL_KEY, next);
      clearPageOverrides();
    }
    applyTheme(currentTheme());
  });
  wrap.append(scope, button);
  if (host === document.body) wrap.classList.add('taiba-theme-floating');
  host.append(wrap);
  applyTheme(currentTheme());
}
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('../css/theme-system.css', import.meta.url).href;
document.head.append(stylesheet);
applyTheme(currentTheme());
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildControl, { once: true });
else buildControl();
