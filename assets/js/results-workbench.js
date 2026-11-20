import { getSupabaseClient } from '../../core/supabase-client.js';
import { signInWithEmail, getCurrentSession, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { listBranchWorkPage, listVisitWorkForReport } from '../../modules/laboratory/repository.js';
import { listResultsForVisitTests, listVisitParameterRangeOverrides, saveVisitParameterRangeOverride, saveDraftResults, completeVisitTest, approveVisit } from '../../modules/results/repository.js';
import { publishReportVersion, correctVisitResultWithFlag } from '../../modules/reports/repository.js';
import { getLabAssetPublicUrl } from '../../modules/settings/assets-repository.js';
import { listVisitAttachments, uploadVisitAttachment, createAttachmentDownloadUrl } from '../../modules/files/repository.js';
import { listHistoricalResults } from '../../modules/migration/historical-results-repository.js';
import { listCultureResults, saveCultureIsolate, saveCultureSusceptibility } from '../../modules/results/culture-repository.js';

const $ = (id) => document.getElementById(id);
const state = { context: null, userId: null, tenant: null, branch: null, staff: [], work: [], workPage: 0, workPageSize: 25, workCount: 0, historicalSelections: new Map(), previewedVisits: new Set() };
window.taibaGetResultsContext=()=>({tenantId:state.tenant?.id,branchId:state.branch?.id,tenantSlug:state.tenant?.slug});
window.taibaGetDirtyResultInputs=()=>[...document.querySelectorAll('[data-param-code]')].filter(input=>input.dataset.resultSource!=='calculated'&&input.value.trim()!==(input.dataset.originalValue??'').trim());
window.addEventListener('taiba:results-work-refresh',()=>refreshWork().catch(error=>showNotice(error.message||'تعذر تحديث قائمة النتائج.',true)));
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
  state.workPage = 0;
  window.dispatchEvent(new CustomEvent('taiba:results-context',{detail:{tenantId:state.tenant?.id,branchId:state.branch?.id,tenantSlug:state.tenant?.slug}}));
  await refreshWork();
}

async function refreshWork() {
  if(window.taibaGetDirtyResultInputs?.().length){showNotice('هناك نتائج غير محفوظة. احفظها أولًا قبل تحديث القائمة أو تغيير الفرع أو الحالة.',true);return;}
  state.previewedVisits.clear();
  $('contextStatus').textContent = 'جارٍ تحديث قائمة العمل…';
  let result = await listBranchWorkPage({ tenantId: state.tenant.id, branchId: state.branch.id, page: state.workPage, pageSize: state.workPageSize });
  const lastPage = Math.max(0, Math.ceil(result.count / state.workPageSize) - 1);
  if (state.workPage > lastPage) {
    state.workPage = lastPage;
    result = await listBranchWorkPage({ tenantId: state.tenant.id, branchId: state.branch.id, page: state.workPage, pageSize: state.workPageSize });
  }
  state.work = result.rows;
  state.workCount = result.count;
  $('contextStatus').textContent = `الفرع: ${state.branch.name} · ${state.workCount} تحليل قيد المتابعة`;
  const pager = $('workPager');
  pager.hidden = state.workCount <= state.workPageSize;
  $('workPageStatus').textContent = `صفحة ${state.workPage + 1} من ${Math.max(1, Math.ceil(state.workCount / state.workPageSize))} · ${state.workCount} تحليل`;
  $('prevWorkPage').disabled = state.workPage === 0;
  $('nextWorkPage').disabled = (state.workPage + 1) * state.workPageSize >= state.workCount;
  await renderWork();
}

