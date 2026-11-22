import{saveHistoricalWorkbook,listHistoricalWorkbooks,getHistoricalWorkbook,deleteHistoricalWorkbook}from'../../modules/dashboard/historical-workbooks.js';
import{listCloudHistoricalWorkbooks,saveCloudHistoricalWorkbook,downloadCloudHistoricalWorkbook,deleteCloudHistoricalWorkbook}from'../../modules/dashboard/historical-workbook-cloud.js';
import{buildHistoricalDashboardReport,buildHistoricalProductPortfolio,compareHistoricalAndLiveReports,findLatestHistoricalPeriod}from'../../modules/dashboard/historical-analysis.js';
import{listOwnerFinancialRows}from'../../dashboard/owner-financial-repository.js';
import{buildGenericHistoricalReport}from'../../modules/dashboard/financial-import-engine.js';
const FILES=[{type:'sales',label:'ملف المتابعة السنوية والشهرية',hint:'يحتوي أوراق الشهرية والسنوية وحركة التحاليل'},{type:'prices',label:'ملف أسعار وتكلفة التحاليل',hint:'يحتوي ورقة التحاليل وأسعار البيع والتكلفة والوزن'},{type:'detail2025',label:'تفصيل التحاليل لعام 2025',hint:'ملف تاريخي مستقل لتحليل حركة التحاليل'},{type:'detail2026',label:'تفصيل التحاليل لعام 2026',hint:'ملف تاريخي مستقل لتحليل حركة التحاليل'}];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatSize=n=>(Number(n||0)/1024/1024).toFixed(2)+' MB';let activeTenantId=null,bound=false,monthBound=false,cloudFiles=[],cloudArchiveError='';
function status(msg,error=false){const node=document.getElementById('historyNotice');if(node){node.textContent=msg;node.className='history-notice'+(error?' error':'');}}
function reader(){if(!globalThis.XLSX||typeof globalThis.XLSX.read!=='function')throw new Error('مكتبة قراءة Excel لم تُحمّل. تحقق من الاتصال بالإنترنت ثم أعد تحميل الصفحة.');return globalThis.XLSX;}
function validate(type,wb){const names=wb.SheetNames||[];if(!names.length)throw new Error('الملف لا يحتوي على أوراق عمل.');if(type==='sales'&&(!names.some(n=>n.includes('الشهرية'))||!names.some(n=>n.includes('السنوية'))))throw new Error('ملف المتابعة يجب أن يحتوي ورقتي الشهرية والسنوية على الأقل.');if(type==='prices'&&!names.some(n=>n.includes('التحاليل')))throw new Error('ملف الأسعار يجب أن يحتوي ورقة باسم يتضمن «التحاليل».');return names.map(name=>{const s=wb.Sheets[name],r=s&&s['!ref']?reader().utils.decode_range(s['!ref']):null;return{name,rows:r?Math.max(0,r.e.r-r.s.r):0};});}
async function refreshList(tenantId=activeTenantId){
 const list=document.getElementById('historyFilesList');if(!tenantId||!list)return;
 const rows=await listHistoricalWorkbooks(tenantId);if(tenantId!==activeTenantId)return;
 if(globalThis.navigator?.onLine!==false){try{cloudFiles=await listCloudHistoricalWorkbooks(tenantId);cloudArchiveError='';}catch(error){cloudArchiveError=error.message||'تعذر قراءة الأرشيف السحابي.';}}
 const map=new Map(rows.map(x=>[x.type,x])),cloudMap=new Map(cloudFiles.map(x=>[x.workbook_type,x]));
 list.innerHTML=FILES.map(f=>{
  const x=map.get(f.type),cloud=cloudMap.get(f.type);
  const detail=x?'<div class="history-saved"><b>'+(cloud?'محفوظ محليًا + سحابيًا':'محفوظ محليًا فقط')+'</b><span>'+esc(x.fileName)+' · '+formatSize(x.size)+'</span><small>'+esc((x.sheets||[]).map(s=>s.name).join('، '))+'</small><button type="button" data-history-delete="'+f.type+'">حذف النسخة المحلية والسحابية</button></div>':cloud?'<div class="history-saved"><b>محفوظ سحابيًا</b><span>'+esc(cloud.file_name)+' · '+formatSize(cloud.file_size)+'</span><small>سيتم تنزيل نسخة محلية عند الاتصال.</small></div>':'<div class="history-empty">لم يتم تحميل ملف لهذا القسم بعد.</div>';
  return'<article class="history-file"><div><b>'+f.label+'</b><small>'+f.hint+'</small></div><label class="history-upload">اختيار ملف Excel<input type="file" accept=".xlsx,.xls,.csv" data-history-upload="'+f.type+'"></label>'+detail+'</article>';
 }).join('');
}
async function upload(input,type){
 const tenantId=activeTenantId,file=input.files&&input.files[0];if(!file)return;
 try{
  if(file.size>20*1024*1024)throw new Error('الحد الأقصى لحجم الملف 20 ميجابايت.');
  const ext=file.name.split('.').pop().toLowerCase();if(!['xlsx','xls','csv'].includes(ext))throw new Error('الصيغ المدعومة: XLSX وXLS وCSV.');
  status('جارٍ فحص الملف وحفظ النسخة المحلية والسحابية…');
  const data=await file.arrayBuffer(),wb=reader().read(data,{type:'array',cellDates:false}),sheets=validate(type,wb);
  await saveHistoricalWorkbook({tenantId,type,fileName:file.name,size:file.size,sheets,data});
  let cloudSaved=false;
  if(globalThis.navigator?.onLine!==false){
   await saveCloudHistoricalWorkbook({tenantId,type,fileName:file.name,data,sheets});cloudSaved=true;
  }
  await refreshList(tenantId);await refreshHistoricalDashboard();
  status(cloudSaved?'تم حفظ الملف في أرشيف المعمل السحابي ونسخة محلية لهذا الجهاز. الأرشيف التاريخي مستقل عن التشغيل الحي ومسار المحاسب الشهري.':'تم حفظ نسخة محلية فقط لعدم وجود اتصال. أعد رفع الملف عند عودة الإنترنت لحفظه سحابيًا.');
 }catch(e){status(e.message||'تعذر حفظ الملف.',true);}finally{input.value='';}
}

