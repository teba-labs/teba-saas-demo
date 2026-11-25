import { getSupabaseClient } from '../../core/supabase-client.js';
import { signInWithEmail, getCurrentSession, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { listBranchWorkPage, listVisitWorkForReport } from '../../modules/laboratory/repository.js';
import { listResultsForVisitTests, listVisitParameterRangeOverrides, saveVisitParameterRangeOverride, saveDraftResults, completeVisitTestAtomic, approveVisitWithAutoCompletion } from '../../modules/results/repository.js';
import { listPendingDraftResults } from '../../offline/outbox.js';
import { offlineDb } from '../../offline/database.js';
import { startBackgroundSync } from '../../offline/background-sync.js';
import { cacheRows, getCachedRows } from '../../offline/cache.js';
import { publishReportVersion, correctVisitResultWithFlag, recordLocalWorkCopyDelivery } from '../../modules/reports/repository.js';
import { getLabAssetPublicUrl } from '../../modules/settings/assets-repository.js';
import { listVisitAttachments, uploadVisitAttachment, createAttachmentDownloadUrl } from '../../modules/files/repository.js';
import { listHistoricalResults } from '../../modules/migration/historical-results-repository.js';
import { listCultureResults, saveCultureIsolate, saveCultureSusceptibility } from '../../modules/results/culture-repository.js';

const $ = (id) => document.getElementById(id);
const state = { context: null, userId: null, tenant: null, branch: null, staff: [], work: [], workPage: 0, workPageSize: 100, workCount: 0, historicalSelections: new Map(), previewedVisits: new Set(), partialPublishedVisits: new Set(), portalEnabled: false, reportPreviewHtml: new Map(), deliveryStatus: new Map(), stopBackgroundSync: null };
window.taibaGetResultsContext=()=>({tenantId:state.tenant?.id,branchId:state.branch?.id,tenantSlug:state.tenant?.slug});
window.taibaGetDirtyResultInputs=()=>[...document.querySelectorAll('[data-param-code]')].filter(input=>input.dataset.resultSource!=='calculated'&&input.value.trim()!==(input.dataset.originalValue??'').trim());
window.addEventListener('taiba:results-work-refresh',()=>refreshWork().catch(error=>showNotice(error.message||'تعذر تحديث قائمة النتائج.',true)));
const showNotice = (message, error = false) => {
  const el = $('notice'); el.textContent = message; el.className = `notice show${error ? ' error' : ''}`;
  window.clearTimeout(showNotice.timer); showNotice.timer = window.setTimeout(() => el.className = 'notice', 5000);
};
const setBusy = (button, busy, label) => { button.disabled = busy; if (busy) { button.dataset.oldLabel = button.textContent; button.textContent = label || 'جارٍ التنفيذ…'; } else if (button.dataset.oldLabel) { button.textContent = button.dataset.oldLabel; delete button.dataset.oldLabel; } };
const requireCloudConnection = operation => { if (globalThis.navigator?.onLine === false) throw new Error(`${operation} يتطلب اتصالًا بالإنترنت. لم تُحفظ التغييرات محليًا أو في السحابة.`); };
let html2pdfLoadPromise=null;
async function ensureHtml2Pdf(){
 if(typeof window.html2pdf==='function')return;
 if(!html2pdfLoadPromise){
  html2pdfLoadPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
   script.async=true;script.crossOrigin='anonymous';script.dataset.taibaHtml2pdf='true';
   script.onload=resolve;script.onerror=()=>reject(new Error('تعذر تحميل محرك إنشاء PDF. تحقق من اتصال الإنترنت ثم أعد المحاولة.'));
   document.head.append(script);
  });
 }
 await html2pdfLoadPromise;
 if(typeof window.html2pdf!=='function')throw new Error('محرك إنشاء PDF غير متاح في هذا المتصفح.');
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function resultInputMode(parameter){
  if(parameter?.result_input_mode)return parameter.result_input_mode;
  return ({numeric:'numeric_decimal',text:'text',boolean:'boolean',choice:'single_choice'}[parameter?.value_type||'numeric']||'numeric_decimal');
}
function resultModeValueType(mode){
  return ({numeric_integer:'numeric',numeric_decimal:'numeric',numeric_comparator:'text',
    text:'text',positive_negative:'choice',boolean:'boolean',single_choice:'choice',
    multi_choice:'choice',graded_multi_choice:'choice'}[mode]||'text');
}
function resultChoices(parameter){return Array.isArray(parameter?.choices)?parameter.choices:[];}
function renderResultControl(parameter,metadata,locked,mode){
  const choices=resultChoices(parameter),disabled=locked?' disabled':'';
  if(parameter.result_source==='calculated')return `<input type="number" step="any" ${metadata} data-result-source="calculated" disabled placeholder="تُحسب تلقائيًا بعد إدخال المدخلات" />`;
  if(mode==='numeric_integer'||mode==='numeric_decimal'){
    const decimals=Math.max(0,Math.min(6,Number(parameter.decimal_places??2)));
    return `<input type="number" step="${mode==='numeric_integer'?'1':String(10**-decimals)}" ${metadata}${disabled} placeholder="${mode==='numeric_integer'?'أدخل عددًا صحيحًا':'أدخل النتيجة الرقمية'}" />`;
  }
  if(mode==='numeric_comparator')return `<input type="text" ${metadata}${disabled} placeholder="مثال: <5 أو >=1.2" />`;
  if(mode==='boolean')return `<select ${metadata}${disabled}><option value="">اختر نعم أو لا</option><option value="true">نعم</option><option value="false">لا</option></select>`;
  if(mode==='positive_negative'||mode==='single_choice'){
    return `<select ${metadata}${disabled}><option value="">اختر النتيجة</option>${choices.map(choice=>`<option data-option-value="${escapeHtml(choice)}" value="${escapeHtml(choice)}">${escapeHtml(choice)}</option>`).join('')}</select>`;
  }
  if(mode==='multi_choice'||mode==='graded_multi_choice'){
    const maximum=Number(parameter.result_config?.max_selections||0);
    return `<div class="multi-choice-editor" data-multi-choice-editor>
      <input type="hidden" class="multi-choice-value" ${metadata}${disabled} value="" />
      <div class="multi-choice-options">${choices.map(choice=>`<label class="multi-choice-option" data-choice-option><input class="multi-choice-item" type="checkbox" data-choice-value="${escapeHtml(choice)}"${disabled}><span>${escapeHtml(choice)}</span></label>`).join('')}</div>
      ${maximum>0?'<small>اختر بحد أقصى '+maximum+' اختيارات</small>':''}
      ${mode==='graded_multi_choice'?'<small class="choice-score-total" data-choice-score-total aria-live="polite"></small>':''}
    </div>`;
  }
  return `<textarea rows="2" ${metadata}${disabled} placeholder="اكتب النتيجة هنا"></textarea>`;
}
function syncMultiChoiceValue(hiddenInput){
  const editor=hiddenInput?.closest('[data-multi-choice-editor]');
  if(!editor)return;
  const selected=[...editor.querySelectorAll('.multi-choice-item:checked')].map(input=>input.dataset.choiceValue);
  hiddenInput.value=selected.length?JSON.stringify(selected):'';
  const summary=editor.querySelector('[data-choice-score-total]');
  if(summary){
    let config={};try{config=JSON.parse(hiddenInput.dataset.resultConfig||'{}');}catch{}
    const scores=config.choice_scores||{};
    const total=selected.reduce((sum,choice)=>sum+Number(scores[choice]||0),0);
    summary.textContent=selected.length?'الدرجة المحتسبة: '+total:'';
  }
}
function setMultiChoiceValue(hiddenInput,rawValue){
  if(!hiddenInput)return;
  let selected=[];try{const parsed=JSON.parse(String(rawValue||'[]'));if(Array.isArray(parsed))selected=parsed.map(String);}catch{}
  hiddenInput.value=selected.length?JSON.stringify(selected):'';
  const editor=hiddenInput.closest('[data-multi-choice-editor]');
  if(editor)editor.querySelectorAll('.multi-choice-item').forEach(input=>{input.checked=selected.includes(input.dataset.choiceValue);});
  syncMultiChoiceValue(hiddenInput);
}
function evaluateDisplayRules(section){
  if(!section)return;
  for(const field of section.querySelectorAll('[data-display-rules]')){
    let rules=[];try{rules=JSON.parse(field.dataset.displayRules||'[]');}catch{}
    if(!Array.isArray(rules)||!rules.length)continue;
    const visible=new Set(),conditional=new Set();let matched=false,anyControllerValue=false;
    for(const rule of rules){
      const condition=rule?.when||{},source=section.querySelector('[data-param-code="'+CSS.escape(condition.parameter_code||'')+'"]');
      let sourceValue=source?.value??'';
      if(source?.dataset.inputMode==='multi_choice'||source?.dataset.inputMode==='graded_multi_choice'){try{sourceValue=JSON.parse(sourceValue||'[]');}catch{sourceValue=[];}}
      const conditionValue=String(condition.value??'');
      const hasControllerValue=Array.isArray(sourceValue)?sourceValue.length>0:String(sourceValue).trim()!=='';
      if(hasControllerValue)anyControllerValue=true;
      let isMatch=false;
      if(hasControllerValue){
        if(['lt','lte','gt','gte'].includes(condition.operator)){
          const left=Number(sourceValue),right=Number(condition.value);
          if(Number.isFinite(left)&&Number.isFinite(right)){
            isMatch=condition.operator==='lt'?left<right:condition.operator==='lte'?left<=right:condition.operator==='gt'?left>right:condition.operator==='gte'?left>=right:false;
          }
        }else if(condition.operator==='not_equals'){
          isMatch=Array.isArray(sourceValue)?!sourceValue.includes(conditionValue):String(sourceValue)!==conditionValue;
        }else{
          isMatch=Array.isArray(sourceValue)?sourceValue.includes(conditionValue):String(sourceValue)===conditionValue;
        }
      }
      for(const value of (rule.visible_values||[])){conditional.add(String(value));if(isMatch)visible.add(String(value));}
      if(isMatch)matched=true;
    }
    field.querySelectorAll('[data-option-value], [data-choice-value]').forEach(option=>{
      const value=option.dataset.optionValue??option.dataset.choiceValue??'';
      const shouldHide=matched?!visible.has(value):anyControllerValue&&conditional.has(value);
      if(option.tagName==='OPTION'){
        option.hidden=shouldHide;option.disabled=shouldHide;
        if(shouldHide&&option.selected&&option.closest('select'))option.closest('select').value='';
      }
      else{const label=option.closest('[data-choice-option]')||option;label.hidden=shouldHide;if(shouldHide&&option.checked)option.checked=false;}
    });
    const hidden=field.querySelector('.multi-choice-value');if(hidden)syncMultiChoiceValue(hidden);
  }
}


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
  let staffRows;
  if (globalThis.navigator?.onLine === false) {
    staffRows = (await getCachedRows('staff_directory', { tenantId: state.tenant.id, branchId: state.branch.id }))
      .filter(row => row.is_active);
  } else {
    const db = getSupabaseClient();
    let staffQuery = db.from('staff_directory')
      .select('id, tenant_id, branch_id, display_name, auth_user_id, is_active').eq('tenant_id', state.tenant.id)
      .eq('branch_id', state.branch.id).eq('is_active', true);
    if (state.tenant.accountType === 'employee') staffQuery = staffQuery.eq('auth_user_id', state.userId);
    const { data, error } = await staffQuery.order('display_name');
    if (error) throw error;
    staffRows = data ?? [];
    await cacheRows('staff_directory', staffRows);
  }
  state.staff = staffRows;
  if (state.tenant.accountType === 'employee') state.staff = state.staff.filter(row => row.auth_user_id === state.userId);
  $('staffSelect').disabled = state.tenant.accountType === 'employee';
  $('staffSelect').innerHTML = state.staff.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.display_name)}</option>`).join('');
  if (!state.staff.length) { $('workList').innerHTML = '<div class="empty">لا يوجد موظف نشط مسجل لهذا الفرع. أضف الموظفين من إعدادات المعمل أولًا.</div>'; $('contextStatus').textContent = ''; return; }
  state.workPage = 0;
  window.dispatchEvent(new CustomEvent('taiba:results-context',{detail:{tenantId:state.tenant?.id,branchId:state.branch?.id,tenantSlug:state.tenant?.slug}}));
  state.stopBackgroundSync?.();
  state.stopBackgroundSync = startBackgroundSync({ tenantId: state.tenant.id, branchId: state.branch.id });
  await refreshWork();
}

window.addEventListener('taiba:offline-sync-complete', () => refreshWork().catch(error => showNotice(error.message || 'تعذر تحديث النتائج بعد المزامنة.', true)));

async function refreshWork() {
  if(window.taibaGetDirtyResultInputs?.().length){showNotice('هناك نتائج غير محفوظة. احفظها أولًا قبل تحديث القائمة أو تغيير الفرع أو الحالة.',true);return;}
  state.previewedVisits.clear();
  $('contextStatus').textContent = 'جارٍ تحديث قائمة العمل…';
  const url = new URL(globalThis.location.href);
  const requestedVisitId = url.searchParams.get('visit_id');
  if (requestedVisitId) {
    const maps = await offlineDb.sync_meta.toArray();
    const resolved = maps.find(row => row.tenant_id === state.tenant.id && row.branch_id === state.branch.id && row.local_visit_id === requestedVisitId && row.server_visit_id);
    if (resolved) { url.searchParams.set('visit_id', resolved.server_visit_id); globalThis.history.replaceState({}, '', url); }
  }
  let result = await listBranchWorkPage({ tenantId: state.tenant.id, branchId: state.branch.id, page: state.workPage, pageSize: state.workPageSize });
  const lastPage = Math.max(0, Math.ceil(result.count / state.workPageSize) - 1);
  if (state.workPage > lastPage) {
    state.workPage = lastPage;
    result = await listBranchWorkPage({ tenantId: state.tenant.id, branchId: state.branch.id, page: state.workPage, pageSize: state.workPageSize });
  }
  const localVisits=await getCachedRows('visits',{tenantId:state.tenant.id,branchId:state.branch.id});
  const localVisitById=new Map(localVisits.map(row=>[row.id,row]));
  state.work = result.rows.map(row=>{const local=localVisitById.get(row.visit_id);return local?.local_approval_status?{...row,visits:{...(row.visits||{}),local_approval_status:local.local_approval_status,local_approved_at:local.local_approved_at,local_approved_by_staff_id:local.local_approved_by_staff_id}}:row;});
  const deliveryRows=await offlineDb.sync_meta.toArray();
  state.deliveryStatus=new Map(deliveryRows.filter(row=>row.key?.startsWith(`delivery:${state.tenant.id}:${state.branch.id}:`)).map(row=>[row.visit_id,row]));
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
  try {
    const {data:portalConfig,error:portalConfigError}=await getSupabaseClient().functions.invoke('patient-portal-config',{body:{slug:state.tenant.slug}});
    state.portalEnabled=!portalConfigError && portalConfig?.settings?.enabled===true;
  } catch { state.portalEnabled=false; }
  const resultRows = await listResultsForVisitTests({tenantId:state.tenant.id,visitTestIds:state.work.map(item=>item.id)});
  const resultsByTest = new Map();
  for (const result of resultRows) {
    if (!resultsByTest.has(result.visit_test_id)) resultsByTest.set(result.visit_test_id, []);
    resultsByTest.get(result.visit_test_id).push(result);
  }
  if (globalThis.navigator?.onLine !== false && state.work.length) {
    try {
      const {data,error}=await getSupabaseClient().from('report_versions')
        .select('visit_id,publication_type,version_number').eq('tenant_id',state.tenant.id)
        .eq('is_published',true).in('visit_id',state.work.map(item=>item.visit_id))
        .order('version_number',{ascending:false});
      if(!error){
        state.partialPublishedVisits.clear();
        const seen=new Set();
        for(const version of data||[]){if(seen.has(version.visit_id))continue;seen.add(version.visit_id);if(version.publication_type==='partial')state.partialPublishedVisits.add(version.visit_id);}
      }
    } catch {}
  }
  const byVisit = new Map();
  for (const item of state.work) {
    const visit = item.visits;
    const key = item.visit_id;
    if (!byVisit.has(key)) byVisit.set(key, { visit, items: [] });
    byVisit.get(key).items.push(item);
  }
  host.innerHTML = '';
  for (const [visitId, group] of byVisit) {
    const card = document.createElement('article'); card.className = 'work-card'; card.dataset.visitId = visitId; card.dataset.patientPhone = group.visit?.patients?.phone || ''; card.dataset.patientName = group.visit?.patients?.full_name || ''; card.dataset.patientAge = group.visit?.patients?.age_value ?? group.visit?.patients?.age_years ?? ''; card.dataset.patientAgeUnit = group.visit?.patients?.age_unit || (group.visit?.patients?.age_years != null ? 'years' : ''); card.dataset.patientSex = group.visit?.patients?.sex || ''; card.dataset.visitDate = group.visit?.visit_work_date || ''; card.dataset.visitNumber = group.visit?.visit_number || ''; card.dataset.published = String(Boolean(group.visit?.is_published)); card.dataset.visitStatus = group.visit?.status || 'open';
    const visitTitle = `زيارة ${group.visit?.visit_number ?? '—'} · ${group.visit?.patients?.full_name ?? 'مريض'}`;
    const isPublished = Boolean(group.visit?.is_published);
    const hasCompletedTests = group.items.some(item => item.status === 'completed');
    const hasPendingTests = group.items.some(item => item.status !== 'completed');
    const hasAnySavedResults = group.items.some(item => (resultsByTest.get(item.id)||[]).length>0);
    const isPartialPublished = state.partialPublishedVisits.has(visitId);
    const canPrintPartial = hasAnySavedResults && !isPublished && (hasPendingTests || group.visit?.status !== 'approved');
    const canPublishPartial = state.portalEnabled && hasAnySavedResults && !isPublished && (hasPendingTests || group.visit?.status !== 'approved');
    const canPublishReport = state.portalEnabled && (group.visit?.status === 'approved' || isPublished) && !hasPendingTests;
    const itemsMarkup = group.items.map(item => {
      const locked = item.status === 'completed';
      const canCorrectApproved = state.tenant.accountType === 'owner' && group.visit?.status === 'approved' && !isPublished;
      const params = item.technical_snapshot?.parameters ?? [];
      const groupedParams = new Map();
      for (const p of params) { const sectionName = p.clinical_metadata?.section || 'النتائج'; if (!groupedParams.has(sectionName)) groupedParams.set(sectionName, []); groupedParams.get(sectionName).push(p); }
      const parameterControls = [...groupedParams.entries()].map(([sectionName, groupParams]) => `<fieldset class="parameter-group"><legend>${escapeHtml(sectionName)}</legend>${groupParams.map(p => {
        const mode=resultInputMode(p),type=resultModeValueType(mode);
        const code=escapeHtml(p.code),name=escapeHtml(p.name??p.parameter_name??p.code);
        const parameterRange=rangeOverridesByKey.get(item.id+'|'+p.code)?.reference_ranges??p.reference_ranges??{};
        const displayRules=Array.isArray(p.display_rules)?p.display_rules:[];
        const metadata=`aria-label="${name}" data-param-code="${code}" data-param-name="${name}" data-unit="${escapeHtml(p.unit??'')}" data-value-type="${escapeHtml(type)}" data-input-mode="${escapeHtml(mode)}" data-result-config='${escapeHtml(JSON.stringify(p.result_config||{}))}' data-range='${escapeHtml(JSON.stringify(parameterRange))}' data-choices='${escapeHtml(JSON.stringify(resultChoices(p)))}' data-reference-interval-status='${escapeHtml(p.reference_interval_status??'local_verification_required')}' data-patient-age='${escapeHtml(patientAgeInYears(item.visits?.patients||{})??'')}' data-patient-sex='${escapeHtml(item.visits?.patients?.sex??'')}' data-critical-range='${escapeHtml(JSON.stringify(p.critical_ranges??[]))}'`;
        const control=renderResultControl(p,metadata,locked,mode);
        const rangeText = resolveReferenceRange(parameterRange, item.visits?.patients || {}, p.reference_interval_status);
        const rangeEditButton = (isPublished || (group.visit?.status !== 'approved' && group.visit?.status !== 'cancelled'))
          ? '<button type="button" class="edit-reference-range" data-visit-test-id="' + escapeHtml(item.id) + '" data-param-code="' + code + '" data-range="' + escapeHtml(JSON.stringify(parameterRange)) + '" data-published="' + String(isPublished) + '">' + (isPublished ? 'تصحيح رينج التقرير المنشور' : 'تعديل الرينج لهذه الزيارة') + '</button>' : '';
        return '<div class="result-field" data-display-rules=\'' + escapeHtml(JSON.stringify(displayRules)) + '\'><span class="result-field-name">' + name + (p.is_required === false ? ' (اختياري)' : '') + '</span><small>' + escapeHtml(p.unit ?? '') + ' ' + escapeHtml(rangeText) + '</small>' + control + rangeEditButton + '</div>';
      }).join('')}</fieldset>`).join('');
      const isCulture = String(item.test_code_snapshot || '').startsWith('CULTURE_');
      const cultureEditor = isCulture ? `<section class="culture-workflow" data-culture-workflow="${escapeHtml(item.id)}"><h3>العزلات والاختبار الحساسي (Antibiogram)</h3><p class="muted">أضف كل عزلة منفصلة. أدخل تفسير الحساسية وفق إصدار CLSI/EUCAST والطريقة المعتمدة في المعمل؛ النظام لا يخمّن نقاط القطع.</p><div class="culture-isolates" data-culture-isolates="${escapeHtml(item.id)}"><p class="muted">جارٍ تحميل العزلات…</p></div>${!locked && !isPublished ? `<form class="culture-isolate-form" data-visit-test-id="${escapeHtml(item.id)}"><label>رقم العزلة<input name="isolateNumber" type="number" min="1" max="20" value="1" required></label><label>اسم الكائن الممرض / العزلة<input name="organismName" maxlength="200" required placeholder="مثال: Escherichia coli"></label><label>وصف النمو<input name="growthDescription" placeholder="Pure growth / mixed growth"></label><label>عدد المستعمرات<input name="colonyCount" type="number" min="0" step="any"></label><label>وحدة العد<input name="colonyCountUnit" value="CFU/mL"></label><label>طريقة التعريف<input name="identificationMethod" placeholder="Biochemical / MALDI-TOF / Automated"></label><label class="wide">ملاحظات<textarea name="notes" rows="2"></textarea></label><button class="button" type="submit">حفظ العزلة</button></form>` : ''}</section>` : '';
      return `<section class="parameter" data-test-id="${escapeHtml(item.id)}" data-visit-id="${escapeHtml(visitId)}" data-test-status="${escapeHtml(item.status)}" data-published="${String(isPublished)}" data-test-code="${escapeHtml(item.test_code_snapshot || '')}" data-test-kind="${escapeHtml(item.technical_snapshot?.test_kind || item.tests_catalog?.test_kind || 'individual')}">
        <div class="card-head"><strong>${escapeHtml(item.test_name_snapshot)}</strong><span class="pill">${escapeHtml(item.status)}</span></div>
        <div class="parameter-grid">${parameterControls}</div>${cultureEditor}
        <div class="actions">${isPublished ? '<button class="button button-secondary correct-test" data-test-id="' + escapeHtml(item.id) + '">تصحيح نتيجة منشورة</button>' : locked && group.visit?.status !== 'cancelled' && (group.visit?.status !== 'approved' || canCorrectApproved) ? '<button class="button button-secondary correct-unpublished-test" data-test-id="' + escapeHtml(item.id) + '">تصحيح النتيجة</button>' : locked ? '<span class="pill">التحليل مكتمل — النتائج للعرض فقط</span>' : ''}</div>
      </section>`;
    }).join('');
    card.innerHTML = `<div class="card-head"><div><h2>${escapeHtml(visitTitle)}</h2><p class="muted">${escapeHtml(group.visit?.visit_work_date ?? '')}</p></div><span class="pill">${group.visit?.local_approval_status === 'pending_server_validation' ? 'اعتماد محلي — بانتظار المزامنة' : state.deliveryStatus.get(visitId)?.delivery_status === 'pending_sync' ? 'تسليم نسخة عمل — بانتظار المزامنة' : state.deliveryStatus.get(visitId)?.delivery_status === 'synced' ? 'تم تسجيل تسليم نسخة عمل' : (isPublished ? 'منشور' : escapeHtml(group.visit?.status ?? 'مفتوح'))}</span></div>${itemsMarkup}
      <div class="actions"><button class="button button-secondary save-visit-drafts" data-visit-id="${escapeHtml(visitId)}" ${(isPublished || group.visit?.status === 'approved') ? 'disabled' : ''}>حفظ كل النتائج</button><button class="button approve-visit" data-visit-id="${escapeHtml(visitId)}" ${(isPublished || group.visit?.status === 'approved') ? 'disabled' : ''}>${group.visit?.status === 'approved' ? 'تم اعتماد الزيارة' : 'اعتماد الزيارة'}</button></div>
      <div class="actions"><button class="button button-secondary print-visit-report" data-visit-id="${escapeHtml(visitId)}" ${!isPublished && group.visit?.status !== 'approved' && !hasCompletedTests && !hasAnySavedResults ? 'disabled' : ''}>${canPrintPartial ? 'طباعة النتائج المحفوظة (تقرير جزئي)' : 'طباعة التقرير بإعدادات المعمل / حفظ PDF'}</button></div>
      ${!isPublished && hasAnySavedResults ? `<div class="actions"><button class="button button-secondary mark-work-copy-delivered" data-visit-id="${escapeHtml(visitId)}" ${state.deliveryStatus.get(visitId)?.delivery_status ? 'disabled' : ''}>تسجيل تسليم نسخة عمل مطبوعة</button></div>` : ''}
      <div class="actions"><button class="button button-secondary select-historical-report" data-visit-id="${escapeHtml(visitId)}" type="button">اختيار نتائج تاريخية لإضافتها للتقرير (اختياري)</button></div><div class="historical-report-picker" data-historical-picker="${escapeHtml(visitId)}" hidden></div>
      <div class="file-row report-publish-row"><p class="muted">بعد معاينة التقرير النهائي واعتماد الزيارة، انشر النسخة النهائية على بوابة المريض.</p><button class="button publish-report" data-visit-id="${escapeHtml(visitId)}" ${!canPublishReport ? 'disabled' : ''}>${!state.portalEnabled ? 'بوابة المريض غير مفعلة' : isPublished ? 'نشر نسخة مصححة' : 'نشر التقرير النهائي'}</button></div>
      ${canPublishPartial ? '<div class="file-row report-publish-row"><p class="muted">يمكن نشر النتائج المحفوظة الآن كتقرير جزئي دون اعتماد الزيارة أو إغلاقها.</p><button class="button button-secondary publish-partial-report" data-partial="true" data-visit-id="' + escapeHtml(visitId) + '">' + (isPartialPublished ? 'نشر تحديث جزئي' : 'نشر تقرير جزئي') + '</button></div>' : ''}
      ${isPartialPublished && state.portalEnabled && group.visit?.patients?.phone ? '<div class="actions"><button class="button button-secondary share-partial-report" data-visit-id="' + escapeHtml(visitId) + '">إرسال رابط التقرير الجزئي عبر واتساب</button></div>' : ''}
      ${hasAnySavedResults && !state.portalEnabled ? '<p class="muted">الطباعة الجزئية متاحة الآن؛ فعّل بوابة المريض من إعدادات الموقع لإتاحة النشر وواتساب.</p>' : ''}
      <div class="file-row"><label>مرفق للزيارة (PDF أو JPG أو PNG)<input type="file" accept="application/pdf,image/jpeg,image/png" data-attachment-file="${escapeHtml(visitId)}"></label><button class="button button-secondary upload-attachment" data-visit-id="${escapeHtml(visitId)}">رفع مرفق</button><button class="button button-secondary list-attachments" data-visit-id="${escapeHtml(visitId)}">عرض المرفقات</button></div>
      <div class="attachment-list" data-attachment-list="${escapeHtml(visitId)}"></div>
      <p class="danger-note">اسم المستخدم الذي أجرى التصحيح يُسجل تلقائيًا في سجل المراجعة، ولا يحتاج الفني إلى كتابة سبب للتصحيح.</p>`;
    host.append(card);
  }
  host.querySelectorAll('.edit-reference-range').forEach(btn => btn.addEventListener('click', () => editReferenceRange(btn)));
  if(!host.dataset.resultControlsBound){
    host.dataset.resultControlsBound='true';
    host.addEventListener('change',event=>{
      const section=event.target.closest('.parameter[data-test-id]');if(!section)return;
      const checkbox=event.target.closest('.multi-choice-item');
      if(checkbox){
        const editor=checkbox.closest('[data-multi-choice-editor]');
        const hidden=editor?.querySelector('.multi-choice-value');
        let config={};try{config=JSON.parse(hidden?.dataset.resultConfig||'{}');}catch{}
        const max=Number(config.max_selections||0),selected=[...editor.querySelectorAll('.multi-choice-item:checked')];
        if(max>0&&selected.length>max){checkbox.checked=false;showNotice('عدد الاختيارات تجاوز الحد المسموح.',true);}
        if(hidden)syncMultiChoiceValue(hidden);
      }
      evaluateDisplayRules(section);
    });
    host.addEventListener('input',event=>{
      const section=event.target.closest('.parameter[data-test-id]');if(section)evaluateDisplayRules(section);
    });
  }
  host.querySelectorAll('.parameter[data-test-id]').forEach(section=>evaluateDisplayRules(section));

  host.querySelectorAll('.save-visit-drafts').forEach(btn => btn.addEventListener('click', () => saveVisitDraftsAction(btn)));
  host.querySelectorAll('.correct-test, .correct-unpublished-test').forEach(btn => btn.addEventListener('click', () => correctTest(btn)));
  host.querySelectorAll('.approve-visit').forEach(btn => btn.addEventListener('click', () => approve(btn)));
  host.querySelectorAll('.mark-work-copy-delivered').forEach(btn => btn.addEventListener('click', () => markWorkCopyDelivered(btn)));
  host.querySelectorAll('.publish-report, .publish-partial-report').forEach(btn => btn.addEventListener('click', () => publish(btn)));
  host.querySelectorAll('.share-partial-report').forEach(btn => btn.addEventListener('click', () => sharePartialReport(btn)));
  host.querySelectorAll('.upload-attachment').forEach(btn => btn.addEventListener('click', () => uploadAttachment(btn)));
  host.querySelectorAll('.list-attachments').forEach(btn => btn.addEventListener('click', () => loadAttachments(btn.dataset.visitId)));
  host.querySelectorAll('.attachment-download').forEach(btn => btn.addEventListener('click', () => downloadAttachment(btn)));
  // Populate all existing values from the single scoped query loaded above.
  const cultureWork = state.work.filter(item => String(item.test_code_snapshot || '').startsWith('CULTURE_'));
  if (cultureWork.length) {
    const cultureRows = await listCultureResults({tenantId:state.tenant.id,branchId:state.branch.id,visitTestIds:cultureWork.map(item=>item.id)});
    for (const item of cultureWork) renderCultureResults(host,item,cultureRows);
    bindCultureForms(host);
  }
  host.querySelectorAll('.select-historical-report').forEach(btn => btn.addEventListener('click', () => loadHistoricalReportPicker(btn)));
  host.querySelectorAll('.print-visit-report').forEach(btn => btn.addEventListener('click', () => window.taibaPreviewVisitReport(btn.dataset.visitId)));
  for (const item of state.work) {
    const section = host.querySelector(`[data-test-id="${CSS.escape(item.id)}"]`);
    if (!section) continue;
    for (const result of resultsByTest.get(item.id) ?? []) {
      const input = section.querySelector(`[data-param-code="${CSS.escape(result.parameter_code)}"]`);
      if (input) {
        const rawValue=result.value_numeric??result.value_text??'';
        if(input.dataset.inputMode==='multi_choice'||input.dataset.inputMode==='graded_multi_choice')setMultiChoiceValue(input,rawValue);
        else input.value=rawValue;
        input.dataset.resultId=result.id;input.dataset.originalValue=input.value;
      }
    }
  }
  const pendingDraftBatches = await listPendingDraftResults({ tenantId: state.tenant.id, branchId: state.branch.id });
  const visitMaps = await offlineDb.sync_meta.toArray();
  for (const batch of pendingDraftBatches) {
    let targetTestId = batch.payload?.visit_test_id || '';
    for (const map of visitMaps) if (map.tenant_id === state.tenant.id && map.branch_id === state.branch.id && map.visit_test_ids?.[targetTestId]) { targetTestId = map.visit_test_ids[targetTestId]; break; }
    const section = host.querySelector(`[data-test-id="${CSS.escape(targetTestId)}"]`);
    if (!section) continue;
    section.dataset.localPending = 'true';
    const pill = section.querySelector('.card-head .pill');
    if (pill) pill.textContent = batch.status === 'conflict' ? 'تعارض مزامنة — يحتاج مراجعة' : 'محفوظ محليًا — بانتظار المزامنة';
    for (const result of batch.payload?.results || []) {
      const input = section.querySelector(`[data-param-code="${CSS.escape(result.parameter_code)}"]`);
      if (!input) continue;
      const rawValue=result.value_numeric??result.value_text??'';
      if(input.dataset.inputMode==='multi_choice'||input.dataset.inputMode==='graded_multi_choice')setMultiChoiceValue(input,rawValue);
      else input.value=rawValue;
      input.dataset.originalValue=input.value;
      input.dataset.localPending='true';
    }
  }
  host.querySelectorAll('.parameter[data-test-id]').forEach(section=>evaluateDisplayRules(section));
  if (globalThis.navigator?.onLine === false || state.work.some(item => item.local_offline)) {
    for (const item of state.work) {
      const section = host.querySelector(`[data-test-id="${CSS.escape(item.id)}"]`);
      if (!section) continue;
      const localRows = [];
      for (const input of section.querySelectorAll('[data-param-code]')) {
        if (input.dataset.resultSource !== 'calculated' && ['numeric_integer','numeric_decimal'].includes(input.dataset.inputMode) && input.value.trim() && Number.isFinite(Number(input.value))) {
          localRows.push({ visit_test_id: item.id, parameter_code: input.dataset.paramCode, value_numeric: Number(input.value) });
        }
      }
      for (const derived of calculateLocalDerivedResults(item, localRows)) {
        const input = section.querySelector(`[data-param-code="${CSS.escape(derived.parameter_code)}"]`);
        if (input) { input.value = derived.value_numeric; input.dataset.originalValue = input.value; input.dataset.localCalculated = 'true'; }
      }
    }
  }
}


async function editReferenceRange(button) {
  if(window.taibaGetDirtyResultInputs?.().length){window.alert('احفظ النتائج التي أدخلتها أولًا قبل تعديل المدى المرجعي لهذه الزيارة. لن تُفقد أي نتيجة.');return;}
  const visitTestId=button.dataset.visitTestId,parameterCode=button.dataset.paramCode;
  const item=state.work.find(row=>row.id===visitTestId);
  const parameter=item?.technical_snapshot?.parameters?.find(row=>row.code===parameterCode);
  if(!item||!parameter){showNotice('تعذر تحديد البارامتر والزيارة لتعديل المدى المرجعي. حدّث شاشة النتائج وحاول مرة أخرى.',true);return;}
  let current={};try{current=JSON.parse(button.dataset.range||'{}');}catch{}
  const currentText=formatReferenceRange(current);
  const value=window.prompt('اكتب المدى المرجعي الجديد لهذا المريض وهذه الزيارة فقط. مثال: 0.7 - 1.3 أو Negative',currentText==='—'?'':currentText);
  if(value===null)return;
  const clean=value.trim();if(!clean){showNotice('لم يتم تغيير المدى المرجعي لأن القيمة فارغة.',true);return;}
  const normalized=clean.replace(/[–—]/g,'-');
  const numericMatch=normalized.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
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

function ageBoundaryInYears(value,unit){
  if(value==null||value==='')return null;
  const normalized=String(unit||'years').toLowerCase();
  const factor=['month','months','mo','m'].includes(normalized)?1/12
    :['day','days','d'].includes(normalized)?1/365:1;
  return Number(value)*factor;
}
function patientAgeInYears(patient={}){
  if(patient.age_years!=null&&patient.age_years!=='')return Number(patient.age_years);
  return ageBoundaryInYears(patient.age_value,patient.age_unit||'years');
}
function resolveReferenceRange(value, patient = {}, status = 'local_verification_required') {
  if (status === 'not_applicable' && !(value && (value.text || Array.isArray(value)))) return 'لا ينطبق';
  if (!value || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) return '';
  if (Array.isArray(value)) {
    const age = patientAgeInYears(patient);
    const sex = String(patient?.sex || '').toLowerCase();
    const matches = value.filter(range => {
      if (range.pregnancy) return false;
      if (range.sex && String(range.sex).toLowerCase() !== sex) return false;
      if (range.age) {
        if (age === null || !Number.isFinite(age)) return false;
        const minUnit=range.age.min_unit||range.age.unit||'years';
        const maxUnit=range.age.max_unit||range.age.unit||'years';
        const min=ageBoundaryInYears(range.age.min,minUnit);
        const max=ageBoundaryInYears(range.age.max,maxUnit);
        if (min!=null&&age<min)return false;
        if (max!=null&&age>max)return false;
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

function evaluateLocalFormula(node, values) {
  if (!node || typeof node !== 'object') return null;
  if (node.const !== undefined) return Number.isFinite(Number(node.const)) ? Number(node.const) : null;
  if (node.param) return values.has(node.param) ? values.get(node.param) : null;
  const args = (node.args || []).map(arg => evaluateLocalFormula(arg, values));
  if (args.some(value => value === null || !Number.isFinite(value))) return null;
  let result;
  switch (node.op) {
    case 'add': result = args[0] + args[1]; break;
    case 'subtract': result = args[0] - args[1]; break;
    case 'multiply': result = args[0] * args[1]; break;
    case 'divide': if (args[1] === 0) return null; result = args[0] / args[1]; break;
    case 'abs': result = Math.abs(args[0]); break;
    case 'round': { const places = Math.max(0, Math.min(6, Math.trunc(args[1] ?? 0))); result = Number(args[0].toFixed(places)); break; }
    case 'min': result = Math.min(...args); break;
    case 'max': result = Math.max(...args); break;
    default: return null;
  }
  return Number.isFinite(result) ? result : null;
}

function calculateLocalDerivedResults(item, rows) {
  const parameters = item.technical_snapshot?.parameters || [];
  const values = new Map();
  for (const row of rows) {
    if (row.visit_test_id !== item.id || row.value_numeric == null) continue;
    values.set(row.parameter_code, Number(row.value_numeric));
  }
  const derived = [];
  for (let pass = 0; pass < parameters.length; pass++) {
    let progress = false;
    for (const parameter of parameters) {
      if (parameter.result_source !== 'calculated' || values.has(parameter.code)) continue;
      const raw = evaluateLocalFormula(parameter.formula, values);
      if (raw === null) continue;
      const places = Math.max(0, Math.min(6, Number(parameter.decimal_places ?? 2)));
      const value = Number(raw.toFixed(places));
      values.set(parameter.code, value);
      derived.push({
        id: 'local-calculated:' + item.id + ':' + parameter.code,
        tenant_id: item.tenant_id, visit_test_id: item.id, parameter_code: parameter.code,
        parameter_name_snapshot: parameter.name || parameter.parameter_name || parameter.code,
        value_numeric: value, value_text: null, unit_snapshot: parameter.unit || null,
        reference_range_snapshot: parameter.reference_ranges || {}, entered_at: new Date().toISOString(),
      });
      progress = true;
    }
    if (!progress) break;
  }
  return derived;
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
  const allVisitItems = await listVisitWorkForReport({ tenantId: state.tenant.id, branchId: state.branch.id, visitId });
  if (!allVisitItems.length) throw new Error('تعذر العثور على تحاليل الزيارة في هذا الفرع.');
  const visit = allVisitItems[0].visits || {};
  const visitApproved = visit.status === 'approved' || Boolean(visit.is_published);
  const hasCompletedTests = allVisitItems.some(item => item.status === 'completed');
  const hasPendingTests = allVisitItems.some(item => item.status !== 'completed');
  const localOffline = globalThis.navigator?.onLine === false || Boolean(visit.local_offline) || allVisitItems.some(item => item.local_offline) || visit.local_approval_status === 'pending_server_validation';
  const serverApproved = !localOffline && visitApproved && !hasPendingTests;
  const patient = visit.patients || {};
  let rows = await listResultsForVisitTests({ tenantId: state.tenant.id, visitTestIds: allVisitItems.map(item => item.id) });
  const hasSavedResults = rows.length > 0;
  // Any cloud-saved result may be issued as a clearly marked partial report;
  // the final approval state remains untouched until every required result is complete.
  const partialReport = !localOffline && globalThis.navigator?.onLine !== false && !serverApproved && (hasSavedResults || hasCompletedTests);
  const visitItems = partialReport
    ? allVisitItems.filter(item => item.status === 'completed' || rows.some(row => row.visit_test_id === item.id))
    : allVisitItems;
  if (partialReport) rows = rows.filter(row => visitItems.some(item => item.id === row.visit_test_id));
  const canPrint = serverApproved || localOffline || partialReport;
  if (globalThis.navigator?.onLine === false || localOffline) {
    const pending = await listPendingDraftResults({ tenantId: state.tenant.id, branchId: state.branch.id });
    const maps = await offlineDb.sync_meta.toArray();
    const pendingRows = pending.flatMap(batch => {
      let targetTestId = batch.payload?.visit_test_id;
      for (const map of maps) if (map.tenant_id === state.tenant.id && map.branch_id === state.branch.id && map.visit_test_ids?.[targetTestId]) { targetTestId = map.visit_test_ids[targetTestId]; break; }
      if (!visitItems.some(item => item.id === targetTestId)) return [];
      return (batch.payload?.results || []).map(result => ({
        id: 'local:' + batch.operation_id + ':' + result.parameter_code,
        tenant_id: state.tenant.id, visit_test_id: targetTestId,
        parameter_code: result.parameter_code, value_numeric: result.value_numeric,
        value_text: result.value_text, flag: result.flag, entered_at: batch.created_at,
      }));
    });
    const byKey = new Map(rows.map(row => [row.visit_test_id + '|' + row.parameter_code, row]));
    for (const row of pendingRows) byKey.set(row.visit_test_id + '|' + row.parameter_code, row);
    rows.splice(0, rows.length, ...byKey.values());
    for (const item of visitItems) {
      for (const derived of calculateLocalDerivedResults(item, rows)) {
        if (!rows.some(row => row.visit_test_id === item.id && row.parameter_code === derived.parameter_code)) rows.push(derived);
      }
    }
  }
  const cultureRows = await listCultureResults({tenantId:state.tenant.id,branchId:state.branch.id,visitTestIds:visitItems.filter(item=>String(item.test_code_snapshot || '').startsWith('CULTURE_')).map(item=>item.id)});
  // A partial report contains only individually completed tests; the visit itself remains open.
  const selectedHistoricalIds=state.historicalSelections.get(visitId)||new Set();
  let selectedHistoricalRows=[];
  if(selectedHistoricalIds.size && globalThis.navigator?.onLine !== false){
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
  let reportBranches = [];
  if (globalThis.navigator?.onLine === false) reportBranches = [state.branch].filter(Boolean);
  else {
    const branchResult = await getSupabaseClient().from('branches')
      .select('id,name,address,phone').eq('tenant_id', state.tenant.id).eq('is_active', true).order('name');
    if (branchResult.error) {
      if (/fetch|network|offline/i.test(branchResult.error.message || '')) reportBranches = [state.branch].filter(Boolean);
      else throw branchResult.error;
    } else reportBranches = branchResult.data || [];
  }
  const logoPath = print.showLogo === false ? '' : (print.logoSource === 'branch' ? (print.logoPath || lab.logo_path || '') : (lab.logo_path || print.logoPath || ''));
  const signaturePath = !localOffline && print.showSignature ? print.signaturePath || '' : '';
  const stampPath = !localOffline && print.showStamp ? print.stampPath || '' : '';
  const logo = logoPath ? getLabAssetPublicUrl(logoPath) : '';
  const signature = signaturePath ? getLabAssetPublicUrl(signaturePath) : '';
  const stamp = stampPath ? getLabAssetPublicUrl(stampPath) : '';
  const reviewerName = !localOffline && print.showReviewer ? String(print.reviewerName || '').trim() : '';
  const headerSideText = String(print.headerSideText || '').trim() .split(/\r?\n/).map(escapeHtml).join('<br>');
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
  const sideContent = headerSideText ? '<div class="identity-extra">' + headerSideText + '</div>' : '';
  const headerRight = print.identitySide === 'left' ? sideContent : identityHtml;
  const headerLeft = print.identitySide === 'left' ? identityHtml : sideContent;
  const centerLogo = logo ? '<img class="lab-logo" src="' + escapeHtml(logo) + '" alt="شعار المعمل">' : '';
  const qrHtml = print.footerCenterMode === 'qr' && websiteUrl ? '<a class="footer-qr" href="' + escapeHtml(websiteUrl) + '"><img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=' + encodeURIComponent(websiteUrl) + '" alt="QR للموقع"><small>امسح لزيارة موقع المعمل</small></a>' : '';
  const centerFooter = print.footerCenterMode === 'message' && print.footerCenterMessage ? '<div class="footer-center-message">' + escapeHtml(print.footerCenterMessage) + '</div>' : qrHtml;
  const branchPhones = print.showContacts === false || print.showPhone === false ? [] : reportBranches.filter(row=>row.phone).map(row=>'<div>' + escapeHtml(row.name) + ' هاتف: ' + escapeHtml(row.phone) + '</div>');
  const phoneLink = value => { const digits=String(value||'').replace(/[^0-9+]/g,''); return digits ? '<a href="tel:' + escapeHtml(digits) + '">' + escapeHtml(digits) + '</a>' : escapeHtml(value); };
  const whatsappLink = value => { let digits=String(value||'').replace(/\D/g,'').replace(/^00/,''); if(digits.startsWith('0'))digits='20'+digits.slice(1); if(/^20\d{9,11}$/.test(digits))return '<a href="https://wa.me/'+digits+'" target="_blank" rel="noopener">'+escapeHtml(value)+'</a>'; return escapeHtml(value); };
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
      let value = result.value_numeric ?? result.value_text ?? '—';
      const reportMode=resultInputMode(parameter);
      if(['multi_choice','graded_multi_choice'].includes(reportMode)){
        try{
          const selected=JSON.parse(String(value));
          if(Array.isArray(selected)){
            value=selected.join('، ');
            if(reportMode==='graded_multi_choice'){
              const scores=parameter.result_config?.choice_scores||{};
              const total=selected.reduce((sum,choice)=>sum+Number(scores[choice]||0),0);
              value+=' · الدرجة: '+total;
            }
          }
        }catch{}
      }
      const unit = result.unit_snapshot || parameter.unit || '';
      const rawReference = result.reference_range_snapshot ?? parameter.reference_ranges;
      const hasReference = Array.isArray(rawReference) ? rawReference.length > 0
        : rawReference && typeof rawReference === 'object' ? Object.keys(rawReference).length > 0
        : rawReference !== null && rawReference !== undefined && String(rawReference).trim() !== '';
      const reference = hasReference ? resolveReferenceRange(rawReference, patient, parameter.reference_interval_status) : '';
      const calculatedFlag=computeReferenceFlag(result.value_numeric,result.reference_range_snapshot ?? parameter.reference_ranges,patient.age_years,patient.sex,parameter.reference_interval_status,'numeric');
      const displayFlag=calculatedFlag || result.flag;
      const flag = displayFlag ? ' · ' + displayFlag : '';
      return '<tr><td>' + escapeHtml(parameterName) + '</td><td>' + escapeHtml(value) + '</td><td>' + escapeHtml(unit) + '</td><td>' + escapeHtml(reference) + '</td><td>' + escapeHtml(flag) + '</td></tr>';
    }).filter(Boolean).join('');
    const cultureHtml = cultureRows.isolates.filter(isolate=>isolate.visit_test_id===item.id).map(isolate=>{const ast=cultureRows.susceptibilities.filter(row=>row.isolate_id===isolate.id);const astLines=ast.map(row=>'<tr><td>'+escapeHtml(row.antimicrobial_agent)+'</td><td>'+escapeHtml(row.test_method)+'</td><td>'+escapeHtml(row.measured_value??'—')+' '+escapeHtml(row.measured_unit??'')+'</td><td>'+escapeHtml(row.interpretation)+'</td><td>'+escapeHtml(row.breakpoint_standard)+' '+escapeHtml(row.breakpoint_edition)+'</td><td>'+escapeHtml(row.qc_status)+'</td></tr>').join('');return '<h3>العزلة '+isolate.isolate_number+': '+escapeHtml(isolate.organism_name)+'</h3><p>النمو: '+escapeHtml(isolate.growth_description||'—')+' · العد: '+escapeHtml(isolate.colony_count??'—')+' '+escapeHtml(isolate.colony_count_unit)+' · التعريف: '+escapeHtml(isolate.identification_method||'—')+'</p><table><thead><tr><th>المضاد الحيوي</th><th>الطريقة</th><th>القيمة</th><th>التفسير</th><th>معيار/إصدار القطع</th><th>ضبط الجودة</th></tr></thead><tbody>'+(astLines||'<tr><td colspan="6">لا توجد نتائج حساسية مسجلة</td></tr>')+'</tbody></table>'+(isolate.notes?'<p>'+escapeHtml(isolate.notes)+'</p>':'');}).join('');
    const kind = item.technical_snapshot?.test_kind || item.tests_catalog?.test_kind || 'individual';
    const hasContent = Boolean(lines || cultureHtml);
    return { kind, hasContent, html: '<section class="test ' + (kind === 'panel' ? 'profile-report' : 'individual-test') + '"><h2>' + escapeHtml(item.test_name_snapshot || 'Test') + ' <small class="section-status">' + (item.status === 'completed' ? 'مكتمل' : 'غير مكتمل') + '</small></h2><table><thead><tr><th>Test / Parameter</th><th>Result</th><th>Unit</th><th>Reference Interval</th><th>Flag</th></tr></thead><tbody>' + lines + '</tbody></table>' + cultureHtml + '</section>' };
  });
  const individualHtml = testSections.filter(section => section.kind !== 'panel' && section.hasContent).map(section => section.html).join('');
  const profileSections = testSections.filter(section => section.kind === 'panel' && section.hasContent);
  const profileHtml = profileSections.map((section,index) => section.html.replace(
    'class="test profile-report"',
    'class="test profile-report' + (!individualHtml && index===0 ? ' first-profile' : '') + '"'
  )).join('');
  const groupedTestSections = (individualHtml ? '<section class="report-group individual-report"><h2>INDIVIDUAL TESTS</h2>' + individualHtml + '</section>' : '') + profileHtml;
  const historicalSections=selectedHistoricalRows.map(row=>{
    const payload=row.result_data||{},parameters=payload.parameters&&typeof payload.parameters==='object'?Object.entries(payload.parameters):[];
    const resultLines=parameters.length?parameters.map(([name,value])=>'<tr><td>'+escapeHtml(name)+'</td><td>'+escapeHtml(value)+'</td><td>'+escapeHtml(payload.unit||'')+'</td><td>'+escapeHtml(payload.reference_range||'')+'</td></tr>').join(''):'<tr><td>'+escapeHtml(row.test_name_snapshot)+'</td><td>'+escapeHtml(payload.value??payload.raw_original??JSON.stringify(payload))+'</td><td>'+escapeHtml(payload.unit||'')+'</td><td>'+escapeHtml(payload.reference_range||'')+'</td></tr>';
    return '<section class="test historical-test"><h2>نتيجة تاريخية — '+escapeHtml(row.test_name_snapshot)+' · '+escapeHtml(row.result_date)+'</h2><table><thead><tr><th>الفحص / البارامتر</th><th>النتيجة القديمة</th><th>الوحدة وقتها</th><th>المدى المرجعي وقتها</th></tr></thead><tbody>'+resultLines+'</tbody></table><small>مصدر تاريخي: '+escapeHtml(row.source_file_name||'')+' · '+escapeHtml(row.source_sheet_name||'')+' · صف '+escapeHtml(row.source_row_number||'—')+'</small></section>';
  }).join('');
  const performedAt = 'تم إجراء التحاليل بفرع: ' + (branch.name || '—');
  const showPrintHeader = print.showHeader !== false;
  const showPrintFooter = print.showFooter !== false;
  const pageTopMargin = showPrintHeader ? 36 : 12;
  const pageBottomMargin = showPrintFooter ? 24 : 12;
  const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(title) + '</title><style>' +
    '@page{size:' + paper + ' ' + orientation + ';margin:' + pageTopMargin + 'mm ' + margin + 'mm ' + pageBottomMargin + 'mm ' + margin + 'mm}' +
    'body{position:relative;font-family:Tahoma,Arial,sans-serif;color:#1d2e3a;font-size:12px;line-height:1.65;background:#fff}body>*:not(.watermark-image):not(.watermark-text){position:relative;z-index:1}.watermark-image{position:fixed;top:28%;left:0;right:0;z-index:0;text-align:center;pointer-events:none;opacity:' + watermarkOpacity + ';transform:' + (print.watermarkPosition==='diagonal'?'rotate(-28deg)':'none') + '}.watermark-image img{width:' + (print.watermarkSize==='large'?'62%':print.watermarkSize==='small'?'28%':'42%') + ';max-height:48vh;object-fit:contain}.watermark-text{position:fixed;top:42%;left:8%;right:8%;z-index:0;text-align:center;font-size:' + (print.watermarkSize==='large'?'76px':print.watermarkSize==='small'?'38px':'56px') + ';font-weight:800;color:#173f58;opacity:' + watermarkOpacity + ';transform:' + (print.watermarkPosition==='diagonal'?'rotate(-28deg)':'none') + ';pointer-events:none}header.report-header{border-bottom:2px solid #168f9a;padding:0 0 4px;margin:0;background:#fff}.report-cover-meta{margin:10px 0 14px}.report-cover-meta h1{font-size:19px;margin:4px 0;text-align:center;color:#173f58}.report-cover-meta .header-grid{display:grid;grid-template-columns:1fr 120px 1fr;align-items:center;gap:10px}.identity-zone{display:grid;gap:3px;font-size:13px}.identity-zone strong{font-size:17px;color:#173f58}.identity-zone span{color:#435864}.header-right{text-align:right}.header-left{text-align:left}.logo-zone{text-align:center}.lab-logo{max-width:110px;max-height:72px;object-fit:contain}.logo-placeholder{font-weight:800;color:#173f58;font-size:12px}h2{font-size:15px;margin:12px 0 6px;color:#173f58}.report-title{text-align:center;font-weight:700;color:#16818b;font-size:13px}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin:10px 0 10px}.meta span{padding:6px 8px;background:#f3f7f8;border-radius:5px}.report-group{margin-top:8px}.profile-report{break-before:page;page-break-before:always}.profile-report.first-profile{break-before:auto;page-break-before:auto}.test{break-inside:auto;margin:0 0 8px}.individual-report>.test{break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}h2,h3{break-after:avoid;page-break-after:avoid}.historical-test{border:2px dashed #8a6d3b;padding:8px;margin-top:18px}.historical-test h2{color:#765a27}table{width:100%;border-collapse:collapse;margin-bottom:12px;direction:ltr}th,td{border:1px solid #cbd5dc;padding:6px;text-align:left}th{background:#eaf2f4;color:#173f58}td{background:#fff}.branch-performed{font-weight:700;color:#315c66;margin-top:7px;padding:5px 0;border-top:1px solid #dce5e8;font-size:11px}.report-footer{display:grid;grid-template-columns:1fr 120px 1fr;gap:10px;border-top:1px solid #168f9a;margin-top:20px;padding-top:10px;align-items:start;font-size:10px;line-height:1.35}.footer-right,.footer-left{display:grid;gap:4px}.footer-center{text-align:center}.footer-qr{display:grid;justify-items:center;gap:3px;color:#173f58;text-decoration:none}.footer-qr img{width:76px;height:76px;object-fit:contain}.footer-center-message{font-size:11px;font-weight:700}.signature{max-width:130px;max-height:65px;object-fit:contain}.preview-controls{display:flex;gap:8px;justify-content:center;padding:10px;margin-bottom:12px}.preview-controls button{border:0;border-radius:7px;padding:8px 14px;background:#173f58;color:#fff;font:inherit;cursor:pointer}.preview-controls button+button{background:#e7f1f2;color:#173f58}.report-pages{display:block}.report-extra-footer{grid-column:1/-1;text-align:center;border-top:1px solid #e1e8eb;padding-top:4px;margin-top:4px;font-size:9px}@media print{.preview-controls{display:none}'+(showPrintHeader?'header.report-header{position:fixed;top:-29mm;left:0;right:0;z-index:2;background:#fff}':'header.report-header{position:static;top:auto;border:0;padding:0;margin-bottom:14px}')+(showPrintFooter?'.report-footer{position:fixed;bottom:-18mm;left:0;right:0;z-index:2;background:#fff}':'.report-footer{display:none}')+'.profile-report{break-before:page;page-break-before:always}.profile-report.first-profile{break-before:auto;page-break-before:auto}.report-footer{break-inside:avoid}}' +
    '</style></head><body>' + (watermarkImage ? '<div class="watermark-image"><img src="' + escapeHtml(watermarkImage) + '" alt=""></div>' : '') + (watermarkText ? '<div class="watermark-text">' + escapeHtml(watermarkText) + '</div>' : '') +
    '<div class="preview-controls">' + (canPrint ? '<button onclick="window.print()">' + (localOffline ? 'طباعة مسودة غير معتمدة' : partialReport ? 'طباعة النتائج المكتملة فقط' : 'طباعة التقرير') + '</button>' : '<button disabled>أكمل تحليلًا واحدًا على الأقل قبل الطباعة الجزئية</button>') + '<button onclick="window.close()">إغلاق المعاينة</button></div>' +
    (localOffline ? '<div style="border:2px solid #b45309;background:#fff7ed;color:#7c2d12;padding:12px;margin:10px 0;text-align:center;font-weight:800">نسخة عمل غير معتمدة — محفوظة على هذا الجهاز — تنتظر المزامنة والمراجعة والاعتماد. لا تُسلّم باعتبارها تقريرًا نهائيًا.</div>' : '') +
    (partialReport ? '<div style="border:2px solid #b45309;background:#fff7ed;color:#7c2d12;padding:12px;margin:10px 0;text-align:center;font-weight:800">تقرير جزئي — يعرض التحاليل المكتملة فقط. توجد تحاليل أخرى بالزيارة لم تكتمل بعد.</div>' : '') +
    (showPrintHeader ? '<header class="report-header"><div class="header-grid"><div class="header-right">' + headerRight + '</div><div class="logo-zone">' + centerLogo + '</div><div class="header-left">' + headerLeft + '</div></div></header>' : '') +
    '<section class="report-cover-meta"><h1>LABORATORY REPORT</h1><div class="report-title">' + escapeHtml(title) + '</div><div class="meta"><span>اسم المريض: ' + escapeHtml(patient.full_name || '—') + '</span><span>رقم الملف: ' + escapeHtml(patient.patient_number || '—') + '</span><span>رقم الزيارة: ' + escapeHtml(visit.visit_number || '—') + '</span><span>تاريخ الزيارة: ' + escapeHtml(visit.visit_work_date || '—') + '</span></div><div class="branch-performed">' + escapeHtml(performedAt) + '</div></section>' +
    '<main class="report-pages">' + groupedTestSections + historicalSections + '</main>' +
    ((signature || stamp || reviewerName) ? '<section class="report-approval" style="display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;margin:14px 0 8px">' + (signature ? '<div style="display:grid;gap:4px"><img style="max-width:130px;max-height:65px;object-fit:contain" src="' + escapeHtml(signature) + '" alt="التوقيع"><small>التوقيع</small></div>' : '') + (stamp ? '<div style="display:grid;gap:4px"><img style="max-width:100px;max-height:100px;object-fit:contain" src="' + escapeHtml(stamp) + '" alt="الختم"><small>ختم المعمل</small></div>' : '') + (reviewerName ? '<div style="display:grid;gap:4px"><strong style="border-top:1px solid #667;padding-top:4px;min-width:120px">' + escapeHtml(reviewerName) + '</strong><small>المراجع / المعتمد</small></div>' : '') + '</section>' : '') +
    (showPrintFooter ? '<footer class="report-footer" style="grid-template-columns:' + footerGridColumns + '"><div class="footer-right">' + footerAddresses + '</div>' + footerCenterMarkup + '<div class="footer-left">' + footerContacts + '</div>' + (footer ? '<div class="report-extra-footer">' + escapeHtml(footer) + '</div>' : '') + '</footer>' : '') + '</body></html>';
  const reportHtml = partialReport
    ? html.replace('<section class="report-cover-meta">','<div style="border:2px solid #b45309;background:#fff7ed;color:#7c2d12;padding:12px;margin:10px 0;text-align:center;font-weight:800">تقرير جزئي — بعض النتائج لم تصدر بعد. هذه النسخة لا تمثل اعتمادًا نهائيًا للزيارة.</div><section class="report-cover-meta">')
    : html;
  state.reportPreviewHtml.set(visitId,reportHtml);
  win.document.open(); win.document.write(reportHtml); win.document.close();
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
  if(range.age){
   if(!Number.isFinite(age))return false;
   const min=ageBoundaryInYears(range.age.min,range.age.min_unit||range.age.unit||'years');
   const max=ageBoundaryInYears(range.age.max,range.age.max_unit||range.age.unit||'years');
   if(min!=null&&age<min)return false;if(max!=null&&age>max)return false;
  }
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
 if(!['numeric_integer','numeric_decimal'].includes(input.dataset.inputMode))return null;
 return computeReferenceFlag(input.value,ranges,input.dataset.patientAge,input.dataset.patientSex,input.dataset.referenceIntervalStatus,'numeric');
}

async function saveVisitDrafts(visitId) {
  const items = state.work.filter(item => item.visit_id === visitId && item.status !== 'cancelled');
  let savedCount = 0, queuedCount = 0;
  for (const item of items) {
    if (item.status === 'completed') continue;
    const section = document.querySelector('[data-test-id="' + CSS.escape(item.id) + '"]');
    if (!section) continue;
    const inputs = [...section.querySelectorAll('[data-param-code]')];
    const dirty = inputs.filter(input =>
      input.dataset.resultSource !== 'calculated' &&
      input.value.trim() !== (input.dataset.originalValue ?? '').trim()
    );
    if (section.dataset.localPending === 'true') {
      if (dirty.length) throw new Error('هذه الزيارة بها نتائج محفوظة محليًا تنتظر المزامنة. انتظر المزامنة قبل تعديلها مرة أخرى.');
      queuedCount++;
      continue;
    }
    const clearedSaved = inputs.filter(input =>
      input.dataset.resultSource !== 'calculated' && input.dataset.resultId &&
      input.value.trim() === '' && (input.dataset.originalValue ?? '').trim() !== ''
    );
    if (clearedSaved.length) {
      throw new Error('تم مسح نتيجة محفوظة من أحد الحقول. أعد إدخالها أو استخدم مسار التصحيح الموثق قبل الحفظ.');
    }
    const results = inputs
      .filter(input => input.dataset.resultSource !== 'calculated' && input.value.trim() !== '')
      .map(input => ({
        parameter: {
          code: input.dataset.paramCode,
          name: input.dataset.paramName,
          unit: input.dataset.unit,
          valueType: input.dataset.valueType,
          inputMode: input.dataset.inputMode,
          resultConfig: JSON.parse(input.dataset.resultConfig || '{}'),
          referenceRange: JSON.parse(input.dataset.range || '{}'),
          choices: JSON.parse(input.dataset.choices || '[]')
        },
        value: input.value,
        flag: classifyResultFlag(input)
      }));
    if (!results.length || !dirty.length) continue;
    const savedRows = await saveDraftResults({
      tenantId: state.tenant.id,
      branchId: state.branch.id,
      visitTestId: item.id,
      results,
      staffId: $('staffSelect').value,
      dependsOn: item.local_intake_operation_id ? [item.local_intake_operation_id] : []
    });
    if (savedRows?.queued) {
      section.dataset.localPending = 'true';
      for (const input of inputs) if (input.value.trim() && input.dataset.resultSource !== 'calculated') {
        input.dataset.originalValue = input.value;
        input.dataset.localPending = 'true';
      }
      const pill = section.querySelector('.card-head .pill');
      if (pill) pill.textContent = 'محفوظ محليًا — بانتظار المزامنة';
      queuedCount++;
    } else {
      for (const row of savedRows || []) {
        const input = section.querySelector('[data-param-code="' + CSS.escape(row.parameter_code) + '"]');
        if (!input) continue;
        input.value = row.value_numeric ?? row.value_text ?? '';
        input.dataset.resultId = row.id;
        input.dataset.originalValue = input.value;
        delete input.dataset.localPending;
      }
      delete section.dataset.localPending;
      const pill = section.querySelector('.card-head .pill');
      if (pill) pill.textContent = 'تم حفظ النتائج';
      savedCount++;
    }
  }
  let completedTestCount = 0;
  // Complete each fully-entered test independently so urgent results can be
  // issued while the rest of the visit remains open.
  if (!queuedCount && globalThis.navigator?.onLine !== false) {
    for (const item of items) {
      if (item.status === 'completed') continue;
      const section = document.querySelector('[data-test-id="' + CSS.escape(item.id) + '"]');
      if (!section) continue;
      const inputs = [...section.querySelectorAll('[data-param-code]')];
      const hasSavedOrEnteredValue = inputs.some(input => input.dataset.resultId || input.value.trim());
      if (!hasSavedOrEnteredValue) continue;
      try {
        await completeVisitTestAtomic({
          tenantId: state.tenant.id,
          branchId: state.branch.id,
          visitTestId: item.id,
          staffId: $('staffSelect').value
        });
        item.status = 'completed';
        section.dataset.testStatus = 'completed';
        const pill = section.querySelector('.card-head .pill');
        if (pill) pill.textContent = 'مكتمل';
        completedTestCount++;
      } catch (error) {
        if (/required results are missing|required|missing|ناقص|غير مكتمل/i.test(error.message || '')) continue;
        throw error;
      }
    }
  }
  if (savedCount || queuedCount || completedTestCount) state.previewedVisits.delete(visitId); state.reportPreviewHtml.delete(visitId);
  return { savedCount, queuedCount, completedTestCount };
}
async function saveAndMaybeApproveVisit(visitId, testId = null) {
  if (!visitId) throw new Error('تعذر تحديد الزيارة.');
  const saved = await saveVisitDrafts(visitId);
  if (saved.queuedCount) {
    showNotice('تم حفظ المدخلات محليًا بأمان. الاعتماد النهائي سيتم بعد المزامنة واكتمال نتائج الزيارة.');
    return { saved: true, queued: true, completed: false };
  }
  try {
    await approveVisitWithAutoCompletion({
      tenantId: state.tenant.id,
      branchId: state.branch.id,
      visitId,
      staffId: $('staffSelect').value
    });
    state.previewedVisits.delete(visitId); state.reportPreviewHtml.delete(visitId);
    showNotice('تم حفظ النتيجة واعتماد الزيارة تلقائيًا بعد اكتمال كل النتائج المطلوبة. يمكنك معاينة التقرير الآن.');
    return { saved: true, visitApproved: true, completed: !testId || state.work.some(item => item.id === testId && item.status === 'completed') };
  } catch (error) {
    const detail = error.message || 'تعذر إكمال اعتماد الزيارة.';
    const missingRequired = /required|missing|مفقود|ناقص|غير مكتمل/i.test(detail);
    if (missingRequired) {
      const completed = state.work.filter(item => item.visit_id === visitId && item.status === 'completed').length;
      showNotice(completed
        ? 'تم حفظ النتائج وإكمال ' + completed + ' تحليل. يمكنك طباعة النتائج المكتملة الآن، والزيارة ستظل مفتوحة لاستكمال الباقي.'
        : 'تم حفظ النتائج. الزيارة ما زالت مفتوحة لحين اكتمال التحاليل المطلوبة: ' + detail);
    } else {
      showNotice('تم حفظ نتيجة التحليل، لكن تعذر اعتماد الزيارة الآن. النتائج محفوظة ولم تُفقد: ' + detail, true);
    }
    return { saved: true, visitApproved: false, completed: Boolean(testId && state.work.some(item => item.id === testId && item.status === 'completed')), approvalError: detail };
  }
}
window.taibaSaveAndMaybeApproveVisit = saveAndMaybeApproveVisit;

async function saveVisitDraftsAction(button) {
  try {
    setBusy(button, true, 'جارٍ حفظ كل النتائج…');
    const result = await saveVisitDrafts(button.dataset.visitId);
    if (!result.savedCount && !result.queuedCount) {
      showNotice('لا توجد نتائج جديدة للحفظ. أدخل القيم أولًا.');
    } else if (result.queuedCount) {
      showNotice('تم حفظ النتائج على الجهاز بأمان. ستتم مزامنتها تلقائيًا عند عودة الإنترنت؛ الاعتماد النهائي يحتاج اكتمال المزامنة.');
    } else if (result.completedTestCount) {
      showNotice('تم حفظ وإكمال ' + result.completedTestCount + ' تحليل. يمكنك طباعة النتائج المكتملة، واستكمال بقية الزيارة لاحقًا.');
      await refreshWork();
    } else {
      showNotice('تم حفظ النتائج وحساب البارامترات المشتقة تلقائيًا على السحابة. أكمل بقية النتائج ثم اعتمد الزيارة.');
      await refreshWork();
    }
  } catch (error) {
    showNotice(error.message || 'تعذر حفظ نتائج الزيارة.', true);
  } finally {
    setBusy(button, false);
  }
}
async function correctTest(button) {
  const section=button.closest('.parameter[data-test-id]');
  const isPublished=section?.dataset.published==='true';
  if(!section)return;
  if(button.dataset.correctionMode!=='true'){
    button.dataset.correctionMode='true';button.textContent='حفظ التصحيح';
    section.querySelectorAll('[data-param-code]').forEach(input=>{if(input.dataset.resultSource!=='calculated')input.disabled=false;});
    section.querySelectorAll('.multi-choice-item').forEach(input=>{input.disabled=false;});
    showNotice('وضع التصحيح مفعل. غيّر نتيجة واحدة فقط ثم اضغط حفظ التصحيح.');
    return;
  }
  try {
    requireCloudConnection('تصحيح النتائج');
    const changed=[...section.querySelectorAll('[data-param-code]')].filter(input=>input.dataset.resultId&&input.value.trim()!==''&&input.value.trim()!==(input.dataset.originalValue??'').trim());
    if(!changed.length)throw new Error('لا توجد نتيجة محفوظة تغيرت قيمتها للتصحيح.');
    if(changed.length>1)throw new Error('صحح نتيجة واحدة في كل مرة لتجنب حفظ بعض التصحيحات دون غيرها.');
    const visitId=state.work.find(row=>row.id===section.dataset.testId)?.visit_id;
    if(!visitId)throw new Error('تعذر تحديد الزيارة المرتبطة بالنتيجة.');
    const reason='تصحيح يدوي من شاشة النتائج';
    setBusy(button,true,'جارٍ حفظ التصحيح…');
    for(const input of changed){
      const raw=input.value.trim(),isNumeric=['numeric_integer','numeric_decimal'].includes(input.dataset.inputMode),numeric=isNumeric?raw:null,text=isNumeric?null:raw;
      await correctVisitResultWithFlag({tenantId:state.tenant.id,branchId:state.branch.id,visitTestId:section.dataset.testId,resultId:input.dataset.resultId,valueNumeric:numeric,valueText:text,flag:classifyResultFlag(input),reason,staffId:$('staffSelect').value});
      input.dataset.originalValue=input.value;
    }
    state.previewedVisits.delete(visitId); state.reportPreviewHtml.delete(visitId);
    section.querySelectorAll('[data-param-code]').forEach(input=>{if(input.dataset.resultSource!=='calculated')input.disabled=true;});
    section.querySelectorAll('.multi-choice-item').forEach(input=>{input.disabled=true;});
    button.dataset.correctionMode='false';button.textContent=isPublished?'تصحيح نتيجة منشورة':'تصحيح نتيجة محفوظة';button.dataset.oldLabel=button.textContent;
    showNotice(isPublished?'تم تصحيح النتيجة. النسخة المنشورة السابقة محفوظة؛ راجع المعاينة ثم ارفع النسخة المصححة.':'تم تصحيح النتيجة، وسُجل اسم المستخدم تلقائيًا.');
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
    requireCloudConnection('رفع المرفق');
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
    requireCloudConnection('فتح المرفق');
    setBusy(button,true,'جارٍ تجهيز الرابط…');
    const url=await createAttachmentDownloadUrl({tenantId:state.tenant.id,branchId:state.branch.id,fileId:button.dataset.fileId,expiresIn:90});
    window.open(url,'_blank','noopener');
  } catch(error) { showNotice(error.message||'تعذر فتح المرفق.',true); }
  finally { setBusy(button,false); }
}

async function markWorkCopyDelivered(button) {
  const visitId=button.dataset.visitId;
  if(!visitId||!confirm('تسجيل تسليم نسخة عمل مطبوعة للمريض؟ هذا الإجراء لا يعني اعتمادًا نهائيًا أو نشرًا على بوابة المريض.'))return;
  try{
    setBusy(button,true,'جارٍ تسجيل التسليم…');
    const result=await recordLocalWorkCopyDelivery({tenantId:state.tenant.id,branchId:state.branch.id,visitId,staffId:$('staffSelect').value});
    showNotice(result?.queued?'تم تسجيل تسليم نسخة العمل محليًا؛ ستتم مزامنة سجل التسليم عند عودة الإنترنت.':'تم تسجيل تسليم النسخة المطبوعة في سجل المعمل.');
    await refreshWork();
  }catch(error){showNotice(error.message||'تعذر تسجيل التسليم.',true);}
  finally{setBusy(button,false);}
}

async function approve(button) {
  const visitId = button.dataset.visitId;
  try {
    if (!visitId) throw new Error('تعذر تحديد الزيارة المراد اعتمادها.');
    const dirtyOutside = window.taibaGetDirtyResultInputs?.().filter(input =>
      input.closest('.parameter[data-visit-id]')?.dataset.visitId !== visitId
    ) || [];
    if (dirtyOutside.length) throw new Error('هناك نتيجة غير محفوظة في زيارة أخرى. احفظها أولًا حتى لا تختلط الحالات.');

    setBusy(button, true, 'جارٍ حفظ واعتماد الزيارة…');
    const saved = await saveVisitDrafts(visitId);
    const approval = await approveVisitWithAutoCompletion({
      tenantId: state.tenant.id,
      branchId: state.branch.id,
      visitId,
      staffId: $('staffSelect').value
    });
    state.previewedVisits.delete(visitId); state.reportPreviewHtml.delete(visitId);
    if (approval?.queued) {
      showNotice('هناك نتائج محلية لم تصل إلى السحابة بعد. تم تسجيل الاعتماد المحلي وحفظه على هذا الجهاز؛ سيُراجع الخادم النتائج والصلاحيات بعد المزامنة. هذا ليس اعتمادًا نهائيًا ولا ينشر التقرير للمريض.');
      await refreshWork();
      return;
    }
    showNotice('تم حفظ النتائج واعتماد الزيارة بالكامل. يمكنك الآن معاينة التقرير وطباعته، والنشر النهائي يظل خطوة منفصلة.');
    await refreshWork();
  } catch (error) {
    if (/required|missing|ناقص|غير مكتمل/i.test(error.message || '')) {
      const completed = state.work.filter(item => item.visit_id === visitId && item.status === 'completed').length;
      showNotice(completed
        ? 'اكتمل ' + completed + ' تحليل. الزيارة ما زالت مفتوحة، ويمكن طباعة النتائج المكتملة فقط.'
        : 'الزيارة لم تكتمل بعد. أكمل نتائج التحاليل المطلوبة أولًا.');
      await refreshWork();
    } else {
      showNotice(error.message || 'تعذر حفظ واعتماد الزيارة.', true);
    }
  } finally {
    setBusy(button, false);
  }
}
async function publish(button) {
  let reportWindow=null;
  const partial=button.dataset.partial==='true';
  try {
    requireCloudConnection('نشر التقرير');
    if(window.taibaGetDirtyResultInputs?.().length)throw new Error('احفظ النتائج التي أدخلتها قبل نشر التقرير.');
    const visitId=button.dataset.visitId;
    const visitState=state.work.find(item=>item.visit_id===visitId)?.visits;
    if(!visitState)throw new Error('تعذر تحديد الزيارة المراد نشرها.');
    if(partial && visitState.is_published)throw new Error('الزيارة منشورة نهائيًا بالفعل؛ استخدم مسار تصحيح التقرير.');
    if(!partial && visitState.status!=='approved'&&!visitState.is_published)throw new Error('اعتمد الزيارة بالكامل قبل نشر التقرير.');
    if(!state.previewedVisits.has(visitId))throw new Error('افتح معاينة نتائج الزيارة وراجع التقرير قبل النشر.');
    const reportHtml=state.reportPreviewHtml.get(visitId);
    if(!reportHtml)throw new Error('معاينة التقرير غير موجودة في الذاكرة. افتح المعاينة مرة أخرى ثم أعد النشر.');
    setBusy(button,true,'جارٍ إنشاء PDF والنشر…');
    reportWindow=window.open('','_blank');
    if(!reportWindow)throw new Error('اسمح بفتح نافذة مؤقتة لإنشاء نسخة التقرير PDF.');
    reportWindow.document.open();
    reportWindow.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;padding:24px">جارٍ تجهيز التقرير النهائي…</body></html>');
    reportWindow.document.close();

    const allVisitItems=await listVisitWorkForReport({tenantId:state.tenant.id,branchId:state.branch.id,visitId});
    if(!allVisitItems.length)throw new Error('لا توجد تحاليل مرتبطة بهذه الزيارة.');
    if(partial){
      const savedResults=await listResultsForVisitTests({tenantId:state.tenant.id,visitTestIds:allVisitItems.map(item=>item.id)});
      if(!savedResults.length)throw new Error('احفظ نتيجة واحدة على الأقل قبل نشر التقرير الجزئي.');
    }else if(allVisitItems.some(item=>item.status!=='completed'))throw new Error('لا يمكن نشر التقرير النهائي قبل اكتمال جميع التحاليل.');
    const isCorrection=allVisitItems[0]?.visits?.is_published||state.work.some(item=>item.visit_id===visitId&&item.visits?.is_published);
    const reason=isCorrection?'إصدار نسخة محدثة بعد تصحيح نتيجة':'';

    reportWindow.document.open();reportWindow.document.write(reportHtml);reportWindow.document.close();
    await reportWindow.document.fonts?.ready;
    await Promise.all([...reportWindow.document.images].map(img=>img.decode?.().catch(()=>null)));
    await new Promise(resolve=>setTimeout(resolve,180));
    await ensureHtml2Pdf();
    const pdfBlob=await window.html2pdf().set({
      margin:0,
      filename:`taiba-report-${visitId}.pdf`,
      image:{type:'jpeg',quality:0.98},
      html2canvas:{scale:2,useCORS:true,allowTaint:false,backgroundColor:'#ffffff',scrollY:0},
      jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},
      pagebreak:{mode:['css','legacy']}
    }).from(reportWindow.document.body).outputPdf('blob');
    if(!(pdfBlob instanceof Blob)||pdfBlob.size<1000)throw new Error('تعذر إنشاء ملف PDF صالح من معاينة التقرير.');
    const file=new File([pdfBlob],`taiba-report-${visitId}.pdf`,{type:'application/pdf'});
    await publishReportVersion({tenantId:state.tenant.id,branchId:state.branch.id,visitId,staffId:$('staffSelect').value,file,changeReason:reason,isPartial:partial});
    if(partial)state.partialPublishedVisits.add(visitId);else state.partialPublishedVisits.delete(visitId);
    state.previewedVisits.delete(visitId); state.reportPreviewHtml.delete(visitId);
    showNotice(partial?'تم نشر التقرير الجزئي على بوابة المريض. الزيارة ما زالت مفتوحة وغير معتمدة.':'تم إنشاء PDF من نفس معاينة التقرير ورفعه تلقائيًا إلى بوابة المريض.');
    try{await refreshWork();}catch(error){showNotice('تم نشر التقرير بنجاح، لكن تعذر تحديث قائمة النتائج تلقائيًا.',true);}
  } catch(error) {
    showNotice(error.message||'تعذر إنشاء التقرير أو نشره.',true);
  } finally {
    if(reportWindow&&!reportWindow.closed)reportWindow.close();
    setBusy(button,false);
  }
}

async function sharePartialReport(button){
  const card=button.closest('.work-card');
  const phone=String(card?.dataset.patientPhone||'').replace(/\D/g,'');
  const patientName=String(card?.dataset.patientName||'').trim();
  const visitNumber=String(card?.dataset.visitNumber||'').trim();
  if(!phone||!patientName||!visitNumber){showNotice('رقم الهاتف أو بيانات الزيارة غير مكتملة لإرسال واتساب.',true);return;}
  let whatsappNumber=phone;
  if(whatsappNumber.startsWith('0'))whatsappNumber='20'+whatsappNumber.slice(1);
  else if(whatsappNumber.startsWith('1')&&whatsappNumber.length===10)whatsappNumber='20'+whatsappNumber;
  if(whatsappNumber.length<10){showNotice('رقم الهاتف غير صالح لإرسال واتساب.',true);return;}
  const portalUrl=new URL('../portal/',globalThis.location.href);
  portalUrl.searchParams.set('lab',state.tenant.slug);
  const message='تم إصدار تقرير جزئي من '+(state.tenant.name||'المعمل')+'، وبعض النتائج لم تصدر بعد.\nاسم المريض: '+patientName+'\nرقم الزيارة: '+visitNumber+'\nللاطلاع على التقرير، افتح بوابة النتائج وأدخل الاسم ورقم الزيارة:\n'+portalUrl.href;
  const url='https://wa.me/'+whatsappNumber+'?text='+encodeURIComponent(message);
  window.open(url,'_blank','noopener,noreferrer');
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
window.taibaApproveVisit = (visitId, button) => {
  const control = button || document.createElement('button');
  control.dataset.visitId = visitId;
  if (!control.textContent) control.textContent = 'حفظ النتائج واعتماد الزيارة';
  return approve(control);
};
window.taibaSaveVisitDrafts = (visitId, button) => {
  const control = button || document.createElement('button');
  control.dataset.visitId = visitId;
  if (!control.textContent) control.textContent = 'حفظ كل النتائج';
  return saveVisitDraftsAction(control);
};

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
