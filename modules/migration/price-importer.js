const normalizeCode=value=>String(value??'').trim().toLocaleUpperCase('en');

function parseSellingPrice(value,rowNumber){
 if(value===null||value===undefined||String(value).trim()==='')return null;
 if(typeof value==='number'){
  if(!Number.isFinite(value)||value<0||value>9999999999.99||Math.abs(value*100-Math.round(value*100))>1e-7)throw new Error('صف '+rowNumber+': السعر يجب أن يكون رقمًا موجبًا أو صفرًا وبحد أقصى منزلتين عشريتين.');
  return value;
 }
 let text=String(value).trim()
  .replace(/[٠-٩۰-۹]/g,d=>String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(d)%10))
  .replace(/جنيه(?:\s*مصري)?|ج\.?\s*م|EGP|LE/gi,'')
  .replace(/[\s٬]/g,'').replace(/٫/g,'.');
 if(!text)return null;
 const commas=(text.match(/,/g)||[]).length,dots=(text.match(/\./g)||[]).length;
 if(commas&&dots){
  if(text.lastIndexOf(',')>text.lastIndexOf('.'))text=text.replace(/\./g,'').replace(',','.');
  else text=text.replace(/,/g,'');
 }else if(commas){
  if(commas>1){
   if(/^\d{1,3}(,\d{3})+$/.test(text))text=text.replace(/,/g,'');
   else throw new Error('صف '+rowNumber+': تنسيق السعر بالفواصل ملتبس؛ صحح القيمة قبل الاستيراد.');
  }else{
   const [whole,fraction]=text.split(',');
   if(/^\d{1,3}$/.test(whole)&&/^\d{3}$/.test(fraction))text=whole+fraction;
   else if(/^\d+$/.test(whole)&&/^\d{1,2}$/.test(fraction))text=whole+'.'+fraction;
   else throw new Error('صف '+rowNumber+': تنسيق السعر بالفاصلة غير واضح؛ استخدم نقطة عشرية أو راجع القيمة.');
  }
 }else if(dots>1){
  if(/^\d{1,3}(\.\d{3})+$/.test(text))text=text.replace(/\./g,'');
  else throw new Error('صف '+rowNumber+': تنسيق السعر غير صالح.');
 }
 if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error('صف '+rowNumber+': السعر غير صالح أو يتجاوز منزلتين عشريتين.');
 const price=Number(text);
 if(!Number.isFinite(price)||price<0||price>9999999999.99)throw new Error('صف '+rowNumber+': السعر خارج النطاق المسموح.');
 return price;
}

/**
 * Insert-only import for tenant-wide base prices. It never updates a current
 * base price or a branch override. Unique partial indexes are the final
 * concurrency guard; a collision is reported and a retry becomes a skip.
 */
export async function importNewBasePrices({tenantId,records,listCatalog,listExistingPrices,savePrice}={}){
 if(!tenantId||!Array.isArray(records)||typeof listCatalog!=='function'||typeof listExistingPrices!=='function'||typeof savePrice!=='function'){
  throw new Error('tenantId, records and price repository functions are required.');
 }
 const prepared=[],skippedNoPrice=[],seen=new Set();
 for(let index=0;index<records.length;index++){
  const row=records[index],rowNumber=row?._rowNumber??index+1;
  const rawPrice=row?.selling_price??row?.price;
  if(rawPrice===null||rawPrice===undefined||String(rawPrice).trim()===''){
   skippedNoPrice.push({code:String(row?.test_code??'').trim(),rowNumber,reason:'no-price'});
   continue;
  }
  const code=String(row?.test_code??'').trim();
  if(!code)throw new Error('صف '+rowNumber+': كود التحليل مطلوب مع كل سعر.');
  if(code.length>40)throw new Error('صف '+rowNumber+': كود التحليل يتجاوز 40 حرفًا.');
  const key=normalizeCode(code);
  if(seen.has(key))throw new Error('كود مكرر داخل ملف Excel: '+code+'. لم يتم حفظ أي سعر.');
  seen.add(key);
  const sellingPrice=parseSellingPrice(rawPrice,rowNumber);
  if(sellingPrice===null)continue;
  prepared.push({code,key,sellingPrice,rowNumber});
 }
 const result={created:[],skipped:[...skippedNoPrice],failed:[]};
 if(!prepared.length)return result;
 const catalog=await listCatalog({tenantId,includeInactive:false});
 const byCode=new Map((catalog||[]).map(test=>[normalizeCode(test.code),test]));
 const unresolved=prepared.filter(row=>!byCode.has(row.key));
 if(unresolved.length)throw new Error('أكواد أسعار لا تطابق تحاليل نشطة في كتالوج هذا المعمل: '+unresolved.map(row=>row.code).join('، ')+'. لم يتم حفظ أي سعر.');
 const testIds=[...new Set(prepared.map(row=>byCode.get(row.key).id))];
 const existing=await listExistingPrices({tenantId,testIds});
 const currentBase=new Set((existing||[]).filter(row=>row.is_current===true&&row.branch_id==null).map(row=>row.test_id));
 for(const row of prepared){
  const test=byCode.get(row.key);
  if(currentBase.has(test.id)){result.skipped.push({code:row.code,reason:'current-base-price-exists'});continue;}
  try{
   const saved=await savePrice({tenantId,testId:test.id,sellingPrice:row.sellingPrice});
   if(saved?.created===false){currentBase.add(test.id);result.skipped.push({code:row.code,reason:'current-base-price-exists'});}
   else{currentBase.add(test.id);result.created.push({code:row.code,testId:test.id,priceId:saved?.price?.id??saved?.id??null,sellingPrice:row.sellingPrice,cacheUpdated:saved?.cacheUpdated!==false});}
  }catch(error){result.failed.push({code:row.code,message:error?.message||'تعذر حفظ السعر'});}
 }
 return result;
}
