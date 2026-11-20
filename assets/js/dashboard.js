import { mountHistoricalWorkbookPanel, renderLiveHistoricalReconciliation } from './dashboard-history.js';
import { signInWithEmail, getCurrentSession, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { getOwnerMonthlyDashboard, getOwnerTestRangeReport } from '../../dashboard/repository.js';
import { getPreviousMonthRange, getSameMonthPreviousYearRange, compareDashboardPeriods, buildBranchPerformanceMetrics } from '../../modules/dashboard/period-comparison.js';
const $ = id => document.getElementById(id);
const state = { context: null, tenant: null, report: null, previousReport: null, previousYearReport: null };
const money = value => `${Number(value || 0).toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2})} ج.م`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function currentMonth(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function monthRange(value){if(!/^\d{4}-\d{2}$/.test(value))throw new Error('اختر شهرًا صحيحًا.');const [y,m]=value.split('-').map(Number);const start=`${y}-${String(m).padStart(2,'0')}-01`;const next=new Date(y,m,1);return {monthStart:start,monthEnd:`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-01`};}
function notify(message,error=false){$('notice').textContent=message;$('notice').className=`notice show${error?' error':''}`;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('notice').className='notice',6000);}

const OWNER_REPORTS=[
 ['dailyFinance','الحركة المالية اليومية','التحصيل والمصروفات المسجلة وسجل الحركات'],
 ['reconciliation','المطابقة الشهرية','مطابقة التشغيل الحي مع أرشيف Excel دون دمج المصدرين'],
 ['live','الإحصائيات المباشرة','ملخص الحالات والتحاليل والتحصيل والمصروفات'],
 ['overview','نظرة عامة','مؤشرات المعمل ومقارنة الفروع'],
 ['financial','التقرير الشهري','أداء الشهر ومقارنته بالشهر السابق'],
 ['annual','التقرير السنوي','مقارنة الشهر نفسه بالعام السابق واتجاه الأداء'],
 ['cases','تحليل أعداد الحالات','الحركة اليومية وعدد الزيارات والتحاليل'],
 ['expenseBreakdown','تفصيل المصروفات','المصروفات حسب الفرع وبند الصرف'],
 ['bcg','تصنيف BCG','المحفظة التاريخية وتصنيف التحاليل'],
 ['testReport','تقرير التحاليل التفصيلي','بحث التحاليل خلال فترة محددة'],
 ['monthlyPlan','خطة الشهر','الخطة الاسترشادية المبنية على الموسمية التاريخية'],
 ['topSellers','الأكثر طلبًا','ترتيب التحاليل حسب عدد الطلبات'],
 ['mostProfitable','الأكثر ربحًا','التحاليل الأعلى ربحًا وفق تكلفة Excel التاريخية'],
 ['leastProfitable','الأقل ربحية','التحاليل ذات هامش الربح الضعيف'],
 ['needOffers','تحاليل تحتاج عروضًا','فرص تنشيط الطلب وفق الأرشيف التاريخي'],
 ['lossMakers','التحاليل الخاسرة','التحاليل ذات ربح الوحدة السالب تاريخيًا'],
 ['upload','رفع ملفات Excel','إدارة ملفات الأرشيف التاريخي المحلي'],
 ['security','الأمان والنسخ الاحتياطي','حالة النسخ والمزامنة وحدود النسخ المحلية']
];
function panelByHeading(text){return [...$('workspace').querySelectorAll(':scope > .panel')].find(node=>node.querySelector('h2')?.textContent.trim()===text);}
function mountOwnerDashboardNavigation(){
 if($('ownerDashboardHome'))return;
 const home=document.createElement('section');home.id='ownerDashboardHome';home.className='owner-dashboard-home panel';
 home.innerHTML='<div class="owner-dashboard-title"><div><h2>مركز تقارير المالك</h2><p class="muted">اختر تقريرًا لفتح شاشته المستقلة. كل الأرقام المالية خاصة بالمالك.</p></div><span class="badge">18 تقريرًا</span></div><div class="owner-report-grid">'+OWNER_REPORTS.map(([id,title,desc],i)=>'<button type="button" class="owner-report-card" data-owner-report="'+id+'"><span class="owner-report-number">'+String(i+1).padStart(2,'0')+'</span><strong>'+title+'</strong><small>'+desc+'</small><span class="owner-report-open">فتح التقرير ←</span></button>').join('')+'</div>';
 const screens=document.createElement('section');screens.id='ownerDashboardScreens';screens.hidden=true;
 screens.innerHTML=OWNER_REPORTS.map(([id,title,desc])=>'<section class="owner-report-screen" data-owner-screen="'+id+'" hidden><div class="owner-screen-head"><div><p class="eyebrow">تقارير المالك / '+String(OWNER_REPORTS.findIndex(x=>x[0]===id)+1).padStart(2,'0')+'</p><h2>'+title+'</h2><p class="muted">'+desc+'</p></div><button type="button" class="btn secondary" data-owner-export="'+id+'">تصدير التقرير CSV</button><button type="button" class="btn secondary" data-owner-back>العودة إلى التقارير</button></div><div class="owner-screen-content" id="ownerContent-'+id+'"></div></section>').join('');
 const anchor=$('status').closest('.panel');
 anchor.after(home,screens);
 home.addEventListener('click',event=>{const button=event.target.closest('[data-owner-report]');if(button)showOwnerReport(button.dataset.ownerReport);});
 screens.addEventListener('click',event=>{const exportButton=event.target.closest('[data-owner-export]');if(exportButton){exportOwnerReport(exportButton.dataset.ownerExport);return;}if(event.target.closest('[data-owner-back]')){screens.hidden=true;home.hidden=false;window.scrollTo({top:home.offsetTop-12,behavior:'smooth'});}});
 const content=id=>$('ownerContent-'+id);
 const move=(id,node)=>{if(node)content(id).append(node);};
 move('live',$('workspace').querySelector('.kpis'));
 move('live',$('workspace').querySelector('.secondary-kpis'));
 move('financial',panelByHeading('مقارنة الشهر بالشهر السابق'));
 move('annual',panelByHeading('مقارنة نفس الشهر بالعام السابق'));
 move('reconciliation',panelByHeading('مطابقة التشغيل مع أرشيف Excel التاريخي'));
 move('cases',panelByHeading('الحركة اليومية'));
 move('expenseBreakdown',panelByHeading('تفصيل المصروفات حسب البند'));
 move('overview',panelByHeading('مقارنة الفروع'));
 move('testReport',panelByHeading('تقرير التحاليل خلال فترة محددة'));
 move('topSellers',panelByHeading('أكثر التحاليل حركة'));
 const historyPanel=panelByHeading('ملفات Excel التاريخية والتحليلات القديمة');
 if(historyPanel){
  const results=historyPanel.querySelector('#historyAnalysisResults');
  if(results)results.hidden=true;
  const period=historyPanel.querySelector('#historyMonth');
  const files=historyPanel.querySelector('#historyFilesList');
  const notice=historyPanel.querySelector('#historyNotice');
  const uploadPanel=document.createElement('section');uploadPanel.className='panel history-upload-panel';
  uploadPanel.append(notice,files);
  move('upload',uploadPanel);
  const controls=document.createElement('section');controls.className='panel';controls.innerHTML='<h3>الفترة التاريخية المختارة</h3>';
  if(period)controls.append(period.closest('label'));
  move('upload',controls);
  if(results){
   const source=results;
   const targets={bcg:'مصفوفة BCG التاريخية',monthlyPlan:'خطة الشهر التالي',cases:'موسمية الحالات حسب الشهر',topSellers:'الأكثر طلبًا',mostProfitable:'الأكثر ربحية',leastProfitable:'الأقل ربحية',needOffers:'تحاليل تحتاج تنشيطًا',lossMakers:'التحاليل الخاسرة',annual:'الملخص السنوي'};
   for(const [id,needle] of Object.entries({bcgDetails:'تفاصيل فئات BCG',annualTrend:'اتجاه الأداء المالي السنوي'})){
    const clone=document.createElement('section');clone.className='panel historical-report-card';
    content(id==='bcgDetails'?'bcg':'annual').append(clone);
    const sync=()=>filterHistoricalReport(source,clone,needle);
    new MutationObserver(sync).observe(source,{childList:true,subtree:true,characterData:true});
    sync();
   }
   for(const [id,needle] of Object.entries(targets)){
    const clone=document.createElement('section');clone.className='panel historical-report-card';clone.dataset.historyNeedle=needle;
    content(id).append(clone);
    const sync=()=>filterHistoricalReport(source,clone,needle);
    new MutationObserver(sync).observe(source,{childList:true,subtree:true,characterData:true});
    sync();
   }
  }
  move('upload',historyPanel);
 }
 const movement=document.createElement('section');movement.className='panel';movement.innerHTML='<h3>سجل الحركات المالية</h3><p class="muted">قراءة فقط من دفتر الحركات. تسجيل التحصيل والمصروفات يظل من شاشة يوم العمل لمنع تكرار الإدخال.</p><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الفرع</th><th>نوع الحركة</th><th>البيان</th><th>المبلغ</th></tr></thead><tbody id="ownerLedgerRows"><tr><td colspan="5">جارٍ تحميل الحركات…</td></tr></tbody></table></div>';
 content('dailyFinance').append(movement);
 const financeLink=document.createElement('a');financeLink.href='workday.html';financeLink.className='btn secondary owner-workday-link';financeLink.textContent='فتح شاشة يوم العمل لتسجيل حركة جديدة';content('dailyFinance').prepend(financeLink);
 const liveNote=document.createElement('p');liveNote.className='hint';liveNote.textContent='تعرض هذه المؤشرات بيانات التشغيل الحية للشهر والفرع المحددين. مؤشرات حالات التحاليل قيد التشغيل والمنشورة لم تُضف بعد لعدم اكتمال ربط مصدر حالتها في هذه الشاشة.';content('live').append(liveNote);
 const annualNote=document.createElement('p');annualNote.className='hint';annualNote.textContent='المقارنة أعلى الشاشة تقارن الشهر نفسه بالعام السابق، والجداول التاريخية أدناه تعرض السنة الكاملة من أرشيف Excel عند توفره.';content('annual').append(annualNote);
 const security=document.createElement('section');security.className='panel';security.innerHTML='<h3>حالة الأمان والنسخ</h3><p class="muted">عزل بيانات المعمل والصلاحيات تُطبّق من طبقة الحساب وقاعدة البيانات. الأرشيف التاريخي في هذه اللوحة محفوظ محليًا على هذا المتصفح فقط، وليس نسخة سحابية.</p><div class="security-status-grid"><article><strong>أرشيف Excel</strong><span>محلي على الجهاز</span></article><article><strong>النسخ السحابي</strong><span>غير مثبت كميزة استعادة كاملة في هذه النسخة</span></article><article><strong>إدارة المزامنة</strong><span>راجع مركز المزامنة والنسخ المحلي</span></article></div><a class="btn secondary" href="sync-center.html">فتح مركز المزامنة والنسخ</a><p class="hint">لا تعرض هذه الشاشة أن النسخة المحلية Backup سحابيًا، ولا تنفذ حذفًا أو استعادة تلقائية.</p>';
 content('security').append(security);
 const summary=panelByHeading('ملخص قابل للنسخ');move('overview',summary);
 const note=document.createElement('p');note.className='hint';note.textContent='صافي النقدية ليس صافي ربح محاسبيًا؛ لا تتوفر في التشغيل الحي تكلفة موثوقة لكل تحليل ضمن هذا التقرير.';content('overview').append(note);
 const historyHint=document.createElement('p');historyHint.className='hint';historyHint.textContent='يعرض كل تقرير تاريخي بيانات ملف Excel فقط. لا تخلط هذه النتائج مع التشغيل الحي.';for(const id of ['bcg','monthlyPlan','topSellers','mostProfitable','leastProfitable','needOffers','lossMakers'])content(id).prepend(historyHint.cloneNode(true));
 showOwnerReport('home');
}

function exportOwnerReport(id){
 const screen=$('ownerContent-'+id);if(!screen)return;
 const tables=[...screen.querySelectorAll('table')];
 const cards=[...screen.querySelectorAll('.kpi')];
 if(!tables.length&&!cards.length){notify('لا توجد بيانات قابلة للتصدير في هذا التقرير.',true);return;}
 const rows=[];
 if(!tables.length&&cards.length)for(const card of cards)rows.push([card.querySelector('span')?.textContent||'',card.querySelector('strong')?.textContent||'',card.querySelector('small')?.textContent||'']);
 for(const [index,table] of tables.entries()){
  if(index)rows.push([]);
  const heading=table.closest('.panel')?.querySelector('h4,h3,h2')?.textContent||'جدول التقرير';
  rows.push([heading]);
  for(const tr of table.querySelectorAll('tr'))rows.push([...tr.cells].map(cell=>cell.innerText.trim()));
 }
 const csv='\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
 const url=URL.createObjectURL(blob);const link=document.createElement('a');
 link.href=url;link.download='taiba-'+id+'-'+($('month').value||localToday())+'.csv';
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 notify('تم تجهيز ملف CSV للتقرير.');
}
function filterHistoricalReport(source,target,needle){
 target.replaceChildren();
 const intro=source.querySelector('.history-analysis-head');
 if(intro)target.append(intro.cloneNode(true));
 const children=[...source.children];let capture=false;
 for(let i=0;i<children.length;i++){
  const node=children[i];
  if(node.tagName==='H4')capture=node.textContent.includes(needle);
  if(capture)target.append(node.cloneNode(true));
  if(node.tagName==='H4'&&capture&&children[i+1]?.tagName==='DIV'){}
 }
 if(!target.querySelector('h4'))target.insertAdjacentHTML('beforeend','<p class="muted">سيظهر هذا التقرير بعد تحميل ملفات Excel التاريخية المطلوبة واختيار الفترة.</p>');
}
function showOwnerReport(id){
 const home=$('ownerDashboardHome'),screens=$('ownerDashboardScreens');
 if(id==='home'){home.hidden=false;screens.hidden=true;return;}
 const screen=screens.querySelector('[data-owner-screen="'+id+'"]');if(!screen)return;
 home.hidden=true;screens.hidden=false;
 screens.querySelectorAll('[data-owner-screen]').forEach(node=>node.hidden=node!==screen);
 window.scrollTo({top:screens.offsetTop-12,behavior:'smooth'});
}
async function start(){mountOwnerDashboardNavigation();const session=await getCurrentSession();if(!session){$('loginPanel').hidden=false;$('workspace').hidden=true;$('signOut').hidden=true;return;}$('loginPanel').hidden=true;$('workspace').hidden=false;$('signOut').hidden=false;state.context=await loadMyTenantContext();const owners=(state.context.tenants||[]).filter(t=>t.accountType==='owner');if(!owners.length){$('workspace').hidden=true;$('loginPanel').hidden=false;throw new Error('لوحة التحليل المالي متاحة لمدير المعمل فقط.');}state.context.tenants=owners;$('tenantSelect').innerHTML=owners.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');$('tenantSelect').onchange=()=>selectTenant($('tenantSelect').value);$('month').value=currentMonth();$('testRangeFrom').value=monthRange(currentMonth()).monthStart;$('testRangeTo').value=localToday();const preferredTenantId=getPreferredTenantId(owners);$('tenantSelect').value=preferredTenantId;await selectTenant(preferredTenantId);}
async function selectTenant(id){state.tenant=state.context.tenants.find(t=>t.id===id);if(!state.tenant)return;rememberWorkspaceSelection(state.tenant.id);const ownerBranches=state.tenant?.allBranches||state.tenant?.branches||[];$('branchSelect').innerHTML='<option value="all">كل الفروع</option>'+ownerBranches.map(b=>`<option value="${esc(b.id)}">${esc(b.name)}${b.is_active===false?' · مؤرشف':''}</option>`).join('');await refresh();await mountHistoricalWorkbookPanel(state.tenant.id);}
function renderComparison(current,previous){
 const body=$('periodComparisonRows');if(!body)return;
 body.innerHTML=compareDashboardPeriods(current,previous).map(item=>{
  const format=value=>item.kind==='money'?money(value):Number(value).toLocaleString('ar-EG');
  const change=item.changePercent===null?'جديد':(item.changePercent>0?'+':'')+item.changePercent.toFixed(1)+'%';
  const difference=item.kind==='money'?money(item.difference):(item.difference>0?'+':'')+item.difference.toLocaleString('ar-EG');
  return '<tr><td>'+esc(item.label)+'</td><td class="num">'+format(item.current)+'</td><td class="num">'+format(item.previous)+'</td><td class="num">'+difference+'</td><td class="num">'+change+'</td></tr>';
 }).join('');
 $('periodComparisonCaption').textContent='مقارنة '+current.period.monthStart.slice(0,7)+' مع الشهر السابق '+previous.period.monthStart.slice(0,7)+' · نفس المعمل ونطاق الفرع.';
}
async function runTestRangeReport(){
 const from=$('testRangeFrom').value,to=$('testRangeTo').value,search=$('testRangeSearch').value;
 if(!from||!to||to<from)throw new Error('حدد تاريخ بداية ونهاية صحيحين.');
 const exclusive=new Date(to+'T00:00:00Z');exclusive.setUTCDate(exclusive.getUTCDate()+1);
 const toDateExclusive=exclusive.toISOString().slice(0,10);
 const branchId=$('branchSelect').value==='all'?null:$('branchSelect').value;
 $('testRangeRows').innerHTML='<tr><td colspan="3">جارٍ البحث…</td></tr>';
 const result=await getOwnerTestRangeReport({tenantId:state.tenant.id,fromDate:from,toDateExclusive,branchId,search});
 $('testRangeSummary').textContent='الزيارات: '+result.visitCount+' · إجمالي مرات طلب التحاليل: '+result.testCount;
 $('testRangeRows').innerHTML=result.tests.length?result.tests.map(item=>'<tr><td>'+esc(item.name)+'</td><td>'+item.count+'</td><td class="num">'+money(item.billed)+'</td></tr>').join(''):'<tr><td colspan="3">لا توجد تحاليل مطابقة خلال الفترة.</td></tr>';
}
function renderYearComparison(current,previous){
 const body=$('yearComparisonRows');if(!body)return;
 body.innerHTML=compareDashboardPeriods(current,previous).map(item=>{
  const format=value=>item.kind==='money'?money(value):Number(value).toLocaleString('ar-EG');
  const change=item.changePercent===null?'جديد':(item.changePercent>0?'+':'')+item.changePercent.toFixed(1)+'%';
  const difference=item.kind==='money'?money(item.difference):(item.difference>0?'+':'')+item.difference.toLocaleString('ar-EG');
  return '<tr><td>'+esc(item.label)+'</td><td class="num">'+format(item.current)+'</td><td class="num">'+format(item.previous)+'</td><td class="num">'+difference+'</td><td class="num">'+change+'</td></tr>';
 }).join('');
 $('yearComparisonCaption').textContent='مقارنة '+current.period.monthStart.slice(0,7)+' مع نفس الشهر من '+previous.period.monthStart.slice(0,4)+' · نفس المعمل والفرع.';
}
function render(report){const ledgerBody=$('ownerLedgerRows');if(ledgerBody)ledgerBody.innerHTML=report.ledger.length?report.ledger.slice().sort((a,b)=>String(b.work_date).localeCompare(String(a.work_date))).map(row=>'<tr><td>'+esc(row.work_date)+'</td><td>'+esc(report.branches.find(branch=>branch.id===row.branch_id)?.name||'—')+'</td><td>'+esc(row.direction==='inflow'?'تحصيل':'مصروف')+'</td><td>'+esc(row.description||row.source_type||'—')+'</td><td class="num">'+money(row.amount)+'</td></tr>').join(''):'<tr><td colspan="5">لا توجد حركات مالية في الفترة المحددة.</td></tr>';const t=report.totals;$('collected').textContent=money(t.collected);$('expenses').textContent=money(t.expenses);$('netCash').textContent=money(t.netCash);$('receivables').textContent=money(t.receivables);$('grossBilled').textContent=money(t.grossBilled);$('discounts').textContent=money(t.discounts);$('netBilled').textContent=money(t.netBilled);$('visitsPatients').textContent=`${t.visits} / ${t.patients}`;$('testsCount').textContent=`${t.tests} تحليل مطلوب`;
$('dailyRows').innerHTML=report.daily.length?report.daily.map(d=>`<tr><td>${esc(d.date)}</td><td>${d.visits||0}</td><td>${d.tests||0}</td><td class="num">${money(d.collected)}</td><td class="num">${money(d.expenses)}</td><td class="num">${money(d.collected-d.expenses)}</td></tr>`).join(''):'<tr><td colspan="6">لا توجد حركة أو زيارات خلال الشهر المحدد.</td></tr>';
$('expenseBreakdownRows').innerHTML=report.expenseBreakdown?.length?report.expenseBreakdown.map(x=>`<tr><td>${esc(x.branchName)}</td><td>${esc(x.categoryName)}</td><td>${x.count}</td><td class="num">${money(x.amount)}</td></tr>`).join(''):'<tr><td colspan="4">لا توجد مصروفات مسجلة خلال الفترة.</td></tr>';
$('branchRows').innerHTML=report.branches.length?buildBranchPerformanceMetrics(report).map(b=>`<tr><td>${esc(b.name)}</td><td>${b.visits}</td><td>${b.tests}</td><td class="num">${money(b.netBilled)}</td><td class="num">${money(b.collected)}</td><td class="num">${money(b.expenses)}</td><td class="num">${money(b.netCash)}</td><td class="num">${money(b.receivables)}</td><td class="num">${money(b.averageInvoice)}</td><td class="num">${b.collectionRate===null?'—':b.collectionRate.toFixed(1)+'%'}</td><td class="num">${b.expenseToCollectionRate===null?'—':b.expenseToCollectionRate.toFixed(1)+'%'}</td></tr>`).join(''):'<tr><td colspan="11">لا توجد فروع ظاهرة لهذا الحساب.</td></tr>';
$('testRows').innerHTML=report.topTests.length?report.topTests.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count}</td><td class="num">${money(x.billed)}</td></tr>`).join(''):'<tr><td colspan="3">لا توجد تحاليل مسجلة خلال الشهر.</td></tr>';
const lines=[`ملخص معامل ${state.tenant.name}`,`الفترة: ${report.period.monthStart} إلى ${report.period.monthEnd}`,`الزيارات: ${t.visits} | المرضى: ${t.patients} | التحاليل: ${t.tests}`,`الفواتير قبل الخصم: ${money(t.grossBilled)}`,`الخصومات: ${money(t.discounts)}`,`صافي الفواتير: ${money(t.netBilled)}`,`التحصيل الفعلي: ${money(t.collected)}`,`المديونيات القائمة على زيارات الشهر: ${money(t.receivables)}`,`المصروفات: ${money(t.expenses)}`,`صافي النقدية: ${money(t.netCash)}`,`ملاحظة: صافي النقدية ليس صافي ربح محاسبيًا؛ لم تخصم منه تكلفة التحاليل والرواتب والتكاليف غير المسجلة هنا.`];$('summaryText').value=lines.join('\\n');if(state.previousReport)renderComparison(report,state.previousReport);if(state.previousYearReport)renderYearComparison(report,state.previousYearReport);}
async function refresh(){if(!state.tenant)return;const button=$('refresh');button.disabled=true;button.textContent='جارٍ التحديث…';$('status').textContent='جارٍ قراءة الفواتير والتحصيلات والمصروفات من قاعدة البيانات…';try{const range=monthRange($('month').value);const branchId=$('branchSelect').value==='all'?null:$('branchSelect').value;const previousRange=getPreviousMonthRange(range.monthStart),previousYearRange=getSameMonthPreviousYearRange(range.monthStart);[state.report,state.previousReport,state.previousYearReport]=await Promise.all([getOwnerMonthlyDashboard({tenantId:state.tenant.id,...range,branchId}),getOwnerMonthlyDashboard({tenantId:state.tenant.id,...previousRange,branchId}),getOwnerMonthlyDashboard({tenantId:state.tenant.id,...previousYearRange,branchId})]);render(state.report);await renderLiveHistoricalReconciliation(state.report,state.tenant.id,branchId);$('status').classList.remove('error');$('status').textContent=`تم تحديث البيانات. ${state.report.branches.length} فرع · ${state.report.ledger.length} حركة مالية. الأرقام حسب يوم العمل.`;}catch(error){$('status').textContent=error.message||'تعذر تحميل التقرير.';$('status').classList.add('error');throw error;}finally{button.disabled=false;button.textContent='تحديث البيانات';}}
$('loginForm').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{await signInWithEmail($('email').value,$('password').value);await start();}catch(error){notify(error.message||'تعذر تسجيل الدخول.',true);}finally{button.disabled=false;}});
$('signOut').addEventListener('click',async()=>{try{await signOut();await start();}catch(error){notify(error.message,true);}});
$('refresh').addEventListener('click',()=>refresh().catch(error=>notify(error.message,true)));$('branchSelect').addEventListener('change',()=>{if($('branchSelect').value!=='all')rememberWorkspaceSelection(state.tenant.id,$('branchSelect').value);refresh().catch(error=>notify(error.message,true));});$('month').addEventListener('change',()=>refresh().catch(error=>notify(error.message,true)));$('runTestRangeReport').addEventListener('click',()=>runTestRangeReport().catch(error=>notify(error.message,true)));
$('copySummary').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('summaryText').value);notify('تم نسخ ملخص الشهر.');}catch{ $('summaryText').select();notify('حدد النص وانسخه يدويًا.');}});
try{await start();}catch(error){notify(error.message||'تعذر تهيئة لوحة الإدارة.',true);}
