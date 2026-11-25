const $ = id => document.getElementById(id);
const dialog = $('accessDialog');
$('portalLink')?.addEventListener('click', () => dialog?.showModal());
$('closeAccessDialog')?.addEventListener('click', () => dialog?.close());
dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
const menu = $('mobileMenuToggle');
const nav = $('mainNav');
menu?.addEventListener('click', () => {
  const open = nav?.classList.toggle('is-open') ?? false;
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
});
nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  nav.classList.remove('is-open');
  menu?.setAttribute('aria-expanded', 'false');
  menu?.setAttribute('aria-label', 'فتح القائمة');
}));
