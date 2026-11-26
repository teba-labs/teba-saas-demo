import { getCurrentSession, signInWithEmail, signOut } from '../../core/auth/session.js';
import { loadMyTenantContext } from '../../core/tenant/context.js';
import { getPreferredTenantId, getPreferredBranchId, rememberWorkspaceSelection } from '../../core/tenant/workspace-selection.js';
import { listCatalog, listCurrentPrices, listTestParameters, saveCatalogTest, saveTestParameter, setTestParameterActive, setCurrentPrice, setBranchPrice, listMasterCatalogTests, importMasterCatalogTest, setCatalogTestActive } from '../../modules/catalog/repository.js';
import { parseFormulaExpression, formulaToExpression } from '../../modules/catalog/formula-engine.js';

const $ = id => document.getElementById(id);
const state = { context:null, tenant:null, role:'staff', tests:[], masterTests:[], masterLibraryOpen:false, prices:new Map(), selectedTest:null, parameters:[], selectedParameter:null, busy:false, tenantRequest:0, selectionRequest:0 };
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => `${Number(value || 0).toFixed(2)} ج.م`;
const priceKey = (testId, branchId = null) => `${testId}:${branchId || 'base'}`;
const catalogBranchId = () => state.tenant?.branches?.find(branch => branch.id === getPreferredBranchId(state.tenant.id, state.tenant.branches || []))?.id || state.tenant?.branches?.[0]?.id || null;
function notice(message,error=false){const el=$('notice');el.textContent=message;el.className=`notice show${error?' error':''}`;clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.className='notice',6500);}
function requireOnline(){if(globalThis.navigator?.onLine===false)throw new Error('استيراد المكتبة المركزية يحتاج اتصالًا بالإنترنت.');}
function setBusy(form,busy){form.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=busy);if(form.id==='testForm')$('testKind').disabled=busy||!!state.selectedTest;}

