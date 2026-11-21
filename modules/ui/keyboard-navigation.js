// Shared keyboard navigation for every Taiba Smart Lab screen.
const isVisible = element => !element.disabled && !element.hidden &&
  element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0;
const formControls = form => [...form.querySelectorAll(
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
)].filter(isVisible);
const listFor = element => element.closest(
  '[data-keyboard-list], [role="listbox"], [role="menu"], ul, ol, .result-list, .list-group, .queue-list'
);
const listItems = list => list ? [...list.querySelectorAll(
  'button:not([disabled]), a[href], [role="option"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
)].filter(isVisible) : [];

document.addEventListener('keydown', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest('[data-keyboard-native]')) return;
  const form = target.closest('form');
  if (event.key === 'Enter' && form &&
      target.matches('input:not([type="search"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"])')) {
    const controls = formControls(form).filter(control =>
      !control.matches('button, input[type="submit"], input[type="button"]')
    );
    const index = controls.indexOf(target);
    const next = index >= 0 ? controls[index + 1] : null;
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
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
  if (!list || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
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
