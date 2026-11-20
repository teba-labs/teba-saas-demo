import {getSupabaseClient} from '../../core/supabase-client.js';
const db=()=>getSupabaseClient(),types=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']]);
export async function uploadLabAsset({tenantId,file,assetKind='logo'}={}) {
 if(!tenantId||!(file instanceof File))throw new Error('المعمل والصورة مطلوبان.');
 const ext=types.get(file.type);if(!ext)throw new Error('الصورة يجب أن تكون PNG أو JPG أو WebP.');
 if(!file.size||file.size>5*1024*1024)throw new Error('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.');
 if(!['logo','signature'].includes(assetKind))throw new Error('نوع الصورة غير مدعوم.');
 const path=tenantId+'/system/'+assetKind+'-'+crypto.randomUUID()+'.'+ext;
 const {error}=await db().storage.from('tenant-site-assets').upload(path,file,{cacheControl:'3600',contentType:file.type,upsert:false});
 if(error)throw error;
 const {data}=db().storage.from('tenant-site-assets').getPublicUrl(path);
 if(!data?.publicUrl)throw new Error('تم الرفع لكن تعذر إنشاء رابط العرض.');
 return {path,publicUrl:data.publicUrl,size:file.size,mimeType:file.type};
}
export function getLabAssetPublicUrl(path){if(!path)return '';return db().storage.from('tenant-site-assets').getPublicUrl(path).data?.publicUrl||'';}
