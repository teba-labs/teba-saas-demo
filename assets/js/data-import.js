import {getCurrentSession,signInWithEmail} from '../../core/auth/session.js';
import {loadMyTenantContext} from '../../core/tenant/context.js';
import {inspectWorkbookFile,getEntityOptions,getEntityFields,suggestColumnMapping,analyzeArchiveSheet,analyzeArchiveRelationships} from '../../modules/migration/workbook-inspector.js';
const $=id=>document.getElementById(id);let state={tenants:[],result:null};
function note(message,error=false){$('notice').textContent=message;$('notice').className='show'+(error?' error':'');}
function el(tag,text=''){const n=document.createElement(tag);n.textContent=String(text??'');return n;}
function makeSelect(options,value){const s=el('select');for(const item of options){const o=el('option',item.label);o.value=item.value;s.append(o);}s.value=value??'';return s;}
async function start(){const session=await getCurrentSession();if(!session){$('loginPanel').hidden=false;$('workspace').hidden=true;return;}const ctx=await loadMyTenantContext();state.tenants=(ctx.tenants||[]).filter(t=>t.accountType==='owner');if(!state.tenants.length)throw Error('هذه الأداة مخصصة لمالك المعمل فقط.');$('tenantName').textContent=state.tenants[0].name;$('loginPanel').hidden=true;$('workspace').hidden=false;}
function renderSheet(){
 const s=state.result?.sheets[Number($('sheetSelect').value)];if(!s)return;
 const root=$('sheetDetails');root.replaceChildren();
 const summary=el('div');summary.className='meta';
 for(const [label,value] of [['اسم الورقة',s.name],['عدد الصفوف غير الفارغة',s.rowCount],['صف العناوين',s.headerRowIndex+1]]){const box=el('div');box.append(el('small',label),el('b',value));summary.append(box);}root.append(summary);
 const head=el('div');head.className='mappingHead';head.append(el('h3','تحديد نوع البيانات في الورقة'));
 const entity=makeSelect(getEntityOptions(),s.entityType);entity.addEventListener('change',()=>{s.entityType=entity.value;s.columnMapping=suggestColumnMapping(s.headers,s.entityType);renderSheet();});head.append(entity);root.append(head);
 const cand=el('div');cand.append(el('h3','اختيار صف العناوين بعد المعاينة'));
 const pick=el('select');pick.id='headerRowSelect';
 for(const option of s.headerCandidates){const o=el('option','صف '+(option.rowIndex+1)+' · '+option.nonEmpty+' خلية');o.value=option.rowIndex;pick.append(o);}
 pick.value=String(s.headerRowIndex);
 pick.addEventListener('change',()=>{const chosen=s.headerCandidates.find(x=>x.rowIndex===Number(pick.value));if(chosen){s.headerRowIndex=chosen.rowIndex;s.headers=chosen.values;s.preview=chosen.preview;s.columnMapping=suggestColumnMapping(s.headers,s.entityType);renderSheet();}});
 cand.append(pick);root.append(cand);
 s.analysis=analyzeArchiveSheet(s.rawRows,s.headerRowIndex,s.entityType,s.columnMapping);\n const fields=getEntityFields(s.entityType), mapped=s.columnMapping.filter(x=>x.fieldKey);
 const duplicates=mapped.filter((m,i)=>mapped.findIndex(x=>x.fieldKey===m.fieldKey)!==i);
 const required=fields.filter(f=>f.required),missing=required.filter(f=>!mapped.some(m=>m.fieldKey===f.key));
 const status=el('div');status.className='mappingStatus';
 status.textContent=s.entityType==='unknown'?'حدد نوع البيانات أولًا.':`تم ربط ${mapped.length} عمودًا · أعمدة مطلوبة غير مربوطة: ${missing.length} · تعيينات مكررة: ${duplicates.length}`;
 root.append(status);
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
 const previewTitle=el('h3','عينة من الصفوف تحت العناوين');root.append(previewTitle);
 const table=el('table'),thead=el('thead'),tr=el('tr');
 (s.headers.length?s.headers:['لا توجد عناوين واضحة']).forEach(v=>tr.append(el('th',v)));thead.append(tr);table.append(thead);
 const body=el('tbody');for(const row of s.preview){const line=el('tr');for(let i=0;i<Math.max(s.headers.length,row.length);i++)line.append(el('td',row[i]??''));body.append(line);}
 if(!s.preview.length){const line=el('tr'),cell=el('td','لا توجد صفوف معاينة بعد صف العناوين المقترح.');cell.colSpan=Math.max(1,s.headers.length);line.append(cell);body.append(line);}
 table.append(body);const wrap=el('div');wrap.className='tableWrap';wrap.append(table);root.append(wrap);
}
function renderResult(){const r=state.result;$('summary').hidden=false;$('sheetPanel').hidden=false;const root=$('summary');root.replaceChildren();const meta=el('div');meta.className='meta';
 for(const [label,value] of [['الملف',r.fileName],['الحجم',(r.fileSize/1024/1024).toFixed(2)+' MB'],['عدد الأوراق',r.sheetCount],['بصمة SHA-256',r.sha256],['وقت الفحص',new Date(r.inspectedAt).toLocaleString('ar-EG')],['حالة الخصوصية','قراءة محلية فقط']]){const box=el('div');box.append(el('small',label),el('b',value));meta.append(box);}root.append(meta);
 $('sheetSelect').replaceChildren(...r.sheets.map((s,i)=>{const o=el('option',s.name+' ('+s.rowCount+' صف)');o.value=i;return o;}));$('sheetSelect').value='0';renderSheet();}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;try{await signInWithEmail($('email').value,$('password').value);await start();}catch(x){note(x.message||'تعذر تسجيل الدخول.',true);}finally{b.disabled=false;}});
$('sheetSelect').addEventListener('change',renderSheet);
$('inspectButton').addEventListener('click',async()=>{const file=$('archiveFile').files?.[0];const b=$('inspectButton');b.disabled=true;b.textContent='جارٍ الفحص داخل المتصفح…';$('summary').hidden=true;$('sheetPanel').hidden=true;try{state.result=await inspectWorkbookFile(file);renderResult();note('انتهى الفحص واقتراح مطابقة الأعمدة. التغييرات مؤقتة داخل الصفحة فقط؛ لم يتم رفع أو استيراد أو حفظ أي بيانات.');}catch(x){note(x.message||'تعذر فحص الملف.',true);}finally{b.disabled=false;b.textContent='فحص الملف محليًا';}});
try{await start();}catch(e){note(e.message||'تعذر فتح أداة الفحص.',true);}
