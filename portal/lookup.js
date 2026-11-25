import { APP_ENV } from '../config/environment.js';

let configLoadedFor = '';
let portalDisabled = false;
let portalSubmitLabel = 'عرض التقرير';
async function loadPortalConfig(slug) {
  slug = String(slug || '').trim().toLowerCase();
  if (!slug || slug === configLoadedFor) return;
  configLoadedFor = slug;
  portalDisabled = false;
  try {
    const endpoint = APP_ENV.supabase.url + '/functions/v1/patient-portal-config';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: APP_ENV.supabase.publishableKey },
      body: JSON.stringify({ slug }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.settings) return;
    const x = data.settings;
    document.getElementById('portalTitle').textContent = x.title || 'بوابة نتائج التحاليل';
    document.getElementById('portalIntro').textContent = x.intro || '';
    document.getElementById('portalNameLabel').textContent = x.patient_name_label || 'اسم المريض بالكامل';
    document.getElementById('portalVisitLabel').textContent = x.visit_number_label || 'رقم الزيارة';
    portalSubmitLabel = x.submit_label || 'عرض التقرير';
    document.getElementById('portalSubmit').textContent = portalSubmitLabel;
    document.getElementById('portalHelpText').textContent = x.help_text || '';
    const accent = x.accent_color || '#147c72';
    document.querySelector('.mark').style.background = accent + '18';
    document.querySelector('.mark').style.color = accent;
    document.getElementById('portalSubmit').style.background = accent;
    const submit = form.querySelector('button[type="submit"]');
    portalDisabled = x.enabled === false;
    submit.disabled = portalDisabled;
    if (x.enabled === false) showMessage('بوابة النتائج متوقفة مؤقتًا من إدارة المعمل.', 'error');
  } catch (error) {
    console.warn('Patient portal presentation settings could not be loaded.', error);
  }
}
const form = document.querySelector('[data-portal-form]');
const status = document.querySelector('[data-portal-status]');
const result = document.querySelector('[data-portal-result]');
const link = document.querySelector('[data-portal-download]');
const labName = document.querySelector('[data-portal-lab]');
const partialNotice = document.querySelector('[data-portal-partial]');
const publicSiteLink = document.getElementById('publicSiteLink');

function showMessage(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = false;
}

form?.querySelector('[name="slug"]')?.addEventListener('blur', event => loadPortalConfig(event.target.value));
const initialSlug = String(new URLSearchParams(window.location.search).get('lab') || '').trim().toLowerCase();
const slugInput = form?.querySelector('[name="slug"]');
if (slugInput) slugInput.value = initialSlug;
if (initialSlug && publicSiteLink) {
  const siteUrl = new URL('../website/index.html', window.location.href);
  siteUrl.searchParams.set('lab', initialSlug);
  publicSiteLink.href = siteUrl.href;
  publicSiteLink.hidden = false;
}
if (initialSlug) {
  loadPortalConfig(initialSlug);
} else {
  const submit = form?.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  showMessage('افتح بوابة النتائج من الموقع الرسمي للمعمل حتى يتم تحديد المعمل الصحيح.', 'error');
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.hidden = true;
  if(partialNotice)partialNotice.hidden=true;
  link.removeAttribute('href');
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'جارٍ البحث…';
  showMessage('جارٍ التحقق من البيانات بأمان…');

  try {
    const formData = new FormData(form);
    const slug = String(formData.get('slug') ?? '').trim().toLowerCase();
    if (!slug) { showMessage('افتح بوابة النتائج من الموقع الرسمي للمعمل حتى يتم تحديد المعمل الصحيح.', 'error'); return; }
    const patientName = String(formData.get('patientName') ?? '').trim();
    const visitNumber = String(formData.get('visitNumber') ?? '').trim();
    await loadPortalConfig(slug);
    const endpoint = `${APP_ENV.supabase.url}/functions/v1/patient-portal-lookup`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': APP_ENV.supabase.publishableKey,
      },
      body: JSON.stringify({ slug, patientName, visitNumber }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.reportUrl) {
      if (response.status === 429) {
        showMessage('تم إيقاف المحاولات مؤقتًا لحماية البوابة. حاول مرة أخرى بعد ساعة.', 'error');
      } else if (response.status === 400 || response.status === 200) {
        showMessage('لا توجد نتائج منشورة متاحة بهذه البيانات حاليًا. قد تكون التحاليل قيد الاختبار والمراجعة.', 'error');
      } else {
        showMessage(data.message || 'تعذر الاتصال بالخدمة الآن. حاول مرة أخرى لاحقًا.', 'error');
      }
      return;
    }
    labName.textContent = data.laboratoryName;
    link.href = data.reportUrl;
    if(partialNotice)partialNotice.hidden=!data.isPartial;
    result.hidden = false;
    showMessage(data.isPartial ? 'تم العثور على تقرير جزئي. بعض النتائج لم تصدر بعد؛ رابط التحميل صالح لمدة دقيقتين.' : 'تم العثور على التقرير. رابط التحميل صالح لمدة دقيقتين.', 'success');
  } catch (error) {
    console.error('Patient portal request failed.', error);
    showMessage('تعذر الاتصال بالخدمة الآن. تأكد من الإنترنت وحاول مرة أخرى.', 'error');
  } finally {
    submit.disabled = portalDisabled;
    submit.textContent = portalSubmitLabel;
  }
});
