import { getCurrentSession, signInWithEmail, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { listCatalog, listCurrentPrices, listTestParameters, saveCatalogTest, saveTestParameter, setTestParameterActive, setCurrentPrice, setBranchPrice, listMasterCatalogTests, importMasterCatalogTest } from '../../modules/catalog/repository.js';
import { parseFormulaExpression, formulaToExpression } from '../../modules/catalog/formula-engine.js';

const $ = id => document.getElementById(id);
const state = { context:null, tenant:null, role:'staff', tests:[], masterTests:[], masterLibraryOpen:false, prices:new Map(), selectedTest:null, parameters:[], selectedParameter:null, busy:false, tenantRequest:0, selectionRequest:0 };
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => `${Number(value || 0).toFixed(2)} ج.م`;
const priceKey = (testId, branchId = null) => `${testId}:${branchId || 'base'}`;
function notice(message,error=false){const el=$('notice');el.textContent=message;el.className=`notice show${error?' error':''}`;clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.className='notice',6500);}
function setBusy(form,busy){form.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=busy);if(form.id==='testForm')$('testKind').disabled=busy||!!state.selectedTest;}
function requireOnline(){if(globalThis.navigator?.onLine===false)throw new Error('تعديل الكتالوج يحتاج اتصالًا بالإنترنت. يمكنك مراجعة البيانات المحفوظة دون اتصال.');}
function parseJsonField(id,label,allowObject=false){const raw=$(id).value.trim();if(!raw)return [];let value;try{value=JSON.parse(raw);}catch{if(allowObject)return {text:raw};return raw.split(',').map(x=>x.trim()).filter(Boolean);}if(!Array.isArray(value)&&!(allowObject&&value!==null&&typeof value==='object'))throw new Error(allowObject?`${label} يجب أن يكون نصًا أو كائنًا أو قائمة.`:`${label} يجب أن تكون قائمة أو اختيارات مفصولة بفواصل.`);return value;}
function displayJson(value){return value&&typeof value==='object'&&Object.keys(value).length?JSON.stringify(value,null,2):'';}
function parseJsonObjectField(id,label){const value=parseJsonField(id,label,true);return Array.isArray(value)?{}:value;}
function parseJsonArrayField(id,label){const value=parseJsonField(id,label,false);if(!Array.isArray(value))throw new Error(label+' يجب أن تكون قائمة JSON.');return value;}
function legacyInputMode(parameter){
 if(parameter?.result_input_mode)return parameter.result_input_mode;
 const type=parameter?.value_type||'numeric';
 return type==='numeric'?(Number(parameter?.decimal_places)===0?'numeric_integer':'numeric_decimal'):type==='choice'?'single_choice':type;
}
function storageTypeForMode(mode){
 if(mode==='numeric_integer'||mode==='numeric_decimal')return 'numeric';
 if(mode==='boolean')return 'boolean';
 if(mode==='single_choice')return 'choice';
 return 'text';
}
function parseChoiceEditor(){
 const mode=$('parameterInputMode').value;
 const rows=$('parameterChoices').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
 if(mode==='graded_multi_choice'){
  const scores={};
  const choices=rows.map(line=>{
   const parts=line.split('|');
   const label=(parts[0]||'').trim(),score=Number((parts[1]||'').trim());
   if(!label||parts.length<2||!Number.isFinite(score))throw new Error('في الاختيارات المتدرجة اكتب: اسم الاختيار | الدرجة في كل سطر.');
   if(Object.prototype.hasOwnProperty.call(scores,label))throw new Error('لا تكرر الاختيار نفسه.');
   scores[label]=score;return label;
  });
  return {choices,resultConfig:{choice_scores:scores}};
 }
 const choices=mode==='positive_negative'?['Positive','Negative']:rows;
 if(['single_choice','multi_choice'].includes(mode)&&!choices.length)throw new Error('أضف اختيارًا واحدًا على الأقل، كل اختيار في سطر.');
 if(new Set(choices).size!==choices.length)throw new Error('لا يمكن تكرار الاختيار نفسه.');
 return {choices,resultConfig:{}};
}
function makeRangeRow(range={}){
 const age=range.age||{},text=range.text||'';
 const sex=range.sex||'any';
 return `<div class="range-editor-row" data-range-row>
  <label>الجنس
   <select data-range-field="sex"><option value="any" ${sex==='any'?'selected':''}>الكل</option><option value="male" ${sex==='male'?'selected':''}>ذكر</option><option value="female" ${sex==='female'?'selected':''}>أنثى</option></select>
  </label>
  <label>العمر من<input data-range-field="age-min" type="number" min="0" step="any" value="${esc(age.min??'')}"></label>
  <label>وحدة البداية<select data-range-field="age-min-unit"><option value="years" ${(age.min_unit||age.unit||'years')==='years'?'selected':''}>سنة</option><option value="months" ${(age.min_unit||age.unit)==='months'?'selected':''}>شهر</option><option value="days" ${(age.min_unit||age.unit)==='days'?'selected':''}>يوم</option></select></label>
  <label>العمر حتى<input data-range-field="age-max" type="number" min="0" step="any" value="${esc(age.max??'')}"></label>
  <label>وحدة النهاية<select data-range-field="age-max-unit"><option value="years" ${(age.max_unit||age.unit||'years')==='years'?'selected':''}>سنة</option><option value="months" ${(age.max_unit||age.unit)==='months'?'selected':''}>شهر</option><option value="days" ${(age.max_unit||age.unit)==='days'?'selected':''}>يوم</option></select></label>
  <label>أقل نتيجة<input data-range-field="lower" type="number" step="any" value="${esc(range.lower??range.low??'')}"></label>
  <label>أعلى نتيجة<input data-range-field="upper" type="number" step="any" value="${esc(range.upper??range.high??'')}"></label>
  <label>وحدة المدى<input data-range-field="unit" value="${esc(range.unit||'')}" placeholder="مثال: mg/dL"></label>
  <label class="wide">ملاحظة مرجعية نصية (للمديات غير الرقمية)<input data-range-field="note" value="${esc(text)}"></label>
  <label class="check-line"><input data-range-field="pregnancy" type="checkbox" ${range.pregnancy?'checked':''}> ينطبق على الحمل</label>
  <button type="button" class="button button-light" data-remove-range>حذف هذا المدى</button>
 </div>`;
}
function renderRangeEditor(ranges){
 const rows=Array.isArray(ranges)?ranges:(ranges&&typeof ranges==='object'?[ranges]:[]);
 $('referenceRangeRows').innerHTML=rows.length?rows.map(makeRangeRow).join(''):'<p class="muted">لا توجد مديات مضافة. أضف مدى فقط عند توفر مرجع مناسب.</p>';
}
function parseReferenceRangeEditor(){
 const rows=[];
 for(const row of $('referenceRangeRows').querySelectorAll('[data-range-row]')){
  const get=name=>row.querySelector(`[data-range-field="${name}"]`);
  const note=get('note').value.trim();
  if(note){rows.push({text:note});continue;}
  const sex=get('sex').value,ageMin=get('age-min').value,ageMax=get('age-max').value;
  const lower=get('lower').value,upper=get('upper').value,unit=get('unit').value.trim();
  const range={};
  if(sex!=='any')range.sex=sex;
  if(ageMin!==''||ageMax!==''){
   range.age={};
   if(ageMin!==''){range.age.min=Number(ageMin);range.age.min_unit=get('age-min-unit').value;}
   if(ageMax!==''){range.age.max=Number(ageMax);range.age.max_unit=get('age-max-unit').value;}
   if(ageMin!==''&&ageMax!==''&&Number(ageMin)>Number(ageMax)&&get('age-min-unit').value===get('age-max-unit').value)throw new Error('بداية العمر لا يمكن أن تكون أكبر من نهايته.');
  }
  if(lower!=='')range.lower=Number(lower);
  if(upper!=='')range.upper=Number(upper);
  if(unit)range.unit=unit;
  if(get('pregnancy').checked)range.pregnancy=true;
  if(Object.keys(range).length)rows.push(range);
 }
 return rows;
}
function renderRuleSources(selected=''){
 $('parameterRuleSource').innerHTML='<option value="">بدون شرط</option>'+state.parameters.filter(p=>p.id!==state.selectedParameter).map(p=>`<option value="${esc(p.parameter_code)}" ${p.parameter_code===selected?'selected':''}>${esc(p.parameter_name)} (${esc(p.parameter_code)})</option>`).join('');
}
function updateFormulaFields(){
 const calculated=$('parameterSource').value==='calculated';
 $('formulaField').hidden=!calculated;
 if(calculated){$('parameterInputMode').value='numeric_decimal';$('parameterInputMode').disabled=true;}
 else $('parameterInputMode').disabled=false;
 const mode=$('parameterInputMode').value;
 $('parameterType').value=storageTypeForMode(mode);
 $('choiceEditorField').hidden=!['single_choice','multi_choice','graded_multi_choice','positive_negative'].includes(mode);
 $('parameterChoices').placeholder=mode==='graded_multi_choice'?'Positive | 1\nNegative | 0':'اكتب كل اختيار في سطر مستقل';
}
function currentTest(){return state.tests.find(t=>t.id===state.selectedTest)||null;}
function currentTest(){return state.tests.find(t=>t.id===state.selectedTest)||null;}
function renderTests(){const term=$('search').value.trim().toLocaleLowerCase();const visible=state.tests.filter(t=>( $('showInactive').checked || t.is_active ) && (!term || `${t.name} ${t.code}`.toLocaleLowerCase().includes(term)));$('testList').innerHTML=visible.length?visible.map(t=>`<button type="button" class="test-item ${t.id===state.selectedTest?'selected':''}" data-id="${esc(t.id)}"><span><strong>${esc(t.name)}</strong><small>${esc(t.code)}${t.category?` · ${esc(t.category)}`:''} · ${t.test_kind==='panel'?'مجموعة بارامترات':'تحليل فردي'}</small></span><span class="meta"><span class="status ${t.is_active?'active':'inactive'}">${t.is_active?'نشط':'موقوف'}</span></span></button>`).join(''):'<p class="empty">لا توجد تحاليل مطابقة.</p>';}
function resetTestForm(){state.selectionRequest++;state.selectedTest=null;$('editorTitle').textContent='إضافة تحليل جديد';$('testForm').reset();$('testActive').checked=true;$('testKind').value='individual';$('testKind').disabled=false;$('testStatus').textContent='تحليل جديد';$('testStatus').className='status';$('parameterSection').hidden=true;$('priceSection').hidden=true;state.parameters=[];state.selectedParameter=null;renderTests();}
function fillTestForm(test){state.selectedTest=test.id;$('editorTitle').textContent=`تعديل: ${test.name}`;$('testCode').value=test.code||'';$('testName').value=test.name||'';$('testKind').value=test.test_kind||'individual';$('testKind').disabled=true;$('testCategory').value=test.category||'';$('testSpecimen').value=test.specimen||'';$('testMethod').value=test.method||'';$('testTurnaround').value=test.turnaround_minutes??'';$('testInstructions').value=test.instructions||'';$('testActive').checked=!!test.is_active;
 $('testShortName').value=test.short_name||'';$('testSynonyms').value=(test.synonyms||[]).join(', ');$('testLoinc').value=test.loinc_code||'';
 $('testClinicalCategory').value=test.clinical_category||'';$('testClinicalPurpose').value=test.clinical_purpose||'';$('testServiceType').value=test.service_type||'laboratory_test';
 $('testPreparation').value=displayJson(test.patient_preparation);$('testCollection').value=displayJson(test.collection_requirements);
 $('testSpecimenRequirements').value=displayJson(test.specimen_requirements);$('testTransport').value=displayJson(test.transport_requirements);
 $('testStability').value=displayJson(test.stability_requirements);$('testRejection').value=(test.rejection_criteria||[]).join(', ');
 $('testCriticalPolicy').value=displayJson(test.critical_result_policy);$('testBiosafety').value=test.biosafety_notes||'';
 $('testReportingNotes').value=test.reporting_notes||'';$('testSources').value=displayJson(test.source_references);
 $('testReviewStatus').value=test.clinical_review_status||'needs_review';$('testStatus').textContent=test.is_active?'نشط':'موقوف';$('testStatus').className=`status ${test.is_active?'active':'inactive'}`;$('parameterSection').hidden=false;$('priceSection').hidden=false;renderTests();}
