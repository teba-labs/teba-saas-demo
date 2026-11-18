import { APP_ENV } from '../config/environment.js';

const form = document.querySelector('[data-portal-form]');
const status = document.querySelector('[data-portal-status]');
const result = document.querySelector('[data-portal-result]');
const link = document.querySelector('[data-portal-download]');
const labName = document.querySelector('[data-portal-lab]');

function showMessage(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = false;
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.hidden = true;
  link.removeAttribute('href');
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'جارٍ البحث…';
  showMessage('جارٍ التحقق من البيانات بأمان…');

  try {
    const formData = new FormData(form);
    const slug = String(formData.get('slug') ?? '').trim().toLowerCase();
    const patientName = String(formData.get('patientName') ?? '').trim();
    const visitNumber = String(formData.get('visitNumber') ?? '').trim();
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
      showMessage(data.message || 'تعذر العثور على تقرير مطابق. راجع البيانات وحاول مرة أخرى.', 'error');
      return;
    }
    labName.textContent = data.laboratoryName;
    link.href = data.reportUrl;
    result.hidden = false;
    showMessage('تم العثور على التقرير. رابط التحميل صالح لمدة دقيقتين.', 'success');
  } catch (error) {
    console.error('Patient portal request failed.', error);
    showMessage('تعذر الاتصال بالخدمة الآن. تأكد من الإنترنت وحاول مرة أخرى.', 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'عرض التقرير';
  }
});
