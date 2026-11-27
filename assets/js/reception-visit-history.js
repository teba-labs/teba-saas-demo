import { listVisitHistory, warmVisitHistory, updatePatientDemographics, updateVisitDetails, cancelVisit, cancelVisitTest, deleteVisitPermanently, hideVisitOnThisDevice } from '../../modules/reception/visit-management-repository.js';
import { addTestToVisit } from '../../modules/reception/repository.js';
import { listCatalog } from '../../modules/catalog/repository.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={context:null,page:0,pageSize:20,rows:new Map(),busy:false,searchTimer:null};
const statusLabel={open:'مفتوحة',in_progress:'قيد العمل',ready_for_review:'جاهزة للمراجعة',approved:'معتمدة',published:'منشورة',cancelled:'ملغاة'};
function notice(message,error=false){
 const el=$('notice');if(!el)return;el.textContent=message;el.className='notice show'+(error?' error':'');
 clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.className='notice',6500);
}
function getContext(){return window.taibaGetReceptionContext?.()||null;}
function staffId(){return $('staffSelect')?.value||state.context?.staffId||null;}
function init(){state.context=getContext();if(!state.context?.tenantId)return;load().catch(error=>notice(error.message||'تعذر تحميل سجل الزيارات.',true));}
async function load(){
 const c=getContext();if(!c?.tenantId)return;
 state.context=c;
 const host=$('visitHistoryList');if(!host)return;
 host.innerHTML='<p class="muted">جارٍ تحميل سجل الزيارات بالكامل…</p>';
 try{
   const result=await listVisitHistory({tenantId:c.tenantId,branchId:c.branchId,accountType:c.accountType,
     search:$('visitHistorySearch')?.value||'',page:state.page,pageSize:state.pageSize});
   state.rows=new Map(result.rows.map(row=>[row.id,row]));
   $('visitHistoryTotal').textContent=result.offline
     ?'الزيارات المتاحة على هذا الجهاز: '+result.totalCount+' (قد لا تشمل كامل سجل السحابة)'
     :'إجمالي الزيارات المسجلة للمعمل: '+result.totalCount+' · نتائج البحث: '+result.count;
   $('visitHistoryScope').textContent=result.offline?'عرض محلي دون اتصال':c.accountType==='owner'?'بحث في جميع فروع المعمل':'بحث في زيارات الفرع الحالي';
   $('visitHistoryPrev').disabled=state.page===0;
   $('visitHistoryNext').disabled=(state.page+1)*state.pageSize>=result.count;
   const from= result.count ? state.page*state.pageSize+1 : 0;
   const to= Math.min((state.page+1)*state.pageSize,result.count);
   $('visitHistoryPage').textContent='عرض '+from+'–'+to+' من '+result.count;
   $('visitHistoryLoadOffline').disabled=result.offline;
   if(!result.rows.length){host.innerHTML='<p class="muted">لا توجد زيارات مطابقة للبحث.</p>';return;}
   host.innerHTML=result.rows.map(row=>{
     const patient=row.patients||{},tests=(row.visit_tests||[]);
     const branch=c.branches?.find(b=>b.id===row.branch_id);
     const testsHtml=tests.length?'<div class="visit-history-tests"><strong>تحاليل الزيارة</strong>'+tests.map(test=>
       '<div class="visit-history-test"><span>'+esc(test.test_name_snapshot||'تحليل')+' · '+esc(test.status==='cancelled'?'ملغى':'')+'</span>'+
       (test.status!=='cancelled'&&row.status!=='cancelled'?'<button type="button" class="button button-ghost" data-history-action="cancel-test" data-visit-id="'+esc(row.id)+'" data-test-id="'+esc(test.id)+'">إزالة التحليل</button>':'')+'</div>'
     ).join('')+'</div>':'<div class="visit-history-tests muted">لا توجد تحاليل محملة لهذه الزيارة.</div>';
     const canAdd=!['approved','published','cancelled'].includes(row.status)&&!row.is_published;
     const actions=[
       '<button type="button" class="button button-secondary" data-history-action="open" data-visit-id="'+esc(row.id)+'">فتح النتائج</button>',
       '<button type="button" class="button button-secondary" data-history-action="edit-patient" data-visit-id="'+esc(row.id)+'">تعديل بيانات المريض</button>',
       '<button type="button" class="button button-secondary" data-history-action="edit-visit" data-visit-id="'+esc(row.id)+'">تعديل الزيارة</button>',
       canAdd?'<button type="button" class="button button-secondary" data-history-action="add-test" data-visit-id="'+esc(row.id)+'">إضافة تحليل</button>':'',
       row.status!=='cancelled'?'<button type="button" class="button button-ghost" data-history-action="cancel-visit" data-visit-id="'+esc(row.id)+'">إلغاء الزيارة</button>':'<span class="pill">ملغاة</span>',
       '<button type="button" class="button button-ghost" data-history-action="hide-device" data-visit-id="'+esc(row.id)+'">إخفاء من هذا الجهاز</button>',
       c.accountType==='owner'?'<button type="button" class="button button-danger" data-history-action="delete-visit" data-visit-id="'+esc(row.id)+'">حذف نهائي</button>':''
     ].join('');
     return '<article class="visit-history-card"><div class="visit-history-main"><div><strong>'+esc(patient.full_name||row.patient_name||'مريض')+'</strong>'+
       '<small>زيارة '+esc(row.visit_number)+' · '+esc(row.visit_work_date||'—')+' · '+esc(statusLabel[row.status]||row.status||'—')+
       (branch?' · '+esc(branch.name):'')+'</small><small>'+esc(patient.phone||'بدون هاتف')+' · كود الملف '+esc(patient.patient_number||'—')+'</small></div>'+
       '<div class="visit-history-actions">'+actions+'</div></div>'+testsHtml+'</article>';
   }).join('');
 }catch(error){host.innerHTML='<p class="muted">تعذر تحميل سجل الزيارات: '+esc(error.message||'خطأ غير معروف')+'</p>';throw error;}
}
function ensureDialog(){
 let dialog=$('visitManagementDialog');
 if(dialog)return dialog;
 dialog=document.createElement('dialog');dialog.id='visitManagementDialog';dialog.className='visit-management-dialog';
 document.body.append(dialog);return dialog;
}
function openForm(title,fields,onSave){
 const dialog=ensureDialog();
 dialog.innerHTML='<form method="dialog" class="visit-management-form"><header><h2>'+esc(title)+'</h2><button type="button" class="dialog-close" aria-label="إغلاق">×</button></header>'+
   fields+'<footer><button type="button" class="button button-ghost dialog-cancel">إلغاء</button><button type="submit" class="button button-primary">حفظ التعديلات</button></footer></form>';
 const form=dialog.querySelector('form');
 dialog.querySelectorAll('.dialog-close,.dialog-cancel').forEach(b=>b.addEventListener('click',()=>dialog.close()));
 form.addEventListener('submit',async event=>{
   event.preventDefault();const save=form.querySelector('[type=submit]');save.disabled=true;
   try{await onSave(new FormData(form));dialog.close();}
   catch(error){save.disabled=false;notice(error.message||'تعذر حفظ التعديل.',true);}
 });
 dialog.showModal();form.querySelector('input,textarea,select')?.focus();
}
async function editPatient(row){
 const p=row.patients||{};
 const fields='<label>اسم المريض<input name="full_name" maxlength="160" required value="'+esc(p.full_name||'')+'"></label>'+
 '<label>رقم الهاتف<input name="phone" type="tel" inputmode="tel" value="'+esc(p.phone||'')+'"></label>'+
 '<div class="visit-form-grid"><label>العمر<input name="age_value" type="number" min="0" step="any" value="'+esc(p.age_value??'')+'"></label>'+
 '<label>وحدة العمر<select name="age_unit"><option value="years" '+(p.age_unit==='years'?'selected':'')+'>سنة</option><option value="months" '+(p.age_unit==='months'?'selected':'')+'>شهر</option><option value="days" '+(p.age_unit==='days'?'selected':'')+'>يوم</option></select></label></div>'+
 '<label>تاريخ الميلاد<input name="date_of_birth" type="date" value="'+esc(p.date_of_birth||'')+'"></label>'+
 '<label>النوع<select name="sex"><option value="male" '+(p.sex==='male'?'selected':'')+'>ذكر</option><option value="female" '+(p.sex==='female'?'selected':'')+'>أنثى</option><option value="other" '+(p.sex==='other'?'selected':'')+'>آخر</option><option value="unknown" '+(!p.sex||p.sex==='unknown'?'selected':'')+'>غير محدد</option></select></label>';
 openForm('تعديل بيانات المريض',fields,async form=>{
   const c=getContext();const result=await updatePatientDemographics({tenantId:c.tenantId,branchId:row.branch_id,staffId:staffId(),patient:{...p,id:p.id,updated_at:p.updated_at,
     full_name:form.get('full_name'),phone:form.get('phone'),age_value:form.get('age_value'),age_unit:form.get('age_unit'),
     date_of_birth:form.get('date_of_birth'),sex:form.get('sex')}});
   notice(result.queued?'تم حفظ تعديل المريض محليًا وسيُزامن عند عودة الإنترنت.':'تم تحديث بيانات المريض.');
   await load();
 });
}
async function editVisit(row){
 const fields='<label>الطبيب / جهة التحويل<input name="referred_by" maxlength="160" value="'+esc(row.referred_by||'')+'"></label>'+
 '<label>ملاحظات الزيارة<textarea name="notes" rows="4" maxlength="1000">'+esc(row.notes||'')+'</textarea></label>';
 openForm('تعديل بيانات الزيارة',fields,async form=>{
   const c=getContext();const result=await updateVisitDetails({tenantId:c.tenantId,branchId:row.branch_id,staffId:staffId(),
     visit:{...row,referred_by:form.get('referred_by'),notes:form.get('notes')}});
   notice(result.queued?'تم حفظ تعديل الزيارة محليًا وسيُزامن تلقائيًا.':'تم تحديث بيانات الزيارة.');
   await load();
 });
}
async function addTest(row){
 const c=getContext();let catalog=[];
 try{catalog=await listCatalog({tenantId:c.tenantId,branchId:row.branch_id});}
 catch(error){notice(error.message||'تعذر تحميل كتالوج التحاليل.',true);return;}
 const active=catalog.filter(t=>t.is_active);
 if(!active.length){notice('لا توجد تحاليل نشطة في كتالوج هذا الفرع.',true);return;}
 const dialog=ensureDialog();
 dialog.innerHTML='<section class="visit-management-form"><header><h2>إضافة تحليل للزيارة '+esc(row.visit_number)+'</h2><button type="button" class="dialog-close" aria-label="إغلاق">×</button></header>'+
 '<label>ابحث باسم التحليل أو الكود<input type="search" id="historyCatalogSearch" placeholder="اكتب اسم التحليل"></label>'+
 '<div id="historyCatalogRows" class="history-catalog-rows"></div><footer><button type="button" class="button button-ghost dialog-cancel">إغلاق</button></footer></section>';
 const results=dialog.querySelector('#historyCatalogRows'),search=dialog.querySelector('#historyCatalogSearch');
 const draw=()=>{
   const term=search.value.trim().toLowerCase();const filtered=active.filter(t=>(String(t.name)+' '+String(t.code)).toLowerCase().includes(term)).slice(0,100);
   results.innerHTML=filtered.length?filtered.map(t=>'<div><span><strong>'+esc(t.name)+'</strong><small>'+esc(t.code)+'</small></span><button type="button" class="button button-secondary" data-catalog-id="'+esc(t.id)+'">إضافة</button></div>').join(''):'<p class="muted">لا توجد تحاليل مطابقة.</p>';
 };
 search.addEventListener('input',draw);
 dialog.querySelectorAll('.dialog-close,.dialog-cancel').forEach(b=>b.addEventListener('click',()=>dialog.close()));
 results.addEventListener('click',async event=>{
   const b=event.target.closest('[data-catalog-id]');if(!b)return;b.disabled=true;b.textContent='جارٍ الإضافة…';
   try{
     const added=await addTestToVisit({tenantId:c.tenantId,branchId:row.branch_id,visitId:row.id,testId:b.dataset.catalogId,staffId:staffId()});
     dialog.close();notice(added?.queued?'تم وضع التحليل في قائمة المزامنة، وسيظهر في الزيارة بعد المزامنة.':'تمت إضافة التحليل للزيارة.');
     await load();
   }catch(error){b.disabled=false;b.textContent='إضافة';notice(error.message||'تعذرت إضافة التحليل.',true);}
 });
 draw();dialog.showModal();search.focus();
}
async function handleAction(button){
 const action=button.dataset.historyAction,row=state.rows.get(button.dataset.visitId);if(!row)return;
 let c=getContext();button.disabled=true;
 try{
  if(row.branch_id!==c.branchId){
    if(c.accountType!=='owner'||typeof window.taibaSwitchReceptionBranch!=='function')throw new Error('هذه الزيارة تخص فرعًا آخر. اختر الفرع من أعلى الشاشة ثم أعد المحاولة.');
    await window.taibaSwitchReceptionBranch(row.branch_id);
    c=getContext();
  }
  if(action==='open'){window.taibaOpenVisitFromHistory?.(row.id,row.branch_id);return;}
  if(action==='edit-patient'){await editPatient(row);return;}
  if(action==='edit-visit'){await editVisit(row);return;}
  if(action==='add-test'){await addTest(row);return;}
  if(action==='cancel-test'){
    const test=(row.visit_tests||[]).find(x=>x.id===button.dataset.testId);if(!test)return;
    if(!window.confirm('إزالة التحليل '+(test.test_name_snapshot||'')+' من الزيارة؟ سيُحفظ كسجل ملغى ولن يُحذف من سجل التدقيق.'))return;
    const result=await cancelVisitTest({tenantId:c.tenantId,branchId:row.branch_id,visitTest:test,staffId:staffId()});
    notice(result.queued?'تمت جدولة إزالة التحليل للمزامنة.':'تمت إزالة التحليل من الزيارة.');await load();return;
  }
  if(action==='cancel-visit'){
    if(!window.confirm('إلغاء الزيارة '+row.visit_number+'؟ ستختفي من قائمة العمل وتظل بياناتها محفوظة في السجل.'))return;
    const result=await cancelVisit({tenantId:c.tenantId,branchId:row.branch_id,visitId:row.id,staffId:staffId()});
    notice(result.queued?'تم حفظ الإلغاء محليًا وسيُزامن عند عودة الإنترنت.':'تم إلغاء الزيارة مع الاحتفاظ بسجلها.');await load();return;
  }
  if(action==='hide-device'){
    if(!window.confirm('إخفاء هذه الزيارة من هذا الجهاز فقط؟ ستظل محفوظة على السحابة وفي بقية الأجهزة.'))return;
    await hideVisitOnThisDevice({tenantId:c.tenantId,branchId:row.branch_id,visitId:row.id});
    notice('تم إخفاء الزيارة من هذا الجهاز فقط.');await load();return;
  }
  if(action==='delete-visit'){
    if(c.accountType!=='owner'){notice('الحذف النهائي متاح لمالك المعمل فقط.',true);return;}
    if(!window.confirm('حذف نهائي من السحابة وكل الأجهزة؟ هذا الإجراء لا يمكن التراجع عنه. لن يُسمح به إذا كانت الزيارة مرتبطة بتحصيل أو تقرير منشور أو مرفق.'))return;
    const confirmText=window.prompt('للتأكيد اكتب كلمة حذف');
    if(confirmText!=='حذف')return;
    const result=await deleteVisitPermanently({tenantId:c.tenantId,branchId:row.branch_id,visitId:row.id,staffId:staffId()});
    notice(result?.deleted?'تم حذف الزيارة نهائيًا.':'لم يتم تأكيد الحذف.');await load();return;
  }
 }catch(error){notice(error.message||'تعذر تنفيذ الإجراء.',true);}
 finally{button.disabled=false;}
}
$('visitHistoryList')?.addEventListener('click',event=>{const button=event.target.closest('[data-history-action]');if(button)handleAction(button);});
$('refreshRecent')?.addEventListener('click',()=>load().catch(error=>notice(error.message||'تعذر تحديث سجل الزيارات.',true)));
$('visitHistorySearch')?.addEventListener('input',()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>{state.page=0;load().catch(e=>notice(e.message,true));},250);});
$('visitHistoryPrev')?.addEventListener('click',()=>{state.page=Math.max(0,state.page-1);load().catch(e=>notice(e.message,true));});
$('visitHistoryNext')?.addEventListener('click',()=>{state.page+=1;load().catch(e=>notice(e.message,true));});
$('visitHistoryLoadOffline')?.addEventListener('click',async event=>{
 const b=event.currentTarget;b.disabled=true;b.textContent='جارٍ حفظ السجل…';
 try{const c=getContext();const result=await warmVisitHistory({tenantId:c.tenantId,branchId:c.branchId,accountType:c.accountType,maxRows:50000});
   notice(result.truncated?'تم حفظ '+result.cachedRows+' زيارة محليًا. ما زال هناك سجل أقدم من الحد المحمّل.':'تم حفظ كل '+result.cachedRows+' زيارة في التخزين المحلي المتاح.');
   state.page=0;await load();
 }catch(error){notice(error.message||'تعذر تحميل السجل دون إنترنت.',true);}
 finally{b.disabled=false;b.textContent='تجهيز السجل للعمل دون إنترنت';}
});
document.addEventListener('taiba:reception-context',init);
document.addEventListener('taiba:visit-history-refresh',()=>load().catch(error=>notice(error.message,true)));
if(getContext())init();