async function renderWork() {
  const host = $('workList');
  if (!state.work.length) { host.innerHTML = '<div class="empty">لا توجد تحاليل قيد العمل في هذا الفرع حاليًا.</div>'; return; }
  const rangeOverrides = await listVisitParameterRangeOverrides({tenantId:state.tenant.id,visitTestIds:state.work.map(item=>item.id)});
  const rangeOverridesByKey = new Map(rangeOverrides.map(row=>[row.visit_test_id+'|'+row.parameter_code,row]));
  const byVisit = new Map();
  for (const item of state.work) {
    const visit = item.visits;
    const key = item.visit_id;
    if (!byVisit.has(key)) byVisit.set(key, { visit, items: [] });
    byVisit.get(key).items.push(item);
  }
  host.innerHTML = '';
  for (const [visitId, group] of byVisit) {
    const card = document.createElement('article'); card.className = 'work-card'; card.dataset.visitId = visitId; card.dataset.patientPhone = group.visit?.patients?.phone || ''; card.dataset.visitNumber = group.visit?.visit_number || ''; card.dataset.published = String(Boolean(group.visit?.is_published)); card.dataset.visitStatus = group.visit?.status || 'open';
    const visitTitle = `زيارة ${group.visit?.visit_number ?? '—'} · ${group.visit?.patients?.full_name ?? 'مريض'}`;
    const isPublished = Boolean(group.visit?.is_published);
    const itemsMarkup = group.items.map(item => {
      const locked = item.status === 'completed';
      const params = item.technical_snapshot?.parameters ?? [];
      const groupedParams = new Map();
      for (const p of params) { const sectionName = p.clinical_metadata?.section || 'النتائج'; if (!groupedParams.has(sectionName)) groupedParams.set(sectionName, []); groupedParams.get(sectionName).push(p); }
      const parameterControls = [...groupedParams.entries()].map(([sectionName, groupParams]) => `<fieldset class="parameter-group"><legend>${escapeHtml(sectionName)}</legend>${groupParams.map(p => {
        const type = p.value_type ?? 'numeric';
        const code = escapeHtml(p.code);
        const name = escapeHtml(p.name ?? p.parameter_name ?? p.code);
        const parameterRange = rangeOverridesByKey.get(item.id+'|'+p.code)?.reference_ranges ?? p.reference_ranges ?? {};
        const metadata = `data-param-code="${code}" data-param-name="${name}" data-unit="${escapeHtml(p.unit ?? '')}" data-value-type="${escapeHtml(type)}" data-range='${escapeHtml(JSON.stringify(parameterRange))}' data-choices='${escapeHtml(JSON.stringify(p.choices ?? []))}' data-reference-interval-status='${escapeHtml(p.reference_interval_status ?? 'local_verification_required')}' data-patient-age='${escapeHtml(item.visits?.patients?.age_years ?? '')}' data-patient-sex='${escapeHtml(item.visits?.patients?.sex ?? '')}' data-critical-range='${escapeHtml(JSON.stringify(p.critical_ranges ?? []))}'`;
        let control;
        if (p.result_source === 'calculated') {
          control = `<input type="number" step="any" ${metadata} data-result-source="calculated" disabled placeholder="تُحسب تلقائيًا بعد إدخال المدخلات" />`;
        } else if (type === 'boolean') {
          control = `<select ${metadata}${locked ? ' disabled' : ''}><option value="">اختر نعم أو لا</option><option value="true">نعم</option><option value="false">لا</option></select>`;
        } else if (type === 'choice') {
          const choices = Array.isArray(p.choices) ? p.choices : [];
          control = `<select ${metadata}${locked ? ' disabled' : ''}><option value="">اختر النتيجة</option>${choices.map(choice => `<option value="${escapeHtml(choice)}">${escapeHtml(choice)}</option>`).join('')}</select>`;
        } else if (type === 'numeric') {
          const decimals = Math.max(0, Math.min(6, Number(p.decimal_places ?? 2)));
          control = `<input type="number" step="${decimals === 0 ? '1' : String(10 ** -decimals)}" ${metadata}${locked ? ' disabled' : ''} placeholder="أدخل النتيجة" />`;
        } else {
          control = `<input type="text" ${metadata}${locked ? " disabled" : ""} placeholder="أدخل النتيجة" />`;
        }
        const rangeText = resolveReferenceRange(parameterRange, item.visits?.patients || {}, p.reference_interval_status);
        const rangeEditButton = (isPublished || (group.visit?.status !== 'approved' && group.visit?.status !== 'cancelled'))
          ? '<button type="button" class="edit-reference-range" data-visit-test-id="' + escapeHtml(item.id) + '" data-param-code="' + code + '" data-range="' + escapeHtml(JSON.stringify(parameterRange)) + '" data-published="' + String(isPublished) + '">' + (isPublished ? 'تصحيح رينج التقرير المنشور' : 'تعديل الرينج لهذه الزيارة') + '</button>' : '';
        return '<label>' + name + (p.is_required === false ? ' (اختياري)' : '') + '<small>' + escapeHtml(p.unit ?? '') + ' ' + escapeHtml(rangeText) + '</small>' + control + rangeEditButton + '</label>';
      }).join('')}</fieldset>`).join('');
      const isCulture = String(item.test_code_snapshot || '').startsWith('CULTURE_');
      const cultureEditor = isCulture ? `<section class="culture-workflow" data-culture-workflow="${escapeHtml(item.id)}"><h3>العزلات والاختبار الحساسي (Antibiogram)</h3><p class="muted">أضف كل عزلة منفصلة. أدخل تفسير الحساسية وفق إصدار CLSI/EUCAST والطريقة المعتمدة في المعمل؛ النظام لا يخمّن نقاط القطع.</p><div class="culture-isolates" data-culture-isolates="${escapeHtml(item.id)}"><p class="muted">جارٍ تحميل العزلات…</p></div>${!locked && !isPublished ? `<form class="culture-isolate-form" data-visit-test-id="${escapeHtml(item.id)}"><label>رقم العزلة<input name="isolateNumber" type="number" min="1" max="20" value="1" required></label><label>اسم الكائن الممرض / العزلة<input name="organismName" maxlength="200" required placeholder="مثال: Escherichia coli"></label><label>وصف النمو<input name="growthDescription" placeholder="Pure growth / mixed growth"></label><label>عدد المستعمرات<input name="colonyCount" type="number" min="0" step="any"></label><label>وحدة العد<input name="colonyCountUnit" value="CFU/mL"></label><label>طريقة التعريف<input name="identificationMethod" placeholder="Biochemical / MALDI-TOF / Automated"></label><label class="wide">ملاحظات<textarea name="notes" rows="2"></textarea></label><button class="button" type="submit">حفظ العزلة</button></form>` : ''}</section>` : '';
      return `<section class="parameter" data-test-id="${escapeHtml(item.id)}" data-visit-id="${escapeHtml(visitId)}" data-test-status="${escapeHtml(item.status)}" data-published="${String(isPublished)}" data-test-code="${escapeHtml(item.test_code_snapshot || '')}" data-test-kind="${escapeHtml(item.technical_snapshot?.test_kind || item.tests_catalog?.test_kind || 'individual')}">
        <div class="card-head"><strong>${escapeHtml(item.test_name_snapshot)}</strong><span class="pill">${escapeHtml(item.status)}</span></div>
        <div class="parameter-grid">${parameterControls}</div>${cultureEditor}
        <div class="actions">${isPublished ? '<button class="button button-secondary correct-test" data-test-id="' + escapeHtml(item.id) + '">تصحيح نتيجة منشورة</button>' : locked && group.visit?.status !== 'approved' && group.visit?.status !== 'cancelled' ? '<button class="button button-secondary correct-unpublished-test" data-test-id="' + escapeHtml(item.id) + '">تصحيح نتيجة محفوظة</button>' : locked ? '<span class="pill">التحليل مكتمل — النتائج للعرض فقط</span>' : '<button class="button button-secondary save-test" data-test-id="' + escapeHtml(item.id) + '">حفظ النتائج</button><button class="button button-secondary complete-test" data-test-id="' + escapeHtml(item.id) + '">إنهاء التحليل</button>'}</div>
      </section>`;
    }).join('');
    card.innerHTML = `<div class="card-head"><div><h2>${escapeHtml(visitTitle)}</h2><p class="muted">${escapeHtml(group.visit?.visit_work_date ?? '')}</p></div><span class="pill">${isPublished ? 'منشور' : escapeHtml(group.visit?.status ?? 'مفتوح')}</span></div>${itemsMarkup}
      <div class="actions"><button class="button approve-visit" data-visit-id="${escapeHtml(visitId)}" ${(isPublished || group.visit?.status === 'approved') ? 'disabled' : ''}>${group.visit?.status === 'approved' ? 'تم اعتماد الزيارة' : 'اعتماد الزيارة'}</button></div>
      <div class="actions"><button class="button button-secondary print-visit-report" data-visit-id="${escapeHtml(visitId)}" ${!isPublished && group.visit?.status !== 'approved' ? 'disabled' : ''}>طباعة التقرير بإعدادات المعمل / حفظ PDF</button></div>
      <div class="actions"><button class="button button-secondary select-historical-report" data-visit-id="${escapeHtml(visitId)}" type="button">اختيار نتائج تاريخية لإضافتها للتقرير (اختياري)</button></div><div class="historical-report-picker" data-historical-picker="${escapeHtml(visitId)}" hidden></div>
      <div class="file-row"><label>ملف التقرير PDF<input type="file" accept="application/pdf,.pdf" data-report-file="${escapeHtml(visitId)}" ${!group.visit?.status || (!isPublished && group.visit.status !== 'approved') ? 'disabled' : ''}></label><button class="button publish-report" data-visit-id="${escapeHtml(visitId)}" ${!isPublished && group.visit?.status !== 'approved' ? 'disabled' : ''}>${isPublished ? 'نشر نسخة مصححة' : 'نشر التقرير'}</button></div>
      <div class="file-row"><label>مرفق للزيارة (PDF أو JPG أو PNG)<input type="file" accept="application/pdf,image/jpeg,image/png" data-attachment-file="${escapeHtml(visitId)}"></label><button class="button button-secondary upload-attachment" data-visit-id="${escapeHtml(visitId)}">رفع مرفق</button><button class="button button-secondary list-attachments" data-visit-id="${escapeHtml(visitId)}">عرض المرفقات</button></div>
      <div class="attachment-list" data-attachment-list="${escapeHtml(visitId)}"></div>
      <p class="danger-note">التصحيح بعد النشر يحتاج سببًا موثقًا، ويجب إدخال التصحيح من مسار التصحيح المعتمد قبل رفع النسخة الجديدة.</p>`;
    host.append(card);
  }
  host.querySelectorAll('.edit-reference-range').forEach(btn => btn.addEventListener('click', () => editReferenceRange(btn)));
  host.querySelectorAll('.save-test').forEach(btn => btn.addEventListener('click', () => saveTest(btn)));
  host.querySelectorAll('.complete-test').forEach(btn => btn.addEventListener('click', () => completeTest(btn)));
  host.querySelectorAll('.correct-test, .correct-unpublished-test').forEach(btn => btn.addEventListener('click', () => correctTest(btn)));
  host.querySelectorAll('.approve-visit').forEach(btn => btn.addEventListener('click', () => approve(btn)));
  host.querySelectorAll('.publish-report').forEach(btn => btn.addEventListener('click', () => publish(btn)));
  host.querySelectorAll('.upload-attachment').forEach(btn => btn.addEventListener('click', () => uploadAttachment(btn)));
  host.querySelectorAll('.list-attachments').forEach(btn => btn.addEventListener('click', () => loadAttachments(btn.dataset.visitId)));
  host.querySelectorAll('.attachment-download').forEach(btn => btn.addEventListener('click', () => downloadAttachment(btn)));
  // Populate all existing values with one scoped query instead of N+1 requests.
  const resultRows = await listResultsForVisitTests({
    tenantId: state.tenant.id,
    visitTestIds: state.work.map(item => item.id),
  });
  const cultureWork = state.work.filter(item => String(item.test_code_snapshot || '').startsWith('CULTURE_'));
  if (cultureWork.length) {
    const cultureRows = await listCultureResults({tenantId:state.tenant.id,branchId:state.branch.id,visitTestIds:cultureWork.map(item=>item.id)});
    for (const item of cultureWork) renderCultureResults(host,item,cultureRows);
    bindCultureForms(host);
  }
  host.querySelectorAll('.select-historical-report').forEach(btn => btn.addEventListener('click', () => loadHistoricalReportPicker(btn)));
  host.querySelectorAll('.print-visit-report').forEach(btn => btn.addEventListener('click', () => window.taibaPreviewVisitReport(btn.dataset.visitId)));
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


async function editReferenceRange(button) {
  if(window.taibaGetDirtyResultInputs?.().length){showNotice('احفظ النتائج التي أدخلتها قبل تعديل المدى المرجعي.',true);return;}
  const visitTestId=button.dataset.visitTestId,parameterCode=button.dataset.paramCode;
  const item=state.work.find(row=>row.id===visitTestId);
  const parameter=item?.technical_snapshot?.parameters?.find(row=>row.code===parameterCode);
  if(!item||!parameter)return;
  let current={};try{current=JSON.parse(button.dataset.range||'{}');}catch{}
  const currentText=formatReferenceRange(current);
  const value=window.prompt('اكتب المدى المرجعي الجديد لهذا المريض وهذه الزيارة فقط. مثال: 0.7 - 1.3 أو Negative',currentText==='—'?'':currentText);
  if(value===null)return;
  const clean=value.trim();if(!clean){showNotice('لم يتم تغيير المدى المرجعي لأن القيمة فارغة.',true);return;}
  const normalized=clean.replace(/[–—]/g,'-');
  const numericMatch=normalized.match(/^(-?\\d+(?:\\.\\d+)?)\\s*-\\s*(-?\\d+(?:\\.\\d+)?)$/);
  let referenceRanges;
  if(numericMatch){
    const lower=Number(numericMatch[1]),upper=Number(numericMatch[2]);
    if(lower>upper){showNotice('الحد الأدنى لا يمكن أن يتجاوز الحد الأعلى.',true);return;}
    referenceRanges=[{lower,upper}];
  }else referenceRanges=[{text:clean}];
  if(button.dataset.published==='true'&&!window.confirm('هذه الزيارة منشورة بالفعل. سيظل التقرير السابق محفوظًا، وسيحتاج التعديل إلى معاينة ونشر نسخة مصححة. هل تريد المتابعة؟'))return;
  const reason=window.prompt('سبب تعديل المدى (سيُحفظ في سجل التعديلات):','تعديل محلي للمدى المرجعي أثناء تسجيل النتيجة');
  if(reason===null)return;
  const saveReason=reason.trim()||'تعديل محلي للمدى المرجعي أثناء تسجيل النتيجة';
  button.disabled=true;
  try{
    await saveVisitParameterRangeOverride({tenantId:state.tenant.id,branchId:state.branch.id,visitTestId,parameterCode,referenceRanges,staffId:$('staffSelect').value,reason:saveReason});
    showNotice(button.dataset.published==='true'?'تم حفظ تصحيح المدى. التقرير المنشور السابق محفوظ، ويجب معاينة ونشر النسخة المصححة.':'تم حفظ المدى المرجعي لهذه الزيارة والبارامتر فقط. لم يتغير كتالوج التحاليل أو أي زيارة أخرى.');
    window.dispatchEvent(new CustomEvent('taiba:results-work-refresh'));
  }catch(error){button.disabled=false;showNotice(error.message||'تعذر حفظ المدى المرجعي.',true);}
}

function resolveReferenceRange(value, patient = {}, status = 'local_verification_required') {
  const localPending = status === 'local_verification_required';
  if (localPending && (!value || (Array.isArray(value) && value.length === 0))) return 'لا يوجد مدى مصدر محدد؛ يلزم ضبطه محليًا';
  if (status === 'not_applicable' && !(value && (value.text || Array.isArray(value)))) return 'لا ينطبق';
  if (Array.isArray(value)) {
    const age = patient?.age_years == null ? null : Number(patient.age_years);
    const sex = String(patient?.sex || '').toLowerCase();
    const matches = value.filter(range => {
      if (range.pregnancy) return false;
      if (range.sex && String(range.sex).toLowerCase() !== sex) return false;
      if (range.age) {
        if (age === null || (range.age.unit && !['year','years','y'].includes(String(range.age.unit).toLowerCase()))) return false;
        if (range.age.min != null && age < Number(range.age.min)) return false;
        if (range.age.max != null && age > Number(range.age.max)) return false;
      }
      return true;
    });
    if (matches.length === 1) return (localPending ? 'مقترح من المصدر — غير معتمد محليًا: ' : '') + formatReferenceRange(matches[0]);
    if (!matches.length && value.length === 1 && !value[0].age && !value[0].sex && !value[0].pregnancy) return (localPending ? 'مقترح — غير معتمد محليًا: ' : '') + formatReferenceRange(value[0]);
    return matches.length > 1 ? 'أكثر من مدى ينطبق؛ يلزم تحديد الفئة' : (localPending ? 'لا يوجد مدى مصدر مطابق؛ يلزم ضبط محلي' : 'لا يوجد مدى مطابق لعمر/نوع المريض');
  }
  const formatted = formatReferenceRange(value);
  return localPending && formatted !== '—' ? 'مقترح من المصدر — غير معتمد محليًا: ' + formatted : formatted;
}

function formatReferenceRange(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (value.text) return String(value.text);
    const low = value.low ?? value.min ?? value.lower;
    const high = value.high ?? value.max ?? value.upper;
    if (low !== undefined || high !== undefined) return (low ?? '—') + ' – ' + (high ?? '—');
    return Object.entries(value).map(([key, item]) => key + ': ' + item).join(' · ');
  }
  return '—';
}

