import { signInWithEmail, getCurrentSession, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { getOutboxSummary, listOpenConflicts, retryConflictOperation, retryFailedOperations, syncOutbox } from '../../offline/outbox.js';
import { createSupabaseSyncHandlers } from '../../offline/supabase-adapters.js';
import { exportLocalBackup, restoreLocalBackup } from '../../offline/backup.js';
import { getOfflineStorageHealth, requestPersistentOfflineStorage } from '../../offline/database.js';
import { prepareOfflineBranch, getOfflinePreparationStatus } from '../../offline/prepare.js';
import { getOfflineEntitlementStatus, refreshOfflineEntitlement } from '../../offline/entitlement.js';
import { listPendingCatalogChanges, resolveCatalogChangeProposal } from '../../modules/catalog/repository.js';

const $ = id => document.getElementById(id);
const state = { context: null, tenant: null, branch: null, syncing: false, preparing: false, refreshingEntitlement: false };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function catalogProposalFields(record={}) {
  const fields = [
    ['الكود', record.code || record.parameter_code], ['الاسم', record.name || record.parameter_name],
    ['نوع التحليل/النتيجة', record.test_kind || record.result_input_mode || record.value_type],
    ['العينة', record.specimen], ['الوحدة', record.unit], ['التصنيف', record.category],
    ['المديات المرجعية', record.reference_ranges], ['الاختيارات', record.choices],
    ['المعادلة', record.formula_expression], ['الحالة', typeof record.is_active === 'boolean' ? (record.is_active ? 'مفعّل' : 'موقوف') : null],
  ].filter(([,value]) => value !== null && value !== undefined && value !== '');
  if (!fields.length) return '<p class="muted">لا يوجد سجل سابق على الخادم.</p>';
  return '<dl class="catalog-review-fields">' + fields.map(([label,value]) => '<div><dt>'+esc(label)+'</dt><dd>'+esc(typeof value === 'object' ? JSON.stringify(value) : value)+'</dd></div>').join('') + '</dl>';
}

const entityLabel = type => ({visit_approval:'اعتماد محلي بانتظار التحقق',report_delivery:'تسليم نسخة عمل',catalog_change:'تعديل كتالوج',workday_open:'فتح يوم عمل',workday_close:'إغلاق يوم عمل',draft_results:'حفظ نتائج',visit_intake:'تسجيل زيارة',payment:'تحصيل',expense:'مصروف',patient:'تسجيل مريض'}[type]||type);
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = `notice show${error ? ' error' : ''}`; clearTimeout(notice.timer); notice.timer = setTimeout(() => $('notice').className = 'notice', 6500); }
function updateConnection() { const online = navigator.onLine; $('connection').textContent = online ? 'متصل بالإنترنت' : 'غير متصل'; $('connection').className = `badge ${online ? 'online' : 'offline'}`; $('syncNow').disabled = !online || state.syncing || state.preparing || !state.branch; $('prepareOffline').disabled = !online || state.syncing || state.preparing || !state.branch; $('refreshOfflineEntitlement').disabled = !online || state.refreshingEntitlement || !state.branch; }
function formatBytes(value) { if (!Number.isFinite(value)) return 'غير متاح'; const units = ['بايت','KB','MB','GB']; let size = value, index = 0; while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; } return `${size.toFixed(index ? 1 : 0)} ${units[index]}`; }
async function refreshStorageHealth() {
  const health = await getOfflineStorageHealth();
  const remaining = health.remaining === null ? 'المساحة المتبقية غير متاحة' : `المتاح تقريبًا: ${formatBytes(health.remaining)}`;
  const usage = health.usage === null ? '' : ` · المستخدم: ${formatBytes(health.usage)}`;
  if (health.persistent) $('storageHealth').textContent = `التخزين الدائم ممنوح من المتصفح. ${remaining}${usage}`;
  else if (health.supported) $('storageHealth').textContent = `التخزين الدائم لم يُمنح بعد. اطلب الحماية من المتصفح قبل الاعتماد الطويل على الأوف لاين. ${remaining}${usage}`;
  else $('storageHealth').textContent = `هذا المتصفح لا يتيح طلب التخزين الدائم. احتفظ بنسخ احتياطية محلية منتظمة. ${remaining}${usage}`;
  $('protectStorage').disabled = !health.supported || health.persistent;
}
async function refreshEntitlementStatus() {
  if (!state.tenant || !state.branch) return;
  const status = await getOfflineEntitlementStatus({ tenantId: state.tenant.id, branchId: state.branch.id });
  if (status.status === 'key-not-configured') $('offlineEntitlementStatus').textContent = 'مفتاح التحقق العام غير مضاف بعد؛ لم يتم تفعيل الترخيص المحلي.';
  else if (status.status === 'missing') $('offlineEntitlementStatus').textContent = 'لا يوجد ترخيص أوف لاين محفوظ لهذا الفرع على هذا الجهاز. جهّز الترخيص أثناء الاتصال.';
  else if (status.status === 'valid') $('offlineEntitlementStatus').textContent = `الترخيص ساري حتى ${new Date(status.expiresAt).toLocaleString('ar-EG')} · متبقي ${status.daysRemaining} يوم.`;
  else if (status.status === 'expired') $('offlineEntitlementStatus').textContent = 'انتهت صلاحية الترخيص. السجلات والتصدير والمزامنة المعلقة تظل متاحة، لكن العمليات الجديدة تحتاج تجديدًا.';
  else $('offlineEntitlementStatus').textContent = `تعذر التحقق من الترخيص: ${status.message || 'توقيع أو نطاق غير صالح'}`;
}
async function renewOfflineEntitlement() {
  if (!state.tenant || !state.branch || state.refreshingEntitlement) return;
  if (!navigator.onLine) { notice('تجديد الترخيص يحتاج اتصالًا بالإنترنت.', true); return; }
  state.refreshingEntitlement = true; updateConnection();
  try {
    await refreshOfflineEntitlement({ tenantId: state.tenant.id, branchId: state.branch.id, force: true });
    await refreshEntitlementStatus();
    notice('تم إصدار الترخيص الموقّع لهذا الفرع والجهاز والتحقق منه محليًا.');
  } catch (error) {
    await refreshEntitlementStatus().catch(() => {});
    notice(error.message || 'تعذر تجديد الترخيص الإلكتروني.', true);
  } finally { state.refreshingEntitlement = false; updateConnection(); }
}
async function refreshPreparationStatus() {
  if (!state.tenant || !state.branch) return;
  const report = await getOfflinePreparationStatus({ tenantId: state.tenant.id, branchId: state.branch.id });
  if (!report) {
    $('offlinePreparationStatus').textContent = 'لم تتم تهيئة هذا الفرع على هذا الجهاز بعد. نفّذ التهيئة أثناء الاتصال قبل فصل الإنترنت.';
    return;
  }
  const when = report.prepared_at ? new Date(report.prepared_at).toLocaleString('ar-EG') : 'وقت غير متاح';
  const counts = report.counts || {};
  const limit = report.truncated?.patient_directory || report.truncated?.worklist || report.truncated?.financial_ledger
    ? ' · توجد بيانات تجاوزت حد التحميل الموضح أدناه' : '';
  const issues = Array.isArray(report.issues) && report.issues.length ? ` · غير جاهز: ${report.issues.join('؛ ')}` : ' · جاهز للعمل دون اتصال حسب البيانات المحفوظة';
  const warnings = Array.isArray(report.warnings) && report.warnings.length ? ` · تنبيه: ${report.warnings.join('؛ ')}` : '';
  $('offlinePreparationStatus').textContent = `آخر تهيئة: ${when} · المرضى: ${counts.patients ?? 0}/${counts.patients_available ?? counts.patients ?? 0} · التحاليل: ${counts.catalog_tests ?? 0} · تحاليل بسعر صفري تشغيلي: ${counts.tests_without_current_price ?? 0} · بارامترات: ${counts.parameters ?? 0} · عناصر قائمة العمل: ${counts.worklist ?? 0}/${counts.worklist_available ?? counts.worklist ?? 0} · النتائج: ${counts.results ?? 0} · حركة مالية الشهر: ${counts.financial_ledger ?? 0}/${counts.financial_ledger_available ?? counts.financial_ledger ?? 0}${limit}${issues}${warnings}`;
}
async function runOfflinePreparation() {
  if (!state.tenant || !state.branch || state.preparing) return;
  if (!navigator.onLine) { notice('تهيئة البيانات تحتاج اتصالًا بالإنترنت.', true); return; }
  state.preparing = true; updateConnection();
  $('offlinePreparationStatus').textContent = 'بدأ تجهيز بيانات الفرع…';
  try {
    const report = await prepareOfflineBranch({
      tenantId: state.tenant.id,
      branchId: state.branch.id,
      onProgress: progress => { $('offlinePreparationStatus').textContent = progress.detail || progress.step; },
    });
    await refreshPreparationStatus();
    await refresh();
    notice(report.complete
      ? (report.warnings?.length ? 'اكتملت تهيئة بيانات التشغيل. توجد تنبيهات على اكتمال ملخص الداشبورد المحلي؛ راجع الحالة.' : 'اكتملت تهيئة البيانات الأساسية لهذا الفرع على الجهاز.')
      : 'اكتملت التهيئة، لكن بعض البيانات الأساسية تجاوزت حد التحميل أو الترخيص غير جاهز. راجع حالة التهيئة.');
  } catch (error) {
    notice(error.message || 'تعذرت تهيئة بيانات الأوف لاين.', true);
    await refreshPreparationStatus().catch(() => {});
  } finally {
    state.preparing = false; updateConnection();
  }
}
async function protectOfflineStorage() {
  try {
    const health = await requestPersistentOfflineStorage();
    await refreshStorageHealth();
    notice(health.persistent ? 'المتصفح منح التخزين الدائم لهذا الموقع.' : 'المتصفح لم يمنح التخزين الدائم. احتفظ بنسخة احتياطية محلية منتظمة.', !health.persistent);
  } catch (error) { notice(error.message || 'تعذر فحص حماية التخزين.', true); }
}
async function start() {
  const session = await getCurrentSession();
  if (!session) { $('loginPanel').hidden = false; $('workspace').hidden = true; $('signOut').hidden = true; return; }
  state.context = await loadMyTenantContext();
  await refreshStorageHealth();
  if (!state.context.tenants?.length) throw new Error('الحساب لا يملك معملًا نشطًا.');
  $('loginPanel').hidden = true; $('workspace').hidden = false; $('signOut').hidden = false;
  $('tenantSelect').innerHTML = state.context.tenants.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  $('tenantSelect').onchange = () => selectTenant($('tenantSelect').value);
  const preferredTenantId = getPreferredTenantId(state.context.tenants);
  $('tenantSelect').value = preferredTenantId || '';
  await selectTenant(preferredTenantId);
}
async function selectTenant(id) {
  state.tenant = state.context.tenants.find(t => t.id === id);
  if (!state.tenant) return;
  rememberWorkspaceSelection(state.tenant.id);
  $('branchSelect').innerHTML = (state.tenant?.branches || []).map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  $('branchSelect').onchange = () => selectBranch($('branchSelect').value);
  if (!state.tenant?.branches?.length) { state.branch = null; await refresh(); return; }
  const preferredBranchId = getPreferredBranchId(state.tenant.id, state.tenant.branches);
  $('branchSelect').value = preferredBranchId || '';
  await selectBranch(preferredBranchId);
}
async function selectBranch(id) { state.branch = state.tenant?.branches.find(b => b.id === id) || null; if(state.branch)rememberWorkspaceSelection(state.tenant.id,state.branch.id); await refresh(); }
async function refresh() {
  updateConnection();
  if (!state.tenant || !state.branch) { $('syncMessage').textContent = 'لا يوجد فرع متاح لهذا الحساب.'; return; }
  const [summary, conflicts, catalogChanges] = await Promise.all([
    getOutboxSummary({ tenantId: state.tenant.id, branchId: state.branch.id }),
    listOpenConflicts({ tenantId: state.tenant.id, branchId: state.branch.id }),
    navigator.onLine ? listPendingCatalogChanges({ tenantId: state.tenant.id, branchId: state.branch.id }).catch(() => []) : Promise.resolve([]),
  ]);
  $('pending').textContent = summary.pending; $('syncing').textContent = summary.syncing;
  $('failed').textContent = summary.failed; $('conflict').textContent = summary.conflict;
  $('conflicts').innerHTML = conflicts.length ? conflicts.map(c => {
    const local = esc(JSON.stringify(c.local_payload ?? {}, null, 2));
    const server = c.server_snapshot == null ? 'لم تُرجع الخادم لقطة مقارنة لهذه العملية.' : esc(JSON.stringify(c.server_snapshot, null, 2));
    return `<div class="item"><strong>${esc(entityLabel(c.entity_type))} · ${esc(c.reason)}</strong><small>رقم العملية: ${esc(c.operation_id)} · ${new Date(c.created_at).toLocaleString('ar-EG')}</small><details><summary>مراجعة تفاصيل التعارض</summary><h4>البيانات المحلية المحفوظة</h4><pre>${local}</pre><h4>لقطة الخادم</h4><pre>${server}</pre></details><button class="btn quiet-dark" type="button" data-retry-conflict="${esc(c.conflict_id)}" ${!navigator.onLine || state.syncing ? 'disabled' : ''}>إعادة المحاولة بنفس رقم العملية</button></div>`;
  }).join('') : '<p class="muted">لا توجد تعارضات مفتوحة.</p>';
  $('conflicts').querySelectorAll('[data-retry-conflict]').forEach(button => button.addEventListener('click', () => retryConflict(button.dataset.retryConflict)));
  $('catalogChanges').innerHTML = catalogChanges.length ? catalogChanges.map(change => {
    const local = change.local_payload || {};
    const record = local.record_payload || {};
    const label = change.entity_type === 'catalog_test_change' ? 'تعديل تحليل' : 'تعديل بارامتر';
    const deviceLabel = local.device_id ? String(local.device_id).slice(0,8) : 'غير معروف';
    const name = record.name || record.parameter_name || record.code || record.parameter_code || change.entity_id;
    const server = catalogProposalFields(change.resolution_payload?.server_snapshot || change.server_payload || {});
    const proposed = catalogProposalFields(record);
    return `<div class="item"><strong>${esc(label)} · ${esc(name)}</strong><small>الجهاز/العملية: ${esc(change.operation_id)} · ${new Date(change.created_at).toLocaleString('ar-EG')}</small><details><summary>مقارنة النسخة المقترحة ونسخة الخادم</summary><h4>التعديل المقترح</h4><pre>${proposed}</pre><h4>نسخة الخادم وقت المزامنة</h4><pre>${server}</pre></details><div class="actions"><button class="btn" type="button" data-approve-catalog-change="${esc(change.id)}" ${!navigator.onLine || state.syncing ? 'disabled' : ''}>اعتماد التعديل</button><button class="btn quiet-dark" type="button" data-reject-catalog-change="${esc(change.id)}" ${!navigator.onLine || state.syncing ? 'disabled' : ''}>رفض مع الاحتفاظ بالسجل</button></div></div>`;
  }).join('') : '<p class="muted">لا توجد تعديلات كتالوج معلقة للمراجعة.</p>';
  $('catalogChanges').querySelectorAll('[data-approve-catalog-change]').forEach(button => button.addEventListener('click', () => resolveCatalogProposal(button.dataset.approveCatalogChange, 'approve')));
  $('catalogChanges').querySelectorAll('[data-reject-catalog-change]').forEach(button => button.addEventListener('click', () => resolveCatalogProposal(button.dataset.rejectCatalogChange, 'reject')));

  if (!summary.total) $('syncMessage').textContent = 'لا توجد عمليات محلية معلقة لهذا الفرع.';
  else $('syncMessage').textContent = `إجمالي العمليات المحلية: ${summary.total}. لا تُحذف أي عملية إلا بعد تأكيد الخادم.`;
  await refreshEntitlementStatus();
  await refreshPreparationStatus();
}

