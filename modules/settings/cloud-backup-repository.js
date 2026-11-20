import {getSupabaseClient} from '../../core/supabase-client.js';
const db=()=>getSupabaseClient(),BUCKET='tenant-backups';
export async function listCloudBackups({tenantId,branchId=null,limit=30}={}) {
 if(!tenantId)throw new Error('tenantId is required.');
 let query=db().from('backup_runs').select('id,tenant_id,backup_type,storage_path,manifest,status,created_at,completed_at').eq('tenant_id',tenantId).eq('backup_type','manual_export').eq('status','completed');
 // Filter the JSONB branch scope in Postgres before applying the limit. Client-side filtering
 // after a tenant-wide limit could hide this branch's older backups when other branches are busy.
 if(branchId)query=query.contains('manifest',{branch_id:branchId});
 const {data,error}=await query.order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,Number(limit)||30)));
 if(error)throw error;return data||[];
}
/** Cloud copy of this browser's local snapshot, not a full server database backup. */
export async function createCloudBackup({tenantId,branchId,branchName='',document}={}) {
 if(!tenantId||!branchId||document?.format!=='taiba-smart-lab-local-backup'||document.scope?.tenant_id!==tenantId||document.scope?.branch_id!==branchId||!document.checksum_sha256)throw new Error('ملف النسخة لا يطابق المعمل والفرع أو بصمة السلامة.');
 const body=JSON.stringify(document),bytes=new Blob([body]).size;if(!bytes||bytes>100*1024*1024)throw new Error('حجم النسخة يتجاوز 100 ميجابايت.');
 const path=tenantId+'/'+branchId+'/device-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID()+'.json',client=db();
 const manifest={branch_id:branchId,branch_name:String(branchName||''),version:document.version,coverage:document.coverage,checksum_sha256:document.checksum_sha256,bytes,source:'browser-local-cache'};
 const {data:run,error:runError}=await client.from('backup_runs').insert({tenant_id:tenantId,backup_type:'manual_export',storage_path:path,manifest,status:'started'}).select('id').single();if(runError)throw runError;
 try{
  const {error:upError}=await client.storage.from(BUCKET).upload(path,new Blob([body],{type:'application/json'}),{contentType:'application/json',cacheControl:'3600',upsert:false});if(upError)throw upError;
  const {data,error}=await client.from('backup_runs').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',run.id).eq('tenant_id',tenantId).select('id,storage_path,manifest,status,completed_at').single();if(error)throw error;return data;
 }catch(error){await client.from('backup_runs').update({status:'failed',error_message:String(error?.message||'Cloud backup failed').slice(0,500)}).eq('id',run.id).eq('tenant_id',tenantId);throw error;}
}
export async function downloadCloudBackup({tenantId,branchId,backupId}={}) {
 if(!tenantId||!branchId||!backupId)throw new Error('tenantId, branchId and backupId are required.');
 const client=db(),{data:run,error:lookupError}=await client.from('backup_runs').select('id,storage_path,manifest,status').eq('id',backupId).eq('tenant_id',tenantId).eq('backup_type','manual_export').eq('status','completed').single();if(lookupError)throw lookupError;
 if(run.manifest?.branch_id!==branchId||!run.storage_path?.startsWith(tenantId+'/'+branchId+'/'))throw new Error('هذه النسخة تخص فرعًا آخر.');
 const {data:blob,error}=await client.storage.from(BUCKET).download(run.storage_path);if(error)throw error;
 const doc=JSON.parse(await blob.text());if(doc.scope?.tenant_id!==tenantId||doc.scope?.branch_id!==branchId||doc.checksum_sha256!==run.manifest?.checksum_sha256)throw new Error('محتوى النسخة أو بصمتها لا يطابق السجل السحابي.');
 return doc;
}
