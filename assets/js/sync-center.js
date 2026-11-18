import { signInWithEmail, getCurrentSession, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { getOutboxSummary, listOpenConflicts, retryFailedOperations, syncOutbox } from '../../offline/outbox.js';
import { createSupabaseSyncHandlers } from '../../offline/supabase-adapters.js';
import { exportLocalBackup, restoreLocalBackup } from '../../offline/backup.js';

const $ = id => document.getElementById(id);
const state = { context: null, tenant: null, branch: null, syncing: false };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = `notice show${error ? ' error' : ''}`; clearTimeout(notice.timer); notice.timer = setTimeout(() => $('notice').className = 'notice', 6500); }
function updateConnection() { const online = navigator.onLine; $('connection').textContent = online ? 'متصل بالإنترنت' : 'غير متصل'; $('connection').className = `badge ${online ? 'online' : 'offline'}`; $('syncNow').disabled = !online || state.syncing || !state.branch; }
async function start() {
  const session = await getCurrentSession();
  if (!session) { $('loginPanel').hidden = false; $('workspace').hidden = true; $('signOut').hidden = true; return; }
  state.context = await loadMyTenantContext();
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
  const [summary, conflicts] = await Promise.all([
    getOutboxSummary({ tenantId: state.tenant.id, branchId: state.branch.id }),
    listOpenConflicts({ tenantId: state.tenant.id, branchId: state.branch.id }),
  ]);
  $('pending').textContent = summary.pending; $('syncing').textContent = summary.syncing;
  $('failed').textContent = summary.failed; $('conflict').textContent = summary.conflict;
  $('conflicts').innerHTML = conflicts.length ? conflicts.map(c => `<div class="item"><strong>${esc(c.entity_type)} · ${esc(c.reason)}</strong><small>رقم العملية: ${esc(c.operation_id)} · ${new Date(c.created_at).toLocaleString('ar-EG')}</small></div>`).join('') : '<p class="muted">لا توجد تعارضات مفتوحة.</p>';
  if (!summary.total) $('syncMessage').textContent = 'لا توجد عمليات محلية معلقة لهذا الفرع.';
  else $('syncMessage').textContent = `إجمالي العمليات المحلية: ${summary.total}. لا تُحذف أي عملية إلا بعد تأكيد الخادم.`;
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
async function exportBackup() {
  if (!state.branch) return;
  try {
    const document = await exportLocalBackup({ tenantId: state.tenant.id, branchId: state.branch.id, tenantName: state.tenant.name, branchName: state.branch.name });
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = documentCreateLink(url, `taiba-local-${state.branch.id}-${new Date().toISOString().slice(0,10)}.json`); a.click(); URL.revokeObjectURL(url);
    notice('تم إنشاء نسخة محلية لهذا الجهاز. احتفظ بها في مكان آمن.');
  } catch (e) { notice(e.message || 'تعذر إنشاء النسخة المحلية.', true); }
}
function documentCreateLink(url, filename) { const a = document.createElement('a'); a.href = url; a.download = filename; return a; }
async function importBackup(file) {
  if (!file || !state.branch) return;
  if (!confirm('سيتم دمج سجلات النسخة داخل التخزين المحلي لهذا الجهاز فقط. لن يتم رفعها للسحابة تلقائيًا. هل تريد المتابعة؟')) return;
  try {
    const document = JSON.parse(await file.text());
    const result = await restoreLocalBackup(document, { tenantId: state.tenant.id, branchId: state.branch.id });
    notice(`تمت الاستعادة المحلية: ${result.restoredRows} سجلًا عبر ${result.restoredTables} جداول.`);
    await refresh();
  } catch (e) { notice(e.message || 'فشلت الاستعادة. لم يتم اعتماد الملف.', true); }
  finally { $('backupFile').value = ''; }
}
$('loginForm').addEventListener('submit', async e => { e.preventDefault(); try { await signInWithEmail($('email').value, $('password').value); await start(); } catch (err) { notice(err.message || 'تعذر تسجيل الدخول.', true); } });
$('signOut').addEventListener('click', async () => { try { await signOut(); await start(); } catch (e) { notice(e.message, true); } });
$('syncNow').addEventListener('click', runSync); $('refresh').addEventListener('click', () => refresh().catch(e => notice(e.message, true)));
$('retryFailed').addEventListener('click', async () => { try { const count = await retryFailedOperations({ tenantId: state.tenant?.id, branchId: state.branch?.id }); notice(`تمت إعادة ${count} عملية إلى قائمة الانتظار.`); await refresh(); } catch (e) { notice(e.message, true); } });
$('exportBackup').addEventListener('click', exportBackup); $('backupFile').addEventListener('change', e => importBackup(e.target.files?.[0]));
window.addEventListener('online', () => { updateConnection(); runSync(); }); window.addEventListener('offline', updateConnection);
try { await start(); updateConnection(); if (navigator.onLine) runSync(); } catch (e) { notice(e.message || 'تعذر تهيئة مركز المزامنة.', true); }
