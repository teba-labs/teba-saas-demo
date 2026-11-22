import { getSupabaseClient } from '../../core/supabase-client.js';

const db = () => getSupabaseClient();
const allowedTypes = new Set(['sales','prices','detail2025','detail2026']);
const required = (value,name) => { if(!value) throw new Error(name+' مطلوب.'); };
const safeName = value => String(value||'workbook.xlsx').replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,120) || 'workbook.xlsx';

async function sha256(data) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function listCloudHistoricalWorkbooks(tenantId) {
  required(tenantId,'tenantId');
  const {data,error}=await db().from('owner_historical_workbooks')
    .select('id,tenant_id,workbook_type,file_name,file_sha256,storage_path,file_size,sheet_summary,uploaded_at')
    .eq('tenant_id',tenantId).order('workbook_type');
  if(error)throw error;
  return data||[];
}

export async function saveCloudHistoricalWorkbook({tenantId,type,fileName,data,sheets=[]}={}) {
  required(tenantId,'tenantId');required(fileName,'اسم الملف');
  if(!allowedTypes.has(type))throw new Error('نوع الأرشيف التاريخي غير مدعوم.');
  if(!(data instanceof ArrayBuffer)||data.byteLength===0||data.byteLength>20*1024*1024)throw new Error('ملف Excel غير صالح أو يتجاوز 20 ميجابايت.');
  if(globalThis.navigator?.onLine===false)throw new Error('رفع الأرشيف السحابي يحتاج اتصالًا بالإنترنت. احتُفظ بالنسخة المحلية.');
  const fileSha256=await sha256(data);
  const {data:existing,error:readError}=await db().from('owner_historical_workbooks')
    .select('id,file_sha256,storage_path').eq('tenant_id',tenantId).eq('workbook_type',type).maybeSingle();
  if(readError)throw readError;
  if(existing?.file_sha256===fileSha256)return existing;
  const storagePath=tenantId+'/historical-workbooks/'+type+'/'+fileSha256+'/'+safeName(fileName);
  const blob=new Blob([data],{type:'application/octet-stream'});
  const {error:uploadError}=await db().storage.from('tenant-backups').upload(storagePath,blob,{upsert:false,contentType:'application/octet-stream'});
  if(uploadError)throw uploadError;
  const user=await db().auth.getUser();
  if(user.error){await db().storage.from('tenant-backups').remove([storagePath]);throw user.error;}
  const payload={
    tenant_id:tenantId,workbook_type:type,file_name:String(fileName),file_sha256:fileSha256,
    storage_path:storagePath,file_size:data.byteLength,sheet_summary:Array.isArray(sheets)?sheets:[],
    uploaded_by:user.data.user?.id||null,uploaded_at:new Date().toISOString()
  };
  const {data:saved,error:saveError}=await db().from('owner_historical_workbooks')
    .upsert(payload,{onConflict:'tenant_id,workbook_type'})
    .select('id,tenant_id,workbook_type,file_name,file_sha256,storage_path,file_size,sheet_summary,uploaded_at').single();
  if(saveError){await db().storage.from('tenant-backups').remove([storagePath]);throw saveError;}
  if(existing?.storage_path&&existing.storage_path!==storagePath){
    const {error:removeError}=await db().storage.from('tenant-backups').remove([existing.storage_path]);
    if(removeError)throw new Error('تم تحديث بيانات الأرشيف السحابي، لكن تعذر تنظيف النسخة القديمة: '+removeError.message);
  }
  return saved;
}

export async function downloadCloudHistoricalWorkbook({tenantId,type}={}) {
  required(tenantId,'tenantId');
  if(!allowedTypes.has(type))throw new Error('نوع الأرشيف التاريخي غير مدعوم.');
  const {data:row,error:readError}=await db().from('owner_historical_workbooks')
    .select('file_name,file_size,sheet_summary,storage_path,uploaded_at').eq('tenant_id',tenantId).eq('workbook_type',type).maybeSingle();
  if(readError)throw readError;
  if(!row)return null;
  const {data:blob,error}=await db().storage.from('tenant-backups').download(row.storage_path);
  if(error)throw error;
  return {...row,data:await blob.arrayBuffer()};
}

export async function deleteCloudHistoricalWorkbook({tenantId,type}={}) {
  required(tenantId,'tenantId');
  if(!allowedTypes.has(type))throw new Error('نوع الأرشيف التاريخي غير مدعوم.');
  const {data:row,error:readError}=await db().from('owner_historical_workbooks')
    .select('id,storage_path').eq('tenant_id',tenantId).eq('workbook_type',type).maybeSingle();
  if(readError)throw readError;
  if(!row)return false;
  const {error:removeError}=await db().storage.from('tenant-backups').remove([row.storage_path]);
  if(removeError)throw removeError;
  const {error:deleteError}=await db().from('owner_historical_workbooks').delete().eq('id',row.id).eq('tenant_id',tenantId);
  if(deleteError)throw deleteError;
  return true;
}
