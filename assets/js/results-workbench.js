import { getSupabaseClient } from '../../core/supabase-client.js';
import { signInWithEmail, getCurrentSession, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { listBranchWorkPage, listVisitWorkForReport } from '../../modules/laboratory/repository.js';
import { listResultsForVisitTests, saveDraftResults, completeVisitTest, approveVisit } from '../../modules/results/repository.js';
import { publishReportVersion, correctPublishedResult } from '../../modules/reports/repository.js';
import { getLabAssetPublicUrl } from '../../modules/settings/assets-repository.js';
import { listVisitAttachments, uploadVisitAttachment, createAttachmentDownloadUrl } from '../../modules/files/repository.js';
import { listHistoricalResults } from '../../modules/migration/historical-results-repository.js';
import { listCultureResults, saveCultureIsolate, saveCultureSusceptibility } from '../../modules/results/culture-repository.js';

const $ = (id) => document.getElementById(id);
const state = { context: null, userId: null, tenant: null, branch: null, staff: [], work: [], workPage: 0, workPageSize: 25, workCount: 0, historicalSelections: new Map() };
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
  await refreshWork();
}

async function refreshWork() {
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
      const locked = item.status === 'completed';
      const params = item.technical_snapshot?.parameters ?? [];
      const groupedParams = new Map();
      for (const p of params) { const sectionName = p.clinical_metadata?.section || 'النتائج'; if (!groupedParams.has(sectionName)) groupedParams.set(sectionName, []); groupedParams.get(sectionName).push(p); }
      const parameterControls = [...groupedParams.entries()].map(([sectionName, groupParams]) => `<fieldset class="parameter-group"><legend>${escapeHtml(sectionName)}</legend>${groupParams.map(p => {
        const type = p.value_type ?? 'numeric';
        const code = escapeHtml(p.code);
        const name = escapeHtml(p.name ?? p.parameter_name ?? p.code);
        const metadata = `data-param-code="${code}" data-param-name="${name}" data-unit="${escapeHtml(p.unit ?? '')}" data-value-type="${escapeHtml(type)}" data-range='${escapeHtml(JSON.stringify(p.reference_ranges ?? {}))}' data-choices='${escapeHtml(JSON.stringify(p.choices ?? []))}'`;
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
          control = `<input type="text" ${metadata} placeholder="أدخل النتيجة" />`;
        }
        const rangeText = resolveReferenceRange(p.reference_ranges, item.visits?.patients || {}, p.reference_interval_status);
        return `<label>${name}${p.is_required === false ? ' (اختياري)' : ''}<small>${escapeHtml(p.unit ?? '')} ${escapeHtml(rangeText)}</small>${control}</label>`;
      }).join('')}</fieldset>`).join('');
      const isCulture = ['CULTURE_URINE','CULTURE_STOOL'].includes(item.test_code_snapshot);
      const cultureEditor = isCulture ? `<section class="culture-workflow" data-culture-workflow="${escapeHtml(item.id)}"><h3>العزلات والاختبار الحساسي (Antibiogram)</h3><p class="muted">أضف كل عزلة منفصلة. أدخل تفسير الحساسية وفق إصدار CLSI/EUCAST والطريقة المعتمدة في المعمل؛ النظام لا يخمّن نقاط القطع.</p><div class="culture-isolates" data-culture-isolates="${escapeHtml(item.id)}"><p class="muted">جارٍ تحميل العزلات…</p></div>${!locked && !isPublished ? `<form class="culture-isolate-form" data-visit-test-id="${escapeHtml(item.id)}"><label>رقم العزلة<input name="isolateNumber" type="number" min="1" max="20" value="1" required></label><label>اسم الكائن الممرض / العزلة<input name="organismName" maxlength="200" required placeholder="مثال: Escherichia coli"></label><label>وصف النمو<input name="growthDescription" placeholder="Pure growth / mixed growth"></label><label>عدد المستعمرات<input name="colonyCount" type="number" min="0" step="any"></label><label>وحدة العد<input name="colonyCountUnit" value="CFU/mL"></label><label>طريقة التعريف<input name="identificationMethod" placeholder="Biochemical / MALDI-TOF / Automated"></label><label class="wide">ملاحظات<textarea name="notes" rows="2"></textarea></label><button class="button" type="submit">حفظ العزلة</button></form>` : ''}</section>` : '';
      return `<section class="parameter" data-test-id="${escapeHtml(item.id)}">
        <div class="card-head"><strong>${escapeHtml(item.test_name_snapshot)}</strong><span class="pill">${escapeHtml(item.status)}</span></div>
        <div class="parameter-grid">${parameterControls}</div>${cultureEditor}
        <div class="actions">${isPublished ? '<button class="button button-secondary correct-test" data-test-id="' + escapeHtml(item.id) + '">حفظ تصحيح النتيجة</button>' : locked ? '<span class="pill">التحليل مكتمل — النتائج للعرض فقط</span>' : '<button class="button button-secondary save-test" data-test-id="' + escapeHtml(item.id) + '">حفظ النتائج</button><button class="button button-secondary complete-test" data-test-id="' + escapeHtml(item.id) + '">إنهاء التحليل</button>'}</div>
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
  host.querySelectorAll('.save-test').forEach(btn => btn.addEventListener('click', () => saveTest(btn)));
  host.querySelectorAll('.complete-test').forEach(btn => btn.addEventListener('click', () => completeTest(btn)));
  host.querySelectorAll('.correct-test').forEach(btn => btn.addEventListener('click', () => correctTest(btn)));
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
  const cultureWork = state.work.filter(item => ['CULTURE_URINE','CULTURE_STOOL'].includes(item.test_code_snapshot));
  if (cultureWork.length) {
    const cultureRows = await listCultureResults({tenantId:state.tenant.id,branchId:state.branch.id,visitTestIds:cultureWork.map(item=>item.id)});
    for (const item of cultureWork) renderCultureResults(host,item,cultureRows);
    bindCultureForms(host);
  }
  host.querySelectorAll('.select-historical-report').forEach(btn => btn.addEventListener('click', () => loadHistoricalReportPicker(btn)));
  host.querySelectorAll('.print-visit-report').forEach(btn => btn.addEventListener('click', () => {
    const win = window.open('', '_blank');
    if (!win) { showNotice('اسمح بفتح نافذة التقرير من إعدادات المتصفح ثم أعد المحاولة.', true); return; }
    printVisitReport(btn.dataset.visitId, win).catch(error => { win.close(); showNotice(error.message || 'تعذر تجهيز التقرير.', true); });
  }));
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


function resolveReferenceRange(value, patient = {}, status = 'local_verification_required') {
  const localPending = status === 'local_verification_required';
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
async function printVisitReport(visitId, win) {
  const visitItems = await listVisitWorkForReport({ tenantId: state.tenant.id, branchId: state.branch.id, visitId });
  if (!visitItems.length) throw new Error('تعذر العثور على تحاليل الزيارة في هذا الفرع.');
  const visit = visitItems[0].visits || {};
  if (visit.status !== 'approved' && !visit.is_published) throw new Error('اعتمد الزيارة أولًا قبل طباعة التقرير.');
  const patient = visit.patients || {};
  const rows = await listResultsForVisitTests({ tenantId: state.tenant.id, visitTestIds: visitItems.map(item => item.id) });
  const cultureRows = await listCultureResults({tenantId:state.tenant.id,branchId:state.branch.id,visitTestIds:visitItems.filter(item=>['CULTURE_URINE','CULTURE_STOOL'].includes(item.test_code_snapshot)).map(item=>item.id)});
  if (!rows.length && !cultureRows.isolates.length) throw new Error('لا توجد نتائج محفوظة لهذه الزيارة حتى الآن.');
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
  const logoPath = print.showLogo === false ? '' : (print.logoPath || lab.logo_path || '');
  const signaturePath = print.showSignature ? print.signaturePath || '' : '';
  const logo = logoPath ? getLabAssetPublicUrl(logoPath) : '';
  const signature = signaturePath ? getLabAssetPublicUrl(signaturePath) : '';
  const labName = lab.laboratory_name || state.tenant?.name || 'Taiba Smart Lab';
  const doctor = print.showDoctor === false ? '' : (lab.doctor_name || '');
  const branchName = print.showBranch === false ? '' : (branch.name || '');
  const phone = print.showPhone === false ? '' : (branch.phone || lab.phone || lab.whatsapp || '');
  const address = print.showAddress === false ? '' : (branch.address || lab.address || '');
  const footer = print.footerText || lab.report_footer || '';
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
      const flag = result.flag ? ' · ' + result.flag : '';
      return '<tr><td>' + escapeHtml(parameterName) + '</td><td>' + escapeHtml(value) + '</td><td>' + escapeHtml(unit) + '</td><td>' + escapeHtml(reference) + '</td><td>' + escapeHtml(flag) + '</td></tr>';
    }).filter(Boolean).join('');
    const cultureHtml = cultureRows.isolates.filter(isolate=>isolate.visit_test_id===item.id).map(isolate=>{const ast=cultureRows.susceptibilities.filter(row=>row.isolate_id===isolate.id);const astLines=ast.map(row=>'<tr><td>'+escapeHtml(row.antimicrobial_agent)+'</td><td>'+escapeHtml(row.test_method)+'</td><td>'+escapeHtml(row.measured_value??'—')+' '+escapeHtml(row.measured_unit??'')+'</td><td>'+escapeHtml(row.interpretation)+'</td><td>'+escapeHtml(row.breakpoint_standard)+' '+escapeHtml(row.breakpoint_edition)+'</td><td>'+escapeHtml(row.qc_status)+'</td></tr>').join('');return '<h3>العزلة '+isolate.isolate_number+': '+escapeHtml(isolate.organism_name)+'</h3><p>النمو: '+escapeHtml(isolate.growth_description||'—')+' · العد: '+escapeHtml(isolate.colony_count??'—')+' '+escapeHtml(isolate.colony_count_unit)+' · التعريف: '+escapeHtml(isolate.identification_method||'—')+'</p><table><thead><tr><th>المضاد الحيوي</th><th>الطريقة</th><th>القيمة</th><th>التفسير</th><th>معيار/إصدار القطع</th><th>ضبط الجودة</th></tr></thead><tbody>'+(astLines||'<tr><td colspan="6">لا توجد نتائج حساسية مسجلة</td></tr>')+'</tbody></table>'+(isolate.notes?'<p>'+escapeHtml(isolate.notes)+'</p>':'');}).join('');
    return '<section class="test"><h2>' + escapeHtml(item.test_name_snapshot || 'تحليل') + '</h2><table><thead><tr><th>الفحص</th><th>النتيجة</th><th>الوحدة</th><th>القيمة المرجعية</th><th>ملاحظة</th></tr></thead><tbody>' + (lines || '<tr><td colspan="5">لا توجد نتائج لهذا التحليل</td></tr>') + '</tbody></table>' + cultureHtml + '</section>';
  }).join('');
  const historicalSections=selectedHistoricalRows.map(row=>{
    const payload=row.result_data||{},parameters=payload.parameters&&typeof payload.parameters==='object'?Object.entries(payload.parameters):[];
    const resultLines=parameters.length?parameters.map(([name,value])=>'<tr><td>'+escapeHtml(name)+'</td><td>'+escapeHtml(value)+'</td><td>'+escapeHtml(payload.unit||'')+'</td><td>'+escapeHtml(payload.reference_range||'')+'</td></tr>').join(''):'<tr><td>'+escapeHtml(row.test_name_snapshot)+'</td><td>'+escapeHtml(payload.value??payload.raw_original??JSON.stringify(payload))+'</td><td>'+escapeHtml(payload.unit||'')+'</td><td>'+escapeHtml(payload.reference_range||'')+'</td></tr>';
    return '<section class="test historical-test"><h2>نتيجة تاريخية — '+escapeHtml(row.test_name_snapshot)+' · '+escapeHtml(row.result_date)+'</h2><table><thead><tr><th>الفحص / البارامتر</th><th>النتيجة القديمة</th><th>الوحدة وقتها</th><th>المدى المرجعي وقتها</th></tr></thead><tbody>'+resultLines+'</tbody></table><small>مصدر تاريخي: '+escapeHtml(row.source_file_name||'')+' · '+escapeHtml(row.source_sheet_name||'')+' · صف '+escapeHtml(row.source_row_number||'—')+'</small></section>';
  }).join('');
  const contact = [branchName ? 'الفرع: ' + branchName : '', phone, address].filter(Boolean).join(' · ');
  const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(title) + '</title><style>' +
    '@page{size:' + paper + ' ' + orientation + ';margin:' + margin + 'mm}' +
    'body{font-family:Arial,Tahoma,sans-serif;color:#182b36;font-size:12px;line-height:1.6}header{text-align:center;border-bottom:2px solid #244b5d;padding-bottom:12px;margin-bottom:16px}header img{max-width:140px;max-height:70px;object-fit:contain}h1{font-size:20px;margin:6px 0}h2{font-size:15px;margin:14px 0 6px}.meta{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 18px}.meta span{padding:5px 8px;background:#f1f5f7;border-radius:5px}table{width:100%;border-collapse:collapse;margin-bottom:12px}th,td{border:1px solid #cbd5dc;padding:6px;text-align:right}th{background:#edf2f5}.test{break-inside:avoid}.historical-test{border:2px dashed #8a6d3b;padding:8px;margin-top:18px}.historical-test h2{color:#765a27}footer{border-top:1px solid #cbd5dc;margin-top:24px;padding-top:10px;text-align:center}.signature{max-width:140px;max-height:70px;object-fit:contain}@media print{button{display:none}}' +
    '</style></head><body><header>' + (logo ? '<img src="' + escapeHtml(logo) + '" alt="شعار المعمل">' : '') +
    '<h1>' + escapeHtml(labName) + '</h1><strong>' + escapeHtml(title) + '</strong>' +
    (doctor ? '<p>' + escapeHtml(doctor) + '</p>' : '') + (contact ? '<p>' + escapeHtml(contact) + '</p>' : '') +
    '</header><div class="meta"><span>المريض: ' + escapeHtml(patient.full_name || '—') + '</span><span>رقم الملف: ' + escapeHtml(patient.patient_number || '—') + '</span><span>رقم الزيارة: ' + escapeHtml(visit.visit_number || '—') + '</span><span>التاريخ: ' + escapeHtml(visit.visit_work_date || '—') + '</span></div>' +
    testSections + historicalSections + (signature ? '<p style="text-align:left"><img class="signature" src="' + escapeHtml(signature) + '" alt="التوقيع"></p>' : '') +
    (footer ? '<footer>' + escapeHtml(footer) + '</footer>' : '') + '</body></html>';
  win.document.open(); win.document.write(html); win.document.close();
  const printWhenReady = () => { try { win.focus(); win.print(); } catch (error) { showNotice('تم فتح التقرير؛ استخدم أمر الطباعة من المتصفح.', true); } };
  const images = [...win.document.images];
  if (!images.length) setTimeout(printWhenReady, 250);
  else Promise.all(images.map(image => image.decode?.().catch(() => null))).then(() => setTimeout(printWhenReady, 150));
}


function renderCultureResults(host,item,data) {
 const target=host.querySelector('[data-culture-isolates="'+CSS.escape(item.id)+'"]');
 if(!target)return;
 const isolates=data.isolates.filter(row=>row.visit_test_id===item.id);
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
      value: input.value,
    }));
    if (!results.length) throw new Error('أدخل نتيجة واحدة على الأقل قبل الحفظ.');
    const savedRows = await saveDraftResults({ tenantId: state.tenant.id, branchId: state.branch.id,
      visitTestId: testId, results, staffId: $('staffSelect').value });
    for (const row of savedRows) { const input=section.querySelector(`[data-param-code="${CSS.escape(row.parameter_code)}"]`); if(input){input.value=row.value_numeric??row.value_text??'';input.dataset.resultId=row.id;input.dataset.originalValue=input.value;} }
    showNotice('تم حفظ النتائج اليدوية وحساب البارامترات المشتقة تلقائيًا على السحابة.');
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

try { await startWorkspace(); } catch (error) { showNotice(error.message || 'تعذر تهيئة شاشة التشغيل.', true); }

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