const money=value=>Number(value||0).toLocaleString('ar-EG',{maximumFractionDigits:1})+' ج.م';
const workbookSheets=record=>{if(!record)return null;const wb=reader().read(record.data,{type:'array',cellDates:false});return wb.SheetNames.map(name=>({name,rows:reader().utils.sheet_to_json(wb.Sheets[name],{header:1,defval:''})}));};
function renderAnalysis(report){
 const target=document.getElementById('historyAnalysisResults');if(!target)return;const t=report.totals;const portfolio=buildHistoricalProductPortfolio(report);
 const kpis=[['الإيرادات التاريخية',money(t.rev)],['المصروفات التاريخية',money(t.exp)],['صافي الربح التاريخي',money(t.profit)],['الحالات',Number(t.cases).toLocaleString('ar-EG')],['هامش الربح',t.margin.toFixed(1)+'%']];
 const rows=report.branches.map(b=>'<tr><td>'+esc(b.branch)+'</td><td>'+money(b.rev)+'</td><td>'+money(b.exp)+'</td><td>'+money(b.profit)+'</td><td>'+b.cases+'</td><td>'+b.margin.toFixed(1)+'%</td></tr>').join('');
 const testRows=items=>items.slice(0,5).map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+x.count+'</td><td>'+money(x.trueCost)+'</td><td>'+money(x.trueProfitUnit)+'</td><td>'+money(x.trueTotalProfit)+'</td></tr>').join('')||'<tr><td colspan="5">لا توجد بيانات مطابقة.</td></tr>';
 const portfolioRows=items=>items.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+x.count+'</td><td>'+money(x.sell)+'</td><td>'+money(x.trueCost)+'</td><td>'+money(x.trueProfitUnit)+'</td><td>'+money(x.trueTotalProfit)+'</td></tr>').join('')||'<tr><td colspan="6">لا توجد تحاليل في هذه الفئة.</td></tr>';
 target.innerHTML='<div class="history-analysis-head"><div><h3>نتائج التحليل التاريخي الفعلي</h3><p>المصدر: ملفات Excel المحفوظة · '+esc(report.period.month)+'/'+esc(report.period.year)+' · مستقل عن أرقام التشغيل الحي</p></div><span class="badge">Excel تاريخي</span></div><div class="history-analysis-kpis">'+kpis.map(k=>'<article><span>'+k[0]+'</span><strong>'+k[1]+'</strong></article>').join('')+'</div><h4>الأداء حسب الفرع</h4><div class="table-wrap"><table><thead><tr><th>الفرع</th><th>الإيراد</th><th>المصروفات</th><th>الصافي</th><th>الحالات</th><th>الهامش</th></tr></thead><tbody>'+rows+'</tbody></table></div><h4>الملخص السنوي '+esc(report.annual.year)+'</h4><div class="history-analysis-kpis"><article><span>إيرادات السنة</span><strong>'+money(report.annual.totals.rev)+'</strong></article><article><span>مصروفات السنة</span><strong>'+money(report.annual.totals.exp)+'</strong></article><article><span>صافي السنة</span><strong>'+money(report.annual.totals.profit)+'</strong></article><article><span>هامش السنة</span><strong>'+report.annual.totals.margin.toFixed(1)+'%</strong></article></div><div class="table-wrap"><table><thead><tr><th>الفرع</th><th>الإيرادات</th><th>المصروفات</th><th>الصافي</th><th>الهامش</th></tr></thead><tbody>'+report.annual.branches.map(b=>'<tr><td>'+esc(b.branch)+'</td><td>'+money(b.rev)+'</td><td>'+money(b.exp)+'</td><td>'+money(b.profit)+'</td><td>'+b.margin.toFixed(1)+'%</td></tr>').join('')+'</tbody></table></div><h4>اتجاه الأداء المالي السنوي</h4><div class="table-wrap"><table><thead><tr><th>السنة</th><th>الإيرادات</th><th>المصروفات</th><th>صافي الربح</th><th>هامش الربح</th><th>نمو الإيرادات</th></tr></thead><tbody>'+report.annualTrend.map(y=>'<tr><td>'+y.year+'</td><td>'+money(y.rev)+'</td><td>'+money(y.exp)+'</td><td>'+money(y.profit)+'</td><td>'+y.margin.toFixed(1)+'%</td><td>'+(y.revenueGrowth===null?'—':(y.revenueGrowth>=0?'+':'')+y.revenueGrowth.toFixed(1)+'%')+'</td></tr>').join('')+'</tbody></table></div><h4>خطة الشهر التالي بناءً على الموسمية</h4><p class="hint">الهدف مبني على متوسط بيانات نفس الشهر في السنوات السابقة المتاحة، وليس ضمانًا للإيراد أو توقعًا مؤكدًا.</p><div class="history-analysis-kpis"><article><span>الشهر المستهدف</span><strong>'+['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][Number(report.monthlyPlan.target.month)-1]+' '+report.monthlyPlan.target.year+'</strong></article><article><span>هدف الإيراد الإجمالي</span><strong>'+money(report.monthlyPlan.totals.revenue)+'</strong></article><article><span>هدف الحالات</span><strong>'+Math.round(report.monthlyPlan.totals.cases).toLocaleString('ar-EG')+'</strong></article></div><div class="table-wrap"><table><thead><tr><th>الفرع</th><th>سنوات الاستناد</th><th>هدف الإيراد</th><th>هدف الحالات</th><th>متوسط الفاتورة</th><th>هدف أسبوعي تقريبي</th></tr></thead><tbody>'+report.monthlyPlan.branches.map(b=>'<tr><td>'+esc(b.branch)+'</td><td>'+b.history.map(x=>x.year).join('، ')+(b.usedFallback?' · بديل: آخر شهر':'')+'</td><td>'+money(b.targetRevenue)+'</td><td>'+Math.round(b.targetCases)+'</td><td>'+money(b.averageInvoice)+'</td><td>'+money(b.weeklyTargets[0].revenue)+' / '+Math.round(b.weeklyTargets[0].cases)+' حالة</td></tr>').join('')+'</tbody></table></div><h4>خطة الأشهر الثلاثة التالية</h4><div class="table-wrap"><table><thead><tr><th>الشهر</th><th>الفرع</th><th>هدف الإيراد</th><th>هدف الحالات</th><th>مصدر التقدير</th></tr></thead><tbody>'+report.monthlyPlan.outlook.flatMap(plan=>plan.branches.map(b=>'<tr><td>'+['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][Number(plan.target.month)-1]+' '+plan.target.year+'</td><td>'+esc(b.branch)+'</td><td>'+money(b.targetRevenue)+'</td><td>'+Math.round(b.targetCases)+'</td><td>'+(b.usedFallback?'آخر شهر متاح':'متوسط السنوات السابقة لنفس الشهر')+'</td></tr>')).join('')+'</tbody></table></div><h4>موسمية الحالات حسب الشهر (كل السنوات المتاحة)</h4><div class="table-wrap"><table><thead><tr><th>الشهر</th><th>عدد الحالات</th></tr></thead><tbody>'+report.seasonality.monthTotals.map((count,index)=>'<tr><td>'+['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][index]+'</td><td>'+count+'</td></tr>').join('')+'</tbody></table></div><h4>تفصيل المصروفات الثابتة وتوزيع التكلفة</h4><div class="table-wrap"><table><thead><tr><th>الفرع</th><th>كيماويات</th><th>مرتبات</th><th>بنود أخرى</th><th>إجمالي ثابت</th><th>تكلفة متغيرة</th><th>قيمة النقطة</th></tr></thead><tbody>'+report.branches.map(b=>{const x=b.expenseBreakdown;const misc=x?Object.entries(x.misc).map(([name,value])=>esc(name)+': '+money(value)).join('، '):'تفصيل غير متاح؛ تم استخدام تقدير الإجمالي ناقص التكلفة المتغيرة';return '<tr><td>'+esc(b.branch)+'</td><td>'+ (x?money(x.chemicals):'—')+'</td><td>'+(x?money(x.salaries):'—')+'</td><td>'+misc+'</td><td>'+money(b.allocation.fixedCost)+'</td><td>'+money(b.allocation.variableCost)+'</td><td>'+money(b.allocation.pointValue)+'</td></tr>';}).join('')+'</tbody></table></div><h4>الأكثر طلبًا</h4><div class="table-wrap"><table><thead><tr><th>التحليل</th><th>العدد</th><th>التكلفة الحقيقية</th><th>ربح الوحدة</th><th>إجمالي الربح</th></tr></thead><tbody>'+testRows(portfolio.topSellers)+'</tbody></table></div><h4>الأكثر ربحية</h4><div class="table-wrap"><table><thead><tr><th>التحليل</th><th>العدد</th><th>التكلفة الحقيقية</th><th>ربح الوحدة</th><th>إجمالي الربح</th></tr></thead><tbody>'+testRows(portfolio.mostProfitable)+'</tbody></table></div><h4>التحاليل الخاسرة</h4><div class="table-wrap"><table><thead><tr><th>التحليل</th><th>العدد</th><th>التكلفة الحقيقية</th><th>خسارة الوحدة</th><th>إجمالي النتيجة</th></tr></thead><tbody>'+testRows(report.lossMakers)+'</tbody></table></div><p class="hint">توزيع المصروفات الثابتة حسب وزن التحليل ونقاطه، وفق معادلة النظام القديم. عند غياب تفصيل المصروفات يستخدم النظام الفرق بين إجمالي المصروفات والتكلفة المتغيرة. التحاليل غير المطابقة لملف الأسعار: '+(report.unmatchedTests.length?report.unmatchedTests.map(esc).join('، '):'لا يوجد')+'.</p><h4>الأقل ربحية (مع استبعاد الخاسر)</h4><div class="table-wrap"><table><thead><tr><th>التحليل</th><th>العدد</th><th>ربح الوحدة</th><th>إجمالي الربح</th></tr></thead><tbody>'+portfolio.leastProfitable.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+x.count+'</td><td>'+money(x.trueProfitUnit)+'</td><td>'+money(x.trueTotalProfit)+'</td></tr>').join('')+'</tbody></table></div><h4>تحاليل تحتاج تنشيطًا (أقل من 5 طلبات)</h4><div class="table-wrap"><table><thead><tr><th>التحليل</th><th>العدد</th><th>سعر البيع</th><th>ربح الوحدة</th></tr></thead><tbody>'+portfolio.needOffers.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+x.count+'</td><td>'+money(x.sell)+'</td><td>'+money(x.trueProfitUnit)+'</td></tr>').join('')+'</tbody></table></div><h4>قرارات عاجلة من التكلفة الحقيقية</h4><p class="hint">تحاليل خاسرة: '+portfolio.urgent.losses.length+' · فرص قليلة الطلب وربحها أعلى من وسيط الربحية: '+portfolio.urgent.lowDemandOpportunities.length+'</p><ul>'+portfolio.urgent.losses.slice(0,5).map(x=>'<li>'+esc(x.name)+' — خسارة '+money(Math.abs(x.trueProfitUnit))+' لكل تحليل</li>').join('')+portfolio.urgent.lowDemandOpportunities.slice(0,5).map(x=>'<li>'+esc(x.name)+' — طلب منخفض ('+x.count+') وربح الوحدة '+money(x.trueProfitUnit)+'</li>').join('')+'</ul><h4>مصفوفة BCG التاريخية</h4><p class="hint">حد الطلب = الوسيط '+portfolio.thresholds.medianCount+' طلبًا، وحد ربح الوحدة = '+money(portfolio.thresholds.medianProfit)+'. التصنيف إحصائي نسبي إلى مجموعة التحاليل المطابقة في الفترة المختارة.</p><div class="history-analysis-kpis">'+[['النجوم',portfolio.bcg.stars],['أبقار حلوب',portfolio.bcg.cashCows],['علامات الاستفهام',portfolio.bcg.questions],['كلاب',portfolio.bcg.dogs]].map(([label,items])=>'<article><span>'+label+'</span><strong>'+items.length+'</strong><small>'+items.slice(0,3).map(x=>esc(x.name)).join('، ')+'</small></article>').join('')+'</div>'+'<h4>تفاصيل فئات BCG</h4>'+[['النجوم',portfolio.bcg.stars],['الأحصنة',portfolio.bcg.cashCows],['علامات الاستفهام',portfolio.bcg.questions],['الضعيفة',portfolio.bcg.dogs]].map(([label,items])=>'<h5>'+label+'</h5><div class="table-wrap"><table><thead><tr><th>التحليل</th><th>العدد</th><th>سعر البيع</th><th>التكلفة الحقيقية</th><th>ربح الوحدة</th><th>إجمالي الربح</th></tr></thead><tbody>'+portfolioRows(items)+'</tbody></table></div>').join('');
}
export async function refreshHistoricalDashboard(){
 const target=document.getElementById('historyAnalysisResults');if(!target||!activeTenantId)return;
 const periodInput=document.getElementById('historyMonth');const periodValue=periodInput?.value||'';
 try{
  const [sales,prices,detail25,detail26]=await Promise.all(['sales','prices','detail2025','detail2026'].map(type=>getHistoricalWorkbook({tenantId:activeTenantId,type})));
  if(!sales||!prices){target.textContent='للبدء: حمّل ملف المتابعة السنوية والشهرية وملف أسعار وتكلفة التحاليل من الأرشيف أعلاه.';return;}
  const salesSheets=workbookSheets(sales),priceSheets=workbookSheets(prices);let [year,month]=periodValue.split('-');if(!year||!month){const latest=findLatestHistoricalPeriod(salesSheets);if(!latest){target.textContent='لم يتم العثور على شهر تاريخي له إيراد مسجل.';return;}year=latest.year;month=latest.month;if(periodInput)periodInput.value=year+'-'+month;}const detailSheets=workbookSheets(Number(year)===2025?detail25:detail26);
  const branchSelect=document.getElementById('branchSelect');
  const branch=branchSelect?.value==='all'?'all':branchSelect?.selectedOptions?.[0]?.dataset?.branchName||'all';
  const report=buildHistoricalDashboardReport({salesWorkbook:salesSheets,pricesWorkbook:priceSheets,detailWorkbook:detailSheets,movementWorkbooks:salesSheets,year,month,branch});
  renderAnalysis(report);
 }catch(error){target.textContent=error.message||'تعذر حساب التحليل التاريخي.';}
}

async function hydrateCloudArchive(tenantId){
 if(globalThis.navigator?.onLine===false)return;
 const remote=await listCloudHistoricalWorkbooks(tenantId);cloudFiles=remote;
 for(const item of remote){
  const cached=await getHistoricalWorkbook({tenantId,type:item.workbook_type});
  if(cached?.data instanceof ArrayBuffer){
   const digest=await crypto.subtle.digest('SHA-256',cached.data);
   const localHash=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
   if(localHash===item.file_sha256)continue;
  }
  const downloaded=await downloadCloudHistoricalWorkbook({tenantId,type:item.workbook_type});
  if(downloaded?.data)await saveHistoricalWorkbook({tenantId,type:item.workbook_type,fileName:downloaded.file_name,size:downloaded.file_size,sheets:downloaded.sheet_summary,data:downloaded.data});
 }
}
export async function mountHistoricalWorkbookPanel(tenantId){
 if(!tenantId)return;activeTenantId=String(tenantId);const panel=document.getElementById('historyFilesList');if(!panel)return;
 if(!bound){
  panel.addEventListener('change',e=>{const input=e.target.closest('[data-history-upload]');if(input)upload(input,input.dataset.historyUpload);});
  panel.addEventListener('click',async e=>{
   const button=e.target.closest('[data-history-delete]');if(!button)return;
   const ownerTenantId=activeTenantId;
   if(!globalThis.confirm('حذف هذا الملف من الأرشيف المحلي والسحابي للمعمل؟'))return;
   button.disabled=true;
   try{await deleteCloudHistoricalWorkbook({tenantId:ownerTenantId,type:button.dataset.historyDelete});await deleteHistoricalWorkbook({tenantId:ownerTenantId,type:button.dataset.historyDelete});await refreshList(ownerTenantId);status('تم حذف الملف من الأرشيف المحلي والسحابي.');}
   catch(err){status(err.message||'تعذر حذف الملف.',true);button.disabled=false;}
  });
  bound=true;
 }
 try{
  await hydrateCloudArchive(activeTenantId);await refreshList(activeTenantId);
  status(globalThis.navigator?.onLine===false?'لا يوجد اتصال: تُعرض النسخ المحلية فقط.':'الأرشيف التاريخي محفوظ سحابيًا للمعمل، وتُستخدم نسخة محلية لتسريع القراءة. وهو مستقل عن التشغيل الحي ومسار المحاسب الشهري.');
  if(cloudArchiveError)status('تعذر تحديث قائمة الأرشيف السحابي: '+cloudArchiveError,true);
  await refreshHistoricalDashboard();
  if(!monthBound){document.getElementById('historyMonth')?.addEventListener('change',async()=>{await refreshHistoricalDashboard();if(globalThis.__refreshOwnerFinancialArchive)await globalThis.__refreshOwnerFinancialArchive();});monthBound=true;}
 }catch(e){status(e.message||'تعذر قراءة الأرشيف التاريخي.',true);}
}

/** Read-only reconciliation between the live operating stream and the accountant's separate Excel stream. */
export async function renderLiveHistoricalReconciliation(liveReport,tenantId,branchId=null){
 const target=document.getElementById('historyLiveReconciliation');if(!target||!liveReport||!tenantId)return;
 try{
  const from=liveReport.period.monthStart,end=new Date(liveReport.period.monthEnd+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);
  const to=end.toISOString().slice(0,10),rows=await listOwnerFinancialRows({tenantId,from,to,branchId});
  if(!rows.length){target.textContent='لا توجد صفوف من مسار المحاسب لهذه الفترة والفرع. استورد ملف المحاسب من شاشة رفع الملفات أولًا.';return;}
  const accountant=buildGenericHistoricalReport(rows,{from,to,branchId}),live=liveReport.totals||{},excel=accountant.totals||{};
  const pairs=[['المبيعات / الإيرادات','netBilled','revenue','money'],['التحصيل النقدي','collected','collections','money'],['المصروفات','expenses','expenses','money'],['عدد الحالات / الزيارات','visits','cases','count'],['الخصومات','discounts','discounts','money'],['عدد التحاليل','tests','tests','count']];
  const comparison=pairs.map(([label,liveKey,excelKey,kind])=>({label,kind,live:Number(live[liveKey]||0),excel:Number(excel[excelKey]||0),difference:Number(excel[excelKey]||0)-Number(live[liveKey]||0)}));
  const format=(value,kind)=>kind==='money'?money(value):Number(value).toLocaleString('ar-EG'),scope=branchId?(liveReport.branches||[]).find(x=>x.id===branchId)?.name||'الفرع المحدد':'كل الفروع';
  target.innerHTML='<div class="history-analysis-kpis"><article><span>الفترة</span><strong>'+esc(from.slice(0,7))+'</strong></article><article><span>النطاق</span><strong>'+esc(scope)+'</strong></article><article><span>صفوف المحاسب</span><strong>'+rows.length.toLocaleString('ar-EG')+'</strong></article></div><div class="table-wrap"><table><thead><tr><th>المؤشر</th><th>التشغيل الحي</th><th>مسار المحاسب</th><th>الفرق (المحاسب − التشغيل)</th></tr></thead><tbody>'+comparison.map(x=>'<tr><td>'+esc(x.label)+'</td><td class="num">'+format(x.live,x.kind)+'</td><td class="num">'+format(x.excel,x.kind)+'</td><td class="num">'+format(x.difference,x.kind)+'</td></tr>').join('')+'</tbody></table></div><p class="hint">كل عمود يحتفظ بمصدره وتعريفه؛ تتم مقارنة المبيعات بالمبيعات والتحصيل بالتحصيل، ولا يُعامل الإيراد كأنه تحصيل نقدي. لا يحدث دمج أو استبدال أو اعتماد تلقائي. قرار المصدر يظل للمالك بعد مراجعة الفروق.</p>';
 }catch(error){target.textContent=error.message||'تعذرت مطابقة التشغيل مع مسار المحاسب.';}
}
function clean(value){return String(value??'').trim();}
