import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins=new Set([
  'https://teba-labs.github.io','https://teba-labs.com','https://www.teba-labs.com',
  'http://localhost:4174','http://127.0.0.1:4174',
]);
function response(body:unknown,status=200,origin=''){
  const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
  if(allowedOrigins.has(origin)){
    headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');
    headers.set('Access-Control-Allow-Headers','authorization, apikey, content-type, x-client-info');
    headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
  }
  return new Response(status===204?null:JSON.stringify(body),{status,headers});
}
function stable(value:unknown):string{if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object'){const row=value as Record<string,unknown>;return '{'+Object.keys(row).sort().map(key=>JSON.stringify(key)+':'+stable(row[key])).join(',')+'}';}return JSON.stringify(value);}
const isUuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async(request:Request)=>{
  const origin=request.headers.get('origin')||'';
  if(request.method==='OPTIONS')return response({ok:true},204,origin);
  if(request.method!=='POST')return response({error:'Method not allowed.'},405,origin);
  try{
    const authorization=request.headers.get('Authorization')||'';
    const bearer=authorization.match(/^Bearer\\s+(.+)$/i)?.[1];
    if(!bearer)return response({error:'Authentication required.'},401,origin);
    const url=Deno.env.get('SUPABASE_URL')||'';
    const publishableKeys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}');
    const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
    const publishableKey=publishableKeys.default||Deno.env.get('SUPABASE_ANON_KEY');
    const secretKey=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!publishableKey||!secretKey)return response({error:'Server authentication configuration is incomplete.'},503,origin);
    const userClient=createClient(url,publishableKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}});
    const {data:authData,error:authError}=await userClient.auth.getUser(bearer);
    if(authError||!authData.user)return response({error:'Authentication required.'},401,origin);
    const body=await request.json();
    const {operation_id:operationId,tenant_id:tenantId,branch_id:branchId,visit_id:visitId,staff_id:staffId,delivered_at:deliveredAt,delivery_method:deliveryMethod}=body||{};
    if(![operationId,tenantId,branchId,visitId,staffId].every(isUuid))return response({error:'Valid operation, tenant, branch, visit and staff identifiers are required.'},400,origin);
    if(deliveryMethod!=='printed_work_copy'||typeof deliveredAt!=='string'||!Number.isFinite(Date.parse(deliveredAt)))return response({error:'Only a dated printed work-copy handoff can be recorded offline.'},400,origin);

    const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const userId=authData.user.id;
    const {data:membership,error:membershipError}=await admin.from('tenant_memberships')
      .select('id,account_type,is_active').eq('tenant_id',tenantId).eq('user_id',userId).eq('is_active',true).maybeSingle();
    if(membershipError)throw membershipError;
    if(!membership)return response({error:'Active tenant membership was not found.'},403,origin);
    const {data:branch,error:branchError}=await admin.from('branches')
      .select('id,tenant_id,is_active').eq('id',branchId).eq('tenant_id',tenantId).eq('is_active',true).maybeSingle();
    if(branchError)throw branchError;
    if(!branch)return response({error:'Active branch was not found.'},403,origin);
    if(membership.account_type!=='owner'){
      const {data:branchMembership,error:branchMembershipError}=await admin.from('branch_memberships')
        .select('id').eq('tenant_id',tenantId).eq('branch_id',branchId).eq('user_id',userId).eq('is_active',true).maybeSingle();
      if(branchMembershipError)throw branchMembershipError;
      if(!branchMembership)return response({error:'This user is not assigned to the selected branch.'},403,origin);
    }
    const {data:staff,error:staffError}=await admin.from('staff_directory')
      .select('id,tenant_id,branch_id,is_active').eq('id',staffId).eq('tenant_id',tenantId).eq('branch_id',branchId).eq('is_active',true).maybeSingle();
    if(staffError)throw staffError;
    if(!staff)return response({error:'Active staff identity was not found in this branch.'},403,origin);
    const {data:visit,error:visitError}=await admin.from('visits')
      .select('id,tenant_id,branch_id,is_published,status').eq('id',visitId).eq('tenant_id',tenantId).eq('branch_id',branchId).maybeSingle();
    if(visitError)throw visitError;
    if(!visit)return response({error:'Visit was not found in this tenant and branch.'},404,origin);

    const event={
      id:operationId,tenant_id:tenantId,branch_id:branchId,actor_user_id:userId,actor_staff_id:staffId,
      action:'report_work_copy_handed_over',table_name:'visits',record_id:visitId,
      old_data:null,
      new_data:{
        delivery_method:deliveryMethod,
        copy_type:visit.is_published?'published_report_copy':'work_copy',
        delivered_at:deliveredAt,
        visit_status:visit.status,
        is_published:Boolean(visit.is_published),
        final_publication:Boolean(visit.is_published),
      },
      reason:visit.is_published?'Printed copy of an already published report handed over.':'Printed work copy handed over; this event is not a final report approval or publication.',
      occurred_at:deliveredAt,
    };
    const {data:existing,error:existingError}=await admin.from('audit_logs')
      .select('id,tenant_id,branch_id,actor_user_id,actor_staff_id,action,record_id,new_data')
      .eq('id',operationId).maybeSingle();
    if(existingError)throw existingError;
    if(existing){
      const same=existing.tenant_id===tenantId&&existing.branch_id===branchId&&existing.actor_user_id===userId
        &&existing.actor_staff_id===staffId&&existing.action===event.action&&existing.record_id===visitId
        &&stable(existing.new_data)===stable(event.new_data);
      if(!same)return response({error:'Operation ID was reused with a different delivery event.'},409,origin);
      return response({event_id:operationId,copy_type:event.new_data.copy_type,replayed:true},200,origin);
    }
    const {error:insertError}=await admin.from('audit_logs').insert(event);
    if(insertError)throw insertError;
    return response({event_id:operationId,copy_type:event.new_data.copy_type,replayed:false},200,origin);
  }catch(error){
    return response({error:error instanceof Error?error.message:'Unable to record local work-copy delivery.'},500,origin);
  }
});
