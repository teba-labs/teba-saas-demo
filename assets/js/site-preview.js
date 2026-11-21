import {signInWithEmail,getCurrentSession,signOut} from '../../core/auth/session.js';
import {loadMyTenantContext} from '../../core/tenant/context.js';
import {getPreferredTenantId,rememberWorkspaceSelection} from '../../core/tenant/workspace-selection.js';
const $=id=>document.getElementById(id),state={tenants:[],tenant:null};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setStatus(v){$('status').textContent=v}
function showTenant(id){state.tenant=state.tenants.find(t=>t.id===id);if(!state.tenant)return;rememberWorkspaceSelection(id);const publicUrl='../website/index.html?lab='+encodeURIComponent(state.tenant.slug);$('previewFrame').src=publicUrl+'&preview=1';$('openPublic').href=publicUrl;setStatus('معاينة خاصة تعرض المحتوى المحفوظ، بما فيه المسودات، قبل نشر الموقع. هذه المعاينة لا تظهر للزوار.');}
async function start(){const session=await getCurrentSession();if(!session){$('loginPanel').hidden=false;$('workspace').hidden=true;$('signOut').hidden=true;return;}const context=await loadMyTenantContext();state.tenants=(context.tenants||[]).filter(t=>t.accountType==='owner');if(!state.tenants.length)throw new Error('معاينة الموقع متاحة لمالك المعمل فقط.');$('tenantSelect').innerHTML=state.tenants.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');$('tenantSelect').value=getPreferredTenantId(state.tenants);$('loginPanel').hidden=true;$('workspace').hidden=false;$('signOut').hidden=false;showTenant($('tenantSelect').value);}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await signInWithEmail($('email').value,$('password').value);await start()}catch(err){$('notice').textContent=err.message;$('notice').className='notice show error'}});
$('signOut').addEventListener('click',async()=>{await signOut();await start()});
$('tenantSelect').addEventListener('change',()=>showTenant($('tenantSelect').value));
$('refresh').addEventListener('click',()=>showTenant($('tenantSelect').value));
try{await start()}catch(e){$('notice').textContent=e.message;$('notice').className='notice show error'}