async function resolveCatalogProposal(proposalId, decision) {
  if (!navigator.onLine) { notice('مراجعة تعديلات الكتالوج تحتاج اتصالًا بالإنترنت.', true); return; }
  if (state.syncing || !state.tenant || !state.branch) return;
  try {
    const result = await resolveCatalogChangeProposal({ tenantId: state.tenant.id, branchId: state.branch.id, proposalId, decision });
    if (result.status === 'conflict') {
      notice(result.reason || 'اكتُشف تعارض؛ لم يتم استبدال نسخة الخادم.', true);
    } else if (result.status === 'approved') {
      notice('تم اعتماد التعديل. ستتم إعادة مزامنة الجهاز الذي أرسله بنفس رقم العملية.');
      const open = await listOpenConflicts({ tenantId: state.tenant.id, branchId: state.branch.id });
      const local = open.find(item => item.operation_id === proposalId);
      if (local) {
        await retryConflictOperation({ tenantId: state.tenant.id, branchId: state.branch.id, conflictId: local.conflict_id });
        await runSync();
      }
    } else {
      notice('تم رفض التعديل مع الاحتفاظ بنسخته في سجل المراجعة.');
    }
    await refresh();
  } catch (error) { notice(error.message || 'تعذرت مراجعة تعديل الكتالوج.', true); }
}