async function loadHistoricalReportPicker(button){
 const visitId=button.dataset.visitId,group=state.work.find(item=>item.visit_id===visitId)?.visits||{};
 const patient=group.patients||{},picker=document.querySelector('[data-historical-picker="'+CSS.escape(visitId)+'"]');
 if(!picker)return;
 if(!picker.hidden){picker.hidden=true;return;}
 picker.hidden=false;picker.textContent='جارٍ تحميل النتائج التاريخية…';
 try{
  const [linked,unlinked]=await Promise.all([
   patient.id?listHistoricalResults({tenantId:state.tenant.id,branchId:state.branch.id,patientId:patient.id,limit:200}):Promise.resolve([]),
   listHistoricalResults({tenantId:state.tenant.id,branchId:state.branch.id,search:patient.full_name||'',limit:200})
  ]);
  const rows=[...new Map([...linked,...unlinked.filter(row=>!row.patient_id)].map(row=>[row.id,row])).values()];
  picker.replaceChildren();
  if(!rows.length){picker.textContent='لا توجد نتائج تاريخية لهذا المريض في الفرع الحالي.';return;}
  const note=document.createElement('p');note.textContent='حدد النتائج القديمة التي تريد إرفاقها بهذا التقرير فقط. لن تُضاف أي نتيجة دون تحديدها هنا.';picker.append(note);
  const selected=state.historicalSelections.get(visitId)||new Set();
  for(const row of rows){
   const label=document.createElement('label');label.className='historical-report-choice';
   const input=document.createElement('input');input.type='checkbox';input.checked=selected.has(row.id);input.dataset.historicalId=row.id;
   input.addEventListener('change',()=>{const set=state.historicalSelections.get(visitId)||new Set();if(input.checked)set.add(row.id);else set.delete(row.id);state.historicalSelections.set(visitId,set);});
   const text=document.createElement('span');text.textContent=row.test_name_snapshot+' · '+row.result_date+' · '+row.patient_name_snapshot;
   label.append(input,text);picker.append(label);
  }
 }catch(error){picker.textContent=error.message||'تعذر تحميل النتائج التاريخية.';}
}
async function printVisitReport(visitId, win, { autoPrint = true } = {}) {
  const visitItems = await listVisitWorkForReport({ tenantId: state.tenant.id, branchId: state.branch.id, visitId });
  if (!visitItems.length) throw new Error('تعذر العثور على تحاليل الزيارة في هذا الفرع.');
  const visit = visitItems[0].visits || {};
  const canPrint = visit.status === 'approved' || Boolean(visit.is_published);
  const patient = visit.patients || {};
  const rows = await listResultsForVisitTests({ tenantId: state.tenant.id, visitTestIds: visitItems.map(item => item.id) });
  const cultureRows = await listCultureResults({tenantId:state.tenant.id,branchId:state.branch.id,visitTestIds:visitItems.filter(item=>String(item.test_code_snapshot || '').startsWith('CULTURE_')).map(item=>item.id)});
  // Preview may be opened before approval so incomplete work can be spotted; printing remains gated.
  const selectedHistoricalIds=state.historicalSelections.get(visitId)||new Set();
  let selectedHistoricalRows=[];
  if(selectedHistoricalIds.size){
    const [linked,unlinked]=await Promise.all([
      patient.id?listHistoricalResults({tenantId:state.tenant.id,branchId:state.branch.id,patientId:patient.id,limit:200}):Promise.resolve([]),
      listHistoricalResults({tenantId:state.tenant.id,branchId:state.branch.id,search:patient.full_name||'',limit:200})
    ]);
    selectedHistoricalRows=[...new Map([...linked,...unlinked.filter(row=>!row.patient_id)].map(row=>[row.id,row])).values()].filter(row=>selectedHistoricalIds.has(row.id));
  }

  const brand = globalThis.__taibaTenantBrand || {};
  const lab = brand.settings || {};
  const print = brand.printSettings || {};
  const branch = state.branch || brand.branch || {};
  const { data: reportBranches = [] } = await getSupabaseClient().from('branches')
    .select('id,name,address,phone').eq('tenant_id', state.tenant.id).eq('is_active', true).order('name');
  const logoPath = print.showLogo === false ? '' : (print.logoSource === 'branch' ? (print.logoPath || lab.logo_path || '') : (lab.logo_path || print.logoPath || ''));
  const signaturePath = print.showSignature ? print.signaturePath || '' : '';
  const logo = logoPath ? getLabAssetPublicUrl(logoPath) : '';
  const signature = signaturePath ? getLabAssetPublicUrl(signaturePath) : '';
  const labName = lab.laboratory_name || state.tenant?.name || 'Taiba Smart Lab';
  const doctor = print.showDoctor === false ? '' : (lab.doctor_name || '');
  const branchName = print.showBranch === false ? '' : (branch.name || '');
  const phone = print.showPhone === false ? '' : (branch.phone || lab.phone || lab.whatsapp || '');
  const address = print.showAddress === false ? '' : (branch.address || lab.address || '');
  const footer = print.footerText || lab.report_footer || '';
  const branchAddressList = print.showBranchAddresses === false ? [] : (reportBranches.length ? reportBranches : [branch]).filter(row => row.address).map(row => ({name:row.name,address:row.address}));
  const safeHttpUrl = value => { try { const url=new URL(String(value||'')); return ['http:','https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const websiteUrl = safeHttpUrl(print.websiteUrl || lab.settings_json?.website_url || '');
  const supportUrl = safeHttpUrl(print.supportUrl || lab.settings_json?.support_url || '');
  const phoneContact = print.showContacts === false || print.showPhone === false ? '' : (branch.phone || lab.phone || '');
  const whatsappContact = print.showContacts === false ? '' : (lab.whatsapp || '');
  const watermarkMode = print.watermarkMode || 'none';
  const watermarkOpacity = Math.min(.18,Math.max(.02,Number(print.watermarkOpacity)||.07));
  const watermarkText = watermarkMode === 'name' ? labName : '';
  const watermarkImage = watermarkMode === 'logo' ? (logo || (lab.logo_path ? getLabAssetPublicUrl(lab.logo_path) : '')) : '';
  const identityHtml = '<div class="identity-zone"><strong>' + escapeHtml(labName) + '</strong>' + (doctor ? '<span>' + escapeHtml(doctor) + '</span>' : '') + '</div>';
  const headerRight = print.identitySide === 'left' ? '' : identityHtml;
  const headerLeft = print.identitySide === 'left' ? identityHtml : '';
  const centerLogo = logo ? '<img class="lab-logo" src="' + escapeHtml(logo) + '" alt="شعار المعمل">' : '';
  const qrHtml = print.footerCenterMode === 'qr' && websiteUrl ? '<a class="footer-qr" href="' + escapeHtml(websiteUrl) + '"><img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=' + encodeURIComponent(websiteUrl) + '" alt="QR للموقع"><small>امسح لزيارة موقع المعمل</small></a>' : '';
  const centerFooter = print.footerCenterMode === 'message' && print.footerCenterMessage ? '<div class="footer-center-message">' + escapeHtml(print.footerCenterMessage) + '</div>' : qrHtml;
  const branchPhones = print.showContacts === false || print.showPhone === false ? [] : reportBranches.filter(row=>row.phone).map(row=>'<div>' + escapeHtml(row.name) + ' هاتف: ' + escapeHtml(row.phone) + '</div>');
  const phoneLink = value => { const digits=String(value||'').replace(/[^0-9+]/g,''); return digits ? '<a href="tel:' + escapeHtml(digits) + '">' + escapeHtml(digits) + '</a>' : escapeHtml(value); };
  const whatsappLink = value => { let digits=String(value||'').replace(/\\D/g,'').replace(/^00/,''); if(digits.startsWith('0'))digits='20'+digits.slice(1); if(/^20\\d{9,11}$/.test(digits))return '<a href="https://wa.me/'+digits+'" target="_blank" rel="noopener">'+escapeHtml(value)+'</a>'; return escapeHtml(value); };
  const branchPhoneLinks = print.showContacts === false || print.showPhone === false ? [] : reportBranches.filter(row=>row.phone).map(row=>'<div>' + escapeHtml(row.name) + ' هاتف: ' + phoneLink(row.phone) + '</div>');
  const footerContacts = (branchPhoneLinks.length ? branchPhoneLinks.join('') : (phoneContact ? '<div>هاتف: ' + phoneLink(phoneContact) + '</div>' : '')) +
    (whatsappContact ? '<div>واتساب: ' + whatsappLink(whatsappContact) + '</div>' : '') +
    (websiteUrl ? '<div>الموقع: <a href="' + escapeHtml(websiteUrl) + '" target="_blank" rel="noopener">' + escapeHtml(websiteUrl) + '</a></div>' : '') +
    (supportUrl ? '<div>الدعم / بوابة المريض: <a href="' + escapeHtml(supportUrl) + '" target="_blank" rel="noopener">' + escapeHtml(supportUrl) + '</a></div>' : '');
  const footerAddresses = branchAddressList.map(row => '<div><strong>' + escapeHtml(row.name) + ':</strong> ' + escapeHtml(row.address) + '</div>').join('');
  const footerGridColumns = centerFooter ? '1fr 120px 1fr' : '1fr 1fr';
  const footerCenterMarkup = centerFooter ? '<div class="footer-center">' + centerFooter + '</div>' : '';
  const title = print.title || 'نتيجة الفحوصات الطبية';
  const paper = print.paperSize === 'A5' ? 'A5' : 'A4';
  const orientation = print.orientation === 'landscape' ? 'landscape' : 'portrait';
  const margin = Math.min(30, Math.max(5, Number(print.margin) || 12));
  const byTest = new Map();
  for (const row of rows) {
    if (!byTest.has(row.visit_test_id)) byTest.set(row.visit_test_id, new Map());
    byTest.get(row.visit_test_id).set(row.parameter_code, row);
  }
  const testSections = visitItems.map(item => {
    const resultMap = byTest.get(item.id) || new Map();
    const parameters = item.technical_snapshot?.parameters || [];
    const codes = new Set([...parameters.map(parameter => parameter.code), ...resultMap.keys()]);
    const lines = [...codes].map(code => {
      const parameter = parameters.find(candidate => candidate.code === code) || {};
      const result = resultMap.get(code);
      if (!result) return '';
      const parameterName = result.parameter_name_snapshot || parameter.name || parameter.parameter_name || code;
      const value = result.value_numeric ?? result.value_text ?? '—';
      const unit = result.unit_snapshot || parameter.unit || '';
      const reference = resolveReferenceRange(result.reference_range_snapshot ?? parameter.reference_ranges, patient, parameter.reference_interval_status);
      const calculatedFlag=computeReferenceFlag(result.value_numeric,result.reference_range_snapshot ?? parameter.reference_ranges,patient.age_years,patient.sex,parameter.reference_interval_status,'numeric');
      const displayFlag=calculatedFlag || result.flag;
      const flag = displayFlag ? ' · ' + displayFlag : '';
      return '<tr><td>' + escapeHtml(parameterName) + '</td><td>' + escapeHtml(value) + '</td><td>' + escapeHtml(unit) + '</td><td>' + escapeHtml(reference) + '</td><td>' + escapeHtml(flag) + '</td></tr>';
    }).filter(Boolean).join('');
    const cultureHtml = cultureRows.isolates.filter(isolate=>isolate.visit_test_id===item.id).map(isolate=>{const ast=cultureRows.susceptibilities.filter(row=>row.isolate_id===isolate.id);const astLines=ast.map(row=>'<tr><td>'+escapeHtml(row.antimicrobial_agent)+'</td><td>'+escapeHtml(row.test_method)+'</td><td>'+escapeHtml(row.measured_value??'—')+' '+escapeHtml(row.measured_unit??'')+'</td><td>'+escapeHtml(row.interpretation)+'</td><td>'+escapeHtml(row.breakpoint_standard)+' '+escapeHtml(row.breakpoint_edition)+'</td><td>'+escapeHtml(row.qc_status)+'</td></tr>').join('');return '<h3>العزلة '+isolate.isolate_number+': '+escapeHtml(isolate.organism_name)+'</h3><p>النمو: '+escapeHtml(isolate.growth_description||'—')+' · العد: '+escapeHtml(isolate.colony_count??'—')+' '+escapeHtml(isolate.colony_count_unit)+' · التعريف: '+escapeHtml(isolate.identification_method||'—')+'</p><table><thead><tr><th>المضاد الحيوي</th><th>الطريقة</th><th>القيمة</th><th>التفسير</th><th>معيار/إصدار القطع</th><th>ضبط الجودة</th></tr></thead><tbody>'+(astLines||'<tr><td colspan="6">لا توجد نتائج حساسية مسجلة</td></tr>')+'</tbody></table>'+(isolate.notes?'<p>'+escapeHtml(isolate.notes)+'</p>':'');}).join('');
    return { kind: item.technical_snapshot?.test_kind || 'individual', html: '<section class="test ' + ((item.technical_snapshot?.test_kind || item.tests_catalog?.test_kind) === 'panel' ? 'profile-report' : 'individual-test') + '"><h2>' + escapeHtml(item.test_name_snapshot || 'Test') + ' <small class="section-status">' + (item.status === 'completed' ? 'مكتمل' : 'غير مكتمل') + '</small></h2><table><thead><tr><th>Test / Parameter</th><th>Result</th><th>Unit</th><th>Reference Interval</th><th>Flag</th></tr></thead><tbody>' + (lines || '<tr><td colspan="5">No results recorded</td></tr>') + '</tbody></table>' + cultureHtml + '</section>' };
  });
  const individualHtml = testSections.filter(section => section.kind !== 'panel').map(section => section.html).join('');
  const profileHtml = testSections.filter(section => section.kind === 'panel').map(section => section.html).join('');
  const groupedTestSections = (individualHtml ? '<section class="report-group individual-report"><h2>INDIVIDUAL TESTS</h2>' + individualHtml + '</section>' : '') + profileHtml;
  const historicalSections=selectedHistoricalRows.map(row=>{
    const payload=row.result_data||{},parameters=payload.parameters&&typeof payload.parameters==='object'?Object.entries(payload.parameters):[];
    const resultLines=parameters.length?parameters.map(([name,value])=>'<tr><td>'+escapeHtml(name)+'</td><td>'+escapeHtml(value)+'</td><td>'+escapeHtml(payload.unit||'')+'</td><td>'+escapeHtml(payload.reference_range||'')+'</td></tr>').join(''):'<tr><td>'+escapeHtml(row.test_name_snapshot)+'</td><td>'+escapeHtml(payload.value??payload.raw_original??JSON.stringify(payload))+'</td><td>'+escapeHtml(payload.unit||'')+'</td><td>'+escapeHtml(payload.reference_range||'')+'</td></tr>';
    return '<section class="test historical-test"><h2>نتيجة تاريخية — '+escapeHtml(row.test_name_snapshot)+' · '+escapeHtml(row.result_date)+'</h2><table><thead><tr><th>الفحص / البارامتر</th><th>النتيجة القديمة</th><th>الوحدة وقتها</th><th>المدى المرجعي وقتها</th></tr></thead><tbody>'+resultLines+'</tbody></table><small>مصدر تاريخي: '+escapeHtml(row.source_file_name||'')+' · '+escapeHtml(row.source_sheet_name||'')+' · صف '+escapeHtml(row.source_row_number||'—')+'</small></section>';
  }).join('');
  const performedAt = 'تم إجراء التحاليل بفرع: ' + (branch.name || '—');
  const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(title) + '</title><style>' +
    '@page{size:' + paper + ' ' + orientation + ';margin:54mm ' + margin + 'mm 42mm ' + margin + 'mm}' +
    'body{position:relative;font-family:Tahoma,Arial,sans-serif;color:#1d2e3a;font-size:12px;line-height:1.65;background:#fff}body>*:not(.watermark-image):not(.watermark-text){position:relative;z-index:1}.watermark-image{position:fixed;top:28%;left:0;right:0;z-index:0;text-align:center;pointer-events:none;opacity:' + watermarkOpacity + ';transform:' + (print.watermarkPosition==='diagonal'?'rotate(-28deg)':'none') + '}.watermark-image img{width:' + (print.watermarkSize==='large'?'62%':print.watermarkSize==='small'?'28%':'42%') + ';max-height:48vh;object-fit:contain}.watermark-text{position:fixed;top:42%;left:8%;right:8%;z-index:0;text-align:center;font-size:' + (print.watermarkSize==='large'?'76px':print.watermarkSize==='small'?'38px':'56px') + ';font-weight:800;color:#173f58;opacity:' + watermarkOpacity + ';transform:' + (print.watermarkPosition==='diagonal'?'rotate(-28deg)':'none') + ';pointer-events:none}header.report-header{border-bottom:2px solid #168f9a;padding:0 0 8px;margin-bottom:14px;background:#fff}.header-grid{display:grid;grid-template-columns:1fr 120px 1fr;align-items:center;gap:10px}.identity-zone{display:grid;gap:3px;font-size:13px}.identity-zone strong{font-size:17px;color:#173f58}.identity-zone span{color:#435864}.header-right{text-align:right}.header-left{text-align:left}.logo-zone{text-align:center}.lab-logo{max-width:110px;max-height:72px;object-fit:contain}.logo-placeholder{font-weight:800;color:#173f58;font-size:12px}h1{font-size:19px;margin:10px 0 4px;text-align:center;color:#173f58}h2{font-size:15px;margin:12px 0 6px;color:#173f58}.report-title{text-align:center;font-weight:700;color:#16818b;font-size:13px}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin:10px 0 18px}.meta span{padding:6px 8px;background:#f3f7f8;border-radius:5px}.report-group{margin-top:8px}.profile-report{break-before:page}.test{break-inside:avoid;margin:0 0 10px}.individual-report>.test{break-inside:avoid}.historical-test{border:2px dashed #8a6d3b;padding:8px;margin-top:18px}.historical-test h2{color:#765a27}table{width:100%;border-collapse:collapse;margin-bottom:12px;direction:ltr}th,td{border:1px solid #cbd5dc;padding:6px;text-align:left}th{background:#eaf2f4;color:#173f58}td{background:#fff}.branch-performed{font-weight:700;color:#315c66;margin-top:7px;padding:5px 0;border-top:1px solid #dce5e8;font-size:11px}.report-footer{display:grid;grid-template-columns:1fr 120px 1fr;gap:10px;border-top:1px solid #168f9a;margin-top:20px;padding-top:10px;align-items:start;font-size:10px;line-height:1.35}.footer-right,.footer-left{display:grid;gap:4px}.footer-center{text-align:center}.footer-qr{display:grid;justify-items:center;gap:3px;color:#173f58;text-decoration:none}.footer-qr img{width:76px;height:76px;object-fit:contain}.footer-center-message{font-size:11px;font-weight:700}.signature{max-width:130px;max-height:65px;object-fit:contain}.preview-controls{display:flex;gap:8px;justify-content:center;padding:10px;margin-bottom:12px}.preview-controls button{border:0;border-radius:7px;padding:8px 14px;background:#173f58;color:#fff;font:inherit;cursor:pointer}.preview-controls button+button{background:#e7f1f2;color:#173f58}.report-pages{display:block}.report-extra-footer{grid-column:1/-1;text-align:center;border-top:1px solid #e1e8eb;padding-top:4px;margin-top:4px;font-size:9px}@media print{.preview-controls{display:none}header.report-header{position:fixed;top:-50mm;left:0;right:0;z-index:2;background:#fff}.report-footer{position:fixed;bottom:-38mm;left:0;right:0;z-index:2;background:#fff}.profile-report{break-before:page}.report-pages>.profile-report:first-child{break-before:auto}.report-footer{break-inside:avoid}}' +
    '</style></head><body>' + (watermarkImage ? '<div class="watermark-image"><img src="' + escapeHtml(watermarkImage) + '" alt=""></div>' : '') + (watermarkText ? '<div class="watermark-text">' + escapeHtml(watermarkText) + '</div>' : '') +
    '<div class="preview-controls">' + (canPrint ? '<button onclick="window.print()">طباعة التقرير</button>' : '<button disabled>اعتمد الزيارة أولًا للطباعة</button>') + '<button onclick="window.close()">إغلاق المعاينة</button></div>' +
    '<header class="report-header"><div class="header-grid"><div class="header-right">' + headerRight + '</div><div class="logo-zone">' + centerLogo + '</div><div class="header-left">' + headerLeft + '</div></div><h1>LABORATORY REPORT</h1><div class="report-title">' + escapeHtml(title) + '</div><div class="meta"><span>اسم المريض: ' + escapeHtml(patient.full_name || '—') + '</span><span>رقم الملف: ' + escapeHtml(patient.patient_number || '—') + '</span><span>رقم الزيارة: ' + escapeHtml(visit.visit_number || '—') + '</span><span>تاريخ الزيارة: ' + escapeHtml(visit.visit_work_date || '—') + '</span></div><div class="branch-performed">' + escapeHtml(performedAt) + '</div></header>' +
    '<main class="report-pages">' + groupedTestSections + historicalSections + '</main>' +
    (signature ? '<p style="text-align:left"><img class="signature" src="' + escapeHtml(signature) + '" alt="التوقيع"></p>' : '') +
    '<footer class="report-footer" style="grid-template-columns:' + footerGridColumns + '"><div class="footer-right">' + footerAddresses + '</div>' + footerCenterMarkup + '<div class="footer-left">' + footerContacts + '</div>' + (footer ? '<div class="report-extra-footer">' + escapeHtml(footer) + '</div>' : '') + '</footer>' + '</body></html>';
  win.document.open(); win.document.write(html); win.document.close();
  const printWhenReady = () => { try { win.focus(); if (autoPrint) win.print(); } catch (error) { showNotice('تم فتح التقرير؛ استخدم أمر الطباعة من المتصفح.', true); } };
  const images = [...win.document.images];
  if (!images.length) setTimeout(printWhenReady, 250);
  else Promise.all(images.map(image => image.decode?.().catch(() => null))).then(() => setTimeout(printWhenReady, 150));
}


function renderCultureResults(host,item,data) {
 const target=host.querySelector('[data-culture-isolates="'+CSS.escape(item.id)+'"]');
 if(!target)return;
 const isolates=data.isolates.filter(row=>row.visit_test_id===item.id);
 const isolateForm=host.querySelector('.culture-isolate-form[data-visit-test-id="'+CSS.escape(item.id)+'"]');
 if(isolateForm){const nextNumber=Math.max(0,...isolates.map(row=>Number(row.isolate_number)||0))+1;isolateForm.elements.isolateNumber.value=String(nextNumber);}
 const locked=item.status==='completed'||item.visits?.is_published;
 if(!isolates.length){target.innerHTML='<p class="muted">لم تُسجل عزلات حتى الآن.</p>';return;}
 target.innerHTML=isolates.map(isolate=>{
  const ast=data.susceptibilities.filter(row=>row.isolate_id===isolate.id);
  const astRows=ast.map(row=>'<div class="ast-row"><strong>'+escapeHtml(row.antimicrobial_agent)+'</strong><span>'+escapeHtml(row.test_method)+' · '+escapeHtml(row.measured_value??'—')+' '+escapeHtml(row.measured_unit??'')+' · '+escapeHtml(row.interpretation)+'</span><small>'+escapeHtml(row.breakpoint_standard)+' '+escapeHtml(row.breakpoint_edition)+' · QC: '+escapeHtml(row.qc_status)+'</small></div>').join('');
  return '<article class="culture-isolate" data-isolate-id="'+escapeHtml(isolate.id)+'"><div class="card-head"><strong>العزلة '+isolate.isolate_number+': '+escapeHtml(isolate.organism_name)+'</strong><span class="pill">'+escapeHtml(isolate.growth_description||'Growth')+'</span></div><p class="muted">العد: '+escapeHtml(isolate.colony_count??'—')+' '+escapeHtml(isolate.colony_count_unit)+' · طريقة التعريف: '+escapeHtml(isolate.identification_method||'—')+'</p>'+(isolate.notes?'<p>'+escapeHtml(isolate.notes)+'</p>':'')+'<div class="ast-list">'+(astRows||'<p class="muted">لم تُسجل نتائج حساسية لهذه العزلة.</p>')+'</div>'+(!locked?'<form class="culture-ast-form" data-isolate-id="'+escapeHtml(isolate.id)+'"><h4>إضافة / تحديث مضاد حيوي</h4><label>المضاد<input name="antimicrobialAgent" required maxlength="120"></label><label>الطريقة<select name="testMethod"><option value="disk_diffusion">Disk diffusion</option><option value="mic">MIC</option><option value="automated">Automated</option><option value="gradient_diffusion">Gradient diffusion</option><option value="other">Other</option></select></label><label>القيمة المقاسة<input name="measuredValue" type="number" min="0" step="any"></label><label>الوحدة<input name="measuredUnit" placeholder="mm / mg/L"></label><label>التفسير<select name="interpretation"><option value="S">S — Susceptible</option><option value="I">I — Intermediate / susceptible increased exposure</option><option value="R">R — Resistant</option><option value="SDD">SDD</option><option value="IE">IE</option><option value="NA">Not applicable</option><option value="not_interpreted">Not interpreted</option></select></label><label>المعيار<select name="breakpointStandard"><option value="CLSI">CLSI</option><option value="EUCAST">EUCAST</option><option value="other">Other validated standard</option></select></label><label>الإصدار<input name="breakpointEdition" placeholder="مثال: CLSI M100 Ed36 (2026) — أدخل الإصدار الصحيح للطريقة والكائن" required></label><label>جدول / ملاحظة المرجع<input name="breakpointTable"></label><label>رابط المرجع<input name="breakpointSourceUrl" type="url"></label><label>ضبط الجودة<select name="qcStatus"><option value="not_documented">Not documented</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label><label class="wide">ملاحظات<textarea name="notes" rows="1"></textarea></label><button class="button button-secondary" type="submit">حفظ نتيجة الحساسية</button></form>':'')+'</article>';
 }).join('');
}
function bindCultureForms(host) {
 host.querySelectorAll('.culture-isolate-form').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault();const fd=new FormData(form);const button=form.querySelector('button[type="submit"]');
  try{setBusy(button,true,'جارٍ حفظ العزلة…');await saveCultureIsolate({tenantId:state.tenant.id,branchId:state.branch.id,visitTestId:form.dataset.visitTestId,isolateNumber:fd.get('isolateNumber'),organismName:fd.get('organismName'),growthDescription:fd.get('growthDescription'),colonyCount:fd.get('colonyCount'),colonyCountUnit:fd.get('colonyCountUnit'),identificationMethod:fd.get('identificationMethod'),notes:fd.get('notes'),staffId:$('staffSelect').value,userId:state.userId});showNotice('تم حفظ العزلة.');await refreshWork();}catch(error){showNotice(error.message||'تعذر حفظ العزلة.',true);}finally{setBusy(button,false);}
 }));
 host.querySelectorAll('.culture-ast-form').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault();const fd=new FormData(form);const button=form.querySelector('button[type="submit"]');
  try{setBusy(button,true,'جارٍ حفظ الحساسية…');await saveCultureSusceptibility({tenantId:state.tenant.id,branchId:state.branch.id,isolateId:form.dataset.isolateId,antimicrobialAgent:fd.get('antimicrobialAgent'),testMethod:fd.get('testMethod'),measuredValue:fd.get('measuredValue'),measuredUnit:fd.get('measuredUnit'),interpretation:fd.get('interpretation'),breakpointStandard:fd.get('breakpointStandard'),breakpointEdition:fd.get('breakpointEdition'),breakpointTable:fd.get('breakpointTable'),breakpointSourceUrl:fd.get('breakpointSourceUrl'),qcStatus:fd.get('qcStatus'),notes:fd.get('notes'),staffId:$('staffSelect').value,userId:state.userId});showNotice('تم حفظ نتيجة الحساسية وربطها بالعزلة.');await refreshWork();}catch(error){showNotice(error.message||'تعذر حفظ نتيجة الحساسية.',true);}finally{setBusy(button,false);}
 }));
}


