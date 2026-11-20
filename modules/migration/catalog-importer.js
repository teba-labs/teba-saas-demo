const normalizeCode=value=>String(value??'').trim().toLocaleUpperCase('en');
/**
 * Idempotent insert-only catalog import. Existing codes are never overwritten;
 * all workbook rows are validated before the first write.
 */
export async function importNewCatalogTests({tenantId,records,listExisting,saveTest}={}){
 if(!tenantId||!Array.isArray(records)||typeof listExisting!=='function'||typeof saveTest!=='function')throw new Error('tenantId, records and catalog repository functions are required.');
 const prepared=records.map((row,index)=>{
  const code=String(row?.test_code??'').trim(),name=String(row?.test_name??'').trim();
  if(!code||!name)throw new Error('صف '+(row?._rowNumber??index+1)+': كود التحليل واسمه مطلوبان للاستيراد الآمن.');
  if(code.length>40||name.length>160)throw new Error('صف '+(row?._rowNumber??index+1)+': الكود أو الاسم يتجاوز الحد المسموح.');
  return {code,name,category:String(row?.category??'').trim()||null,rowNumber:row?._rowNumber??index+1};
 });
 const seen=new Set();
 for(const row of prepared){const key=normalizeCode(row.code);if(seen.has(key))throw new Error('كود مكرر داخل ملف Excel: '+row.code+'. لم يتم حفظ أي تحليل.');seen.add(key);}
 const existing=await listExisting({tenantId,includeInactive:true});
 const existingCodes=new Set((existing||[]).map(row=>normalizeCode(row.code)));
 const result={created:[],skipped:[],failed:[]};
 for(const row of prepared){
  if(existingCodes.has(normalizeCode(row.code))){result.skipped.push({code:row.code,reason:'already-exists'});continue;}
  try{
   const saved=await saveTest({tenantId,test:{code:row.code,name:row.name,category:row.category}});
   existingCodes.add(normalizeCode(row.code));
   result.created.push({code:row.code,id:saved?.id??null});
  }catch(error){result.failed.push({code:row.code,message:error?.message||'تعذر الحفظ'});}
 }
 return result;
}
