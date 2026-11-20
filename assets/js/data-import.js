import {getCurrentSession,signInWithEmail} from '../../core/auth/session.js';
import {loadMyTenantContext} from '../../core/tenant/context.js';
import {inspectWorkbookFile,getEntityOptions,getEntityFields,suggestColumnMapping,analyzeArchiveSheet,analyzeArchiveRelationships,inspectLegacyDate} from '../../modules/migration/workbook-inspector.js';
import {findHistoricalPatientCandidates,importHistoricalResults,listHistoricalImportTemplatesForBranch,saveHistoricalImportTemplate} from '../../modules/migration/historical-results-repository.js';
import {importNewCatalogTests} from '../../modules/migration/catalog-importer.js';
import {importNewBasePrices} from '../../modules/migration/price-importer.js';
import {listCatalog,saveCatalogTest,listCurrentBasePrices,addBasePriceIfMissing} from '../../modules/catalog/repository.js';
const $=id=>document.getElementById(id);let state={tenants:[],tenantId:null,branchId:null,userId:null,result:null,file:null,patientLinks:{},templateStatus:{}};
function note(message,error=false){$('notice').textContent=message;$('notice').className='show'+(error?' error':'');}
function el(tag,text=''){const n=document.createElement(tag);n.textContent=String(text??'');return n;}
function makeSelect(options,value){const s=el('select');for(const item of options){const o=el('option',item.label);o.value=item.value;s.append(o);}s.value=value??'';return s;}
async function start(){const session=await getCurrentSession();if(!session){$('loginPanel').hidden=false;$('workspace').hidden=true;return;}state.userId=session.user?.id||session.data?.user?.id||null;const ctx=await loadMyTenantContext();state.tenants=(ctx.tenants||[]).filter(t=>t.accountType==='owner');if(!state.tenants.length)throw Error('هذه الأداة مخصصة لمالك المعمل فقط.');state.tenantId=state.tenants[0].id;const tenant=state.tenants[0];$('tenantName').textContent=tenant.name;$('historicalBranch').replaceChildren(...(tenant.branches||[]).filter(b=>b.is_active!==false).map(b=>{const o=el('option',b.name);o.value=b.id;return o;}));state.branchId=$('historicalBranch').value||tenant.branches?.[0]?.id||null;$('historicalBranch').addEventListener('change',()=>{state.branchId=$('historicalBranch').value;});$('loginPanel').hidden=true;$('workspace').hidden=false;}
async function sheetHeaderSignature(headers){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify((headers||[]).map(x=>String(x||'').trim()))));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function applySavedSheetTemplates(){
 state.templateStatus={};
 const templates=await listHistoricalImportTemplatesForBranch({tenantId:state.tenantId,branchId:state.branchId}).catch(()=>[]);
 for(const sheet of state.result.sheets){
  const matching=templates.filter(t=>t.sheet_name===sheet.name);
  if(!matching.length)continue;
  const signature=await sheetHeaderSignature(sheet.headers);
  const exact=matching.find(t=>t.header_signature===signature);
  if(exact){sheet.entityType=exact.entity_type;sheet.columnMapping=exact.column_mapping||sheet.columnMapping;state.templateStatus[sheet.name]='تم تحميل قالب المطابقة المحفوظ لهذه البنية.';}
  else {if(sheet.entityType==='unknown')sheet.entityType=matching[0].entity_type;state.templateStatus[sheet.name]='تنبيه: بنية هذه الورقة تغيرت عن قالب محفوظ سابقًا. راجع العناوين والمطابقة يدويًا قبل الاعتماد.';}
 }
}
function renderSheet(){
 if(!state.result)return;
 for(const sheet of state.result.sheets) sheet.analysis=analyzeArchiveSheet(sheet.rawRows,sheet.headerRowIndex,sheet.entityType,sheet.columnMapping);
 const s=state.result.sheets[Number($('sheetSelect').value)];if(!s)return;
 const root=$('sheetDetails');root.replaceChildren();
 const summary=el('div');summary.className='meta';
 for(const [label,value] of [['اسم الورقة',s.name],['عدد الصفوف غير الفارغة',s.rowCount],['صف العناوين',s.headerRowIndex+1]]){const box=el('div');box.append(el('small',label),el('b',value));summary.append(box);}root.append(summary);
 if(state.templateStatus[s.name]){const templateNote=el('p',state.templateStatus[s.name]);templateNote.className='template-note';root.append(templateNote);}
 const head=el('div');head.className='mappingHead';head.append(el('h3','تحديد نوع البيانات في الورقة'));
 const entity=makeSelect(getEntityOptions(),s.entityType);entity.addEventListener('change',()=>{s.entityType=entity.value;s.columnMapping=suggestColumnMapping(s.headers,s.entityType);renderSheet();});head.append(entity);root.append(head);
 const cand=el('div');cand.append(el('h3','اختيار صف العناوين بعد المعاينة'));
 const pick=el('select');pick.id='headerRowSelect';
 for(const option of s.headerCandidates){const o=el('option','صف '+(option.rowIndex+1)+' · '+option.nonEmpty+' خلية');o.value=option.rowIndex;pick.append(o);}
 pick.value=String(s.headerRowIndex);
 pick.addEventListener('change',()=>{const chosen=s.headerCandidates.find(x=>x.rowIndex===Number(pick.value));if(chosen){s.headerRowIndex=chosen.rowIndex;s.headers=chosen.values;s.preview=chosen.preview;s.columnMapping=suggestColumnMapping(s.headers,s.entityType);renderSheet();}});
 cand.append(pick);root.append(cand);
 const fields=getEntityFields(s.entityType);
 s.analysis=analyzeArchiveSheet(s.rawRows,s.headerRowIndex,s.entityType,s.columnMapping);
 const mapped=s.columnMapping.filter(x=>x.fieldKey);
 const duplicates=mapped.filter((m,i)=>m.fieldKey!=='parameter_columns'&&mapped.findIndex(x=>x.fieldKey===m.fieldKey)!==i);
 const required=fields.filter(f=>f.required),missing=required.filter(f=>!mapped.some(m=>m.fieldKey===f.key));
 const status=el('div');status.className='mappingStatus';
 status.textContent=s.entityType==='unknown'?'حدد نوع البيانات أولًا.':`تم ربط ${mapped.length} عمودًا · أعمدة مطلوبة غير مربوطة: ${missing.length} · تعيينات مكررة: ${duplicates.length}`;
 root.append(status);
 if(s.entityType!=='unknown'){
  const report=el('section');report.className='validationPanel';
  const stats=el('div');stats.className='validationStats';
  for(const [label,value] of [['صفوف البيانات',s.analysis.nonEmptyRows],['صفوف فارغة',s.analysis.blankRows],['حقول مطلوبة ناقصة',s.analysis.missingRequired],['أرقام غير صالحة',s.analysis.invalidNumbers],['تكرارات محتملة',s.analysis.duplicateRows],['عناوين مكررة',s.analysis.duplicateHeaders]]){const item=el('div');item.append(el('small',label),el('b',value));stats.append(item);}
  report.append(stats);
  const legacy=s.analysis.legacyReview||{};
  const legacyStats=el('div');legacyStats.className='validationStats';
  for(const [label,value] of [['أعمار تحتاج مراجعة وحدة',legacy.ageRows||0],['تواريخ ملتبسة',legacy.dateAmbiguous||0],['تواريخ غير معروفة/غير صالحة',legacy.dateInvalid||0],['نتائج JSON غير قابلة للقراءة',legacy.resultPayloadInvalid||0]]){const item=el('div');item.append(el('small',label),el('b',value));legacyStats.append(item);}
  report.append(el('h3','مراجعة الحفاظ على البيانات القديمة'));report.append(legacyStats);
  if(s.entityType==='patients')report.append(el('p','العمر الأصلي ووحدته محفوظان كما وردا في الملف؛ لا نحولهما إلى سنوات تلقائيًا.'));
  if(s.entityType==='visits')report.append(el('p','المدفوع التراكمي لا يتحول إلى دفعة جديدة. يجب مطابقته مع دفتر الحركة قبل أي استيراد.'));
  if(s.entityType==='test_results')report.append(el('p','هذه نتائج تشغيلية قديمة مرتبطة بمعرّفات زيارات؛ لا تُرحّل تلقائيًا ضمن مسار النتائج التاريخية.'));
  if(s.entityType==='historical_results')report.append(el('p','النتائج التاريخية تُحفظ منفصلة عن الزيارات والفواتير. أعمدة البارامترات المتعددة يمكن ربطها جميعًا بالحقل «بارامتر نتيجة»، ويُحتفظ بالصف الأصلي كاملًا. مطابقة المريض اختيار يدوي فقط.'));
  report.append(el('h3','ملاحظات فحص الصفوف'));
  if(!s.analysis.issues.length)report.append(el('p','لم تظهر أخطاء من القواعد الحالية في هذه الورقة. هذا لا يعني اعتماد البيانات أو صلاحيتها للاستيراد.'));
  else {const list=el('ul');for(const issue of s.analysis.issues)list.append(el('li',`صف ${issue.rowNumber}: ${issue.message}`));report.append(list);if(s.analysis.issueCount>s.analysis.issues.length)report.append(el('small','تم إظهار أول '+s.analysis.issues.length+' ملاحظة فقط من أصل '+s.analysis.issueCount+'.'));}
  const links=analyzeArchiveRelationships(state.result.sheets);
  if(links.length){report.append(el('h3','مراجعة الارتباط بين الأوراق'));for(const link of links){const line=el('p',link.label+': '+link.missing+' مرجع غير مطابق من '+link.total+' صف.');if(link.sampleRows.length)line.textContent+=' أمثلة صفوف: '+link.sampleRows.join('، ');report.append(line);}}
  root.append(report);
 }

 const mapTable=el('table'),mapHead=el('thead'),mapRow=el('tr');
 for(const label of ['اسم العمود في الملف','الحقل المقترح في النظام','حالة المطابقة'])mapRow.append(el('th',label));
 mapHead.append(mapRow);mapTable.append(mapHead);
 const mapBody=el('tbody');
 s.headers.forEach((header,index)=>{
  const line=el('tr'),name=el('td',header||'(عمود بلا اسم)'),choice=el('td'),statusCell=el('td');
  const options=[{value:'',label:'— لا تربط هذا العمود —'},...fields.map(f=>({value:f.key,label:f.label+(f.required?' · مطلوب':'' )}))];
  const selected=s.columnMapping.find(m=>m.columnIndex===index)?.fieldKey||'';
  const select=makeSelect(options,selected);
  select.addEventListener('change',()=>{s.columnMapping[index]={columnIndex:index,header,fieldKey:select.value,confidence:select.value?'manual':'unmapped'};renderSheet();});
  choice.append(select);
  const field=fields.find(f=>f.key===selected);
  statusCell.textContent=field?(field.required?'مطلوب':'اختياري'):'غير مربوط';
  line.append(name,choice,statusCell);mapBody.append(line);
 });
 mapTable.append(mapBody);const mapWrap=el('div');mapWrap.className='tableWrap';mapWrap.append(mapTable);root.append(mapWrap);
 if(s.entityType==='historical_results'){const bulk=el('button','اعتبار كل الأعمدة غير المربوطة بارامترات نتائج');bulk.type='button';bulk.addEventListener('click',()=>{s.columnMapping=s.columnMapping.map(item=>item.fieldKey?item:{...item,fieldKey:'parameter_columns',confidence:'manual'});renderSheet();});root.append(bulk);}
 if(s.entityType==='historical_results'){
  const historyButton=el('button','مراجعة النتائج التاريخية ومطابقة المرضى');historyButton.type='button';
  historyButton.addEventListener('click',()=>prepareHistoricalSheet(s,historyButton).catch(error=>note(error.message||'تعذرت معاينة النتائج التاريخية.',true)));
  root.append(historyButton);
  root.append(el('p','لا يحدث أي رفع عند الفحص. بعد المعاينة يمكنك اختيار ربط كل اسم بمريض موجود يدويًا أو تركه غير مربوط، ثم اعتماد الرفع السحابي.'));
 }
 if(s.entityType==='catalog'){
  const importButton=el('button','استيراد التحاليل الجديدة فقط');importButton.type='button';importButton.addEventListener('click',()=>importCatalogSheet(s,importButton).catch(error=>note(error.message||'تعذر استيراد كتالوج التحاليل.',true)));root.append(importButton);
  const importHint=el('p','استيراد الكتالوج ينشئ الأكواد غير الموجودة فقط ولا يعدّل كودًا قائمًا.');root.append(importHint);
 }
 if(s.entityType==='prices'||(s.entityType==='catalog'&&s.columnMapping.filter(item=>item.fieldKey==='test_code').length===1&&s.columnMapping.filter(item=>item.fieldKey==='price').length===1)){
  const priceButton=el('button','استيراد أسعار البيع الأساسية الجديدة فقط');priceButton.type='button';priceButton.addEventListener('click',()=>importBasePricesSheet(s,priceButton).catch(error=>note(error.message||'تعذر استيراد أسعار التحاليل.',true)));root.append(priceButton);
  const priceHint=el('p','مسار الأسعار مستقل: يضيف السعر العام للتحليل النشط إذا لم يكن له سعر عام حالي. لا يغيّر سعرًا موجودًا ولا أي سعر خاص بفرع.');root.append(priceHint);
 }
 const previewTitle=el('h3','عينة من الصفوف تحت العناوين');root.append(previewTitle);
 const table=el('table'),thead=el('thead'),tr=el('tr');
 (s.headers.length?s.headers:['لا توجد عناوين واضحة']).forEach(v=>tr.append(el('th',v)));thead.append(tr);table.append(thead);
 const body=el('tbody');for(const row of s.preview){const line=el('tr');for(let i=0;i<Math.max(s.headers.length,row.length);i++)line.append(el('td',row[i]??''));body.append(line);}
 if(!s.preview.length){const line=el('tr'),cell=el('td','لا توجد صفوف معاينة بعد صف العناوين المقترح.');cell.colSpan=Math.max(1,s.headers.length);line.append(cell);body.append(line);}
 table.append(body);const wrap=el('div');wrap.className='tableWrap';wrap.append(table);root.append(wrap);
}
function historicalRecordKey(fileSha,sheetName,rowNumber,testCode){return crypto.subtle.digest('SHA-256',new TextEncoder().encode([fileSha,sheetName,rowNumber,testCode].join('|'))).then(bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join(''));}
async function prepareHistoricalSheet(sheet,button){
 if(navigator.onLine===false)throw new Error('اعتماد النتائج التاريخية يحتاج اتصالًا بالإنترنت.');
 if(!state.branchId||!state.userId||!state.file)throw new Error('اختر فرعًا وسجّل الدخول ثم افحص الملف من جديد.');
 const mapping=sheet.columnMapping||[];
 const patientCol=mapping.filter(x=>x.fieldKey==='patient_name'),dateCol=mapping.filter(x=>x.fieldKey==='result_date');
 if(patientCol.length!==1||dateCol.length!==1)throw new Error('اربط اسم المريض وتاريخ النتيجة مرة واحدة لكل ورقة.');
 const analysis=analyzeArchiveSheet(sheet.rawRows,sheet.headerRowIndex,'historical_results',mapping);
 const prepared=[],rejected=[],seenContent=new Set();
 for(const row of analysis.records){
  const date=inspectLegacyDate(row.result_date),patientName=String(row.patient_name||'').trim();
  const testName=String(row.test_name||sheet.name||'').trim(),parameters=row.parameter_columns||{};
  if(!patientName){rejected.push({row:row._rowNumber,reason:'اسم المريض فارغ'});continue;}
  if(date.status!=='valid'||!date.isoDate){rejected.push({row:row._rowNumber,reason:date.status==='ambiguous'?'تاريخ ملتبس يحتاج تصحيحًا':'تاريخ غير صالح أو فارغ'});continue;}
  if(!testName){rejected.push({row:row._rowNumber,reason:'اسم التحليل غير موجود'});continue;}
  if(!String(row.result_value||'').trim()&&!String(row.raw_payload||'').trim()&&!Object.keys(parameters).length){rejected.push({row:row._rowNumber,reason:'لا توجد نتيجة أو بارامترات مربوطة'});continue;}
  const testCode=String(row.test_code||('LEGACY-'+testName.toLocaleUpperCase('en').replace(/[^A-Z0-9]+/g,'-').slice(0,48))).trim();
  const originalCells=sheet.rawRows[row._rowNumber-1]||[],originalRow={};
  sheet.headers.forEach((header,index)=>{if(String(originalCells[index]??'').trim()!=='')originalRow[String(header||('Column '+(index+1)))]=String(originalCells[index]);});
  const resultData={format:'legacy-historical-v1',value:row.result_value||null,parameters,unit:row.unit||null,reference_range:row.reference_range||null,raw_original:row.raw_payload||null,raw_result_at:row.result_at||null,raw_age:row.age||null,raw_age_unit:row.age_type||null};
  const duplicateSignature=JSON.stringify([patientName,date.isoDate,testCode,resultData]);if(seenContent.has(duplicateSignature)){rejected.push({row:row._rowNumber,reason:'صف مكرر بنفس المريض والتاريخ والتحليل والنتيجة'});continue;}seenContent.add(duplicateSignature);
  const sourceRecordKey=await historicalRecordKey(state.result.sha256,sheet.name,row._rowNumber,testCode);
  let resultAt=null;if(row.result_at){let candidate=new Date(row.result_at);if(Number.isNaN(candidate.getTime()))candidate=new Date(date.isoDate+'T'+row.result_at);if(!Number.isNaN(candidate.getTime()))resultAt=candidate.toISOString();}
  prepared.push({patient_name_snapshot:patientName,test_code:testCode,test_name_snapshot:testName,result_date:date.isoDate,result_at:resultAt,result_data:resultData,patient_age_raw:row.age||null,patient_age_unit:row.age_type||null,source_sheet_name:sheet.name,source_row_number:row._rowNumber,source_record_key:sourceRecordKey,original_row:originalRow});
 }
 if(!prepared.length)throw new Error('لا توجد صفوف صالحة. الصفوف المرفوضة: '+rejected.length);
 const root=$('sheetDetails'),panel=el('section');panel.className='validationPanel';panel.append(el('h3','مراجعة واعتماد النتائج التاريخية'));
 const stats=el('div');stats.className='validationStats';
 for(const [label,value] of [['صفوف مقبولة',prepared.length],['صفوف مرفوضة',rejected.length],['أسماء مرضى مختلفة',new Set(prepared.map(x=>x.patient_name_snapshot)).size]]){const item=el('div');item.append(el('small',label),el('b',value));stats.append(item);}panel.append(stats);
 if(rejected.length){const list=el('ul');rejected.slice(0,30).forEach(x=>list.append(el('li','صف '+x.row+': '+x.reason)));panel.append(list);}
 const allNames=[...new Set(prepared.map(x=>x.patient_name_snapshot))],names=allNames.slice(0,100);state.patientLinks={};
 panel.append(el('p','مطابقة المرضى لا تتم تلقائيًا. راجع المرشحين حسب الاسم والعمر وتواريخ الزيارات السابقة، واختر المريض الصحيح أو اترك الاسم محفوظًا كنص تاريخي دون ربط.'));
 if(allNames.length>100)panel.append(el('p','تنبيه: يوجد '+(allNames.length-100)+' اسمًا إضافيًا لن تُعرض له اقتراحات ربط في هذه المراجعة؛ ستُحفظ أسماؤهم كما وردت دون ربط بمريض، ويمكن مراجعتهم لاحقًا.'));
 for(let i=0;i<names.length;i+=10){
  const group=names.slice(i,i+10);
  const candidates=await Promise.all(group.map(name=>findHistoricalPatientCandidates({tenantId:state.tenantId,branchId:state.branchId,name,limit:8}).catch(()=>[])));
  group.forEach((name,index)=>{
   const line=el('label');line.className='historyMatch';const select=el('select');
   const options=[{value:'',label:'بدون ربط بمريض — احتفظ بالاسم فقط'},...candidates[index].map(p=>({value:p.id,label:p.full_name+' · العمر '+(p.age_years??'غير مسجل')+' · آخر زيارات: '+((p.recent_visit_dates||[]).join('، ')||'لا توجد')}))];
   select.append(...options.map(x=>{const o=el('option',x.label);o.value=x.value;return o;}));
   select.addEventListener('change',()=>{state.patientLinks[name]=select.value||null;});
   line.append(el('span',name),select);panel.append(line);
  });
 }
 const approve=el('button','اعتماد ورفع '+prepared.length+' نتيجة تاريخية للسحابة');approve.type='button';
 approve.addEventListener('click',async()=>{
  if(!globalThis.confirm('سيتم حفظ النتائج كبيانات تاريخية منفصلة، مع الاحتفاظ بملف Excel الأصلي. لن تُنشأ زيارات أو فواتير أو حركات مالية، ولن تُستبدل نتائج تشغيلية. هل تعتمد الرفع؟'))return;
  approve.disabled=true;approve.textContent='جارٍ حفظ الملف والنتائج…';
  try{
   const records=prepared.map(row=>({...row,patient_id:state.patientLinks[row.patient_name_snapshot]||null}));
   const sheetSummary=[{sheet_name:sheet.name,rows_total:analysis.nonEmptyRows,rows_accepted:prepared.length,rows_rejected:rejected.length}];
   const result=await importHistoricalResults({tenantId:state.tenantId,branchId:state.branchId,userId:state.userId,file:state.file,fileSha256:state.result.sha256,sheetName:sheet.name,mappingSnapshot:{sheet_name:sheet.name,column_mapping:mapping},sheetSummary,records});
   const signature=await sheetHeaderSignature(sheet.headers);await saveHistoricalImportTemplate({tenantId:state.tenantId,branchId:state.branchId,userId:state.userId,sheetName:sheet.name,headerSignature:signature,headers:sheet.headers,entityType:'historical_results',columnMapping:mapping});
   note('تم حفظ الدفعة '+result.batchId+' — أضيف '+result.inserted+'، تكرر وتُخطّي '+result.skipped+'، فشل '+result.failed+'. الحالة: '+result.status,result.failed>0);
   approve.textContent='تم الاعتماد';
  }catch(error){note(error.message||'تعذر اعتماد النتائج التاريخية.',true);approve.disabled=false;approve.textContent='إعادة محاولة الاعتماد';}
 });
 panel.append(approve);root.append(panel);panel.scrollIntoView({behavior:'smooth',block:'start'});
}
async function importCatalogSheet(sheet,button){
 if(navigator.onLine===false)throw new Error('استيراد كتالوج التحاليل يحتاج اتصالًا بالإنترنت. لم يتم تغيير البيانات.');
 if(!state.tenantId)throw new Error('تعذر تحديد المعمل الحالي.');
 const mapping=sheet.columnMapping||[];
 if(mapping.filter(item=>item.fieldKey==='test_code').length!==1)throw new Error('اربط عمود كود التحليل مرة واحدة قبل الاستيراد.');
 if(mapping.filter(item=>item.fieldKey==='test_name').length!==1)throw new Error('اربط عمود اسم التحليل مرة واحدة قبل الاستيراد.');
 const analysis=analyzeArchiveSheet(sheet.rawRows,sheet.headerRowIndex,'catalog',mapping);
 if(analysis.missingRequired||analysis.duplicateRows||analysis.duplicateHeaders)throw new Error('أصلح الحقول المطلوبة والتكرارات والعناوين المكررة قبل الاستيراد. لم يتم حفظ أي تحليل.');
 const records=analysis.records.map(row=>({test_code:row.test_code,test_name:row.test_name,_rowNumber:row._rowNumber}));
 button.disabled=true;button.textContent='جارٍ إنشاء الأكواد الجديدة…';
 try{
  const result=await importNewCatalogTests({tenantId:state.tenantId,records,listExisting:listCatalog,saveTest:saveCatalogTest});
  const message='تم إنشاء '+result.created.length+' تحليل جديد، وتخطي '+result.skipped.length+' كود موجود، وفشل '+result.failed.length+'. لم يتم تعديل الأكواد الموجودة.';
  note(message,result.failed.length>0);
  if(result.failed.length){const detail=el('ul');for(const item of result.failed)detail.append(el('li',item.code+': '+item.message));$('sheetDetails').append(detail);}
 }catch(error){note(error.message||'تعذر استيراد كتالوج التحاليل.',true);}
 finally{button.disabled=false;button.textContent='استيراد التحاليل الجديدة فقط';}
}
async function importBasePricesSheet(sheet,button){
 if(navigator.onLine===false)throw new Error('استيراد الأسعار يحتاج اتصالًا بالإنترنت. لم يتم تغيير البيانات.');
 if(!state.tenantId)throw new Error('تعذر تحديد المعمل الحالي.');
 const mapping=sheet.columnMapping||[];
 const codeColumns=mapping.filter(item=>item.fieldKey==='test_code'),priceColumns=mapping.filter(item=>item.fieldKey==='price');
 if(codeColumns.length!==1||priceColumns.length!==1)throw new Error('اربط عمود كود التحليل وعمود السعر مرة واحدة قبل الاستيراد.');
 const analysis=analyzeArchiveSheet(sheet.rawRows,sheet.headerRowIndex,'prices',mapping);
 if(analysis.missingRequired||analysis.duplicateRows||analysis.duplicateHeaders)throw new Error('أصلح أكواد التحاليل والأسعار والتكرارات قبل الاستيراد. لم يتم حفظ أي سعر.');
 const records=analysis.records.map(row=>({test_code:row.test_code,selling_price:row.price,_rowNumber:row._rowNumber}));
 button.disabled=true;button.textContent='جارٍ إضافة الأسعار العامة الجديدة…';
 try{
  const result=await importNewBasePrices({tenantId:state.tenantId,records,listCatalog,listExistingPrices:listCurrentBasePrices,savePrice:addBasePriceIfMissing});
  const cacheWarnings=result.created.filter(item=>item.cacheUpdated===false).length;
  note('تمت إضافة '+result.created.length+' سعر أساسي جديد، وتخطي '+result.skipped.length+' صف، وفشل '+result.failed.length+'. لم يتم تعديل أي سعر حالي أو سعر فرع.'+(cacheWarnings?' تعذر تحديث الذاكرة المحلية لبعض الأسعار؛ ستُحدّث عند قراءة الكتالوج مع الاتصال.':''),result.failed.length>0);
  if(result.failed.length){const detail=el('ul');for(const item of result.failed)detail.append(el('li',item.code+': '+item.message));$('sheetDetails').append(detail);}
 }catch(error){note(error.message||'تعذر استيراد أسعار التحاليل.',true);}
 finally{button.disabled=false;button.textContent='استيراد أسعار البيع الأساسية الجديدة فقط';}
}
function renderResult(){const r=state.result;$('summary').hidden=false;$('sheetPanel').hidden=false;const root=$('summary');root.replaceChildren();const meta=el('div');meta.className='meta';
 for(const [label,value] of [['الملف',r.fileName],['الحجم',(r.fileSize/1024/1024).toFixed(2)+' MB'],['عدد الأوراق',r.sheetCount],['بصمة SHA-256',r.sha256],['وقت الفحص',new Date(r.inspectedAt).toLocaleString('ar-EG')],['حالة الخصوصية','قراءة محلية فقط']]){const box=el('div');box.append(el('small',label),el('b',value));meta.append(box);}root.append(meta);
 $('sheetSelect').replaceChildren(...r.sheets.map((s,i)=>{const o=el('option',s.name+' ('+s.rowCount+' صف)');o.value=i;return o;}));$('sheetSelect').value='0';renderSheet();}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{await signInWithEmail($('email').value,$('password').value);await start();}catch(x){note(x.message||'تعذر تسجيل الدخول.',true);}finally{b.disabled=false;}});
$('sheetSelect').addEventListener('change',renderSheet);
$('inspectButton').addEventListener('click',async()=>{const file=$('archiveFile').files?.[0];const b=$('inspectButton');b.disabled=true;b.textContent='جارٍ الفحص داخل المتصفح…';$('summary').hidden=true;$('sheetPanel').hidden=true;try{state.file=file;state.result=await inspectWorkbookFile(file);await applySavedSheetTemplates();renderResult();note('انتهى الفحص واقتراح مطابقة الأعمدة. لم يتم رفع الملف أو حفظ نتائج حتى الآن.');}catch(x){note(x.message||'تعذر فحص الملف.',true);}finally{b.disabled=false;b.textContent='فحص الملف محليًا';}});
try{await start();}catch(e){note(e.message||'تعذر فتح أداة الفحص.',true);}
