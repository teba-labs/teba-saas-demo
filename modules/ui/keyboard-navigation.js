// Shared keyboard navigation and accessible tabs for Taiba Smart Lab.
const isVisible = element => !element.disabled && !element.hidden &&
  element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0;
const formControls = form => [...form.querySelectorAll(
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
)].filter(isVisible);
const listFor = element => element.closest(
  '[data-keyboard-list], [role="listbox"], [role="menu"], .result-list, .list-group, .queue-list'
);
const listItems = list => list ? [...list.querySelectorAll(
  'button:not([disabled]), a[href], [role="option"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
)].filter(isVisible) : [];
const tabItems = group => [...group.querySelectorAll('[role="tab"], button:not([disabled]), a[href]')]
  .filter(isVisible);
let lastDialogInvoker = null;

// Give custom button groups the same arrow-key behavior as native ARIA tablists.
document.querySelectorAll('[data-keyboard-tabs]').forEach(group => {
  group.setAttribute('role', 'tablist');
  group.querySelectorAll('button:not([disabled])').forEach(button => {
    if (!button.hasAttribute('aria-controls')) {
      const targetId = button.dataset.view ? 'view-' + button.dataset.view :
        button.dataset.kind === 'packages' ? 'form-packages' :
        button.dataset.kind === 'offers' ? 'form-offers' : 'form-content';
      if (document.getElementById(targetId)) button.setAttribute('aria-controls', targetId);
    }
    if (button.dataset.view) {
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      if (panel) {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', button.id || (button.id = 'keyboard-tab-' + button.dataset.view));
      }
    }
    button.setAttribute('role', 'tab');
    const active = button.classList.contains('active') || button.getAttribute('aria-selected') === 'true';
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
});
document.addEventListener('click', event => {
  const trigger = event.target.closest?.('[aria-controls]');
  const id = trigger?.getAttribute('aria-controls');
  const controlled = id && document.getElementById(id);
  if (trigger && controlled?.tagName === 'DIALOG') lastDialogInvoker = trigger;
  const tab = event.target.closest?.('[role="tab"]');
  const group = tab?.closest('[role="tablist"]');
  if (tab && group) {
    tabItems(group).forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
  }
});

document.addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest('[data-keyboard-native]')) return;

  if (event.key === 'Escape') {
    const dialog = target.closest('dialog[open]') || document.querySelector('dialog[open]');
    if (dialog) {
      event.preventDefault();
      dialog.close();
      const invoker = lastDialogInvoker;
      lastDialogInvoker = null;
      if (invoker?.isConnected && isVisible(invoker)) invoker.focus();
      return;
    }
    const details = target.closest('details[open]');
    if (details) {
      event.preventDefault();
      details.open = false;
      details.querySelector('summary')?.focus();
      return;
    }
    const expanded = [...document.querySelectorAll('[aria-expanded="true"][aria-controls]')]
      .reverse().find(trigger => {
        const panel = document.getElementById(trigger.getAttribute('aria-controls'));
        return panel && (panel.contains(target) || trigger === target || trigger.contains(target)) && isVisible(panel);
      });
    if (expanded) {
      event.preventDefault();
      const panel = document.getElementById(expanded.getAttribute('aria-controls'));
      expanded.setAttribute('aria-expanded', 'false');
      if (panel && panel.tagName !== 'DIALOG') panel.hidden = true;
      expanded.focus();
    }
    return;
  }

  if ((event.key === ' ' || event.key === 'Enter') && target.matches('[role="button"], [role="tab"], [role="menuitem"], [role="option"]') &&
      !target.matches('button, a[href], input, select, textarea')) {
    event.preventDefault();
    target.click();
    return;
  }

  const tabGroup = target.closest('[role="tablist"]');
  if (tabGroup && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const items = tabItems(tabGroup);
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(target.closest('[role="tab"], button, a[href]')));
    const rtl = getComputedStyle(tabGroup).direction === 'rtl';
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowRight') next = Math.max(0, Math.min(items.length - 1, current + (rtl ? -1 : 1)));
    else if (event.key === 'ArrowLeft') next = Math.max(0, Math.min(items.length - 1, current + (rtl ? 1 : -1)));
    event.preventDefault();
    items[next].focus();
    items[next].click();
    return;
  }

  const form = target.closest('form');
  if (event.key === 'Enter' && form &&
      target.matches('input:not([type="search"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"])')) {
    const controls = formControls(form).filter(control =>
      !control.matches('button, input[type="submit"], input[type="button"]')
    );
    const index = controls.indexOf(target);
    const next = index >= 0 ? controls[index + 1] : null;
    const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (next && isVisible(next)) {
      event.preventDefault();
      next.focus();
    } else if (submit && isVisible(submit)) {
      event.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit(submit);
      else submit.click();
    }
    return;
  }

  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      target.matches('input[type="text"], input[type="email"], input[type="tel"]') && form) {
    const controls = formControls(form);
    const index = controls.indexOf(target);
    if (index >= 0 && controls.length > 1) {
      event.preventDefault();
      controls[Math.max(0, Math.min(controls.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
      return;
    }
  }

  const list = listFor(target);
  if (!list || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable ||
      !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = listItems(list);
  if (!items.length) return;
  const current = items.indexOf(target.closest('button, a[href], [role="option"], [role="menuitem"], [tabindex]'));
  let next = current < 0 ? 0 : current;
  if (event.key === 'ArrowDown') next = Math.min(items.length - 1, next + 1);
  if (event.key === 'ArrowUp') next = Math.max(0, next - 1);
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = items.length - 1;
  event.preventDefault();
  items[next].focus();
});
