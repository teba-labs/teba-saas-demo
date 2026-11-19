const DB_NAME='TaibaSmartLabDashboardHistory',STORE_NAME='workbooks',DB_VERSION=1;
function openDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE_NAME)){const store=db.createObjectStore(STORE_NAME,{keyPath:'id'});store.createIndex('tenantId','tenantId',{unique:false});}};request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};request.onerror=()=>reject(request.error||new Error('تعذر فتح مخزن الأرشيف المحلي.'));request.onblocked=()=>reject(new Error('أغلق علامات التبويب القديمة للنظام ثم أعد المحاولة.'));});}
function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('تعذر تنفيذ عملية الأرشيف المحلي.'));});}
function tenantKey(tenantId,type){if(!tenantId||!type)throw new Error('يلزم تحديد المعمل ونوع الملف.');return String(tenantId)+'::'+String(type);}
export async function saveHistoricalWorkbook({tenantId,type,fileName,size,sheets,data}={}){const id=tenantKey(tenantId,type);if(!(data instanceof ArrayBuffer))throw new Error('محتوى ملف Excel غير صالح.');const db=await openDatabase();try{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).put({id,tenantId:String(tenantId),type,fileName:String(fileName||''),size:Number(size||data.byteLength),sheets:Array.isArray(sheets)?sheets:[],uploadedAt:new Date().toISOString(),data});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('فشل حفظ ملف Excel محليًا.'));tx.onabort=()=>reject(tx.error||new Error('تم إلغاء حفظ ملف Excel.'));});}finally{db.close();}}
export async function listHistoricalWorkbooks(tenantId){if(!tenantId)throw new Error('tenantId is required.');const db=await openDatabase();try{const tx=db.transaction(STORE_NAME,'readonly');const rows=await requestResult(tx.objectStore(STORE_NAME).index('tenantId').getAll(String(tenantId)));return rows.map(({id,tenantId:owner,type,fileName,size,sheets,uploadedAt})=>({id,tenantId:owner,type,fileName,size,sheets,uploadedAt}));}finally{db.close();}}
export async function getHistoricalWorkbook({tenantId,type}={}){const db=await openDatabase();try{const row=await requestResult(db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).get(tenantKey(tenantId,type)));return row||null;}finally{db.close();}}
export async function deleteHistoricalWorkbook({tenantId,type}={}){const db=await openDatabase();try{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).delete(tenantKey(tenantId,type));await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('تعذر حذف نسخة الملف المحلي.'));tx.onabort=()=>reject(tx.error||new Error('تم إلغاء حذف الملف المحلي.'));});}finally{db.close();}}

const ALLOWED_HISTORY_TYPES=new Set(['sales','prices','detail2025','detail2026']);
export async function exportHistoricalWorkbooks(tenantId){
 if(!tenantId)throw new Error('tenantId is required.');
 const db=await openDatabase();
 try{
  const rows=await requestResult(db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).index('tenantId').getAll(String(tenantId)));
  return rows.map(({id,tenantId:owner,type,fileName,size,sheets,uploadedAt,data})=>({id,tenantId:owner,type,fileName,size,sheets,uploadedAt,data}));
 }finally{db.close();}
}
export async function restoreHistoricalWorkbooks(tenantId,records=[]){
 if(!tenantId||!Array.isArray(records)||records.length>4)throw new Error('Invalid historical workbook backup.');
 const prepared=records.map(row=>{
  if(!row||row.tenantId!==String(tenantId)||row.id!==tenantKey(tenantId,row.type)||!ALLOWED_HISTORY_TYPES.has(row.type))throw new Error('Historical archive contains a different tenant or an unsupported file type.');
  if(!(row.data instanceof ArrayBuffer)||row.data.byteLength>20*1024*1024)throw new Error('Historical archive file is invalid or exceeds 20 MB.');
  if(!Array.isArray(row.sheets))throw new Error('Historical archive sheet metadata is invalid.');
  return {...row,tenantId:String(tenantId)};
 });
 const db=await openDatabase();let restored=0,skipped=0;
 try{
  const tx=db.transaction(STORE_NAME,'readwrite'),store=tx.objectStore(STORE_NAME);
  for(const row of prepared){const existing=await requestResult(store.get(row.id));if(existing){skipped++;continue;}store.put(row);restored++;}
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Historical archive restore failed.'));tx.onabort=()=>reject(tx.error||new Error('Historical archive restore was rolled back.'));});
  return {restored,skipped};
 }finally{db.close();}
}
