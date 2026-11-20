import { getCurrentSession, signInWithEmail, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { getCurrentWorkday } from '../../modules/workday/repository.js';
import { getOutboxSummary } from '../../offline/outbox.js';
import { APP_ENV, validateEnvironment } from '../../config/environment.js';

const $ = id => document.getElementById(id);
const state = { context: null, tenant: null, branch: null, workday: null };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const apps = [
  { id:'reception', title:'الاستقبال والزيارات', desc:'تسجيل المرضى والزيارات واختيار التحاليل والتحصيل.', href:'reception.html', icon:'＋', roles:['owner','staff'] },
  { id:'results', title:'النتائج وتشغيل المعمل', desc:'قائمة العمل وإدخال النتائج والمراجعة واعتماد التقارير.', href:'results-workbench.html', icon:'▤', roles:['owner','staff'] },
  { id:'catalog', title:'التحاليل والكتالوج', desc:'إدارة التحاليل والبارامترات الفنية؛ الأسعار للمالك فقط.', href:'catalog.html', icon:'⚗', roles:['owner','staff'] },
  { id:'workday', title:'يوم العمل والنقدية', desc:'فتح وإغلاق اليوم ومتابعة التحصيل والمصروفات.', href:'workday.html', icon:'◷', roles:['owner','staff'] },
  { id:'sync', title:'المزامنة والنسخ المحلي', desc:'متابعة العمليات المعلقة والتعارضات وحالة البيانات المحلية.', href:'sync-center.html', icon:'⟳', roles:['owner','staff'] },
  { id:'dashboard', title:'لوحة الإدارة والتحليل', desc:'مؤشرات الأداء والتحصيل والمصروفات ومقارنة الفروع.', href:'dashboard.html', icon:'▥', roles:['owner'] },
];
function notice(message, error=false) { $('notice').textContent=message; $('notice').className=`notice show${error?' error':''}`; }
function updateConnection() {
  const online = navigator.onLine;
  $('connectionTitle').textContent = online ? 'متصل بالإنترنت' : 'العمل دون اتصال';
  $('connectionText').textContent = online ? 'الاتصال بالخادم متاح؛ المزامنة تعمل حسب حالة العمليات.' : 'البيانات المحلية والوظائف المدعومة دون اتصال متاحة.';
  $('connectionDot').style.background = online ? '#229b78' : '#d99b38';
  $('connectionDot').style.boxShadow = online ? '0 0 0 5px #229b781a' : '0 0 0 5px #d99b381a';
  const pill = $('topConnection');
  pill.querySelector('i').style.background = online ? '#56c5a5' : '#d8a34d';
  pill.querySelector('span').textContent = online ? 'متصل' : 'دون اتصال';
}
function renderApps() {
  const role = state.tenant?.accountType === 'owner' ? 'owner' : 'staff';
  $('roleBadge').textContent = role === 'owner' ? 'مالك المعمل · صلاحية كاملة' : 'موظف المعمل · صلاحيات التشغيل';
  const allowed = apps.filter(item => item.roles.includes(role));
  $('appsGrid').innerHTML = allowed.map(item => `<a class="app-card" href="${item.href}" data-app="${item.id}"><span class="app-icon" aria-hidden="true">${item.icon}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.desc)}</small></span></a>`).join('');
  $('ownerArea').hidden = role !== 'owner';
}
function renderBranches() {
  const branches = state.tenant?.branches || [];
  $('branchSelect').innerHTML = branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  const preferred = getPreferredBranchId(state.tenant?.id, branches);
  state.branch = branches.find(b => b.id === preferred) || branches[0] || null;
  $('branchSelect').value = state.branch?.id || '';
  $('branchSelect').disabled = branches.length <= 1;
  if (state.branch) rememberWorkspaceSelection(state.tenant.id, state.branch.id);
  if (!branches.length) {
    $('workdayTitle').textContent = 'لا يوجد فرع نشط متاح';
    $('workdayDetail').textContent = 'راجع مدير المعمل لتفعيل فرع أو ربط حسابك به.';
    notice('لا يوجد فرع نشط متاح لهذا الحساب. راجع مدير المعمل.', true);
  }
}
async function refreshOperationalStatus() {
  if (!state.tenant || !state.branch) return;
  $('workdayTitle').textContent = 'جارٍ تحميل حالة يوم العمل…';
  $('workdayDetail').textContent = state.branch.name;
  try {
    state.workday = await getCurrentWorkday({ tenantId: state.tenant.id, branchId: state.branch.id });
    if (state.workday) {
      $('workdayTitle').textContent = `يوم العمل مفتوح · ${state.workday.work_date}`;
      $('workdayDetail').textContent = `فرع ${state.branch.name} جاهز لتسجيل الحركات على يوم العمل المفتوح.`;
    } else {
      $('workdayTitle').textContent = 'لا يوجد يوم عمل مفتوح';
      $('workdayDetail').textContent = `افتح يوم العمل من شاشة النقدية قبل تسجيل التحصيل والمصروفات · ${state.branch.name}`;
    }
  } catch (error) {
    $('workdayTitle').textContent = 'تعذر قراءة حالة يوم العمل';
    $('workdayDetail').textContent = 'يمكنك فتح شاشة يوم العمل للتحقق من الحالة.';
  }
  try {
    const summary = await getOutboxSummary({ tenantId: state.tenant.id, branchId: state.branch.id });
    $('syncTitle').textContent = summary.total ? `${summary.total} عملية تحتاج متابعة` : 'لا توجد عمليات معلقة';
    $('syncText').textContent = summary.total
      ? `انتظار ${summary.pending} · فاشلة ${summary.failed} · تعارض ${summary.conflict}`
      : (navigator.onLine ? 'لا توجد عمليات بانتظار المزامنة.' : 'لا توجد عمليات محلية معلقة مسجلة.');
  } catch {
    $('syncTitle').textContent = 'حالة المزامنة';
    $('syncText').textContent = 'افتح مركز المزامنة لعرض التفاصيل.';
  }
}
async function selectTenant(id) {
  state.tenant = state.context.tenants.find(t => t.id === id) || null;
  if (!state.tenant) return;
  rememberWorkspaceSelection(state.tenant.id);
  renderBranches();
  renderApps();
  await refreshOperationalStatus();
}
async function selectBranch(id) {
  state.branch = state.tenant?.branches.find(b => b.id === id) || null;
  if (state.branch) {
    rememberWorkspaceSelection(state.tenant.id, state.branch.id);
    await refreshOperationalStatus();
  }
}
async function start() {
  const session = await getCurrentSession();
  if (!session) {
    $('loginPanel').hidden = false; $('workspace').hidden = true; $('signOut').hidden = true;
    return;
  }
  state.context = await loadMyTenantContext();
  if (!state.context.tenants?.length) throw new Error('الحساب لا يملك معملًا نشطًا.');
  $('loginPanel').hidden = true; $('workspace').hidden = false; $('signOut').hidden = false;
  $('userLine').textContent = `الحساب: ${session.user.email || 'مستخدم مسجل'}`;
  $('tenantSelect').innerHTML = state.context.tenants.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  $('tenantSelect').onchange = () => selectTenant($('tenantSelect').value).catch(e => notice(e.message, true));
  $('branchSelect').onchange = () => selectBranch($('branchSelect').value).catch(e => notice(e.message, true));
  const preferredTenantId = getPreferredTenantId(state.context.tenants);
  $('tenantSelect').value = preferredTenantId;
  await selectTenant(preferredTenantId);
}
const env = validateEnvironment(APP_ENV);
$('environment').textContent = env.valid ? 'بيئة الاختبار' : 'إعداد الاتصال غير مكتمل';
if (!env.valid) {
  $('loginButton').disabled = true;
  $('configNotice').hidden = false;
  $('configNotice').textContent = env.problems?.join(' ') || 'راجع إعدادات الاتصال بمشروع الاختبار.';
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const button = $('loginButton'); button.disabled = true; button.textContent = 'جارٍ تسجيل الدخول…';
  try { await signInWithEmail($('email').value, $('password').value); await start(); }
  catch (err) { notice(err.message || 'تعذر تسجيل الدخول.', true); }
  finally { button.disabled = !env.valid; button.innerHTML = 'دخول إلى مساحة العمل <span aria-hidden="true">←</span>'; }
});
$('signOut').addEventListener('click', async () => {
  try { await signOut(); state.context = null; state.tenant = null; state.branch = null; await start(); }
  catch (e) { notice(e.message || 'تعذر تسجيل الخروج.', true); }
});
window.addEventListener('online', () => { updateConnection(); refreshOperationalStatus().catch(() => {}); });
window.addEventListener('offline', updateConnection);
updateConnection();
try { await start(); } catch (e) { notice(e.message || 'تعذر تحميل مساحة العمل.', true); }