function computeReferenceFlag(value,rangesInput,ageValue,sexValue,status,valueType='numeric') {
 if(valueType!=='numeric'||status!=='verified_local')return null;
 const numericValue=Number(value);if(!Number.isFinite(numericValue))return null;
 const ranges=Array.isArray(rangesInput)?rangesInput:(rangesInput&&typeof rangesInput==='object'?[rangesInput]:[]);
 const age=ageValue==null||ageValue===''?NaN:Number(ageValue),sex=String(sexValue||'').toLowerCase();
 const matches=ranges.filter(range=>{
  if(range.pregnancy)return false;
  if(range.sex&&String(range.sex).toLowerCase()!==sex)return false;
  if(range.age){if(!Number.isFinite(age))return false;if(range.age.min!=null&&age<Number(range.age.min))return false;if(range.age.max!=null&&age>Number(range.age.max))return false;}
  return true;
 });
 if(matches.length!==1)return null;
 const range=matches[0],low=range.lower??range.low??range.min,high=range.upper??range.high??range.max;
 if(low==null&&high==null)return null;
 if(low!=null&&numericValue<Number(low))return 'low';
 if(high!=null&&numericValue>Number(high))return 'high';
 return 'normal';
}
function classifyResultFlag(input) {
 let ranges=[];try{ranges=JSON.parse(input.dataset.range||'[]');}catch{}
 return computeReferenceFlag(input.value,ranges,input.dataset.patientAge,input.dataset.patientSex,input.dataset.referenceIntervalStatus,input.dataset.valueType);
}

