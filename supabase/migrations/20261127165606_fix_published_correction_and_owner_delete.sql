begin;

-- Published clinical corrections still require the audited RPC and authorization,
-- but no longer require a user-entered reason. Keep the old/new audit snapshots.
create or replace function private.guard_published_result_correction()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_visit_id uuid;
  v_is_published boolean;
begin
  if tg_op='DELETE' then
    select vt.visit_id into v_visit_id from public.visit_tests vt
     where vt.id=old.visit_test_id and vt.tenant_id=old.tenant_id;
  else
    select vt.visit_id into v_visit_id from public.visit_tests vt
     where vt.id=new.visit_test_id and vt.tenant_id=new.tenant_id;
  end if;
  select v.is_published into v_is_published from public.visits v where v.id=v_visit_id;
  if coalesce(v_is_published,false) then
    if tg_op='DELETE' then raise exception 'Published results cannot be deleted'; end if;
    if tg_op='INSERT' then raise exception 'Use the documented correction workflow for published visits'; end if;
    if current_setting('app.result_correction',true) is distinct from 'on' then
      raise exception 'Use the authorized result correction workflow';
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

-- Only this explicitly authorized RPC performs permanent deletion. It runs with
-- definer privileges because authenticated users intentionally have no DELETE grant.
create or replace function public.delete_visit_permanently(
  p_tenant_id uuid,p_branch_id uuid,p_visit_id uuid,p_staff_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_type text;
  v_visit public.visits;
  v_test_ids uuid[];
  v_result_ids uuid[];
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then
    raise exception 'Authentication or branch access denied';
  end if;
  select tm.account_type into v_type
    from public.tenant_memberships tm
   where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_type<>'owner' then raise exception 'Permanent visit deletion is restricted to the lab owner'; end if;
  if p_staff_id is null or not exists(
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'Active staff identity required'; end if;

  select * into v_visit from public.visits
   where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id for update;
  if not found then raise exception 'Visit not found'; end if;

  if exists(select 1 from public.payments where tenant_id=p_tenant_id and origin_branch_id=p_branch_id and visit_id=p_visit_id)
     or exists(select 1 from public.report_versions where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id)
     or exists(select 1 from public.file_metadata where tenant_id=p_tenant_id and branch_id=p_branch_id and related_visit_id=p_visit_id) then
    raise exception 'لا يمكن حذف هذه الزيارة نهائيًا لأنها مرتبطة بتحصيل مالي أو تقرير محفوظ أو مرفق. استخدم إلغاء الزيارة للاحتفاظ بالسجل بأمان.';
  end if;
  if v_visit.is_published or v_visit.status in ('approved','published') then
    raise exception 'لا يمكن حذف زيارة معتمدة أو منشورة نهائيًا. استخدم إلغاء الزيارة للاحتفاظ بتاريخها الطبي.';
  end if;

  select coalesce(array_agg(id),'{}'::uuid[]) into v_test_ids
    from public.visit_tests where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_result_ids
    from public.test_results where tenant_id=p_tenant_id and visit_test_id=any(v_test_ids);

  delete from public.visit_test_parameter_range_events
   where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_test_id=any(v_test_ids);
  delete from public.visit_test_parameter_range_overrides
   where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_test_id=any(v_test_ids);
  delete from public.test_results where tenant_id=p_tenant_id and visit_test_id=any(v_test_ids);
  delete from public.visit_tests where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id;
  delete from public.visit_billing where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id;
  delete from public.visit_workbench_archive_events where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=p_visit_id;
  delete from public.audit_logs
   where tenant_id=p_tenant_id
     and ((table_name='visits' and record_id=p_visit_id::text)
       or (table_name='visit_tests' and record_id=any(select unnest(v_test_ids)::text))
       or (table_name='test_results' and record_id=any(select unnest(v_result_ids)::text)));
  delete from public.visits where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id;

  insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_staff_id,action,table_name,record_id)
  values(p_tenant_id,p_branch_id,auth.uid(),p_staff_id,'permanently_deleted','visits',p_visit_id::text);
  return jsonb_build_object('deleted',true,'visit_id',p_visit_id);
end;
$function$;
revoke all on function public.delete_visit_permanently(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.delete_visit_permanently(uuid,uuid,uuid,uuid) to authenticated;

commit;