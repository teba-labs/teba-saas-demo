-- Test1 storage RLS smoke. Metadata rows are rolled back; no object bytes are uploaded.
-- This validates the database policy layer, not the Storage HTTP upload or signed-URL service.
begin;
create temp table storage_test_output(details jsonb) on commit drop;
grant insert,select on storage_test_output to authenticated;
select set_config('request.jwt.claim.sub',(
  select tm.user_id::text from public.tenants t
  join public.tenant_memberships tm on tm.tenant_id=t.id
  where t.slug='test1-lab' and tm.account_type='owner' and tm.is_active
  order by tm.created_at limit 1
),true);
select set_config('storage.test_other_tenant_id',(
  select t.id::text from public.tenants t
  join public.branches b on b.tenant_id=t.id
  join public.patients p on p.tenant_id=t.id and p.branch_id=b.id
  where t.slug<>'test1-lab' order by t.created_at limit 1
),true);
select set_config('storage.test_other_branch_id',(
  select b.id::text from public.tenants t
  join public.branches b on b.tenant_id=t.id
  join public.patients p on p.tenant_id=t.id and p.branch_id=b.id
  where t.slug<>'test1-lab' order by t.created_at limit 1
),true);
select set_config('storage.test_reports_private',coalesce((select (not public)::text from storage.buckets where id='tenant-reports'),'false'),true);
select set_config('storage.test_attachments_private',coalesce((select (not public)::text from storage.buckets where id='tenant-attachments'),'false'),true);
set local role authenticated;
do $test$
declare
 v_tenant uuid;v_branch uuid;v_visit uuid;v_other_tenant uuid:=current_setting('storage.test_other_tenant_id')::uuid;v_other_branch uuid:=current_setting('storage.test_other_branch_id')::uuid;v_user uuid:=auth.uid();v_reports_private boolean:=current_setting('storage.test_reports_private')::boolean;v_attachments_private boolean:=current_setting('storage.test_attachments_private')::boolean;
 v_attachment text;v_report text;v_rejected boolean:=false;v_report_count integer;v_attachment_count integer;
begin
 select t.id,b.id into v_tenant,v_branch from public.tenants t
 join public.branches b on b.tenant_id=t.id and b.is_active
 where t.slug='test1-lab' order by b.created_at limit 1;
 select id into v_visit from public.visits
 where tenant_id=v_tenant and branch_id=v_branch order by created_at desc limit 1;
 if v_tenant is null or v_branch is null or v_visit is null or v_user is null then
   raise exception 'TEST BLOCKED: Test1 owner, branch or visit is missing';
 end if;
 if v_other_tenant is null or v_other_branch is null then
   raise exception 'TEST BLOCKED: a second tenant/branch is required for isolation testing';
 end if;
 if not v_reports_private or not v_attachments_private then
   raise exception 'TEST FAIL: report and attachment buckets must remain private';
 end if;
 v_attachment:=v_tenant::text||'/'||v_branch::text||'/__storage_rls_test__.pdf';
 v_report:=v_tenant::text||'/'||v_visit::text||'/__storage_rls_test__.pdf';
 insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata)
 values(gen_random_uuid(),'tenant-attachments',v_attachment,v_user,v_user::text,
   jsonb_build_object('mimetype','application/pdf','size',1));
 insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata)
 values(gen_random_uuid(),'tenant-reports',v_report,v_user,v_user::text,
   jsonb_build_object('mimetype','application/pdf','size',1));
 begin
   insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata)
   values(gen_random_uuid(),'tenant-attachments',
     v_other_tenant::text||'/'||v_other_branch::text||'/__unauthorized__.pdf',
     v_user,v_user::text,jsonb_build_object('mimetype','application/pdf','size',1));
   raise exception 'TEST FAIL: cross-tenant attachment upload was accepted';
 exception when insufficient_privilege then v_rejected:=true;
 end;
 select count(*) into v_attachment_count from storage.objects
  where bucket_id='tenant-attachments' and name=v_attachment;
 select count(*) into v_report_count from storage.objects
  where bucket_id='tenant-reports' and name=v_report;
 if v_attachment_count<>1 or v_report_count<>1 or not v_rejected then
   raise exception 'TEST FAIL: storage RLS policy checks failed';
 end if;
 insert into pg_temp.storage_test_output values(jsonb_build_object(
  'status','PASS','tenant','test1-lab','private_report_bucket',true,'private_attachment_bucket',true,
  'authorized_attachment_insert',true,'authorized_report_insert',true,
  'cross_tenant_attachment_insert_rejected',true,'all_metadata_rows_rolled_back',true));
end
$test$;
select details from storage_test_output;
rollback;