async function saveTest(button) {
  try {
    setBusy(button, true, 'جارٍ الحفظ…');
    const section = button.closest('[data-test-id]');
    const testId = button.dataset.testId;
    const inputs = [...section.querySelectorAll('[data-param-code]')];
    const results = inputs.filter(input => input.dataset.resultSource !== 'calculated' && input.value.trim()).map(input => ({
      parameter: { code: input.dataset.paramCode, name: input.dataset.paramName, unit: input.dataset.unit,
        valueType: input.dataset.valueType, referenceRange: JSON.parse(input.dataset.range || '{}'),
        choices: JSON.parse(input.dataset.choices || '[]') },
      value: input.value, flag: classifyResultFlag(input),
    }));
    if (!results.length) throw new Error('أدخل نتيجة واحدة على الأقل قبل الحفظ.');
    const savedRows = await saveDraftResults({ tenantId: state.tenant.id, branchId: state.branch.id,
      visitTestId: testId, results, staffId: $('staffSelect').value });
    for (const row of savedRows) { const input=section.querySelector(`[data-param-code="${CSS.escape(row.parameter_code)}"]`); if(input){input.value=row.value_numeric??row.value_text??'';input.dataset.resultId=row.id;input.dataset.originalValue=input.value;} }
    const affectedVisit=state.work.find(row=>row.id===testId)?.visit_id;if(affectedVisit)state.previewedVisits.delete(affectedVisit);
    showNotice('تم حفظ النتائج اليدوية وحساب البارامترات المشتقة تلقائيًا على السحابة.');
  } catch (error) { showNotice(error.message || 'تعذر حفظ النتائج.', true); }
  finally { setBusy(button, false); }
}
async function correctTest(button) {
  const section=button.closest('[data-test-id]');
  const isPublished=section?.dataset.published==='true';
  if(!section)return;
  if(button.dataset.correctionMode!=='true'){
    button.dataset.correctionMode='true';button.textContent='حفظ التصحيح';
    section.querySelectorAll('[data-param-code]').forEach(input=>{if(input.dataset.resultSource!=='calculated')input.disabled=false;});
    showNotice('وضع التصحيح مفعل. غيّر نتيجة واحدة فقط ثم اضغط حفظ التصحيح.');
    return;
  }
  try {
    const changed=[...section.querySelectorAll('[data-param-code]')].filter(input=>input.dataset.resultId&&input.value.trim()!==''&&input.value.trim()!==(input.dataset.originalValue??'').trim());
    if(!changed.length)throw new Error('لا توجد نتيجة محفوظة تغيرت قيمتها للتصحيح.');
    if(changed.length>1)throw new Error('صحح نتيجة واحدة في كل مرة لتجنب حفظ بعض التصحيحات دون غيرها.');
    const visitId=state.work.find(row=>row.id===section.dataset.testId)?.visit_id;
    if(!visitId)throw new Error('تعذر تحديد الزيارة المرتبطة بالنتيجة.');
    const reason=window.prompt(isPublished?'سبب تصحيح النتيجة المنشورة:':'سبب تصحيح النتيجة المحفوظة:')?.trim()??'';
    if(!reason)throw new Error('سبب التصحيح إلزامي.');
    setBusy(button,true,'جارٍ حفظ التصحيح…');
    for(const input of changed){
      const raw=input.value.trim(),numeric=input.dataset.valueType==='numeric'?raw:null,text=input.dataset.valueType==='numeric'?null:raw;
      await correctVisitResultWithFlag({tenantId:state.tenant.id,branchId:state.branch.id,visitTestId:section.dataset.testId,resultId:input.dataset.resultId,valueNumeric:numeric,valueText:text,flag:classifyResultFlag(input),reason,staffId:$('staffSelect').value});
      input.dataset.originalValue=input.value;
    }
    state.previewedVisits.delete(visitId);
    section.querySelectorAll('[data-param-code]').forEach(input=>{if(input.dataset.resultSource!=='calculated')input.disabled=true;});
    button.dataset.correctionMode='false';button.textContent=isPublished?'تصحيح نتيجة منشورة':'تصحيح نتيجة محفوظة';button.dataset.oldLabel=button.textContent;
    showNotice(isPublished?'تم تسجيل التصحيح. النسخة المنشورة السابقة محفوظة؛ راجع المعاينة ثم ارفع نسخة مصححة.':'تم تصحيح النتيجة قبل اعتماد الزيارة، وحُفظ سبب التصحيح وسجل التعديل.');
  } catch(error){showNotice(error.message||'تعذر تصحيح النتيجة.',true);}
  finally{setBusy(button,false);}
}