async function selectTest(id){const test=state.tests.find(t=>t.id===id);if(!test)return;const requestId=++state.selectionRequest;const tenantId=state.tenant.id;fillTestForm(test);state.selectedParameter=null;$('parameterForm').hidden=true;await Promise.all([loadParameters({tenantId,testId:test.id,requestId}),loadPrice()]);}
async function loadCatalog(requestId=state.tenantRequest){const tenantId=state.tenant.id;const tests=await listCatalog({tenantId,includeInactive:true});if(requestId!==state.tenantRequest||tenantId!==state.tenant?.id)return;state.tests=tests;const ids=tests.map(t=>t.id);const priceBranchId=state.role==='owner'?null:state.tenant.branches?.[0]?.id||null;const prices=ids.length?await listCurrentPrices({tenantId,branchId:priceBranchId,testIds:ids}):[];if(requestId!==state.tenantRequest||tenantId!==state.tenant?.id)return;state.prices=new Map(prices.map(p=>[priceKey(p.test_id,p.branch_id),p]));renderTests();if(state.selectedTest){const found=state.tests.find(t=>t.id===state.selectedTest);if(found)await selectTest(found.id);else resetTestForm();}}
async function loadParameters({tenantId=state.tenant?.id,testId=state.selectedTest,requestId=state.selectionRequest}={}){if(!tenantId||!testId)return;const rows=await listTestParameters({tenantId,testId,includeInactive:true});if(requestId!==state.selectionRequest||tenantId!==state.tenant?.id||testId!==state.selectedTest)return;state.parameters=rows;renderParameters();}
function renderMasterCatalog(){
 const term=$('masterCatalogSearch').value.trim().toLocaleLowerCase();
 const rows=state.masterTests.filter(t=>!term||`${t.canonical_name} ${t.master_code} ${(t.alternate_names||[]).join(' ')}`.toLocaleLowerCase().includes(term));
 $('masterCatalogCount').textContent=`${state.masterTests.length} تعريف · ${state.masterTests.filter(t=>t.clinical_review_status==='verified').length} موثق مركزيًا · ${state.masterTests.filter(t=>!t.parameter_count).length} بدون بارامترات — قابلة للاستكمال محليًا`;
 $('masterCatalogList').innerHTML=rows.length?rows.map(t=>{
  const parameterCount=Number(t.parameter_count||0);
  const missingRanges=Number(t.missing_numeric_ranges||0),unreviewed=Number(t.unreviewed_parameters||0),placeholderCount=Number(t.placeholder_parameters||0);
  const completeness=placeholderCount?placeholderCount+' حقل مبدئي عام — حدّد النوع والوحدة والرينج محليًا':parameterCount?parameterCount+' بارامتر · '+(missingRanges?missingRanges+' بدون رينج رقمي (قابل للتعديل محليًا)':'لا توجد رينجات رقمية ناقصة')+' · '+(unreviewed?unreviewed+' تحتاج مراجعة':'البارامترات مراجعَة'):'لا توجد بارامترات — أضفها محليًا بعد الاستيراد';
  const requiresLocalSetup=!parameterCount||placeholderCount>0||missingRanges>0||unreviewed>0;
  const review=t.clinical_review_status==='verified'?'مراجع مركزيًا':'غير معتمد مركزيًا — يحتاج مراجعة محلية';
  return `<div class="master-item"><div><strong>${esc(t.canonical_name)}</strong><small>${esc(t.master_code)} · ${t.test_kind==='panel'?'مجموعة':'فردي'} · ${esc(t.category||'غير مصنف')} · إصدار ${esc(t.release?.version||'—')}</small><small>${completeness} · ${review}</small></div><button type="button" class="button button-secondary" data-import-master="${esc(t.id)}">${requiresLocalSetup?'استيراد واستكمال محليًا':'استيراد للمعمل'}</button></div>`;
 }).join(''):'<p class="empty">لا توجد تعريفات منشورة مطابقة.</p>';
}
async function loadMasterCatalog(){
 try{state.masterTests=await listMasterCatalogTests();renderMasterCatalog();}
 catch(error){state.masterTests=[];$('masterCatalogCount').textContent='تعذر التحميل';$('masterCatalogList').innerHTML=`<p class="empty">${esc(error.message||'تعذر تحميل المكتبة الطبية.')}</p>`;}
}
function renderParameters(){const rows=state.parameters;$('parameterList').innerHTML=rows.length?rows.map(p=>`<div class="parameter-item"><div><strong>${esc(p.parameter_name)} <span class="muted-inline">(${esc(p.parameter_code)})</span></strong><small>${esc(p.unit||'بدون وحدة')} · ${esc(({numeric_integer:'عدد صحيح',numeric_decimal:'رقم عشري',numeric_comparator:'رقم بعلامة مقارنة',text:'نص',positive_negative:'موجب/سالب',boolean:'نعم/لا',single_choice:'اختيار واحد',multi_choice:'اختيارات متعددة',graded_multi_choice:'اختيارات بدرجات'})[legacyInputMode(p)]||p.value_type)} · ${p.result_source==='calculated'?'محسوب تلقائيًا':'إدخال يدوي'} · ${p.is_active?'نشط':'موقوف'} · ${p.reference_interval_status==='verified_local'?'المدى معتمد محليًا':p.reference_interval_status==='not_applicable'?'لا يحتاج مدى':'المدى يحتاج تحققًا محليًا'} · ترتيب ${p.display_order}</small></div><div class="parameter-actions"><button type="button" data-edit-param="${esc(p.id)}">تعديل</button><button type="button" data-toggle-param="${esc(p.id)}">${p.is_active?'إيقاف':'تنشيط'}</button></div></div>`).join(''):'<p class="empty">لا توجد بارامترات لهذا التحليل حتى الآن.</p>';}
async function loadPrice(){const branchId=$('priceBranchSelect').value||null;const base=state.prices.get(priceKey(state.selectedTest));const override=branchId?state.prices.get(priceKey(state.selectedTest,branchId)):null;const price=override||base;$('currentPrice').textContent=price?money(price.selling_price):'لا يوجد سعر حالي';$('priceHint').textContent=branchId&&!override?(base?`هذا الفرع يستخدم السعر الأساسي (${money(base.selling_price)}). أدخل سعرًا لإضافة استثناء لهذا الفرع.`:'لا يوجد سعر أساسي أو خاص؛ يجب تسجيل سعر أولًا.'):(price?.effective_from?`آخر سريان: ${new Date(price.effective_from).toLocaleString('ar-EG')}`:'يجب تسجيل سعر قبل إتاحة التحليل للاستقبال.');$('priceForm').hidden=state.role!=='owner';$('newPrice').value=branchId?(override?.selling_price??''):(base?.selling_price??'');}
function resetParameterForm(){state.selectedParameter=null;$('parameterForm').reset();$('parameterDecimals').value='2';$('parameterOrder').value='0';$('parameterChoices').value='';$('parameterSource').value='manual';$('parameterFormula').value='';$('parameterInputMode').value='numeric_decimal';renderRangeEditor([]);renderRuleSources();$('parameterRuleSource').value='';$('parameterRuleValue').value='';$('parameterRuleChoices').value='';updateFormulaFields();$('parameterRequired').checked=true;$('parameterActive').checked=true;$('parameterTitle').textContent='إضافة بارامتر';$('parameterForm').hidden=true;}
function editParameter(id){const p=state.parameters.find(x=>x.id===id);if(!p)return;state.selectedParameter=p.id;$('parameterTitle').textContent=`تعديل: ${p.parameter_name}`;$('parameterCode').value=p.parameter_code||'';$('parameterName').value=p.parameter_name||'';$('parameterUnit').value=p.unit||'';$('parameterType').value=p.value_type||'numeric';$('parameterDecimals').value=p.decimal_places??2;$('parameterOrder').value=p.display_order??0;renderRangeEditor(p.reference_ranges);$('parameterChoices').value=(p.choices||[]).join('\n');$('parameterSource').value=p.result_source||'manual';$('parameterInputMode').value=legacyInputMode(p);renderRuleSources(p.display_rules?.[0]?.source_parameter_code||'');$('parameterRuleOperator').value=p.display_rules?.[0]?.operator||'equals';$('parameterRuleValue').value=p.display_rules?.[0]?.value||'';$('parameterRuleChoices').value=(p.display_rules?.[0]?.choices||[]).join('\n');
 $('parameterUnitUcum').value=p.unit_ucum||'';$('parameterAlternateUnits').value=displayJson(p.alternate_units);
 $('parameterCriticalRanges').value=displayJson(p.critical_ranges);$('parameterInterpretation').value=displayJson(p.interpretation_rules);
 $('parameterApplicability').value=displayJson(p.applicability);$('parameterMethodNotes').value=p.method_notes||'';
 $('parameterSources').value=displayJson(p.source_references);$('parameterClinicalMetadata').value=displayJson(p.clinical_metadata);$('parameterReferenceStatus').value=p.reference_interval_status||'local_verification_required';$('parameterReviewStatus').value=p.clinical_review_status||'needs_review';$('parameterFormula').value=formulaToExpression(p.formula);updateFormulaFields();$('parameterRequired').checked=!!p.is_required;$('parameterActive').checked=!!p.is_active;$('parameterForm').hidden=false;$('parameterForm').scrollIntoView({behavior:'smooth',block:'nearest'});}