async function runSync() {
  if (state.syncing || !state.branch) return;
  if (!navigator.onLine) { notice('لا يوجد اتصال بالإنترنت. العمليات محفوظة محليًا.', true); return; }
  state.syncing = true; updateConnection(); $('syncMessage').textContent = 'جارٍ إرسال العمليات بالترتيب، مع انتظار تأكيد الخادم…';
  try {
    const report = await syncOutbox({ handlers: createSupabaseSyncHandlers(), tenantId: state.tenant?.id, branchId: state.branch?.id, onProgress: p => { $('syncMessage').textContent = `تم تأكيد ${p.acknowledged} · أخطاء مؤقتة ${p.retained} · بانتظار عملية سابقة ${p.blocked} · تعارضات ${p.conflicts}`; } });
    await refresh();
    notice(`انتهت المزامنة: ${report.acknowledged} تم تأكيدها، ${report.retained} أخطاء مؤقتة، ${report.blocked} تنتظر عملية مرتبطة، ${report.conflicts} تعارضات.`);
  } catch (e) { notice(e.message || 'تعذرت المزامنة.', true); }
  finally { state.syncing = false; updateConnection(); await refresh(); }
}
async function retryConflict(conflictId) {
  if (!navigator.onLine) { notice('لا يوجد اتصال بالإنترنت. لم نغيّر حالة العملية.', true); return; }
  if (state.syncing || !state.tenant || !state.branch) return;
  try {
    const operationId = await retryConflictOperation({ tenantId: state.tenant.id, branchId: state.branch.id, conflictId });
    notice(`أعدنا العملية ${operationId} إلى قائمة المزامنة بنفس رقمها الآمن. إذا لم تُعالج المشكلة الأصلية فقد يظهر التعارض مرة أخرى.`);
    await runSync();
  } catch (e) { notice(e.message || 'تعذرت إعادة محاولة العملية.', true); }
}
async function exportBackup() {
  if (!state.branch) return;
  try {
    const document = await exportLocalBackup({ tenantId: state.tenant.id, branchId: state.branch.id, tenantName: state.tenant.name, branchName: state.branch.name });
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = documentCreateLink(url, `taiba-local-${state.branch.id}-${new Date().toISOString().slice(0,10)}.json`); a.click(); URL.revokeObjectURL(url);
    notice('تم إنشاء نسخة محلية لهذا الجهاز تشمل سجلاته التشغيلية والأرشيف التاريخي المحفوظ للمعمل. احتفظ بها في مكان آمن.');
  } catch (e) { notice(e.message || 'تعذر إنشاء النسخة المحلية.', true); }
}
function documentCreateLink(url, filename) { const a = document.createElement('a'); a.href = url; a.download = filename; return a; }
async function importBackup(file) {
  if (!file || !state.branch) return;
  if (!confirm('سيتم دمج سجلات النسخة داخل التخزين المحلي لهذا الجهاز فقط. لن يتم رفعها للسحابة تلقائيًا. هل تريد المتابعة؟')) return;
  try {
    const document = JSON.parse(await file.text());
    const result = await restoreLocalBackup(document, { tenantId: state.tenant.id, branchId: state.branch.id });
    notice(`تمت الاستعادة المحلية: ${result.restoredRows} سجلًا عبر ${result.restoredTables} جداول. الأرشيف التاريخي: ${result.historicalWorkbooksRestored||0} ملف مستعاد، ${result.historicalWorkbooksSkipped||0} ملف محفوظ مسبقًا.`);
    await refresh();
  } catch (e) { notice(e.message || 'فشلت الاستعادة. لم يتم اعتماد الملف.', true); }
  finally { $('backupFile').value = ''; }
}
$('loginForm').addEventListener('submit', async e => { e.preventDefault(); try { await signInWithEmail($('email').value, $('password').value); await start(); } catch (err) { notice(err.message || 'تعذر تسجيل الدخول.', true); } });
$('signOut').addEventListener('click', async () => { try { await signOut(); await start(); } catch (e) { notice(e.message, true); } });
$('syncNow').addEventListener('click', runSync); $('refresh').addEventListener('click', () => refresh().catch(e => notice(e.message, true)));
$('retryFailed').addEventListener('click', async () => { try { const count = await retryFailedOperations({ tenantId: state.tenant?.id, branchId: state.branch?.id }); notice(`تمت إعادة ${count} عملية إلى قائمة الانتظار.`); await refresh(); } catch (e) { notice(e.message, true); } });
$('exportBackup').addEventListener('click', exportBackup); $('backupFile').addEventListener('change', e => importBackup(e.target.files?.[0]));
$('protectStorage').addEventListener('click', protectOfflineStorage); $('prepareOffline').addEventListener('click', runOfflinePreparation); $('refreshOfflineEntitlement').addEventListener('click', renewOfflineEntitlement);
window.addEventListener('online', () => { updateConnection(); runSync(); }); window.addEventListener('offline', updateConnection);
try { await start(); updateConnection(); if (navigator.onLine) runSync(); } catch (e) { notice(e.message || 'تعذر تهيئة مركز المزامنة.', true); }