async function loadAttachments(visitId) {
  const host=document.querySelector(`[data-attachment-list="${CSS.escape(visitId)}"]`);
  if(!host) return;
  host.textContent='جارٍ تحميل المرفقات…';
  try {
    const files=await listVisitAttachments({tenantId:state.tenant.id,branchId:state.branch.id,visitId});
    host.innerHTML=files.length?files.map(file=>`<div class="attachment-item"><span>${escapeHtml(file.mime_type)} · ${Math.ceil(file.size_bytes/1024)} KB · ${escapeHtml(new Date(file.created_at).toLocaleString('ar-EG'))}</span><button class="button button-secondary attachment-download" data-file-id="${escapeHtml(file.id)}">فتح</button></div>`).join(''):'<p class="muted">لا توجد مرفقات لهذه الزيارة.</p>';
    host.querySelectorAll('.attachment-download').forEach(btn=>btn.addEventListener('click',()=>downloadAttachment(btn)));
  } catch(error) { host.textContent=error.message||'تعذر تحميل المرفقات.'; }
}
async function uploadAttachment(button) {
  try {
    const visitId=button.dataset.visitId;
    const input=document.querySelector(`[data-attachment-file="${CSS.escape(visitId)}"]`);
    const file=input?.files?.[0];
    if(!file) throw new Error('اختر الملف المراد إرفاقه أولًا.');
    setBusy(button,true,'جارٍ رفع المرفق…');
    await uploadVisitAttachment({tenantId:state.tenant.id,branchId:state.branch.id,visitId,file});
    input.value='';
    showNotice('تم رفع المرفق وربطه بالزيارة.');
    await loadAttachments(visitId);
  } catch(error) { showNotice(error.message||'تعذر رفع المرفق.',true); }
  finally { setBusy(button,false); }
}
async function downloadAttachment(button) {
  try {
    setBusy(button,true,'جارٍ تجهيز الرابط…');
    const url=await createAttachmentDownloadUrl({tenantId:state.tenant.id,branchId:state.branch.id,fileId:button.dataset.fileId,expiresIn:90});
    window.open(url,'_blank','noopener');
  } catch(error) { showNotice(error.message||'تعذر فتح المرفق.',true); }
  finally { setBusy(button,false); }
}

