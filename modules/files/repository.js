import { getSupabaseClient } from '../../core/supabase-client.js';

const db=()=>getSupabaseClient();
const need=(v,n)=>{if(!v) throw new Error(`${n} is required.`);};

export async function listVisitAttachments({tenantId,branchId,visitId}={}) {
  for (const [v,n] of [[tenantId,'tenantId'],[branchId,'branchId'],[visitId,'visitId']]) need(v,n);
  const {data,error}=await db().from('file_metadata')
    .select('id,tenant_id,branch_id,related_visit_id,bucket_id,storage_path,file_kind,mime_type,size_bytes,created_at')
    .eq('tenant_id',tenantId).eq('branch_id',branchId).eq('related_visit_id',visitId)
    .eq('bucket_id','tenant-attachments').eq('file_kind','attachment')
    .order('created_at',{ascending:false});
  if(error) throw error;
  return data??[];
}

/** Upload through a JWT-verified Edge Function; metadata and object are created together with server-side orphan cleanup. */
export async function uploadVisitAttachment({tenantId,branchId,visitId=null,file}={}) {
  need(tenantId,'tenantId'); need(branchId,'branchId'); need(file,'file');
  if(!(file instanceof File)) throw new Error('A file is required.');
  const allowed=new Set(['application/pdf','image/jpeg','image/png']);
  if(!allowed.has(file.type)) throw new Error('المسموح PDF أو JPG أو PNG فقط.');
  if(!file.size || file.size>10*1024*1024) throw new Error('حجم الملف يجب ألا يتجاوز 10 ميجابايت.');
  const form=new FormData();
  form.set('tenantId',tenantId); form.set('branchId',branchId);
  if(visitId) form.set('visitId',visitId);
  form.set('file',file,file.name||'attachment');
  const {data,error}=await db().functions.invoke('upload-attachment',{body:form});
  if(error) throw error;
  if(!data?.ok || !data.file?.id) throw new Error(data?.message||'Attachment upload failed.');
  return data.file;
}

/** Checks tenant/branch metadata through RLS before asking private Storage for a short URL. */
export async function createAttachmentDownloadUrl({tenantId,branchId,fileId,expiresIn=90}={}) {
  for(const [v,n] of [[tenantId,'tenantId'],[branchId,'branchId'],[fileId,'fileId']]) need(v,n);
  const client=db();
  const {data:file,error:lookupError}=await client.from('file_metadata')
    .select('storage_path,bucket_id,file_kind')
    .eq('id',fileId).eq('tenant_id',tenantId).eq('branch_id',branchId)
    .eq('bucket_id','tenant-attachments').eq('file_kind','attachment').single();
  if(lookupError) throw lookupError;
  const seconds=Math.min(Math.max(Number(expiresIn)||90,30),86400);
  const {data,error}=await client.storage.from('tenant-attachments').createSignedUrl(file.storage_path,seconds);
  if(error) throw error;
  return data.signedUrl;
}
