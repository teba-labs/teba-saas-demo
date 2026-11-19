import { getCurrentSession, signInWithEmail, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { APP_ENV, validateEnvironment } from '../../config/environment.js';

const $ = id => document.getElementById(id);
const state = { context: null, tenant: null, branch: null };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const apps = [
  { id:'catalog', title:'كتالوج التحاليل', desc:'إدارة بيانات التحاليل والبارامترات الفنية والأسعار حسب الصلاحية.', href:'catalog.html', icon:'⚗', roles:['owner'] },
  { id:'reception', title:'الاستقبال والزيارات', desc:'تسجيل المرضى واختيار التحاليل والفواتير.', href:'reception.html', icon:'＋', roles:['owner','staff'] },
  { id:'results', title:'النتائج وتشغيل المعمل', desc:'قائمة العمل وإدخال النتائج والاعتماد ونشر التقارير.', href:'results-workbench.html', icon:'⚗', roles:['owner','staff'] },
  { id:'workday', title:'يوم العمل والنقدية', desc:'فتح وإغلاق اليوم وتسجيل المصروفات ومراجعة التحصيل.', href:'workday.html', icon:'▤', roles:['owner','staff'] },
  { id:'sync', title:'المزامنة والنسخ المحلي', desc:'متابعة العمليات المعلقة والتعارضات والنسخ المحلية.', href:'sync-center.html', icon:'⟳', roles:['owner','staff'] },
  { id:'dashboard', title:'لوحة الإدارة والتحليل', desc:'التحصيل والمصروفات والفواتير والمديونيات ومقارنة الفروع.', href:'dashboard.html', icon:'▥', roles:['owner'] },
  { id:'cms', title:'إدارة موقع المعمل', desc:'إدارة المحتوى والتحاليل المعروضة والعروض والفروع المنشورة.', href:'cms-editor.html', icon:'▣', roles:['owner'] },
  { id:'settings', title:'مركز قيادة المعمل', desc:'إعدادات وهوية المعمل ومراكز الإدارة لصاحب المعمل.', href:'settings.html', icon:'⚙', roles:['owner'] },
];
function notice(message, error=false) { $('notice').textContent=message; $('notice').className=`notice show${error?' error':''}`; }
function updateConnection() { const online=navigator.onLine; $('connectionTitle').textContent=online?'متصل بالإنترنت':'غير متصل بالإنترنت'; $('connectionText').textContent=online?'يمكن مزامنة العمليات مع خادم المعمل.':'يمكن استخدام البيانات المحفوظة محليًا للوظائف المدعومة.'; document.querySelector('.status-dot').style.background=online?'#229b78':'#d99b38'; }
function renderApps() { const role=state.tenant?.accountType==='owner'?'owner':'staff'; $('roleBadge').textContent=role==='owner'?'مدير المعمل':'موظف المعمل'; const allowed=apps.filter(item=>item.roles.includes(role)); $('appsGrid').innerHTML=allowed.map(item=>`<a class="app-card" href="${item.href}" data-app="${item.id}"><span class="app-icon" aria-hidden="true">${item.icon}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.desc)}</small></span></a>`).join(''); }
function renderBranches() { const branches=state.tenant?.branches||[]; $('branchSelect').innerHTML=branches.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join(''); const preferred=getPreferredBranchId(state.tenant?.id,branches); state.branch=branches.find(b=>b.id===preferred)||branches[0]||null; $('branchSelect').value=state.branch?.id||''; $('branchSelect').disabled=branches.length<=1; if(state.branch)rememberWorkspaceSelection(state.tenant.id,state.branch.id); if(!branches.length) notice('لا يوجد فرع نشط متاح لهذا الحساب. راجع مدير المعمل.',true); }
async function selectTenant(id) { state.tenant=state.context.tenants.find(t=>t.id===id)||null; if(state.tenant)rememberWorkspaceSelection(state.tenant.id); renderBranches(); renderApps(); }
async function start() { const session=await getCurrentSession(); if(!session){$('loginPanel').hidden=false;$('workspace').hidden=true;$('signOut').hidden=true;return;} state.context=await loadMyTenantContext(); if(!state.context.tenants?.length) throw new Error('الحساب لا يملك معملًا نشطًا.'); $('loginPanel').hidden=true;$('workspace').hidden=false;$('signOut').hidden=false; $('userLine').textContent=`الحساب: ${session.user.email||'مستخدم مسجل'}`; $('tenantSelect').innerHTML=state.context.tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''); $('tenantSelect').onchange=()=>selectTenant($('tenantSelect').value).catch(e=>notice(e.message,true)); $('branchSelect').onchange=()=>{state.branch=state.tenant?.branches.find(b=>b.id===$('branchSelect').value)||null;if(state.branch)rememberWorkspaceSelection(state.tenant.id,state.branch.id);}; const preferredTenantId=getPreferredTenantId(state.context.tenants); $('tenantSelect').value=preferredTenantId; await selectTenant(preferredTenantId); }
const env=validateEnvironment(APP_ENV); $('environment').textContent=env.valid?'مشروع الاختبار':'إعداد الاتصال غير مكتمل'; if(!env.valid){$('loginButton').disabled=true;$('configNotice').hidden=false;$('configNotice').textContent='لم يتم إدخال مفتاح الاتصال العام لمشروع Supabase TEST بعد. أضفه في config/environment.js قبل تجربة تسجيل الدخول.';}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await signInWithEmail($('email').value,$('password').value);await start();}catch(err){notice(err.message||'تعذر تسجيل الدخول.',true);}});
$('signOut').addEventListener('click',async()=>{try{await signOut();await start();}catch(e){notice(e.message||'تعذر تسجيل الخروج.',true);}});
window.addEventListener('online',updateConnection);window.addEventListener('offline',updateConnection);updateConnection();
try{await start();}catch(e){notice(e.message||'تعذر تحميل مساحة العمل.',true);}