async function completeTest(button) {
  try { const visitId=state.work.find(row=>row.id===button.dataset.testId)?.visit_id;if(window.taibaGetDirtyResultInputs?.().length)throw new Error('احفظ النتائج التي أدخلتها أولًا قبل إنهاء التحليل.'); setBusy(button, true, 'جارٍ الإنهاء…'); await completeVisitTest({ tenantId: state.tenant.id, branchId: state.branch.id, visitTestId: button.dataset.testId, staffId: $('staffSelect').value }); showNotice('تم إنهاء التحليل بعد التحقق من النتائج المطلوبة.'); await refreshWork(); }
  catch (error) { showNotice(error.message || 'تعذر إنهاء التحليل.', true); } finally { setBusy(button, false); }
}
async function approve(button) {
  try { if(window.taibaGetDirtyResultInputs?.().length)throw new Error('احفظ كل النتائج التي أدخلتها قبل اعتماد الزيارة.'); setBusy(button, true, 'جارٍ الاعتماد…'); await approveVisit({ tenantId: state.tenant.id, branchId: state.branch.id, visitId: button.dataset.visitId, staffId: $('staffSelect').value }); showNotice('تم اعتماد الزيارة. يمكنك الآن رفع ملف PDF.'); await refreshWork(); }
  catch (error) { showNotice(error.message || 'تعذر اعتماد الزيارة.', true); } finally { setBusy(button, false); }
}
async function publish(button) {
  try {
    if(window.taibaGetDirtyResultInputs?.().length)throw new Error('احفظ النتائج التي أدخلتها قبل نشر التقرير.');
    const visitId = button.dataset.visitId;
    const visitState = state.work.find(item=>item.visit_id===visitId)?.visits;
    if (!visitState || (visitState.status!=='approved' && !visitState.is_published)) throw new Error('اعتمد الزيارة بالكامل قبل نشر التقرير.');
    if (!state.previewedVisits.has(visitId)) throw new Error('افتح معاينة نتائج الزيارة وراجع التقرير قبل النشر.');
    const fileInput = document.querySelector(`[data-report-file="${CSS.escape(visitId)}"]`);
    const file = fileInput?.files?.[0];
    if (!file) throw new Error('اختر ملف التقرير PDF أولًا.');
    const isCorrection = state.work.some(item => item.visit_id === visitId && item.visits?.is_published);
    let reason = '';
    if (isCorrection) { reason = window.prompt('اكتب سبب إصدار النسخة المصححة:')?.trim() ?? ''; if (!reason) throw new Error('يجب إدخال سبب التصحيح.'); }
    setBusy(button, true, 'جارٍ النشر…');
    await publishReportVersion({ tenantId: state.tenant.id, branchId: state.branch.id, visitId,
      staffId: $('staffSelect').value, file, changeReason: reason });
    state.previewedVisits.delete(visitId); showNotice('تم إرسال التقرير لمسار النشر.'); await refreshWork();
  } catch (error) { showNotice(error.message || 'تعذر نشر التقرير.', true); }
  finally { setBusy(button, false); }
}