function textLines(id){return $(id).value.split(/[\r\n]+/).map(value=>value.trim()).filter(Boolean);}
function parseTextObject(id){const raw=$(id).value.trim();return raw?{instructions:raw}:{};}
function parseTextArray(id){return textLines(id);}
function parseTextReferences(id){return textLines(id).map(line=>{const [title='',organization='',url='',version='']=line.split('|').map(x=>x.trim());return {title,organization,url,version};}).filter(row=>row.title||row.organization||row.url);}
function parseTextKeyValues(id,label){const output={};for(const line of textLines(id)){const at=line.indexOf('=');if(at<1)throw new Error(label+': اكتب كل سطر بصيغة (البيان = القيمة).');const key=line.slice(0,at).trim(),value=line.slice(at+1).trim();if(!key||!value)throw new Error(label+': يوجد سطر ناقص.');output[key]=value;}return output;}
function displayText(value){if(!value||typeof value!=='object')return String(value||'');if(Array.isArray(value))return value.map(v=>typeof v==='string'?v:Object.entries(v||{}).map(([k,item])=>k+' = '+(Array.isArray(item)?item.join('، '):String(item))).join(' | ')).join('\n');if(value.instructions&&Object.keys(value).length===1)return String(value.instructions);const rows=[];function displayReferences(value){return Array.isArray(value)?value.map(v=>typeof v==='string'?v:[v.title,v.organization,v.url,v.version].filter(Boolean).join(' | ')).join('\n'):'';}const flatten=(object,prefix='')=>Object.entries(object).forEach(([key,item])=>{const name=prefix?prefix+'.'+key:key;if(item&&typeof item==='object'&&!Array.isArray(item))flatten(item,name);else rows.push(name+' = '+(Array.isArray(item)?item.join('، '):String(item)));});flatten(value);return rows.join('\n');}
function displayRanges(value){if(!value||Array.isArray(value)&&!value.length)return '';if(typeof value==='object'&&value.text)return String(value.text);return displayText(value);}
function displayChoices(value){return Array.isArray(value)?value.join(', '):'';}
function displayJson(value){return displayText(value);}
function parseCriticalRanges(id){const raw=parseTextKeyValues(id,'القيم الحرجة');const out={};for(const [key,value] of Object.entries(raw)){const k=key.toLowerCase();if(['low','lower','الحد الأدنى','من'].includes(k))out.low=Number(value);else if(['high','upper','الحد الأعلى','إلى'].includes(k))out.high=Number(value);else if(['unit','الوحدة'].includes(k))out.unit=value;else out[key]=value;}if(('low'in out&&!Number.isFinite(out.low))||('high'in out&&!Number.isFinite(out.high)))throw new Error('حدود القيم الحرجة يجب أن تكون أرقامًا.');return out;}
function parseAlternateUnits(id){return textLines(id).map(line=>{const at=line.lastIndexOf('=');if(at<1)throw new Error('الوحدة البديلة: اكتب كل سطر بصيغة الوحدة = معامل التحويل.');const unit=line.slice(0,at).trim(),factor=Number(line.slice(at+1).trim());if(!unit||!Number.isFinite(factor)||factor<=0)throw new Error('معامل تحويل الوحدة يجب أن يكون رقمًا موجبًا.');return {unit,factor};});}
function parseApplicability(id){const raw=parseTextKeyValues(id,'الانطباق');const result={};for(const [key,value] of Object.entries(raw)){if(['العمر من','age_min'].includes(key))result.age={...(result.age||{}),min:Number(value)};else if(['العمر إلى','age_max'].includes(key))result.age={...(result.age||{}),max:Number(value)};else if(['وحدة العمر','age_unit'].includes(key))result.age={...(result.age||{}),unit:value==='سنة'?'years':value==='شهر'?'months':value==='يوم'?'days':value};else if(['النوع','sex'].includes(key))result.sex=value.split(/[،,]+/).map(x=>x.trim()==='ذكر'?'male':x.trim()==='أنثى'?'female':x.trim()).filter(Boolean);else if(['الحمل','pregnancy'].includes(key))result.pregnancy=['نعم','yes','true','1'].includes(value.toLowerCase());else result[key]=value;}if(result.age&&Object.values(result.age).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw new Error('العمر يجب أن يكون رقمًا.');return result;}
function displayApplicability(value){if(!value||typeof value!=='object')return '';const rows=[];if(value.age){if(value.age.min!=null)rows.push('العمر من = '+value.age.min);if(value.age.max!=null)rows.push('العمر إلى = '+value.age.max);if(value.age.unit)rows.push('وحدة العمر = '+({years:'سنة',months:'شهر',days:'يوم'}[value.age.unit]||value.age.unit));}if(value.sex){const sex=Array.isArray(value.sex)?value.sex:[value.sex];rows.push('النوع = '+sex.map(v=>({male:'ذكر',female:'أنثى'}[v]||v)).join('،'));}if(value.pregnancy)rows.push('الحمل = نعم');return rows.join('\n');}


function normalizeInputMode(parameter){
 if(parameter.result_input_mode)return parameter.result_input_mode;
 return ({numeric:'numeric_decimal',text:'text',boolean:'boolean',choice:'single_choice'}[parameter.value_type]||'numeric_decimal');
}
const modeLabels={numeric_integer:'رقم صحيح',numeric_decimal:'رقم عشري',numeric_comparator:'رقم مع علامة مقارنة',text:'نص حر',positive_negative:'موجب / سالب',boolean:'نعم / لا',single_choice:'اختيار واحد',multi_choice:'اختيارات متعددة',graded_multi_choice:'اختيارات متعددة بدرجات'};
function renderRangeRows(ranges=[]){
 const host=$('parameterRangeRows');if(!host)return;
 host.innerHTML='';
 const rows=Array.isArray(ranges)&&ranges.length?ranges:[{}];
 for(const range of rows){
  const age=range.age||{};
  const unit=age.min_unit||age.max_unit||age.unit||'years';
  host.insertAdjacentHTML('beforeend',`<div class="range-row">
    <div class="range-row-top"><strong>مدى مرجعي</strong><button type="button" class="range-remove" data-remove-range>حذف</button></div>
    <label>من<input class="range-lower" type="number" step="any" value="${esc(range.lower??range.low??'')}"></label>
    <label>إلى<input class="range-upper" type="number" step="any" value="${esc(range.upper??range.high??'')}"></label>
    <label>الوحدة<input class="range-unit" value="${esc(range.unit||'')}" placeholder="mg/dL"></label>
    <label>النوع<select class="range-sex"><option value="">كل الأنواع</option><option value="male" ${range.sex==='male'?'selected':''}>ذكر</option><option value="female" ${range.sex==='female'?'selected':''}>أنثى</option></select></label>
    <label>العمر من<input class="range-age-min" type="number" step="any" value="${esc(age.min??'')}"></label>
    <label>العمر إلى<input class="range-age-max" type="number" step="any" value="${esc(age.max??'')}"></label>
    <label>وحدة العمر<select class="range-age-unit"><option value="years" ${unit==='years'?'selected':''}>سنة</option><option value="months" ${unit==='months'?'selected':''}>شهر</option><option value="days" ${unit==='days'?'selected':''}>يوم</option></select></label>
    <label>الفئة<input class="range-population" value="${esc(range.population||'')}" placeholder="بالغ / طفل / حديث ولادة"></label>
    <label>النص المرجعي<input class="range-text" value="${esc(range.text||'')}" placeholder="Negative أو طبيعي..."></label>
    <label>المصدر<input class="range-source" value="${esc(range.source||'')}" placeholder="المصدر أو الجهاز"></label>
    <label class="range-pregnancy-label"><input class="range-pregnancy" type="checkbox" ${range.pregnancy?'checked':''}> خاص بالحمل</label>
  </div>`);
 }
}
function readRangeRows(){
 return [...$('parameterRangeRows').querySelectorAll('.range-row')].map(row=>{
  const value={};
  const text=row.querySelector('.range-text').value.trim();
  const lower=row.querySelector('.range-lower').value.trim();
  const upper=row.querySelector('.range-upper').value.trim();
  const unit=row.querySelector('.range-unit').value.trim();
  const sex=row.querySelector('.range-sex').value;
  const ageMin=row.querySelector('.range-age-min').value.trim();
  const ageMax=row.querySelector('.range-age-max').value.trim();
  const ageUnit=row.querySelector('.range-age-unit').value;
  const population=row.querySelector('.range-population').value.trim();
  const source=row.querySelector('.range-source').value.trim();
  const pregnancy=row.querySelector('.range-pregnancy').checked;
  if(text)value.text=text;
  if(lower!=='')value.lower=Number(lower);
  if(upper!=='')value.upper=Number(upper);
  if(unit)value.unit=unit;
  if(sex)value.sex=sex;
  if(ageMin!==''||ageMax!==''){
   value.age={};if(ageMin!=='')value.age.min=Number(ageMin);if(ageMax!=='')value.age.max=Number(ageMax);
   value.age.min_unit=ageUnit;value.age.max_unit=ageUnit;value.age.unit=ageUnit;
  }
  if(population)value.population=population;
  if(pregnancy)value.pregnancy=true;
  if(source)value.source=source;
  return value;
 }).filter(row=>Object.keys(row).length);
}
function readParameterChoices(){
 return $('parameterChoices').value.split(/[\r\n,]+/).map(value=>value.trim()).filter(Boolean);
}
function readChoiceScores(choices){
 if($('parameterInputMode').value!=='graded_multi_choice')return {};
 const scores={};
 const lines=$('parameterChoiceScores').value.split(/[\r\n]+/).map(line=>line.trim()).filter(Boolean);
 for(const line of lines){
  const splitAt=line.lastIndexOf('=');
  if(splitAt<1)throw new Error('اكتب كل درجة بصيغة: اسم الاختيار = الدرجة.');
  const choice=line.slice(0,splitAt).trim(),scoreText=line.slice(splitAt+1).trim(),score=Number(scoreText);
  if(!choices.includes(choice))throw new Error('يوجد اختيار في جدول الدرجات غير موجود في قائمة الاختيارات.');
  if(!scoreText||!Number.isFinite(score))throw new Error('درجة كل اختيار يجب أن تكون رقمًا صحيحًا.');
  if(Object.hasOwn(scores,choice))throw new Error('لا تكرر درجة الاختيار نفسه.');
  scores[choice]=score;
 }
 if(choices.some(choice=>!Object.hasOwn(scores,choice)))throw new Error('أدخل درجة لكل اختيار في القائمة.');
 return scores;
}

function loadConditionParameterOptions(selectedCode=''){
 const host=$('conditionParameterCode');if(!host)return;
 const current=$('parameterCode').value.trim();
 const options=state.parameters.filter(row=>row.is_active&&row.parameter_code!==current);
 host.innerHTML='<option value="">بدون شرط</option>'+options.map(row=>'<option value="'+esc(row.parameter_code)+'">'+esc(row.parameter_name)+' ('+esc(row.parameter_code)+')</option>').join('');
 host.value=selectedCode;
}
function readDisplayRules(){
 const code=$('conditionParameterCode').value;
 if(!code)return [];
 const value=$('conditionValue').value.trim();
 const visibleValues=$('conditionVisibleValues').value.split(/[\r\n,]+/).map(item=>item.trim()).filter(Boolean);
 if(!value||!visibleValues.length)throw new Error('أكمل البارامتر والقيمة والاختيارات التي تظهر عند تحقق الشرط.');
 return [{when:{parameter_code:code,operator:$('conditionOperator').value,value},visible_values:visibleValues}];
}
function updateParameterFields(){
 const mode=$('parameterInputMode').value;
 const choiceMode=['positive_negative','single_choice','multi_choice','graded_multi_choice'].includes(mode);
 $('parameterChoices').closest('label').hidden=!choiceMode;
 $('parameterMaxSelections').closest('label').hidden=!['multi_choice','graded_multi_choice'].includes(mode);
 $('parameterChoiceScoresField').hidden=mode!=='graded_multi_choice';
 $('conditionParameterCode').closest('.condition-editor').hidden=!choiceMode;
 $('parameterRangeRows').closest('.range-editor').hidden=['boolean','positive_negative','single_choice','multi_choice','graded_multi_choice'].includes(mode);
}
function updateFormulaFields(){
 const calculated=$('parameterSource').value==='calculated';
 $('formulaField').hidden=!calculated;
 if(calculated)$('parameterInputMode').value='numeric_decimal';
 $('parameterInputMode').disabled=calculated;
 updateParameterFields();
}

function currentTest(){return state.tests.find(t=>t.id===state.selectedTest)||null;}
function renderTests(){const term=$('search').value.trim().toLocaleLowerCase();const visible=state.tests.filter(t=>( $('showInactive').checked || t.is_active ) && (!term || `${t.name} ${t.code}`.toLocaleLowerCase().includes(term)));$('testList').innerHTML=visible.length?visible.map(t=>`<button type="button" class="test-item ${t.id===state.selectedTest?'selected':''}" data-id="${esc(t.id)}"><span><strong>${esc(t.name)}</strong><small>${esc(t.code)}${t.category?` · ${esc(t.category)}`:''} · ${t.test_kind==='panel'?'بروفايل / مجموعة':t.test_kind==='group'?'مجموعة تحاليل':'تحليل فردي'}</small></span><span class="meta"><span class="status ${t.is_active?'active':'inactive'}">${t.is_active?'نشط':'موقوف'}</span></span></button>`).join(''):'<p class="empty">لا توجد تحاليل مطابقة.</p>';}
function resetTestForm(){state.selectionRequest++;state.selectedTest=null;$('editorTitle').textContent='إضافة تحليل جديد';$('testForm').reset();$('testActive').checked=true;$('testKind').value='individual';$('testKind').disabled=false;$('testStatus').textContent='تحليل جديد';$('testStatus').className='status';$('activateCatalogTest').hidden=true;$('parameterSection').hidden=true;$('priceSection').hidden=true;state.parameters=[];state.selectedParameter=null;renderTests();}
function fillTestForm(test){state.selectedTest=test.id;$('editorTitle').textContent=`تعديل: ${test.name}`;$('testCode').value=test.code||'';$('testName').value=test.name||'';$('testKind').value=test.test_kind||'individual';$('testKind').disabled=true;$('testCategory').value=test.category||'';$('testSpecimen').value=test.specimen||'';$('testMethod').value=test.method||'';$('testTurnaround').value=test.turnaround_minutes??'';$('testInstructions').value=test.instructions||'';$('testActive').checked=!!test.is_active;
 $('testShortName').value=test.short_name||'';$('testSynonyms').value=(test.synonyms||[]).join(', ');$('testLoinc').value=test.loinc_code||'';
 $('testClinicalCategory').value=test.clinical_category||'';$('testClinicalPurpose').value=test.clinical_purpose||'';$('testServiceType').value=test.service_type||'laboratory_test';
 $('testPreparation').value=displayText(test.patient_preparation);$('testCollection').value=displayText(test.collection_requirements);
 $('testSpecimenRequirements').value=displayText(test.specimen_requirements);$('testTransport').value=displayText(test.transport_requirements);
 $('testStability').value=displayText(test.stability_requirements);$('testRejection').value=(test.rejection_criteria||[]).join(', ');
 $('testCriticalPolicy').value=displayText(test.critical_result_policy);$('testBiosafety').value=test.biosafety_notes||'';
 $('testReportingNotes').value=test.reporting_notes||'';$('testSources').value=displayReferences(test.source_references);
 $('testReviewStatus').value=test.clinical_review_status||'needs_review';$('activateCatalogTest').hidden=!!test.is_active;$('testStatus').textContent=test.is_active?'نشط':'موقوف';$('testStatus').className=`status ${test.is_active?'active':'inactive'}`;$('parameterSection').hidden=false;$('priceSection').hidden=false;renderTests();}
async function selectTest(id){const test=state.tests.find(t=>t.id===id);if(!test)return;const requestId=++state.selectionRequest;const tenantId=state.tenant.id;fillTestForm(test);state.selectedParameter=null;$('parameterForm').hidden=true;await Promise.all([loadParameters({tenantId,testId:test.id,requestId}),loadPrice()]);}
async function loadCatalog(requestId=state.tenantRequest){const tenantId=state.tenant.id;const tests=await listCatalog({tenantId,branchId:catalogBranchId(),includeInactive:true});if(requestId!==state.tenantRequest||tenantId!==state.tenant?.id)return;state.tests=tests;const ids=tests.map(t=>t.id);const priceBranchId=state.role==='owner'?null:state.tenant.branches?.[0]?.id||null;const prices=ids.length?await listCurrentPrices({tenantId,branchId:priceBranchId,testIds:ids}):[];if(requestId!==state.tenantRequest||tenantId!==state.tenant?.id)return;state.prices=new Map(prices.map(p=>[priceKey(p.test_id,p.branch_id),p]));renderTests();if(state.selectedTest){const found=state.tests.find(t=>t.id===state.selectedTest);if(found)await selectTest(found.id);else resetTestForm();}}
async function loadParameters({tenantId=state.tenant?.id,testId=state.selectedTest,requestId=state.selectionRequest}={}){if(!tenantId||!testId)return;const rows=await listTestParameters({tenantId,branchId:catalogBranchId(),testId,includeInactive:true});if(requestId!==state.selectionRequest||tenantId!==state.tenant?.id||testId!==state.selectedTest)return;state.parameters=rows;renderParameters();}
function renderMasterCatalog(){
 const term=$('masterCatalogSearch').value.trim().toLocaleLowerCase();
 $('importAllMasterLibrary').disabled=!state.masterTests.length;
 const existingCodes=new Set((state.tests||[]).map(test=>test.code));
 const rows=state.masterTests.filter(t=>!term||`${t.canonical_name} ${t.master_code} ${(t.alternate_names||[]).join(' ')}`.toLocaleLowerCase().includes(term));
 $('masterCatalogCount').textContent=`${state.masterTests.length} تعريف منشور متاح للاستيراد. كل تحليل يصبح جاهزًا للاستخدام فور استيراده ويمكن تعديله من كتالوج المعمل.`;
 $('masterCatalogList').innerHTML=rows.length?rows.map(t=>{
  const parameterCount=Number(t.parameter_count||0);
  const exists=existingCodes.has(t.master_code);
  return `<div class="master-item"><div><strong>${esc(t.canonical_name)}</strong><small>${esc(t.master_code)} · ${t.test_kind==='panel'?'بروفايل / مجموعة':t.test_kind==='group'?'مجموعة تحاليل':'تحليل فردي'} · ${esc(t.category||'غير مصنف')} · ${parameterCount} بارامتر · إصدار ${esc(t.release?.version||'—')}</small><small>جاهز للاستخدام والتعديل داخل كتالوج المعمل بعد الاستيراد. لا توجد خطوة اعتماد محلي.</small></div><button type="button" class="button button-secondary" data-import-master="${esc(t.id)}" ${exists?'disabled':''}>${exists?'موجود في المعمل':'استيراد الآن'}</button></div>`;
 }).join(''):'<p class="empty">لا توجد تعريفات منشورة تطابق البحث.</p>';
}
async function loadMasterCatalog(){
 try{state.masterTests=await listMasterCatalogTests();renderMasterCatalog();}
 catch(error){state.masterTests=[];$('importAllMasterLibrary').disabled=true;$('masterCatalogCount').textContent='تعذر التحميل';$('masterCatalogList').innerHTML=`<p class="empty">${esc(error.message||'تعذر تحميل المكتبة الطبية.')}</p>`;}
}
function renderParameters(){const rows=state.parameters;$('parameterList').innerHTML=rows.length?rows.map(p=>{const rangeLabel=Array.isArray(p.reference_ranges)&&p.reference_ranges.length?'مدى مرجعي متاح وقابل للتعديل':p.reference_interval_status==='not_applicable'?'لا يحتاج مدى مرجعي':'لم يُحدد مدى مرجعي بعد';return `<div class="parameter-item"><div><strong>${esc(p.parameter_name)} <span class="muted-inline">(${esc(p.parameter_code)})</span></strong><small>${esc(p.unit||'بدون وحدة')} · ${esc(modeLabels[normalizeInputMode(p)]||p.value_type)} · ${p.result_source==='calculated'?'محسوب تلقائيًا':'إدخال يدوي'} · ${p.is_active?'نشط':'موقوف'} · ${rangeLabel} · ترتيب ${p.display_order}</small></div><div class="parameter-actions"><button type="button" data-edit-param="${esc(p.id)}">تعديل</button><button type="button" data-toggle-param="${esc(p.id)}">${p.is_active?'إيقاف':'تنشيط'}</button></div></div>`;}).join(''):'<p class="empty">لا توجد بارامترات لهذا التحليل حتى الآن.</p>';}
async function loadPrice(){const branchId=$('priceBranchSelect').value||null;const base=state.prices.get(priceKey(state.selectedTest));const override=branchId?state.prices.get(priceKey(state.selectedTest,branchId)):null;const price=override||base;$('currentPrice').textContent=price?money(price.selling_price):'لا يوجد سعر حالي';$('priceHint').textContent=branchId&&!override?(base?`هذا الفرع يستخدم السعر الأساسي (${money(base.selling_price)}). أدخل سعرًا لإضافة استثناء لهذا الفرع.` :'سيُستخدم السعر الأساسي الافتراضي صفرًا عند عدم وجود سعر خاص.'):(price?.effective_from?`آخر سريان: ${new Date(price.effective_from).toLocaleString('ar-EG')}`:'السعر الأساسي الافتراضي صفر إذا لم يُحدد سعر آخر.');$('priceForm').hidden=state.role!=='owner';$('newPrice').value=branchId?(override?.selling_price??''):(base?.selling_price??'');}
function resetParameterForm(){
 state.selectedParameter=null;$('parameterForm').reset();
 $('parameterDecimals').value='2';$('parameterOrder').value='0';$('parameterChoices').value='';
 $('parameterMaxSelections').value='';$('parameterChoiceScores').value='';$('parameterSource').value='manual';$('parameterFormula').value='';
 $('conditionValue').value='';$('conditionVisibleValues').value='';$('conditionOperator').value='equals';
 loadConditionParameterOptions();renderRangeRows([]);updateFormulaFields();
 $('parameterRequired').checked=true;$('parameterActive').checked=true;
 $('parameterTitle').textContent='إضافة بارامتر';$('parameterForm').hidden=true;
}
function editParameter(id){
 const p=state.parameters.find(x=>x.id===id);if(!p)return;
 state.selectedParameter=p.id;$('parameterTitle').textContent='تعديل: '+p.parameter_name;
 $('parameterCode').value=p.parameter_code||'';$('parameterName').value=p.parameter_name||'';
 $('parameterUnit').value=p.unit||'';$('parameterInputMode').value=normalizeInputMode(p);
 $('parameterDecimals').value=p.decimal_places??2;$('parameterOrder').value=p.display_order??0;
 renderRangeRows(p.reference_ranges||[]);
 $('parameterChoices').value=displayChoices(p.choices).replace(/, /g,'\\n');
 $('parameterMaxSelections').value=p.result_config?.max_selections??'';
 $('parameterChoiceScores').value=Object.entries(p.result_config?.choice_scores||{}).map(([choice,score])=>choice+' = '+score).join('\n');
 $('parameterSource').value=p.result_source||'manual';
 $('parameterUnitUcum').value=p.unit_ucum||'';$('parameterAlternateUnits').value=(p.alternate_units||[]).map(x=>x.unit+' = '+x.factor).join('\n');
 $('parameterCriticalRanges').value=displayText(p.critical_ranges);$('parameterInterpretation').value=displayText(p.interpretation_rules);
 $('parameterApplicability').value=displayApplicability(p.applicability);$('parameterMethodNotes').value=p.method_notes||'';
 $('parameterSources').value=displayReferences(p.source_references);$('parameterClinicalMetadata').value=displayText(p.clinical_metadata);
 $('parameterReferenceStatus').value=p.reference_interval_status||'local_verification_required';
 $('parameterReviewStatus').value=p.clinical_review_status||'needs_review';
 $('parameterFormula').value=p.formula_expression||formulaToExpression(p.formula);
 const rule=Array.isArray(p.display_rules)?p.display_rules[0]:null;
 loadConditionParameterOptions(rule?.when?.parameter_code||'');
 $('conditionOperator').value=rule?.when?.operator||'equals';
 $('conditionValue').value=rule?.when?.value||'';
 $('conditionVisibleValues').value=(rule?.visible_values||[]).join('\n');
 updateFormulaFields();$('parameterRequired').checked=!!p.is_required;$('parameterActive').checked=!!p.is_active;
 $('parameterForm').hidden=false;$('parameterForm').scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function start(){const session=await getCurrentSession();if(!session){$('loginPanel').hidden=false;$('workspace').hidden=true;$('signOut').hidden=true;return;}state.context=await loadMyTenantContext();if(!state.context.tenants?.length)throw new Error('الحساب لا يملك معملًا نشطًا.');$('loginPanel').hidden=true;$('workspace').hidden=false;$('signOut').hidden=false;$('userLine').textContent=`الحساب: ${session.user.email||'مستخدم مسجل'}`;$('tenantSelect').innerHTML=state.context.tenants.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');await loadMasterCatalog();await selectTenant(getPreferredTenantId(state.context.tenants) || state.context.tenants[0].id);}
async function selectTenant(id){const requestId=++state.tenantRequest;state.selectionRequest++;state.tenant=state.context.tenants.find(t=>t.id===id);if(!state.tenant)throw new Error('لم يتم العثور على المعمل المحدد.');rememberWorkspaceSelection(state.tenant.id);state.role=state.tenant.accountType==='owner'?'owner':'staff';$('openMasterLibrary').hidden=state.role!=='owner'||state.masterLibraryOpen;$('masterCatalogPanel').hidden=state.role!=='owner'||!state.masterLibraryOpen;$('layout').hidden=state.role==='owner'&&state.masterLibraryOpen;$('priceBranchSelect').innerHTML='<option value="">السعر الأساسي لكل الفروع</option>'+(state.tenant.branches||[]).map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');if(state.role!=='owner'&&state.tenant.branches?.length===1)$('priceBranchSelect').value=state.tenant.branches[0].id;$('roleNotice').textContent=state.role==='owner'?'إدارة كتالوج التحاليل والأسعار متاحة لمالك المعمل فقط. صلاحية الموظف: إدارة التحاليل والبارامترات الفنية.':'صلاحية الموظف: إدارة التحاليل والبارامترات الفنية. تعديل الأسعار غير متاح.';resetTestForm();await loadCatalog(requestId);}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await signInWithEmail($('email').value,$('password').value);await start();}catch(err){notice(err.message||'تعذر تسجيل الدخول.',true);}});
$('signOut').addEventListener('click',async()=>{try{await signOut();await start();}catch(e){notice(e.message,true);}});
$('tenantSelect').addEventListener('change',()=>selectTenant($('tenantSelect').value).catch(e=>notice(e.message,true)));
$('search').addEventListener('input',renderTests);$('showInactive').addEventListener('change',renderTests);
$('testList').addEventListener('click',e=>{const btn=e.target.closest('[data-id]');if(btn)selectTest(btn.dataset.id).catch(err=>notice(err.message,true));});
$('newTest').addEventListener('click',resetTestForm);$('resetTest').addEventListener('click',resetTestForm);
$('testForm').addEventListener('submit',async e=>{e.preventDefault();if(state.busy)return;state.busy=true;setBusy(e.currentTarget,true);try{const isNew=!state.selectedTest;const testKind=$('testKind').value;const saved=await saveCatalogTest({tenantId:state.tenant.id,branchId:catalogBranchId(),id:state.selectedTest||undefined,test:{code:$('testCode').value,name:$('testName').value,testKind,category:$('testCategory').value,specimen:$('testSpecimen').value,method:$('testMethod').value,turnaroundMinutes:$('testTurnaround').value,instructions:$('testInstructions').value,isActive:$('testActive').checked,
 shortName:$('testShortName').value,synonyms:$('testSynonyms').value.split(',').map(x=>x.trim()).filter(Boolean),loincCode:$('testLoinc').value,
 clinicalCategory:$('testClinicalCategory').value,clinicalPurpose:$('testClinicalPurpose').value,serviceType:$('testServiceType').value,
 patientPreparation:parseTextObject('testPreparation'),collectionRequirements:parseTextObject('testCollection'),
 specimenRequirements:parseTextObject('testSpecimenRequirements'),transportRequirements:parseTextObject('testTransport'),
 stabilityRequirements:parseTextObject('testStability'),rejectionCriteria:$('testRejection').value.split(',').map(x=>x.trim()).filter(Boolean),
 criticalResultPolicy:parseTextObject('testCriticalPolicy'),biosafetyNotes:$('testBiosafety').value,
 reportingNotes:$('testReportingNotes').value,sourceReferences:parseTextReferences('testSources'),clinicalReviewStatus:$('testReviewStatus').value},initialParameter:isNew&&testKind==='individual'?{code:(`RES_${$('testCode').value.trim()}`).slice(0,40),name:$('testName').value.trim(),valueType:'numeric',decimalPlaces:2,displayOrder:0,referenceRanges:[],choices:[],isRequired:true,isActive:true}:undefined});if(isNew&&testKind==='individual'&&saved.queued){await saveTestParameter({tenantId:state.tenant.id,branchId:catalogBranchId(),testId:saved.id,dependsOn:saved.local_operation_id?[saved.local_operation_id]:[],parameter:{code:(`RES_${saved.code}`).slice(0,40),name:saved.name,valueType:'numeric',decimalPlaces:2,displayOrder:0,referenceRanges:[],choices:[],isRequired:true,isActive:true}});}notice(saved.queued?'تم حفظ تعديل التحليل محليًا، وسيظهر للمراجعة عند المزامنة.':isNew&&testKind==='individual'?'تم إنشاء التحليل وإضافة خانة نتيجته تلقائيًا.':'تم حفظ بيانات التحليل.');await loadCatalog();await selectTest(saved.id);}catch(err){notice(err.message||'تعذر حفظ التحليل.',true);}finally{state.busy=false;setBusy(e.currentTarget,false);}});
$('activateCatalogTest').addEventListener('click',async e=>{
 const button=e.currentTarget;if(!state.selectedTest||button.disabled)return;
 button.disabled=true;
 try{
  
  const activated=await setCatalogTestActive({tenantId:state.tenant.id,branchId:catalogBranchId(),testId:state.selectedTest,isActive:true});
  notice(activated.queued?'تم حفظ طلب تفعيل التحليل محليًا للمراجعة عند المزامنة.':'تم تفعيل التحليل. لم تتغير الأسعار أو بيانات الفروع.');
  await loadCatalog();await selectTest(activated.id);
 }catch(error){notice(error.message||'تعذر اعتماد تعريف التحليل.',true);}
 finally{button.disabled=false;}
});
$('parameterSection').addEventListener('click',async e=>{const edit=e.target.closest('[data-edit-param]');if(edit){editParameter(edit.dataset.editParam);return;}const toggle=e.target.closest('[data-toggle-param]');if(toggle){const p=state.parameters.find(x=>x.id===toggle.dataset.toggleParam);if(!p)return;try{const awaited=await setTestParameterActive({tenantId:state.tenant.id,branchId:catalogBranchId(),testId:state.selectedTest,parameterId:p.id,isActive:!p.is_active});notice(awaited.queued?'تم إيقاف البارامتر.':'تم تنشيط البارامتر.');await loadParameters();}catch(err){notice(err.message,true);}}});
$('newParameter').addEventListener('click',()=>{resetParameterForm();$('parameterForm').hidden=false;$('parameterForm').scrollIntoView({behavior:'smooth',block:'nearest'});});$('cancelParameter').addEventListener('click',resetParameterForm);
$('parameterSource').addEventListener('change',updateFormulaFields);
$('parameterInputMode').addEventListener('change',updateParameterFields);
$('parameterCode').addEventListener('input',()=>loadConditionParameterOptions($('conditionParameterCode').value));
$('parameterRangeRows').addEventListener('click',e=>{if(e.target.closest('[data-remove-range]')){const row=e.target.closest('.range-row');if(row)row.remove();}});
$('addReferenceRange').addEventListener('click',()=>{const rows=readRangeRows();rows.push({});renderRangeRows(rows);});
$('parameterForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!state.selectedTest)return;const form=e.currentTarget;setBusy(form,true);
 try{
  const resultSource=$('parameterSource').value;const resultInputMode=resultSource==='calculated'?'numeric_decimal':$('parameterInputMode').value;
  const parameter={
   code:$('parameterCode').value,name:$('parameterName').value,unit:$('parameterUnit').value,
   resultInputMode,decimalPlaces:$('parameterDecimals').value,displayOrder:$('parameterOrder').value,
   referenceRanges:readRangeRows(),choices:readParameterChoices(),resultSource,
   formula:resultSource==='calculated'?parseFormulaExpression($('parameterFormula').value,state.parameters,$('parameterCode').value):null,
   formulaExpression:resultSource==='calculated'?$('parameterFormula').value.trim():null,
   resultConfig:{
    ...($('parameterMaxSelections').value?{max_selections:Number($('parameterMaxSelections').value)}:{}),
    ...(resultInputMode==='graded_multi_choice'?{choice_scores:readChoiceScores(readParameterChoices())}:{})
   },
   displayRules:readDisplayRules(),
   unitUcum:$('parameterUnitUcum').value,alternateUnits:parseAlternateUnits('parameterAlternateUnits'),
   criticalRanges:parseCriticalRanges('parameterCriticalRanges'),interpretationRules:parseTextArray('parameterInterpretation'),
   applicability:parseApplicability('parameterApplicability'),methodNotes:$('parameterMethodNotes').value,clinicalMetadata:parseTextObject('parameterClinicalMetadata'),
   sourceReferences:parseTextReferences('parameterSources'),referenceIntervalStatus:['numeric_integer','numeric_decimal'].includes(resultInputMode)?$('parameterReferenceStatus').value:'not_applicable',clinicalReviewStatus:$('parameterReviewStatus').value,
   isRequired:$('parameterRequired').checked,isActive:$('parameterActive').checked
  };
  const savedParameter=await saveTestParameter({tenantId:state.tenant.id,branchId:catalogBranchId(),testId:state.selectedTest,id:state.selectedParameter||undefined,parameter});
  notice(savedParameter.queued?'تم حفظ البارامتر محليًا وسيظهر للمراجعة عند المزامنة.':'تم حفظ البارامتر في كتالوج المعمل. سيظهر في الزيارات الجديدة؛ الزيارات المسجلة تحتفظ بنسختها وقت التسجيل.');resetParameterForm();await loadParameters();
 }catch(err){notice(err.message||'تعذر حفظ البارامتر.',true);}
 finally{setBusy(form,false);}
});
$('masterCatalogSearch').addEventListener('input',renderMasterCatalog);
$('openMasterLibrary').addEventListener('click',()=>{state.masterLibraryOpen=true;$('masterCatalogPanel').hidden=false;$('layout').hidden=true;$('openMasterLibrary').hidden=true;});
$('closeMasterLibrary').addEventListener('click',()=>{state.masterLibraryOpen=false;$('masterCatalogPanel').hidden=true;$('layout').hidden=false;$('openMasterLibrary').hidden=state.role!=='owner';});
$('importAllMasterLibrary').addEventListener('click',async e=>{
 if(state.role!=='owner'||!state.masterTests.length)return;
 const button=e.currentTarget;
 if(button.disabled)return;
 try{
  requireOnline();
  button.disabled=true;
  const existingCodes=new Set((state.tests||[]).map(test=>test.code));
  let imported=0,skipped=0;
  const failures=[];
  const total=state.masterTests.length;
  for(let index=0;index<total;index++){
   const item=state.masterTests[index];
   button.textContent=`استيراد الكل ${index+1}/${total}`;
   if(existingCodes.has(item.master_code)){skipped++;continue;}
   try{
    requireOnline();await importMasterCatalogTest({tenantId:state.tenant.id,masterTestId:item.id});
    imported++;
    existingCodes.add(item.master_code);
   }catch(error){
    const message=String(error?.message||error);
    if(/duplicate|already exists|unique|موجود/i.test(message))skipped++;
    else failures.push({code:item.master_code,message});
   }
   $('masterImportStatus').textContent=`تم استيراد ${imported} · تم تجاوز ${skipped} · أخطاء ${failures.length}`;
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  await loadCatalog();
  renderMasterCatalog();
  $('masterImportStatus').textContent=`اكتمل: ${imported} جديد · ${skipped} موجود مسبقًا · ${failures.length} أخطاء`;
  if(failures.length)notice(`اكتمل الاستيراد مع ${failures.length} أخطاء. أول خطأ: ${failures[0].code} — ${failures[0].message}`,true);
  else notice(`اكتمل استيراد المكتبة: ${imported} تحليل جديد، و${skipped} موجود مسبقًا. التحاليل الجديدة نشطة وبسعر صفر افتراضيًا.`);
 }catch(error){
  notice(error.message||'تعذر استيراد المكتبة المركزية.',true);
 }finally{
  button.disabled=false;
  button.textContent='استيراد كل التعريفات';
 }
});
$('masterCatalogList').addEventListener('click',async e=>{
 const btn=e.target.closest('[data-import-master]');if(!btn||state.role!=='owner')return;
 btn.disabled=true;
 try{const testId=await importMasterCatalogTest({tenantId:state.tenant.id,masterTestId:btn.dataset.importMaster});
  await loadCatalog();await selectTest(testId);notice('تم استيراد نسخة مستقلة نشطة. السعر الأساسي الافتراضي صفر ويمكن تعديله لاحقًا.');
 }catch(error){notice(error.message||'تعذر استيراد تعريف التحليل.',true);}finally{btn.disabled=false;}
});
$('priceBranchSelect').addEventListener('change',()=>loadPrice());
$('priceForm').addEventListener('submit',async e=>{e.preventDefault();if(state.role!=='owner'||!state.selectedTest)return;const form=e.currentTarget;setBusy(form,true);try{const value=Number($('newPrice').value);if(!Number.isFinite(value)||value<0)throw new Error('أدخل سعرًا صحيحًا غير سالب.');const branchId=$('priceBranchSelect').value||null;const saved=branchId?await setBranchPrice({tenantId:state.tenant.id,branchId,testId:state.selectedTest,sellingPrice:value}):await setCurrentPrice({tenantId:state.tenant.id,testId:state.selectedTest,sellingPrice:value});state.prices.set(priceKey(state.selectedTest,branchId),saved);await loadPrice();notice(branchId?'تم تحديث سعر الفرع.':'تم تحديث السعر الأساسي.');}catch(err){notice(err.message||'تعذر تحديث السعر.',true);}finally{setBusy(form,false);}});

try{await start();}catch(e){notice(e.message||'تعذر تحميل كتالوج المعمل.',true);}
