import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const MAX_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Map([
  ['application/pdf', { ext: 'pdf', signature: [0x25,0x50,0x44,0x46,0x2d] }],
  ['image/jpeg', { ext: 'jpg', signature: [0xff,0xd8,0xff] }],
  ['image/png', { ext: 'png', signature: [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a] }],
]);

function reply(body: unknown, status = 200, origin = '') {
  const headers: Record<string,string> = {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store, max-age=0',
    'Vary':'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin']=origin;
    headers['Access-Control-Allow-Headers']='authorization, x-client-info, apikey, content-type';
    headers['Access-Control-Allow-Methods']='POST, OPTIONS';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async req => {
  const allowed=(Deno.env.get('ATTACHMENT_ALLOWED_ORIGINS') ?? '').split(',').map(v=>v.trim()).filter(Boolean);
  const origin=req.headers.get('origin') ?? '';
  if (req.method==='OPTIONS') return reply({ok:true},200,allowed.includes(origin)?origin:'');
  if (req.method!=='POST') return reply({ok:false,message:'Method not allowed.'},405);
  if (!allowed.length || !origin || !allowed.includes(origin)) return reply({ok:false,message:'Origin not allowed.'},403);

  const bearer=req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return reply({ok:false,message:'Authentication required.'},401,origin);
  const url=Deno.env.get('SUPABASE_URL');
  const anon=Deno.env.get('SUPABASE_ANON_KEY');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return reply({ok:false,message:'الخدمة غير متاحة مؤقتًا.'},503,origin);

  const user=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${bearer}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await user.auth.getUser(bearer);
  if (authError || !auth.user) return reply({ok:false,message:'Authentication required.'},401,origin);

  let form:FormData;
  try { form=await req.formData(); } catch { return reply({ok:false,message:'Invalid request.'},400,origin); }
  const tenantId=String(form.get('tenantId')??'');
  const branchId=String(form.get('branchId')??'');
  const visitId=String(form.get('visitId')??'').trim() || null;
  const file=form.get('file');
  if (!UUID.test(tenantId) || !UUID.test(branchId) || (visitId && !UUID.test(visitId)) || !(file instanceof File)) {
    return reply({ok:false,message:'بيانات المرفق غير مكتملة.'},400,origin);
  }
  if (!file.size || file.size>MAX_BYTES) return reply({ok:false,message:'حجم الملف يجب ألا يتجاوز 10 ميجابايت.'},400,origin);
  const type=TYPES.get(file.type);
  if (!type) return reply({ok:false,message:'المسموح حاليًا PDF أو صورة JPG أو PNG فقط.'},415,origin);
  const bytes=new Uint8Array(await file.slice(0,type.signature.length).arrayBuffer());
  if (!type.signature.every((b,i)=>bytes[i]===b)) return reply({ok:false,message:'محتوى الملف لا يطابق نوعه.'},400,origin);

  const path=`${tenantId}/${branchId}/${crypto.randomUUID()}.${type.ext}`;
  const {error:uploadError}=await user.storage.from('tenant-attachments').upload(path,file,{
    contentType:file.type,upsert:false,cacheControl:'0',
  });
  if (uploadError) {
    console.error('Attachment upload failed:',uploadError.message);
    return reply({ok:false,message:'تعذر رفع المرفق. تحقق من صلاحية الفرع وحاول مرة أخرى.'},403,origin);
  }

  const {data:metadata,error:metadataError}=await user.from('file_metadata').insert({
    tenant_id:tenantId,branch_id:branchId,related_visit_id:visitId,
    bucket_id:'tenant-attachments',storage_path:path,file_kind:'attachment',
    mime_type:file.type,size_bytes:file.size,uploaded_by:auth.user.id,
  }).select('id,tenant_id,branch_id,related_visit_id,bucket_id,storage_path,file_kind,mime_type,size_bytes,created_at').single();

  if (metadataError || !metadata) {
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {error:cleanupError}=await admin.storage.from('tenant-attachments').remove([path]);
    if (cleanupError) console.error('Orphan attachment cleanup failed:',cleanupError.message,path);
    console.error('Attachment metadata insert failed:',metadataError?.message);
    return reply({ok:false,message:'لم يتم اعتماد المرفق. حاول مرة أخرى.'},409,origin);
  }
  return reply({ok:true,file:metadata},201,origin);
});