async function searchHistorical(){
 const term=$('historicalSearch').value.trim(),host=$('historicalResultsList');
 if(term.length<2){host.textContent='اكتب حرفين على الأقل من اسم المريض.';return;}
 host.textContent='جارٍ البحث في النتائج التاريخية…';
 try{
  const rows=await listHistoricalResults({tenantId:state.tenant.id,branchId:state.branch.id,search:term,limit:200});
  host.replaceChildren();
  if(!rows.length){host.textContent='لا توجد نتائج تاريخية مطابقة في هذا الفرع.';return;}
  for(const row of rows){
   const card=document.createElement('article');card.className='historical-result-card';
   const heading=document.createElement('strong');heading.textContent=row.patient_name_snapshot+' · '+row.test_name_snapshot;card.append(heading);
   const meta=document.createElement('small');meta.textContent='نتيجة تاريخية · '+row.result_date+(row.patient_age_raw?' · العمر وقت النتيجة: '+row.patient_age_raw+' '+(row.patient_age_unit||''):'');card.append(meta);
   const data=document.createElement('pre');data.textContent=JSON.stringify(row.result_data,null,2);card.append(data);
   const source=document.createElement('small');source.textContent='المصدر: '+(row.source_file_name||'سجل قديم')+' · '+(row.source_sheet_name||'')+' · صف '+(row.source_row_number||'—');card.append(source);
   host.append(card);
  }
 }catch(error){host.textContent=error.message||'تعذر تحميل النتائج التاريخية.';}
}
$('showHistoricalToggle').addEventListener('change',()=>{$('historicalLookupPanel').hidden=!$('showHistoricalToggle').checked;if(!$('showHistoricalToggle').checked)$('historicalResultsList').replaceChildren();});
$('searchHistoricalResults').addEventListener('click',()=>searchHistorical());
$('historicalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchHistorical();}});
$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]');
  try { setBusy(button, true, 'جارٍ الدخول…'); await signInWithEmail($('email').value, $('password').value); await startWorkspace(); }
  catch (error) { showNotice(error.message || 'تعذر تسجيل الدخول.', true); }
  finally { setBusy(button, false); }
});
$('signOut').addEventListener('click', async () => { try { await signOut(); await startWorkspace(); } catch (error) { showNotice(error.message, true); } });
$('refreshButton').addEventListener('click', async () => { try { await refreshWork(); } catch (error) { showNotice(error.message, true); } });

try { await startWorkspace(); window.dispatchEvent(new CustomEvent('taiba:results-context',{detail:{tenantId:state.tenant?.id,branchId:state.branch?.id,tenantSlug:state.tenant?.slug}})); } catch (error) { showNotice(error.message || 'تعذر تهيئة شاشة التشغيل.', true); }
window.taibaPreviewVisitReport = async visitId => { const dirty=window.taibaGetDirtyResultInputs?.()||[];if(dirty.length){showNotice('هناك نتائج تم تغييرها ولم تُحفظ بعد. احفظها أولًا ثم أعد المعاينة.',true);return;} const win=window.open('','_blank'); if(!win){showNotice('اسمح بفتح نافذة المعاينة من إعدادات المتصفح.',true);return;} try{await printVisitReport(visitId,win,{autoPrint:false});state.previewedVisits.add(visitId);window.dispatchEvent(new CustomEvent('taiba:visit-report-previewed',{detail:{visitId}}));showNotice('تم تجهيز معاينة التقرير. راجعها قبل الطباعة أو النشر.');}catch(error){win.close();showNotice(error.message||'تعذر تجهيز المعاينة.',true);} };

$('prevWorkPage').addEventListener('click', async () => {
  if (state.workPage <= 0) return;
  state.workPage -= 1;
  try { await refreshWork(); } catch (error) { showNotice(error.message || 'تعذر تحميل الصفحة السابقة.', true); }
});
$('nextWorkPage').addEventListener('click', async () => {
  if ((state.workPage + 1) * state.workPageSize >= state.workCount) return;
  state.workPage += 1;
  try { await refreshWork(); } catch (error) { showNotice(error.message || 'تعذر تحميل الصفحة التالية.', true); }
});
