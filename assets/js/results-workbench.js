import { getSupabaseClient } from '../../core/supabase-client.js';
import { signInWithEmail, getCurrentSession, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { listBranchWork } from '../../modules/laboratory/repository.js';
import { listResultsForVisitTests, saveDraftResults, completeVisitTest, approveVisit } from '../../modules/results/repository.js';
import { publishReportVersion, correctPublishedResult } from '../../modules/reports/repository.js';

const $ = (id) => document.getElementById(id);
const state = { context: null, userId: null, tenant: null, branch: null, staff: [], work: [] };
const showNotice = (message, error = false) => {
  const el = $('notice'); el.textContent = message; el.className = `notice show${error ? ' error' : ''}`;
  window.clearTimeout(showNotice.timer); showNotice.timer = window.setTimeout(() => el.className = 'notice', 5000);
};
const setBusy = (button, busy, label) => { button.disabled = busy; if (busy) { button.dataset.oldLabel = button.textContent; button.textContent = label || 'جارٍ التنفيذ…'; } else if (button.dataset.oldLabel) { button.textContent = button.dataset.oldLabel; delete button.dataset.oldLabel; } };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function startWorkspace() {
  const session = await getCurrentSession();
  if (!session) { $('loginPanel').hidden = false; $('workspace').hidden = true; $('signOut').hidden = true; return; }
  state.context = await loadMyTenantContext();
  state.userId = state.context.user.id;
  $('loginPanel').hidden = true; $('workspace').hidden = false; $('signOut').hidden = false;
  const tenantSelect = $('tenantSelect');
  tenantSelect.innerHTML = state.context.tenants.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  if (!state.context.tenants.length) throw new Error('الحساب لا يملك معملًا نشطًا.');
  tenantSelect.onchange = () => selectTenant(tenantSelect.value);
  tenantSelect.value = getPreferredTenantId(state.context.tenants) || '';
  await selectTenant(tenantSelect.value);
}

async function selectTenant(tenantId) {
  state.tenant = state.context.tenants.find(t => t.id === tenantId);
  if (!state.tenant) return;
  rememberWorkspaceSelection(state.tenant.id);
  const branches = state.tenant.branches ?? [];
  $('branchSelect').innerHTML = branches.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
  $('branchSelect').onchange = () => loadBranch();
  $('branchSelect').value = getPreferredBranchId(state.tenant.id, branches) || '';
  if (!branches.length) { $('workList').innerHTML = '<div class="empty">لا يوجد فرع متاح لهذا الحساب.</div>'; return; }
  await loadBranch();
}

async function loadBranch() {
  const branchId = $('branchSelect').value;
  state.branch = state.tenant.branches.find(b => b.id === branchId);
  if (!state.branch) return;
  rememberWorkspaceSelection(state.tenant.id, state.branch.id);
  $('contextStatus').textContent = 'جارٍ تحميل بيانات الفرع…';
  const db = getSupabaseClient();
  let staffQuery = db.from('staff_directory')
    .select('id, display_name, auth_user_id, is_active').eq('tenant_id', state.tenant.id)
    .eq('branch_id', state.branch.id).eq('is_active', true);
  if (state.tenant.accountType === 'employee') staffQuery = staffQuery.eq('auth_user_id', state.userId);
  const { data, error } = await staffQuery.order('display_name');
  if (error) throw error;
  state.staff = data ?? [];
  if (state.tenant.accountType === 'employee') state.staff = state.staff.filter(row => row.auth_user_id === state.userId);
  $('staffSelect').disabled = state.tenant.accountType === 'employee';
  $('staffSelect').innerHTML = state.staff.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.display_name)}</option>`).join('');
  if (!state.staff.length) { $('workList').innerHTML = '<div class="empty">لا يوجد موظف نشط مسجل لهذا الفرع. أضف الموظفين من إعدادات المعمل أولًا.</div>'; $('contextStatus').textContent = ''; return; }
  await refreshWork();
}

async function refreshWork() {
  $('contextStatus').textContent = 'جارٍ تحديث قائمة العمل…';
  state.work = await listBranchWork({ tenantId: state.tenant.id, branchId: state.branch.id });
  $('contextStatus').textContent = `الفرع: ${state.branch.name} · ${state.work.length} تحليل قيد المتابعة`;
  await renderWork();
}

async function renderWork() {
  const host = $('workList');
  if (!state.work.length) { host.innerHTML = '<div class="empty">لا توجد تحاليل قيد العمل في هذا الفرع حاليًا.</div>'; return; }
  const byVisit = new Map();
  for (const item of state.work) {
    const visit = item.visits;
    const key = item.visit_id;
    if (!byVisit.has(key)) byVisit.set(key, { visit, items: [] });
    byVisit.get(key).items.push(item);
  }
  host.innerHTML = '';
  for (const [visitId, group] of byVisit) {
    const card = document.createElement('article'); card.className = 'work-card';
    const visitTitle = `زيارة ${group.visit?.visit_number ?? '—'} · ${group.visit?.patients?.full_name ?? 'مريض'}`;
    const isPublished = Boolean(group.visit?.is_published);
    const itemsMarkup = group.items.map(item => {
      const params = item.technical_snapshot?.parameters ?? [];
      const parameterControls = params.map(p => {
        const type = p.value_type ?? 'numeric';
        const code = escapeHtml(p.code);
        const name = escapeHtml(p.name ?? p.parameter_name ?? p.code);
        const metadata = `data-param-code="${code}" data-param-name="${name}" data-unit="${escapeHtml(p.unit ?? '')}" data-value-type="${escapeHtml(type)}" data-range='${escapeHtml(JSON.stringify(p.reference_ranges ?? {}))}' data-choices='${escapeHtml(JSON.stringify(p.choices ?? []))}'`;
        let control;
        if (type === 'boolean') {
          control = `<select ${metadata}><option value="">اختر نعم أو لا</option><option value="true">نعم</option><option value="false">لا</option></select>`;
        } else if (type === 'choice') {
          const choices = Array.isArray(p.choices) ? p.choices : [];
          control = `<select ${metadata}><option value="">اختر النتيجة</option>${choices.map(choice => `<option value="${escapeHtml(choice)}">${escapeHtml(choice)}</option>`).join('')}</select>`;
        } else if (type === 'numeric') {
          const decimals = Math.max(0, Math.min(6, Number(p.decimal_places ?? 2)));
          control = `<input type="number" step="${decimals === 0 ? '1' : String(10 ** -decimals)}" ${metadata} placeholder="أدخل النتيجة" />`;
        } else {
          control = `<input type="text" ${metadata} placeholder="أدخل النتيجة" />`;
        }
        return `<label>${name}${p.is_required === false ? ' (اختياري)' : ''}<small>${escapeHtml(p.unit ?? '')} ${escapeHtml(p.reference_ranges?.text ?? '')}</small>${control}</label>`;
      }).join('');
      return `<section class="parameter" data-test-id="${escapeHtml(item.id)}">
        <div class="card-head"><strong>${escapeHtml(item.test_name_snapshot)}</strong><span class="pill">${escapeHtml(item.status)}</span></div>
        <div class="parameter-grid">${parameterControls}</div>
        <div class="actions">${isPublished ? '<button class="button button-secondary correct-test" data-test-id="' + escapeHtml(item.id) + '">حفظ تصحيح النتيجة</button>' : '<button class="button button-secondary save-test" data-test-id="' + escapeHtml(item.id) + '">حفظ النتائج</button><button class="button button-secondary complete-test" data-test-id="' + escapeHtml(item.id) + '">إنهاء التحليل</button>'}</div>
      </section>`;
    }).join('');
    card.innerHTML = `<div class="card-head"><div><h2>${escapeHtml(visitTitle)}</h2><p class="muted">${escapeHtml(group.visit?.visit_work_date ?? '')}</p></div><span class="pill">${isPublished ? 'منشور' : escapeHtml(group.visit?.status ?? 'مفتوح')}</span></div>${itemsMarkup}
      <div class="actions"><button class="button approve-visit" data-visit-id="${escapeHtml(visitId)}" ${isPublished ? 'disabled' : ''}>اعتماد الزيارة</button></div>
      <div class="file-row"><label>ملف التقرير PDF<input type="file" accept="application/pdf,.pdf" data-report-file="${escapeHtml(visitId)}" ${!group.visit?.status || (!isPublished && group.visit.status !== 'approved') ? 'disabled' : ''}></label><button class="button publish-report" data-visit-id="${escapeHtml(visitId)}" ${!isPublished && group.visit?.status !== 'approved' ? 'disabled' : ''}>${isPublished ? 'نشر نسخة مصححة' : 'نشر التقرير'}</button></div>
      <p class="danger-note">التصحيح بعد النشر يحتاج سببًا موثقًا، ويجب إدخال التصحيح من مسار التصحيح المعتمد قبل رفع النسخة الجديدة.</p>`;
    host.append(card);
  }
  host.querySelectorAll('.save-test').forEach(btn => btn.addEventListener('click', () => saveTest(btn)));
  host.querySelectorAll('.complete-test').forEach(btn => btn.addEventListener('click', () => completeTest(btn)));
  host.querySelectorAll('.correct-test').forEach(btn => btn.addEventListener('click', () => correctTest(btn)));
  host.querySelectorAll('.approve-visit').forEach(btn => btn.addEventListener('click', () => approve(btn)));
  host.querySelectorAll('.publish-report').forEach(btn => btn.addEventListener('click', () => publish(btn)));
  // Populate all existing values with one scoped query instead of N+1 requests.
  const resultRows = await listResultsForVisitTests({
    tenantId: state.tenant.id,
    visitTestIds: state.work.map(item => item.id),
  });
  const resultsByTest = new Map();
  for (const result of resultRows) {
    if (!resultsByTest.has(result.visit_test_id)) resultsByTest.set(result.visit_test_id, []);
    resultsByTest.get(result.visit_test_id).push(result);
  }
  for (const item of state.work) {
    const section = host.querySelector(`[data-test-id="${CSS.escape(item.id)}"]`);
    if (!section) continue;
    for (const result of resultsByTest.get(item.id) ?? []) {
      const input = section.querySelector(`[data-param-code="${CSS.escape(result.parameter_code)}"]`);
      if (input) { input.value = result.value_numeric ?? result.value_text ?? ''; input.dataset.resultId = result.id; input.dataset.originalValue = input.value; }
    }
  }
}

async function saveTest(button) {
  try {
    setBusy(button, true, 'جارٍ الحفظ…');
    const section = button.closest('[data-test-id]');
    const testId = button.dataset.testId;
    const inputs = [...section.querySelectorAll('[data-param-code]')];
    const results = inputs.filter(input => input.value.trim()).map(input => ({
      parameter: { code: input.dataset.paramCode, name: input.dataset.paramName, unit: input.dataset.unit,
        valueType: input.dataset.valueType, referenceRange: JSON.parse(input.dataset.range || '{}'),
        choices: JSON.parse(input.dataset.choices || '[]') },
      value: input.value,
    }));
    if (!results.length) throw new Error('أدخل نتيجة واحدة على الأقل قبل الحفظ.');
    await saveDraftResults({ tenantId: state.tenant.id, branchId: state.branch.id,
      visitTestId: testId, results, staffId: $('staffSelect').value });
    showNotice('تم حفظ النتائج المدخلة بالكامل في عملية واحدة.');
  } catch (error) { showNotice(error.message || 'تعذر حفظ النتائج.', true); }
  finally { setBusy(button, false); }
}
async function correctTest(button) {
  try {
    const section = button.closest('[data-test-id]');
    const changed = [...section.querySelectorAll('[data-param-code]')].filter(input => input.dataset.resultId && input.value.trim() !== '' && input.value.trim() !== (input.dataset.originalValue ?? '').trim());
    if (!changed.length) throw new Error('لا توجد نتيجة محفوظة تغيرت قيمتها للتصحيح.');
    if (changed.length > 1) throw new Error('صحح نتيجة واحدة في كل مرة لتجنب حفظ بعض التصحيحات دون غيرها.');
    const reason = window.prompt('اكتب سبب تصحيح النتيجة المنشورة:')?.trim() ?? '';
    if (!reason) throw new Error('سبب التصحيح إلزامي.');
    setBusy(button, true, 'جارٍ حفظ التصحيح…');
    for (const input of changed) {
      const raw = input.value.trim();
      const numeric = input.dataset.valueType === 'numeric' ? raw : null;
      const text = input.dataset.valueType === 'numeric' ? null : raw;
      await correctPublishedResult({ tenantId: state.tenant.id, branchId: state.branch.id, visitId: section.closest('.work-card').querySelector('.publish-report').dataset.visitId, resultId: input.dataset.resultId, valueNumeric: numeric, valueText: text, reason, staffId: $('staffSelect').value });
    }
    showNotice('تم تسجيل التصحيح. ارفع نسخة PDF جديدة بسبب التصحيح لتحديث تقرير المريض.');
    for (const input of changed) input.dataset.originalValue = input.value;
  } catch (error) { showNotice(error.message || 'تعذر تصحيح النتيجة.', true); }
  finally { setBusy(button, false); }
}

async function completeTest(button) {
  try { setBusy(button, true, 'جارٍ الإنهاء…'); await completeVisitTest({ tenantId: state.tenant.id, branchId: state.branch.id, visitTestId: button.dataset.testId, staffId: $('staffSelect').value }); showNotice('تم إنهاء التحليل بعد التحقق من النتائج المطلوبة.'); await refreshWork(); }
  catch (error) { showNotice(error.message || 'تعذر إنهاء التحليل.', true); } finally { setBusy(button, false); }
}
async function approve(button) {
  try { setBusy(button, true, 'جارٍ الاعتماد…'); await approveVisit({ tenantId: state.tenant.id, branchId: state.branch.id, visitId: button.dataset.visitId, staffId: $('staffSelect').value }); showNotice('تم اعتماد الزيارة. يمكنك الآن رفع ملف PDF.'); await refreshWork(); }
  catch (error) { showNotice(error.message || 'تعذر اعتماد الزيارة.', true); } finally { setBusy(button, false); }
}
async function publish(button) {
  try {
    const visitId = button.dataset.visitId;
    const fileInput = document.querySelector(`[data-report-file="${CSS.escape(visitId)}"]`);
    const file = fileInput?.files?.[0];
    if (!file) throw new Error('اختر ملف التقرير PDF أولًا.');
    const isCorrection = state.work.some(item => item.visit_id === visitId && item.visits?.is_published);
    let reason = '';
    if (isCorrection) { reason = window.prompt('اكتب سبب إصدار النسخة المصححة:')?.trim() ?? ''; if (!reason) throw new Error('يجب إدخال سبب التصحيح.'); }
    setBusy(button, true, 'جارٍ النشر…');
    await publishReportVersion({ tenantId: state.tenant.id, branchId: state.branch.id, visitId,
      staffId: $('staffSelect').value, file, changeReason: reason });
    showNotice('تم إرسال التقرير لمسار النشر.'); await refreshWork();
  } catch (error) { showNotice(error.message || 'تعذر نشر التقرير.', true); }
  finally { setBusy(button, false); }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]');
  try { setBusy(button, true, 'جارٍ الدخول…'); await signInWithEmail($('email').value, $('password').value); await startWorkspace(); }
  catch (error) { showNotice(error.message || 'تعذر تسجيل الدخول.', true); }
  finally { setBusy(button, false); }
});
$('signOut').addEventListener('click', async () => { try { await signOut(); await startWorkspace(); } catch (error) { showNotice(error.message, true); } });
$('refreshButton').addEventListener('click', async () => { try { await refreshWork(); } catch (error) { showNotice(error.message, true); } });

try { await startWorkspace(); } catch (error) { showNotice(error.message || 'تعذر تهيئة شاشة التشغيل.', true); }
