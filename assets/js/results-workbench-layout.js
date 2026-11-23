import { listCatalog } from '../../modules/catalog/repository.js';
import { addTestToVisit } from '../../modules/reception/repository.js';
import { listHiddenWorkbenchVisits, setVisitWorkbenchHidden } from '../../modules/laboratory/repository.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedVisitId = null, catalogCache = null, rebuilding = false;
function button(label, cls='button button-secondary'){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;return b;}
function buildShell(host,cards){
 if(rebuilding)return;rebuilding=true;
 window.taibaResultsContext=window.taibaGetResultsContext?.()||window.taibaResultsContext||{};
 const records=cards.map(card=>{
  const header=card.querySelector(':scope > .card-head');
  const visitId=card.dataset.visitId||card.querySelector('[data-visit-id]')?.dataset.visitId;
  const tests=[...card.querySelectorAll(':scope > .parameter')];
  const actions=[...card.children].filter(node=>node!==header&&!tests.includes(node));
  card.classList.add('work-source-card');
  return {card,visitId,title:header?.querySelector('h2')?.textContent||'زيارة',status:header?.querySelector('.pill')?.textContent||'',visitStatus:card.dataset.visitStatus||'open',tests,actions,phone:card.dataset.patientPhone||'',patientAge:card.dataset.patientAge||'',patientAgeUnit:card.dataset.patientAgeUnit||'',patientSex:card.dataset.patientSex||'',visitDate:card.dataset.visitDate||'',visitNumber:card.dataset.visitNumber||'',published:card.dataset.published==='true'};
 }).filter(x=>x.visitId);
 host.replaceChildren();
 const shell=document.createElement('div');shell.className='results-workbench-shell';
 const bar=document.createElement('section');bar.className='results-actionbar panel';
 bar.innerHTML='<div class="results-actionbar-title"><strong>إجراءات الزيارة المحددة</strong><span class="muted" data-selected-visit-label>اختر زيارة من العمود الأول</span></div><div class="results-actionbar-buttons" data-visit-actions></div>';
 const columns=document.createElement('div');columns.className='results-columns';
 const visits=document.createElement('section');visits.className='results-column visits-column';
 visits.innerHTML='<div class="results-column-head"><h2>الزيارات</h2><span class="pill" data-visit-count></span></div><input class="visit-filter" type="search" placeholder="ابحث باسم المريض أو رقم الزيارة"><button type="button" class="button button-secondary hidden-visits-toggle">الحالات المخفية</button><div class="hidden-visits-list" hidden></div><div class="visit-list" data-visit-list></div>';
 const individual=document.createElement('section');individual.className='results-column tests-column';
 individual.innerHTML='<div class="results-column-head"><h2>التحاليل الفردية</h2><span class="pill" data-individual-count>0</span></div><div class="catalog-tools"><input type="search" placeholder="بحث في التحاليل الفردية" data-catalog-search><button type="button" class="button button-secondary" data-catalog-toggle>+ إضافة تحليل</button></div><div class="catalog-results" data-catalog-results hidden></div><div class="test-workspace" data-individual-workspace><div class="empty">اختر زيارة لعرض التحاليل الفردية.</div></div>';
 const profiles=document.createElement('section');profiles.className='results-column tests-column';
 profiles.innerHTML='<div class="results-column-head"><h2>البروفايلات</h2><span class="pill" data-profile-count>0</span></div><div class="catalog-tools"><input type="search" placeholder="بحث في البروفايلات" data-catalog-search><button type="button" class="button button-secondary" data-catalog-toggle>+ إضافة بروفايل</button></div><div class="catalog-results" data-catalog-results hidden></div><div class="test-workspace" data-profile-workspace><div class="empty">اختر زيارة لعرض البروفايلات.</div></div>';
 columns.append(visits,individual,profiles);shell.append(bar,columns);host.append(shell);
 const source=document.createElement('div');source.className='results-source-records';source.hidden=true;records.forEach(r=>source.append(r.card));host.append(source);
 const list=visits.querySelector('[data-visit-list]');
 records.forEach(record=>{const b=button(record.title+' · '+record.status,'visit-select-button');b.dataset.visitId=record.visitId;b.addEventListener('click',()=>selectRecord(record,records,shell));list.append(b);});
 visits.querySelector('.visit-filter').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();list.querySelectorAll('button').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(q));});
 visits.querySelector('[data-visit-count]').textContent=String(records.length);
 visits.querySelector('.hidden-visits-toggle').addEventListener('click',()=>loadHiddenVisits(visits));
 shell.querySelectorAll('[data-catalog-toggle]').forEach(b=>b.addEventListener('click',()=>toggleCatalog(b,b.closest('.results-column'),records)));
 if(records.length){const requested=new URLSearchParams(location.search).get('visit_id');selectRecord(records.find(r=>r.visitId===requested)||records.find(r=>r.visitId===window.taibaLastSelectedVisitId)||records[0],records,shell);}
 rebuilding=false;
}
function testLauncher(node,record,kind,workspace){
 const name=node.querySelector('.card-head strong')?.textContent?.trim()||'تحليل';
 const status=node.querySelector('.card-head .pill')?.textContent?.trim()||'قيد العمل';
 const open=button('', 'test-launch-card');
 open.innerHTML='<span><strong>'+esc(name)+'</strong><small>'+esc(status)+' · '+(kind==='profile'?'بروفايل':'تحليل فردي')+'</small></span><b class="launch-arrow" aria-hidden="true">←</b>';
 open.addEventListener('click',()=>{
  const list=workspace.querySelector('.test-launch-list');
  if(!list)return;
  const previous=workspace.querySelector('.test-detail');
  if(previous){
   const previousNode=previous.querySelector('.parameter[data-test-id]');
   const previousMarker=previousNode?.previousSibling;
   if(previousNode&&previousMarker?.nodeType===8)previousMarker.replaceWith(previousNode);
   previous.remove();list.hidden=false;
  }
  const placeholder=document.createComment('test-card-placeholder');
  node.before(placeholder);
  const detail=document.createElement('section');detail.className='test-detail';
  const back=button('رجوع لقائمة التحاليل','button button-secondary test-detail-back');
  back.addEventListener('click',()=>{
   placeholder.replaceWith(node);detail.remove();list.hidden=false;
  });
  detail.append(back,node);list.hidden=true;workspace.append(detail);
  node.scrollIntoView({behavior:'smooth',block:'start'});
 });
 return open;
}
function selectRecord(record,records,shell){
 if(window.taibaGetDirtyResultInputs?.().length){window.alert('احفظ نتائج الزيارة الحالية قبل تغيير الاختيار أو الانتقال إلى زيارة أخرى.');return;}
 // Restore any open editor to its source card before rebuilding the selected visit.
 shell.querySelectorAll('.test-detail').forEach(detail=>{
  const node=detail.querySelector('.parameter[data-test-id]'),marker=node?.previousSibling;
  if(node&&marker?.nodeType===8)marker.replaceWith(node);
  detail.remove();
 });
 selectedVisitId=record.visitId;window.taibaLastSelectedVisitId=selectedVisitId;window.taibaResultsContext=window.taibaGetResultsContext?.()||window.taibaResultsContext||{};
 shell.querySelectorAll('.visit-select-button').forEach(b=>b.classList.toggle('active',b.dataset.visitId===selectedVisitId));
 shell.querySelector('[data-selected-visit-label]').textContent=record.title;
 const individual=record.tests.filter(node=>node.dataset.testKind!=='panel'),panels=record.tests.filter(node=>node.dataset.testKind==='panel');
 if(document.body.classList.contains('result-entry-page')){
  const requested=new URLSearchParams(location.search).get('visit_test_id');
  const node=record.tests.find(item=>item.dataset.testId===requested);
  const entry=$('entryWorkspace'),view=$('entryView');
  if(!node){entry.innerHTML='<div class="empty">لم يتم العثور على التحليل داخل الزيارة المحددة. ارجع لقائمة النتائج وافتح التحليل مرة أخرى.</div>';view.hidden=false;shell.hidden=true;return;}
  $('entryTitle').textContent=node.querySelector('.card-head strong')?.textContent?.trim()||'تسجيل نتيجة التحليل';
  $('entryContext').textContent=[record.title,record.visitDate,record.patientSex==='male'?'ذكر':record.patientSex==='female'?'أنثى':'',record.patientAge?('العمر '+record.patientAge+' '+({days:'يوم',months:'شهر',years:'سنة'}[record.patientAgeUnit]||'')):'',record.phone?'الهاتف '+record.phone:''].filter(Boolean).join(' · ');
  const back=new URL('results-workbench.html',location.href);back.searchParams.set('visit_id',record.visitId);$('entryBack').href=back.href;
  const visitActions=document.createElement('div');visitActions.className='entry-visit-actions';
  const saveButton=button('حفظ كل النتائج','button button-secondary');
  saveButton.addEventListener('click',()=>window.taibaSaveVisitDrafts?.(record.visitId,saveButton));
  const approveButton=button('اعتماد الزيارة','button button-primary');
  approveButton.addEventListener('click',()=>window.taibaApproveVisit?.(record.visitId,approveButton));
  const previewButton=button('معاينة التقرير','button button-preview');
  previewButton.addEventListener('click',()=>window.taibaPreviewVisitReport?.(record.visitId));
  visitActions.append(saveButton,approveButton,previewButton);
  entry.replaceChildren(visitActions,node);view.hidden=false;shell.hidden=true;return;
 }
 const ih=shell.querySelector('[data-individual-workspace]'),ph=shell.querySelector('[data-profile-workspace]');ih.replaceChildren();ph.replaceChildren();
 if(individual.length){const list=document.createElement('div');list.className='test-launch-list';individual.forEach(node=>list.append(testLauncher(node,record,'individual',ih)));ih.append(list);}
 else ih.innerHTML='<div class="empty">لا توجد تحاليل فردية في هذه الزيارة.</div>';
 if(panels.length){const list=document.createElement('div');list.className='test-launch-list';panels.forEach(node=>list.append(testLauncher(node,record,'profile',ph)));ph.append(list);}
 else ph.innerHTML='<div class="empty">لا توجد بروفايلات في هذه الزيارة.</div>';
 shell.querySelector('[data-individual-count]').textContent=String(individual.length);shell.querySelector('[data-profile-count]').textContent=String(panels.length);
 const actions=shell.querySelector('[data-visit-actions]');actions.replaceChildren();record.actions.forEach(node=>{if(!node.querySelector('.print-visit-report')&&!node.querySelector('.select-historical-report')&&!node.querySelector('[data-attachment-file]'))actions.append(node);});
 const preview=button('معاينة التقرير قبل الطباعة','button button-preview');
 preview.addEventListener('click',()=>{if(typeof window.taibaPreviewVisitReport!=='function'){window.alert('تعذر تحميل أداة معاينة التقرير.');return;}window.taibaPreviewVisitReport(record.visitId);});
 const hide=button('إخفاء الحالة من قائمة العمل','button button-secondary');
 hide.addEventListener('click',async()=>{if(window.taibaGetDirtyResultInputs?.().length){window.alert('احفظ النتائج قبل إخفاء الحالة.');return;}const reason=window.prompt('سبب إخفاء الحالة (اختياري):')||'';if(!window.confirm('سيتم إخفاء الحالة من قائمة العمل فقط، مع الاحتفاظ بكل نتائجها وسجلها. متابعة؟'))return;hide.disabled=true;try{await setVisitWorkbenchHidden({tenantId:window.taibaResultsContext.tenantId,branchId:window.taibaResultsContext.branchId,visitId:record.visitId,staffId:$('staffSelect')?.value,hidden:true,reason});window.dispatchEvent(new CustomEvent('taiba:results-work-refresh'));}catch(error){hide.disabled=false;window.alert(error.message||'تعذر إخفاء الحالة.');}});
 const whatsapp=button('إرسال واتساب للنتائج','button button-secondary');
 const rawPhone=String(record.phone||'').replace(/[^0-9+]/g,'');let waPhone=rawPhone.replace(/^00/,'');
 if(waPhone.startsWith('0'))waPhone='20'+waPhone.slice(1);else if(waPhone.startsWith('+'))waPhone=waPhone.slice(1);
 const shareReady=record.published&&/^20\\d{9,11}$/.test(waPhone)&&Boolean(window.taibaResultsContext?.tenantSlug);
 whatsapp.disabled=!shareReady;whatsapp.title=shareReady?'إرسال رابط بوابة المريض عبر واتساب':'يتطلب رقم هاتف صالحًا وتقريرًا منشورًا ورمز معمل';
 whatsapp.addEventListener('click',()=>{if(!shareReady)return;const portal=new URL('../portal/index.html',location.href).href;const message='نتائج تحاليلك جاهزة من معامل '+(window.taibaResultsContext?.tenantSlug||'')+'. لعرض التقرير افتح بوابة النتائج: '+portal+' ثم أدخل رمز المعمل ورقم الزيارة '+record.visitNumber+' واسم المريض كما هو مسجل.';window.open('https://wa.me/'+waPhone+'?text='+encodeURIComponent(message),'_blank','noopener');});
 actions.prepend(whatsapp);actions.prepend(hide);actions.prepend(preview);
 shell.querySelectorAll('[data-catalog-results]').forEach(el=>{el.hidden=true;el.replaceChildren();});
 const canAdd=record.visitStatus!=='approved'&&!record.published;shell.querySelectorAll('[data-catalog-toggle]').forEach(b=>{b.disabled=!canAdd;b.title=canAdd?'إضافة تحليل لهذه الزيارة':'لا يمكن إضافة تحاليل بعد اعتماد الزيارة أو نشرها';});
}
async function loadHiddenVisits(column){
 const host=column.querySelector('.hidden-visits-list');if(!host.hidden){host.hidden=true;return;}host.hidden=false;host.textContent='جارٍ تحميل الحالات المخفية…';
 try{const rows=await listHiddenWorkbenchVisits({tenantId:window.taibaResultsContext.tenantId,branchId:window.taibaResultsContext.branchId});host.innerHTML=rows.length?rows.map(row=>'<div class="hidden-visit-row"><span><strong>'+esc(row.patients?.full_name||'مريض')+'</strong><small>زيارة '+esc(row.visit_number)+' · '+esc(row.visit_work_date||'')+'</small></span><button type="button" class="button button-secondary" data-restore-visit="'+esc(row.id)+'">استعادة</button></div>').join(''):'<p class="muted">لا توجد حالات مخفية.</p>';
 host.querySelectorAll('[data-restore-visit]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{await setVisitWorkbenchHidden({tenantId:window.taibaResultsContext.tenantId,branchId:window.taibaResultsContext.branchId,visitId:b.dataset.restoreVisit,staffId:$('staffSelect')?.value,hidden:false});window.dispatchEvent(new CustomEvent('taiba:results-work-refresh'));}catch(error){b.disabled=false;window.alert(error.message||'تعذرت استعادة الحالة.');}}));
 }catch(error){host.textContent=error.message||'تعذر تحميل الحالات المخفية.';}
}
async function toggleCatalog(button,column,records){
 const host=column.querySelector('[data-catalog-results]');if(!host.hidden){host.hidden=true;return;}if(!selectedVisitId){window.alert('اختر زيارة أولًا.');return;}
 host.hidden=false;host.textContent='جارٍ تحميل الكتالوج…';
 try{
  catalogCache ||= await listCatalog({tenantId:window.taibaResultsContext?.tenantId});
  const isIndividual=column.querySelector('h2').textContent.includes('الفردية');
  const rows=catalogCache.filter(row=>row.is_active&&(isIndividual?row.test_kind!=='panel':row.test_kind==='panel'));
  const current=records.find(r=>r.visitId===selectedVisitId),currentCodes=new Set((current?.tests||[]).map(node=>node.dataset.testCode));
  const search=column.querySelector('[data-catalog-search]');
  const draw=()=>{const term=search.value.trim().toLowerCase();const filtered=rows.filter(row=>(row.name+' '+row.code).toLowerCase().includes(term));
   host.innerHTML=filtered.length?filtered.map(row=>'<div class="catalog-result-row"><span><strong>'+esc(row.name)+'</strong><small>'+esc(row.code)+'</small></span><button type="button" class="button button-secondary" data-add-test="'+esc(row.id)+'" '+(currentCodes.has(row.code)?'disabled':'')+'>'+(currentCodes.has(row.code)?'مضاف':'إضافة')+'</button></div>').join(''):'<p class="muted">لا توجد نتائج مطابقة.</p>';
   host.querySelectorAll('[data-add-test]').forEach(add=>add.addEventListener('click',async()=>{if(window.taibaGetDirtyResultInputs?.().length){window.alert('احفظ النتائج الحالية قبل إضافة تحليل جديد.');return;}add.disabled=true;add.textContent='جارٍ الإضافة…';try{await addTestToVisit({tenantId:window.taibaResultsContext.tenantId,branchId:window.taibaResultsContext.branchId,visitId:selectedVisitId,testId:add.dataset.addTest,staffId:$('staffSelect')?.value});window.dispatchEvent(new CustomEvent('taiba:results-work-refresh'));}catch(error){add.disabled=false;add.textContent='إضافة';window.alert(error.message||'تعذرت إضافة التحليل.');}}));
  };search.oninput=draw;draw();
 }catch(error){host.textContent=error.message||'تعذر تحميل كتالوج التحاليل.';}
}
const host=$('workList');
if(host){const observer=new MutationObserver(()=>{const cards=[...host.querySelectorAll(':scope > .work-card')];if(cards.length&&!host.querySelector('.results-workbench-shell'))buildShell(host,cards);});observer.observe(host,{childList:true,subtree:false});}
document.addEventListener('taiba:results-context',event=>{window.taibaResultsContext=event.detail;catalogCache=null;});

if(document.body.classList.contains('result-entry-page')){
 const back=$('entryBack');
 back?.addEventListener('click',event=>{
  if(window.taibaGetDirtyResultInputs?.().length){
   event.preventDefault();
   window.alert('هناك نتائج لم يتم حفظها بعد. احفظ النتيجة أولًا قبل الرجوع لقائمة العمل.');
  }
 });
}