async function start(){const session=await getCurrentSession();if(!session){$('loginPanel').hidden=false;$('workspace').hidden=true;$('signOut').hidden=true;return;}state.context=await loadMyTenantContext();if(!state.context.tenants?.length)throw new Error('الحساب لا يملك معملًا نشطًا.');$('loginPanel').hidden=true;$('workspace').hidden=false;$('signOut').hidden=false;$('userLine').textContent=`الحساب: ${session.user.email||'مستخدم مسجل'}`;$('tenantSelect').innerHTML=state.context.tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');await loadMasterCatalog();await selectTenant(getPreferredTenantId(state.context.tenants) || state.context.tenants[0].id);}
async function selectTenant(id){const requestId=++state.tenantRequest;state.selectionRequest++;state.tenant=state.context.tenants.find(t=>t.id===id);if(!state.tenant)throw new Error('لم يتم العثور على المعمل المحدد.');rememberWorkspaceSelection(state.tenant.id);state.role=state.tenant.accountType==='owner'?'owner':'staff';$('openMasterLibrary').hidden=state.role!=='owner';$('masterCatalogPanel').hidden=state.role!=='owner'||!state.masterLibraryOpen;$('priceBranchSelect').innerHTML='<option value="">السعر الأساسي لكل الفروع</option>'+(state.tenant.branches||[]).map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');if(state.role!=='owner'&&state.tenant.branches?.length===1)$('priceBranchSelect').value=state.tenant.branches[0].id;$('roleNotice').textContent=state.role==='owner'?'إدارة كتالوج التحاليل والأسعار متاحة لمالك المعمل فقط. صلاحية الموظف: إدارة التحاليل والبارامترات الفنية.':'صلاحية الموظف: إدارة التحاليل والبارامترات الفنية. تعديل الأسعار غير متاح.';resetTestForm();await loadCatalog(requestId);}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await signInWithEmail($('email').value,$('password').value);await start();}catch(err){notice(err.message||'تعذر تسجيل الدخول.',true);}});
$('signOut').addEventListener('click',async()=>{try{await signOut();await start();}catch(e){notice(e.message,true);}});
$('tenantSelect').addEventListener('change',()=>selectTenant($('tenantSelect').value).catch(e=>notice(e.message,true)));
$('search').addEventListener('input',renderTests);$('showInactive').addEventListener('change',renderTests);
$('testList').addEventListener('click',e=>{const btn=e.target.closest('[data-id]');if(btn)selectTest(btn.dataset.id).catch(err=>notice(err.message,true));});
$('newTest').addEventListener('click',resetTestForm);$('resetTest').addEventListener('click',resetTestForm);
$('testForm').addEventListener('submit',async e=>{e.preventDefault();if(state.busy)return;state.busy=true;setBusy(e.currentTarget,true);try{requireOnline();const isNew=!state.selectedTest;const testKind=$('testKind').value;const saved=await saveCatalogTest({tenantId:state.tenant.id,id:state.selectedTest||undefined,test:{code:$('testCode').value,name:$('testName').value,testKind,category:$('testCategory').value,specimen:$('testSpecimen').value,method:$('testMethod').value,turnaroundMinutes:$('testTurnaround').value,instructions:$('testInstructions').value,isActive:$('testActive').checked,
 shortName:$('testShortName').value,synonyms:$('testSynonyms').value.split(',').map(x=>x.trim()).filter(Boolean),loincCode:$('testLoinc').value,
 clinicalCategory:$('testClinicalCategory').value,clinicalPurpose:$('testClinicalPurpose').value,serviceType:$('testServiceType').value,
 patientPreparation:parseJsonObjectField('testPreparation','تحضير المريض'),collectionRequirements:parseJsonObjectField('testCollection','متطلبات السحب'),
 specimenRequirements:parseJsonObjectField('testSpecimenRequirements','مواصفات العينة'),transportRequirements:parseJsonObjectField('testTransport','النقل'),
 stabilityRequirements:parseJsonObjectField('testStability','الثبات'),rejectionCriteria:$('testRejection').value.split(',').map(x=>x.trim()).filter(Boolean),
 criticalResultPolicy:parseJsonObjectField('testCriticalPolicy','سياسة النتائج الحرجة'),biosafetyNotes:$('testBiosafety').value,
 reportingNotes:$('testReportingNotes').value,sourceReferences:parseJsonArrayField('testSources','المراجع العلمية'),clinicalReviewStatus:$('testReviewStatus').value}});if(isNew&&testKind==='individual'){await saveTestParameter({tenantId:state.tenant.id,testId:saved.id,parameter:{code:(`RES_${saved.code}`).slice(0,40),name:saved.name,valueType:'numeric',decimalPlaces:2,displayOrder:0,referenceRanges:[],choices:[],isRequired:true,isActive:true}});}notice(isNew&&testKind==='individual'?'تم إنشاء التحليل وإضافة خانة نتيجته تلقائيًا.':'تم حفظ بيانات التحليل.');await loadCatalog();await selectTest(saved.id);}catch(err){notice(err.message||'تعذر حفظ التحليل.',true);}finally{state.busy=false;setBusy(e.currentTarget,false);}});
$('parameterSection').addEventListener('click',async e=>{const edit=e.target.closest('[data-edit-param]');if(edit){editParameter(edit.dataset.editParam);return;}const toggle=e.target.closest('[data-toggle-param]');if(toggle){const p=state.parameters.find(x=>x.id===toggle.dataset.toggleParam);if(!p)return;try{requireOnline();await setTestParameterActive({tenantId:state.tenant.id,testId:state.selectedTest,parameterId:p.id,isActive:!p.is_active});notice(p.is_active?'تم إيقاف البارامتر.':'تم تنشيط البارامتر.');await loadParameters();}catch(err){notice(err.message,true);}}});
$('newParameter').addEventListener('click',()=>{resetParameterForm();$('parameterForm').hidden=false;$('parameterForm').scrollIntoView({behavior:'smooth',block:'nearest'});});$('cancelParameter').addEventListener('click',resetParameterForm);
$('parameterSource').addEventListener('change',updateFormulaFields);$('parameterInputMode').addEventListener('change',updateFormulaFields);
$('addReferenceRange').addEventListener('click',()=>{const host=$('referenceRangeRows');if(host.querySelector('.muted'))host.innerHTML='';host.insertAdjacentHTML('beforeend',makeRangeRow());});
$('referenceRangeRows').addEventListener('click',e=>{const remove=e.target.closest('[data-remove-range]');if(remove){remove.closest('[data-range-row]').remove();if(!$('referenceRangeRows').querySelector('[data-range-row]'))$('referenceRangeRows').innerHTML='<p class="muted">لا توجد مديات مضافة. أضف مدى فقط عند توفر مرجع مناسب.</p>';}});
$('parameterForm').addEventListener('submit',async e=>{e.preventDefault();if(!state.selectedTest)return;const form=e.currentTarget;setBusy(form,true);try{requireOnline();const resultSource=$('parameterSource').value;const inputMode=$('parameterInputMode').value;const choiceData=parseChoiceEditor();const sourceCode=$('parameterRuleSource').value;const ruleChoices=$('parameterRuleChoices').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);const displayRules=sourceCode?[{source_parameter_code:sourceCode,operator:$('parameterRuleOperator').value,value:$('parameterRuleOperator').value==='is_not_empty'?'':$('parameterRuleValue').value.trim(),...(ruleChoices.length?{choices:ruleChoices}:{})}]:[];if(sourceCode&&$('parameterRuleOperator').value!=='is_not_empty'&&!$('parameterRuleValue').value.trim())throw new Error('أدخل القيمة التي تحقق شرط إظهار البارامتر.');const parameter={code:$('parameterCode').value,name:$('parameterName').value,unit:$('parameterUnit').value,valueType:storageTypeForMode(inputMode),inputMode,decimalPlaces:$('parameterDecimals').value,displayOrder:$('parameterOrder').value,referenceRanges:parseReferenceRangeEditor(),choices:choiceData.choices,resultConfig:choiceData.resultConfig,displayRules,resultSource,formula:resultSource==='calculated'?parseFormulaExpression($('parameterFormula').value,state.parameters,$('parameterCode').value):null,
 unitUcum:$('parameterUnitUcum').value,alternateUnits:parseJsonArrayField('parameterAlternateUnits','الوحدات البديلة'),
 criticalRanges:parseJsonObjectField('parameterCriticalRanges','القيم الحرجة'),interpretationRules:parseJsonArrayField('parameterInterpretation','قواعد التفسير'),
 applicability:parseJsonObjectField('parameterApplicability','الانطباق'),methodNotes:$('parameterMethodNotes').value,clinicalMetadata:parseJsonObjectField('parameterClinicalMetadata','بيانات الجودة والمنهجية'),
 sourceReferences:parseJsonArrayField('parameterSources','المراجع العلمية'),referenceIntervalStatus:$('parameterReferenceStatus').value,clinicalReviewStatus:$('parameterReviewStatus').value,
 isRequired:$('parameterRequired').checked,isActive:$('parameterActive').checked};await saveTestParameter({tenantId:state.tenant.id,testId:state.selectedTest,id:state.selectedParameter||undefined,parameter});notice('تم حفظ البارامتر الفني.');resetParameterForm();await loadParameters();}catch(err){notice(err.message||'تعذر حفظ البارامتر.',true);}finally{setBusy(form,false);}});
$('masterCatalogSearch').addEventListener('input',renderMasterCatalog);
$('openMasterLibrary').addEventListener('click',()=>{state.masterLibraryOpen=true;$('masterCatalogPanel').hidden=false;$('openMasterLibrary').hidden=true;});
$('closeMasterLibrary').addEventListener('click',()=>{state.masterLibraryOpen=false;$('masterCatalogPanel').hidden=true;$('openMasterLibrary').hidden=state.role!=='owner';});
$('masterCatalogList').addEventListener('click',async e=>{
 const btn=e.target.closest('[data-import-master]');if(!btn||state.role!=='owner')return;
 btn.disabled=true;
 try{requireOnline();const testId=await importMasterCatalogTest({tenantId:state.tenant.id,masterTestId:btn.dataset.importMaster});
  await loadCatalog();await selectTest(testId);notice('تم استيراد نسخة مستقلة إلى كتالوج المعمل. يمكنك استكمال السعر والرينجات والبيانات الفنية قبل اعتمادها للتشغيل.');
 }catch(error){notice(error.message||'تعذر استيراد تعريف التحليل.',true);}finally{btn.disabled=false;}
});
$('priceBranchSelect').addEventListener('change',()=>loadPrice());
$('priceForm').addEventListener('submit',async e=>{e.preventDefault();if(state.role!=='owner'||!state.selectedTest)return;const form=e.currentTarget;setBusy(form,true);try{requireOnline();const value=Number($('newPrice').value);if(!Number.isFinite(value)||value<0)throw new Error('أدخل سعرًا صحيحًا غير سالب.');const branchId=$('priceBranchSelect').value||null;const saved=branchId?await setBranchPrice({tenantId:state.tenant.id,branchId,testId:state.selectedTest,sellingPrice:value}):await setCurrentPrice({tenantId:state.tenant.id,testId:state.selectedTest,sellingPrice:value});state.prices.set(priceKey(state.selectedTest,branchId),saved);await loadPrice();notice(branchId?'تم تحديث سعر الفرع.':'تم تحديث السعر الأساسي.');}catch(err){notice(err.message||'تعذر تحديث السعر.',true);}finally{setBusy(form,false);}});

try{await start();}catch(e){notice(e.message||'تعذر تحميل كتالوج المعمل.',true);}
