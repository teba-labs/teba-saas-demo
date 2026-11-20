import { getSupabaseClient } from '../../core/supabase-client.js';
import { signInWithEmail, getCurrentSession, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { findPatients, createPatient, getOpenWorkday, createVisitIntake, recordPayment, listBranchOutstandingBalances } from '../../modules/reception/repository.js';
import { listCatalog, listCurrentPrices, listTestParameters } from '../../modules/catalog/repository.js';
import { listHistoricalResults } from '../../modules/migration/historical-results-repository.js';
import { startBackgroundSync } from '../../offline/background-sync.js';
import { getLabAssetPublicUrl } from '../../modules/settings/assets-repository.js';
import { cacheRows, getCachedRows, replaceCachedRows } from '../../offline/cache.js';

const $ = id => document.getElementById(id);
const state = { context:null, userId:null, tenant:null, branch:null, staff:[], workday:null, patient:null, catalog:[], prices:new Map(), selected:new Set(), parameters:new Map(), busy:false, stopSync:null, lastVisit:null };
const money = n => `${Number(n || 0).toFixed(2)} ج.م`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateStamp = () => new Date().toISOString().slice(0,10).replaceAll('-','');
const makeCode = prefix => `${prefix}-${dateStamp()}-${crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase()}`;
const paymentMethodLabels = {cash:'نقدي',card:'بطاقة',wallet:'محفظة إلكترونية',bank_transfer:'تحويل بنكي',other:'أخرى'};
function notice(message,error=false){const el=$('notice');el.textContent=message;el.className=`notice show${error?' error':''}`;clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.className='notice',6500);}
function busy(button,on,label){if(!button)return;button.disabled=on;if(on){button.dataset.label=button.textContent;button.textContent=label||'جارٍ التنفيذ…';}else if(button.dataset.label){button.textContent=button.dataset.label;delete button.dataset.label;}}
function currentStaff(){return $('staffSelect').value || null;}
function newReferenceCodes(){
  $('patientNumberPreview').value=makeCode('P');
  $('visitNumber').value=makeCode('V');
}
function showPaymentReceipt({patientName,visitNumber,amount,method,staffName,paymentId}){
  const brand=globalThis.__taibaTenantBrand||{}, lab=brand.settings||{}, print=brand.printSettings||{};
  const logoPath=print.showLogo===false?'':(print.logoPath||lab.logo_path||''), logo=logoPath?getLabAssetPublicUrl(logoPath):'';
  const signature=print.showSignature&&print.signaturePath?getLabAssetPublicUrl(print.signaturePath):'';
  const labName=lab.laboratory_name||'Taiba Smart Lab', branch=brand.branch||{};
  const contact=[print.showBranch===false?'':(branch.name?'فرع '+branch.name:''),print.showPhone===false?'':(branch.phone||lab.phone||lab.whatsapp||''),print.showAddress===false?'':(branch.address||lab.address||'')].filter(Boolean).join(' · ');
  const doctor=print.showDoctor===false?'':(lab.doctor_name||''), footer=print.footerText||lab.report_footer||'شكرًا لثقتكم في معامل طيبة';
  $('paymentReceiptContent').innerHTML=`<div style="text-align:center">${logo?'<img src="'+escapeHtml(logo)+'" alt="شعار المعمل" style="max-width:120px;max-height:65px;object-fit:contain">':''}<h2>${escapeHtml(print.title||'إيصال تحصيل')}</h2><strong>${escapeHtml(labName)}</strong>${doctor?'<p>'+escapeHtml(doctor)+'</p>':''}${contact?'<small>'+escapeHtml(contact)+'</small>':''}</div><hr><p>اسم المريض: <b>${escapeHtml(patientName)}</b></p><p>رقم الزيارة: <b>${escapeHtml(visitNumber)}</b></p><p>المبلغ المحصل: <b>${money(amount)}</b></p><p>طريقة الدفع: <b>${escapeHtml(paymentMethodLabels[method]||method)}</b></p><p>الموظف: <b>${escapeHtml(staffName||'—')}</b></p><p>التاريخ والوقت: <b>${new Date().toLocaleString('ar-EG')}</b></p>${paymentId?'<p>مرجع العملية: '+escapeHtml(paymentId)+'</p>':''}${signature?'<div style="text-align:left"><img src="'+escapeHtml(signature)+'" alt="التوقيع" style="max-width:130px;max-height:65px;object-fit:contain"></div>':''}<hr><p style="text-align:center">${escapeHtml(footer)}</p>`;
  const paper=print.paperSize==='A5'?'A5':'A4', orientation=print.orientation==='landscape'?'landscape':'portrait', margin=Math.min(30,Math.max(5,Number(print.margin)||12));
  let style=document.getElementById('tenant-print-page-style');if(!style){style=document.createElement('style');style.id='tenant-print-page-style';document.head.append(style);}
  style.textContent='@page{size:'+paper+' '+orientation+';margin:'+margin+'mm}';$('paymentReceipt').hidden=false;
}
function setPatient(patient){
  state.patient=patient;$('selectedPatient').hidden=!patient;$('patientHistoricalPanel').hidden=true;
  $('selectedPatient').innerHTML=patient?`<div><strong>${escapeHtml(patient.full_name)}</strong><small>${escapeHtml(patient.phone||'لا يوجد هاتف')} · كود الملف: ${escapeHtml(patient.patient_number||'—')}</small></div><div class="selected-actions"><button id="clearPatient" class="button button-ghost" type="button">تغيير المريض</button><button id="showPatientHistory" class="button button-secondary" type="button">النتائج التاريخية</button></div>`:'';
  updateTotals();
  if(patient){$('newPatientDetails').open=false;$('clearPatient').addEventListener('click',()=>setPatient(null));$('showPatientHistory').addEventListener('click',e=>showPatientHistory(e.currentTarget));}
}
async function showPatientHistory(button){
  if(!state.patient||!state.branch)return;busy(button,true,'جارٍ تحميل النتائج…');
  try{
    const [linked,unlinked]=await Promise.all([
      listHistoricalResults({tenantId:state.tenant.id,branchId:state.branch.id,patientId:state.patient.id,limit:200}),
      listHistoricalResults({tenantId:state.tenant.id,branchId:state.branch.id,search:state.patient.full_name,limit:200})
    ]);
    const map=new Map([...linked,...unlinked.filter(row=>!row.patient_id)].map(row=>[row.id,row]));
    const rows=[...map.values()].sort((a,b)=>String(b.result_date).localeCompare(String(a.result_date)));
    const host=$('patientHistoricalList');host.replaceChildren();
    if(!rows.length)host.append(document.createTextNode('لا توجد نتائج تاريخية مرتبطة بهذا المريض أو محفوظة باسمه في هذا الفرع.'));
    for(const row of rows){
      const card=document.createElement('article');card.className='historical-result-card';
      const heading=document.createElement('strong');heading.textContent=row.test_name_snapshot+' · '+row.result_date;card.append(heading);
      const label=document.createElement('small');label.textContent='نتيجة تاريخية · '+row.patient_name_snapshot+(row.patient_age_raw?' · العمر وقتها: '+row.patient_age_raw+' '+(row.patient_age_unit||''):'');card.append(label);
      const data=document.createElement('pre');data.textContent=JSON.stringify(row.result_data,null,2);card.append(data);
      const source=document.createElement('small');source.textContent='المصدر: '+(row.source_file_name||'سجل تاريخي')+' · '+(row.source_sheet_name||'')+' · صف '+(row.source_row_number||'—');card.append(source);host.append(card);
    }
    $('patientHistoricalPanel').hidden=false;
  }catch(error){notice(error.message||'تعذر تحميل النتائج التاريخية.',true);}finally{busy(button,false);}
}
async function start(){
  const session=await getCurrentSession();
  if(!session){$('loginPanel').hidden=false;$('workspace').hidden=true;$('signOut').hidden=true;return;}
  state.context=await loadMyTenantContext();state.userId=state.context.user.id;
  $('loginPanel').hidden=true;$('workspace').hidden=false;$('signOut').hidden=false;
  $('tenantSelect').innerHTML=state.context.tenants.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
  if(!state.context.tenants.length)throw new Error('الحساب لا يملك معملًا نشطًا.');
  $('tenantSelect').onchange=()=>selectTenant($('tenantSelect').value).catch(e=>notice(e.message,true));
  $('tenantSelect').value=getPreferredTenantId(state.context.tenants)||state.context.tenants[0].id;
  await selectTenant($('tenantSelect').value);
}
async function selectTenant(id){
  state.tenant=state.context.tenants.find(t=>t.id===id);if(!state.tenant)return;
  rememberWorkspaceSelection(state.tenant.id);
  const branches=state.tenant.branches||[];
  $('branchSelect').innerHTML=branches.map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('');
  $('branchSelect').onchange=()=>loadBranch().catch(e=>notice(e.message,true));
  if(!branches.length){$('intakePanel').hidden=true;$('workdayStatus').textContent='لا يوجد فرع متاح لهذا الحساب.';return;}
  $('branchSelect').value=getPreferredBranchId(state.tenant.id,branches)||branches[0].id;await loadBranch();
}
async function loadBranch(){
  state.stopSync?.();state.stopSync=null;
  state.branch=state.tenant.branches.find(b=>b.id===$('branchSelect').value);if(!state.branch)return;
  rememberWorkspaceSelection(state.tenant.id,state.branch.id);
  state.patient=null;state.selected.clear();$('patientMatches').innerHTML='<p class="muted">ابدأ البحث لاختيار مريض مسجل.</p>';setPatient(null);
  $('intakePanel').hidden=true;$('recentVisits').innerHTML='<p class="muted">جارٍ تحميل الزيارات…</p>';$('balancesList').innerHTML='<p class="muted">جارٍ تحميل المديونيات…</p>';
  state.stopSync=startBackgroundSync({tenantId:state.tenant.id,branchId:state.branch.id});
  const db=getSupabaseClient();let staffRows=[];
  if(navigator.onLine===false)staffRows=(await getCachedRows('staff_directory',{tenantId:state.tenant.id,branchId:state.branch.id})).filter(x=>x.is_active);
  else{
    let query=db.from('staff_directory').select('id,tenant_id,branch_id,display_name,auth_user_id,is_active').eq('tenant_id',state.tenant.id).eq('branch_id',state.branch.id).eq('is_active',true);
    if(state.tenant.accountType==='employee')query=query.eq('auth_user_id',state.userId);
    const result=await query.order('display_name');
    if(result.error){if(/fetch|network|offline/i.test(result.error.message||''))staffRows=(await getCachedRows('staff_directory',{tenantId:state.tenant.id,branchId:state.branch.id})).filter(x=>x.is_active);else throw result.error;}
    else{staffRows=result.data||[];await replaceCachedRows('staff_directory',staffRows,{tenantId:state.tenant.id,branchId:state.branch.id});}
  }
  if(state.tenant.accountType==='employee')staffRows=staffRows.filter(x=>x.auth_user_id===state.userId);
  state.staff=staffRows;$('staffSelect').disabled=state.tenant.accountType==='employee';
  $('staffSelect').innerHTML=state.staff.map(s=>`<option value="${escapeHtml(s.id)}">${escapeHtml(s.display_name)}</option>`).join('');
  const workdayResult=await getOpenWorkday({tenantId:state.tenant.id,branchId:state.branch.id}).catch(error=>({error}));
  state.workday=workdayResult.error?null:workdayResult;
  $('workdayStatus').className='status '+(state.workday?'good':'bad');
  $('workdayStatus').textContent=state.workday?`يوم العمل مفتوح: ${state.workday.work_date}`:`لا يوجد يوم عمل مفتوح. ${workdayResult.error?.message||''}`;
  if(!state.workday){const openLink=document.createElement('a');openLink.href='workday.html';openLink.className='button button-secondary';openLink.textContent='فتح يوم العمل';openLink.style.marginInlineStart='8px';$('workdayStatus').append(document.createTextNode(' '),openLink);}
  $('intakeWorkdayChip').textContent=state.workday?`يوم العمل · ${state.workday.work_date}`:'يوم العمل مغلق';
  $('visitDate').value=state.workday?.work_date||'—';
  if(!state.staff.length)$('workdayStatus').textContent+=' لا توجد هوية موظف نشطة مرتبطة بهذا الحساب في الفرع.';
  if(!state.workday||!state.staff.length){await loadRecent();await loadBalances();return;}
  const catalog=await listCatalog({tenantId:state.tenant.id});state.catalog=catalog;
  const prices=await listCurrentPrices({tenantId:state.tenant.id,branchId:state.branch.id,testIds:catalog.map(t=>t.id)});
  state.prices=new Map(prices.map(p=>[p.test_id,p]));state.parameters.clear();
  $('intakePanel').hidden=false;newReferenceCodes();renderCatalog();await loadRecent();await loadBalances();
}
function renderCatalog(){
  const term=$('catalogSearch').value.trim().toLowerCase(),host=$('catalogList');
  const available=state.catalog.filter(t=>`${t.name} ${t.code} ${t.category||''}`.toLowerCase().includes(term));
  $('catalogCount').textContent=`التحاليل المتاحة: ${available.length}`;
  host.innerHTML=available.length?available.map(t=>{
    const price=state.prices.get(t.id),checked=state.selected.has(t.id);
    return `<div class="catalog-item"><input type="checkbox" data-test="${escapeHtml(t.id)}" id="test-${escapeHtml(t.id)}" ${checked?'checked':''} ${!price?'disabled':''} aria-label="${escapeHtml(t.name)}"><label for="test-${escapeHtml(t.id)}"><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(t.code)}${t.category?' · '+escapeHtml(t.category):''}${!price?' · لا يوجد سعر نشط':''}</small></label><strong>${price?money(price.selling_price):'—'}</strong></div>`;
  }).join(''):'<p class="muted">لا توجد تحاليل مطابقة لبحثك.</p>';
  host.querySelectorAll('[data-test]').forEach(input=>input.addEventListener('change',()=>toggleTest(input.dataset.test,input.checked)));
  updateTotals();
}
async function toggleTest(id,checked){
  if(checked){
    try{let params=state.parameters.get(id);if(!params){params=await listTestParameters({tenantId:state.tenant.id,testId:id});state.parameters.set(id,params);}
      if(!params.length)throw new Error('هذا التحليل لا يحتوي على معاملات فنية نشطة، لذلك لا يمكن طلبه.');
      state.selected.add(id);
    }catch(error){state.selected.delete(id);renderCatalog();notice(error.message||'تعذر اختيار التحليل.',true);return;}
  }else state.selected.delete(id);
  updateTotals();
}
function updateTotals(){
  let gross=0;for(const id of state.selected)gross+=Number(state.prices.get(id)?.selling_price||0);
  const discount=Number($('discount').value||0),net=gross-discount,paid=Number($('initialPayment').value||0),remaining=net-paid;
  $('grossTotal').textContent=money(gross);$('netTotal').textContent=money(net);$('remainingTotal').textContent=money(remaining);
  $('selectedCount').textContent=state.selected.size?`تم اختيار ${state.selected.size} تحليل`:'لم يتم اختيار تحاليل';
  const valid=state.patient&&state.workday&&state.selected.size>0&&state.staff.length>0&&Number.isFinite(discount)&&discount>=0&&discount<=gross&&Number.isFinite(paid)&&paid>=0&&paid<=net;
  $('createVisit').disabled=!valid||state.busy;
}
let searchTimer;
async function searchPatients(){
  const term=$('patientSearch').value.trim();
  if(term.length<2){$('patientMatches').innerHTML='<p class="muted">اكتب حرفين على الأقل لبدء البحث.</p>';return;}
  $('patientMatches').innerHTML='<p class="muted">جارٍ البحث…</p>';
  try{
    const rows=await findPatients({tenantId:state.tenant.id,branchId:state.branch.id,search:term});
    $('patientMatches').innerHTML=rows.length?rows.map(p=>`<div class="match"><div><strong>${escapeHtml(p.full_name)}</strong><small>${escapeHtml(p.phone||'بدون هاتف')} · كود ${escapeHtml(p.patient_number||'—')}</small></div><button class="button button-secondary" type="button" data-patient="${escapeHtml(p.id)}" role="option" tabindex="0">اختيار المريض</button></div>`).join(''):'<p class="muted">لم يتم العثور على مريض. يمكنك تسجيله كمريض جديد.</p>';
    for(const button of $('patientMatches').querySelectorAll('[data-patient]'))button.addEventListener('click',()=>{const patient=rows.find(p=>p.id===button.dataset.patient);setPatient(patient);notice('تم اختيار المريض.');});
  }catch(error){$('patientMatches').innerHTML='<p class="muted">تعذر البحث: '+escapeHtml(error.message||'خطأ غير معروف')+'</p>';}
}
async function addNewPatient(button){
  const fullName=$('patientName').value.trim();if(!fullName){notice('اكتب اسم المريض أولًا.',true);$('patientName').focus();return;}
  const sex=$('patientSex').value;if(!sex){notice('حدد النوع: ذكر أو أنثى.',true);$('patientSex').focus();return;}
  const ageRaw=$('patientAge').value,age=ageRaw===''?null:Number(ageRaw),unit=$('patientAgeUnit').value;
  const max=unit==='days'?43800:unit==='months'?1440:120;
  if(age!==null&&(!Number.isFinite(age)||age<0||age>max)){notice('راجع العمر ووحدة القياس المدخلة.',true);$('patientAge').focus();return;}
  busy(button,true,'جارٍ حفظ المريض…');
  try{
    const patient=await createPatient({tenantId:state.tenant.id,branchId:state.branch.id,patient:{
      fullName,phone:$('patientPhone').value.trim()||null,ageValue:age,ageUnit:unit,patientNumber:$('patientNumberPreview').value,
      sex,createdByStaffId:currentStaff()
    }});
    setPatient(patient);$('patientSearch').value='';$('patientMatches').replaceChildren();$('newPatientForm').reset();
    $('patientNumberPreview').value=makeCode('P');
    if(patient.offline_pending){$('pendingSyncNotice').hidden=false;notice('تم حفظ المريض محليًا. ستتم مزامنته وربط الزيارة به بعد عودة الاتصال.');}
    else notice('تم تسجيل المريض واختياره بنجاح.');
  }catch(error){notice(error.message||'تعذر تسجيل المريض.',true);}finally{busy(button,false);updateTotals();}
}
function clearIntake(){
  state.patient=null;state.selected.clear();state.parameters.clear();setPatient(null);
  $('patientSearch').value='';$('patientMatches').innerHTML='<p class="muted">ابدأ البحث لاختيار مريض مسجل.</p>';
  $('newPatientForm').reset();$('newPatientDetails').open=false;$('catalogSearch').value='';
  $('referredBy').value='';$('visitNotes').value='';$('discount').value='0';$('initialPayment').value='0';$('initialPaymentMethod').value='cash';
  $('postSaveActions').hidden=true;$('paymentReceipt').hidden=true;newReferenceCodes();renderCatalog();$('patientSearch').focus();
}
async function submitVisit(button){
  if(state.busy)return;
  if(!state.patient){notice('اختر مريضًا أولًا.',true);return;}
  if(!state.workday){notice('يجب فتح يوم العمل قبل تسجيل الزيارات.',true);return;}
  if(!state.selected.size){notice('اختر تحليلًا واحدًا على الأقل.',true);return;}
  const gross=[...state.selected].reduce((sum,id)=>sum+Number(state.prices.get(id)?.selling_price||0),0);
  const discount=Number($('discount').value||0),paid=Number($('initialPayment').value||0);
  if(!Number.isFinite(discount)||discount<0||discount>gross||!Number.isFinite(paid)||paid<0||paid>gross-discount){notice('راجع قيمة الخصم والمدفوع؛ المدفوع لا يجوز أن يتجاوز صافي الفاتورة.',true);return;}
  const visitNumber=$('visitNumber').value||makeCode('V');state.busy=true;updateTotals();busy(button,true,'جارٍ حفظ الزيارة والفاتورة…');
  try{
    const result=await createVisitIntake({
      tenantId:state.tenant.id,branchId:state.branch.id,patientId:state.patient.id,visitNumber,staffId:currentStaff(),
      testIds:[...state.selected],discountAmount:discount,initialPayment:paid,paymentMethod:$('initialPaymentMethod').value,
      referredBy:$('referredBy').value.trim()||null,notes:$('visitNotes').value.trim()||null,
      expectedPrices:[...state.selected].map(id=>({test_id:id,id:state.prices.get(id).id,selling_price:Number(state.prices.get(id).selling_price)})),
      dependsOn:state.patient.pendingOperationId?[state.patient.pendingOperationId]:[]
    });
    if(result?.queued){
      $('pendingSyncNotice').hidden=false;$('postSaveTitle').textContent='تم حفظ الزيارة محليًا';$('postSaveDetail').textContent='الزيارة تنتظر المزامنة مع الخادم. لا يمكن فتح النتائج قبل تأكيد المزامنة.';
      $('goToResults').hidden=true;$('newPatientAfterSave').textContent='تسجيل مريض جديد';$('postSaveActions').hidden=false;
      notice(`تم حفظ الزيارة ${visitNumber} محليًا، وستتم مزامنتها تلقائيًا عند عودة الاتصال.`);
    }else{
      const visitId=result.visitId||result;
      state.lastVisit={visitId,visitNumber,patientId:state.patient.id,patientName:state.patient.full_name};
      $('postSaveTitle').textContent='تم حفظ الزيارة والفاتورة بنجاح';
      $('postSaveDetail').textContent=`المريض: ${state.patient.full_name} · الزيارة: ${visitNumber} · المتبقي: ${money(gross-discount-paid)}`;
      $('goToResults').hidden=false;$('newPatientAfterSave').textContent='تسجيل مريض جديد';$('postSaveActions').hidden=false;
      if(paid>0)showPaymentReceipt({patientName:state.patient.full_name,visitNumber,amount:paid,method:$('initialPaymentMethod').value,staffName:state.staff.find(s=>s.id===currentStaff())?.display_name});
      notice(`تم تسجيل الزيارة رقم ${visitNumber} وإضافة ${state.selected.size} تحليلًا.`);
      await loadRecent();await loadBalances();
    }
    state.selected.clear();renderCatalog();$('visitNumber').value=makeCode('V');$('discount').value='0';$('initialPayment').value='0';$('initialPaymentMethod').value='cash';$('referredBy').value='';$('visitNotes').value='';
    if(!result?.queued){$('newPatientDetails').open=false;}
    updateTotals();$('postSaveActions').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(error){notice(error.message||'تعذر تسجيل الزيارة. لم يتم تأكيد حفظ الفاتورة.',true);}
  finally{state.busy=false;busy(button,false);updateTotals();}
}
async function loadBalances(){
  const host=$('balancesList');if(!state.branch){host.textContent='اختر الفرع أولًا.';return;}
  if(navigator.onLine===false){host.innerHTML='<p class="muted">عرض المديونيات يحتاج اتصالًا؛ لم نعرض أرصدة محلية قد تكون غير مكتملة.</p>';return;}
  host.innerHTML='<p class="muted">جارٍ تحميل الأرصدة…</p>';
  try{
    const rows=await listBranchOutstandingBalances({tenantId:state.tenant.id,branchId:state.branch.id,limit:50});
    if(!rows.length){host.innerHTML='<p class="muted">لا توجد أرصدة مستحقة لهذا الفرع.</p>';return;}
    host.innerHTML=rows.map(row=>`<div class="match balance-card" data-balance-visit="${escapeHtml(row.visit_id)}" data-balance="${Number(row.balance)}" data-patient-name="${escapeHtml(row.patient_name)}" data-visit-number="${escapeHtml(row.visit_number)}"><div><strong>${escapeHtml(row.patient_name)}</strong><small>زيارة ${escapeHtml(row.visit_number)} · الفاتورة ${money(row.net_total)} · المدفوع ${money(row.paid_total)} · المتبقي <b>${money(row.balance)}</b></small></div><div class="balance-actions"><label>مبلغ التحصيل<input class="balance-amount" type="number" min="0.01" max="${Number(row.balance)}" step="0.01" placeholder="${Number(row.balance).toFixed(2)}"></label><label>طريقة الدفع<select class="balance-method"><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="wallet">محفظة إلكترونية</option><option value="bank_transfer">تحويل بنكي</option><option value="other">أخرى</option></select></label><button class="button button-secondary collect-balance" type="button" ${!state.workday||!currentStaff()?'disabled':''}>تحصيل دفعة</button></div></div>`).join('');
  }catch(error){host.innerHTML='<p class="muted">تعذر تحميل المديونيات: '+escapeHtml(error.message||'خطأ غير معروف')+'</p>';}
}
async function collectBalance(button){
  const card=button.closest('[data-balance-visit]');if(!card)return;
  const amount=Number(card.querySelector('.balance-amount').value),remaining=Number(card.dataset.balance);
  if(!Number.isFinite(amount)||amount<=0||amount>remaining){notice('أدخل مبلغًا أكبر من صفر ولا يتجاوز الرصيد المتبقي.',true);return;}
  if(!state.workday){notice('افتح يوم العمل قبل تسجيل التحصيل.',true);return;}
  if(!currentStaff()){notice('لا توجد هوية موظف نشطة مرتبطة بهذا الحساب.',true);return;}
  if(navigator.onLine===false){notice('التحصيل اللاحق من هذه الشاشة يحتاج اتصالًا حاليًا. لم يتم تسجيل أي مبلغ.',true);return;}
  busy(button,true,'جارٍ تسجيل التحصيل…');
  try{
    const method=card.querySelector('.balance-method').value;
    const payment=await recordPayment({tenantId:state.tenant.id,branchId:state.branch.id,visitId:card.dataset.balanceVisit,amount,paymentMethod:method,staffId:currentStaff()});
    if(payment?.queued){notice('تم وضع التحصيل في قائمة المزامنة؛ لا تطبع إيصالًا نهائيًا قبل تأكيد الخادم.');$('pendingSyncNotice').hidden=false;return;}
    showPaymentReceipt({patientName:card.dataset.patientName,visitNumber:card.dataset.visitNumber,amount,method,staffName:state.staff.find(s=>s.id===currentStaff())?.display_name,paymentId:typeof payment==='string'?payment:payment?.id});
    notice('تم تسجيل الدفعة وتحديث رصيد الزيارة.');await loadBalances();
  }catch(error){notice(error.message||'تعذر تسجيل الدفعة. لم يتم تأكيد التحصيل.',true);}finally{busy(button,false);}
}
async function loadRecent(){
  const host=$('recentVisits');if(!state.branch){host.innerHTML='<p class="muted">اختر الفرع لعرض الزيارات.</p>';return;}
  if(navigator.onLine===false){
    const rows=(await getCachedRows('visits',{tenantId:state.tenant.id,branchId:state.branch.id})).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,12);
    host.innerHTML=rows.length?rows.map(v=>`<div class="visit-row"><div><strong>${escapeHtml(v.patient_name||'مريض')}</strong><small>زيارة ${escapeHtml(v.visit_number)} · ${escapeHtml(v.visit_work_date||'محفوظة محليًا')}</small></div><span class="muted">${escapeHtml(v.status||'بانتظار المزامنة')}</span></div>`).join(''):'<p class="muted">لا توجد زيارات محفوظة محليًا.</p>';return;
  }
  const {data,error}=await getSupabaseClient().from('visits').select('id,tenant_id,branch_id,visit_number,visit_work_date,status,created_at,patients!inner(full_name)').eq('tenant_id',state.tenant.id).eq('branch_id',state.branch.id).order('created_at',{ascending:false}).limit(12);
  if(error){host.innerHTML='<p class="muted">تعذر تحديث الزيارات: '+escapeHtml(error.message||'خطأ في الاتصال')+'</p>';throw error;}
  await cacheRows('visits',(data||[]).map(v=>({...v,patient_name:v.patients?.full_name||'مريض'})));
  host.innerHTML=data?.length?data.map(v=>`<div class="visit-row"><div><strong>${escapeHtml(v.patients?.full_name||'مريض')}</strong><small>زيارة ${escapeHtml(v.visit_number)} · ${escapeHtml(v.visit_work_date)} · ${escapeHtml(v.status)}</small></div><button class="button button-secondary open-visit-results" type="button" data-visit-id="${escapeHtml(v.id)}">فتح النتائج</button></div>`).join(''):'<p class="muted">لا توجد زيارات مسجلة حتى الآن.</p>';
}
function goToResults(visitId=state.lastVisit?.visitId){
  if(!visitId){notice('لا يوجد رقم زيارة مؤكد لفتح النتائج.',true);return;}
  const url=new URL('results-workbench.html',location.href);url.searchParams.set('visit_id',visitId);location.href=url.href;
}
function focusNewPatient(){ $('newPatientDetails').open=true; $('patientName').focus(); }
function bindKeyboard(){
  $('newPatientDetails').addEventListener('toggle',()=>{if($('newPatientDetails').open)requestAnimationFrame(()=>$('patientName').focus());});
  $('newPatientForm').addEventListener('submit',e=>{e.preventDefault();addNewPatient($('createPatient'));});
  $('patientMatches').addEventListener('keydown',e=>{if(e.key==='Escape')$('patientSearch').focus();});
  $('catalogList').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.matches('input[type="checkbox"]')){e.preventDefault();e.target.checked=!e.target.checked;e.target.dispatchEvent(new Event('change',{bubbles:true}));return;}
    if(!['ArrowDown','ArrowUp'].includes(e.key))return;
    const inputs=[...$('catalogList').querySelectorAll('input[type="checkbox"]:not(:disabled)')],index=inputs.indexOf(e.target);
    if(index<0)return;e.preventDefault();inputs[Math.max(0,Math.min(inputs.length-1,index+(e.key==='ArrowDown'?1:-1)))].focus();
  });
  $('intakePanel').addEventListener('keydown',e=>{
    if(e.key==='Escape'&&$('patientHistoricalPanel').hidden===false){$('patientHistoricalPanel').hidden=true;$('showPatientHistory')?.focus();}
    if(e.key!=='Enter'||e.target.matches('textarea,input[type="search"],button,input[type="checkbox"]'))return;
    if(e.target.matches('input[type="text"],input[type="number"],input[type="tel"]')){
      const fields=[...$('intakePanel').querySelectorAll('input:not([disabled]):not([readonly]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])')].filter(el=>el.getClientRects().length&&el.type!=='button');
      const next=fields[fields.indexOf(e.target)+1];if(next){e.preventDefault();next.focus();}
    }
  });
}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');busy(button,true,'جارٍ تسجيل الدخول…');try{await signInWithEmail($('email').value,$('password').value);await start();}catch(error){notice(error.message||'تعذر تسجيل الدخول.',true);}finally{busy(button,false);}});
$('signOut').addEventListener('click',async()=>{try{state.stopSync?.();await signOut();await start();}catch(error){notice(error.message||'تعذر تسجيل الخروج.',true);}});
$('createPatient').addEventListener('click',e=>{e.preventDefault();addNewPatient(e.currentTarget);});
$('createVisit').addEventListener('click',e=>submitVisit(e.currentTarget));
$('patientSearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(searchPatients,300);});
$('patientSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchPatients();}});
$('catalogSearch').addEventListener('input',renderCatalog);
$('discount').addEventListener('input',updateTotals);$('initialPayment').addEventListener('input',updateTotals);
$('resetSelection').addEventListener('click',()=>{state.selected.clear();renderCatalog();});
$('clearIntake').addEventListener('click',clearIntake);
$('cancelNewPatient').addEventListener('click',()=>{$('newPatientDetails').open=false;$('newPatientForm').reset();});
$('refreshRecent').addEventListener('click',()=>loadRecent().catch(e=>notice(e.message||'تعذر تحديث الزيارات.',true)));
$('refreshBalances').addEventListener('click',()=>loadBalances());
$('printPaymentReceipt').addEventListener('click',()=>window.print());
$('balancesList').addEventListener('click',e=>{const button=e.target.closest('.collect-balance');if(button)collectBalance(button);});
$('recentVisits').addEventListener('click',e=>{const button=e.target.closest('.open-visit-results');if(button)goToResults(button.dataset.visitId);});
$('goToResults').addEventListener('click',()=>goToResults());
$('newPatientAfterSave').addEventListener('click',()=>{clearIntake();focusNewPatient();});
$('initialPayment').addEventListener('change',updateTotals);
bindKeyboard();
try{await start();}catch(error){notice(error.message||'تعذر تهيئة شاشة الاستقبال.',true);}
