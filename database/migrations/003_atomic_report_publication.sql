-- Taiba Smart Lab — atomic report publication and audited result correction.
-- Apply only to the TEST Supabase project after migrations 001 and 002.

-- Preserve the selected staff identity on each immutable report version.
alter table public.report_versions add column if not exists published_by_staff_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='fk_report_versions_published_staff' and conrelid='public.report_versions'::regclass) then
    alter table public.report_versions add constraint fk_report_versions_published_staff
      foreign key (tenant_id,branch_id,published_by_staff_id)
      references public.staff_directory(tenant_id,branch_id,id) on delete restrict;
  end if;
end $$;

-- Permit a new published version for an already-published visit only when a
-- non-empty correction reason is supplied. Initial publication still requires
-- an approved visit and all required results.
create or replace function private.validate_report_version_publication()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_count integer;
  v_incomplete integer;
  v_visit_status text;
  v_visit_published boolean;
  v_has_previous boolean;
begin
  if new.is_published then
    if current_setting('app.report_publication',true) is distinct from 'on' then
      raise exception 'Use the authorized report publication workflow';
    end if;
    select status, is_published into v_visit_status, v_visit_published
      from public.visits where id=new.visit_id and tenant_id=new.tenant_id;
    select exists(select 1 from public.report_versions rv
      where rv.visit_id=new.visit_id and rv.tenant_id=new.tenant_id and rv.is_published)
      into v_has_previous;

    if coalesce(v_visit_published,false) then
      if not v_has_previous or nullif(trim(new.change_reason),'') is null then
        raise exception 'A published report correction requires an existing report and a documented reason';
      end if;
    elsif v_visit_status <> 'approved' then
      raise exception 'Visit must be approved before report publication';
    end if;

    select count(*) into v_count from public.visit_tests vt
      where vt.visit_id=new.visit_id and vt.tenant_id=new.tenant_id and vt.status <> 'cancelled';
    select count(*) into v_incomplete from public.visit_tests vt
      where vt.visit_id=new.visit_id and vt.tenant_id=new.tenant_id and vt.status <> 'cancelled'
        and (vt.status <> 'completed' or exists (
          select 1 from jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters','[]'::jsonb)) p
          where coalesce((p->>'is_required')::boolean,true)
            and not exists (select 1 from public.test_results tr
              where tr.visit_test_id=vt.id and tr.tenant_id=vt.tenant_id and tr.parameter_code=p->>'code')
        ));
    if v_count=0 or v_incomplete>0 then
      raise exception 'Cannot publish: every required parameter of every requested test must have a result';
    end if;
    if nullif(trim(new.storage_path),'') is null then raise exception 'Published report storage path is required'; end if;
  end if;
  return new;
end;
$$;

-- One transaction inserts the immutable report version and changes visit state.
-- Storage upload is performed by the authenticated Edge Function first; if this
-- RPC fails, that function removes the unreferenced object with its server key.
create or replace function public.publish_report_version(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid,
  p_storage_path text,
  p_change_reason text default null,
  p_staff_id uuid default null
)
returns public.report_versions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_visit public.visits%rowtype;
  v_version integer;
  v_report public.report_versions%rowtype;
  v_expected_prefix text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
    where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;

  v_expected_prefix := p_tenant_id::text || '/' || p_visit_id::text || '/';
  if p_storage_path is null or left(p_storage_path,length(v_expected_prefix)) <> v_expected_prefix
     or p_storage_path !~ '\.pdf$' then
    raise exception 'Invalid report storage path';
  end if;

  select * into v_visit from public.visits
    where id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id
    for update;
  if not found then raise exception 'Visit not found'; end if;

  if v_visit.is_published then
    if nullif(trim(p_change_reason),'') is null then
      raise exception 'A correction reason is required for an already-published report';
    end if;
  elsif v_visit.status <> 'approved' then
    raise exception 'Visit must be approved before publication';
  end if;

  select coalesce(max(version_number),0)+1 into v_version
    from public.report_versions where tenant_id=p_tenant_id and visit_id=p_visit_id;

  perform set_config('app.report_publication','on',true);
  insert into public.report_versions(
    tenant_id,branch_id,visit_id,version_number,storage_path,report_snapshot,
    change_reason,created_by,published_by_staff_id,is_published,published_at
  ) values (
    p_tenant_id,p_branch_id,p_visit_id,v_version,p_storage_path,
    jsonb_build_object(
      'visit',jsonb_build_object('id',v_visit.id,'visit_number',v_visit.visit_number,'visit_work_date',v_visit.visit_work_date),
      'published_by_staff_id',p_staff_id,
      'tests',coalesce((
        select jsonb_agg(jsonb_build_object(
          'visit_test_id',vt.id,'test_code',vt.test_code_snapshot,'test_name',vt.test_name_snapshot,
          'parameters',coalesce((
            select jsonb_agg(jsonb_build_object(
              'code',tr.parameter_code,'name',tr.parameter_name_snapshot,
              'value_numeric',tr.value_numeric,'value_text',tr.value_text,'unit',tr.unit_snapshot,
              'flag',tr.flag,'reference_ranges',tr.reference_range_snapshot
            ) order by tr.parameter_code)
            from public.test_results tr where tr.tenant_id=vt.tenant_id and tr.visit_test_id=vt.id
          ),'[]'::jsonb)
        ) order by vt.id)
        from public.visit_tests vt where vt.tenant_id=p_tenant_id and vt.visit_id=p_visit_id and vt.status <> 'cancelled'
      ),'[]'::jsonb)
    ),
    nullif(trim(p_change_reason),''),auth.uid(),p_staff_id,true,now()
  ) returning * into v_report;

  if not v_visit.is_published then
    update public.visits set status='published',is_published=true,published_at=now(),updated_at=now()
      where id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
  end if;
  return v_report;
end;
$$;

-- A published result can only be changed through this function. The existing
-- audit trigger captures old/new values; correction_reason is mandatory.
create or replace function public.correct_published_result(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid,
  p_result_id uuid,
  p_value_numeric numeric,
  p_value_text text,
  p_reason text,
  p_staff_id uuid
)
returns public.test_results
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result public.test_results%rowtype;
  v_visit public.visits%rowtype;
  v_updated public.test_results%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Correction reason is required'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
    where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;

  select * into v_visit from public.visits
    where id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id for update;
  if not found or not v_visit.is_published then raise exception 'Only a published visit can use this correction workflow'; end if;

  select tr.* into v_result from public.test_results tr
    join public.visit_tests vt on vt.id=tr.visit_test_id and vt.tenant_id=tr.tenant_id
    where tr.id=p_result_id and tr.tenant_id=p_tenant_id and vt.visit_id=p_visit_id and vt.branch_id=p_branch_id
    for update of tr;
  if not found then raise exception 'Result not found'; end if;
  if (p_value_numeric is null) = (p_value_text is null) then
    raise exception 'Provide exactly one numeric or text result value';
  end if;

  perform set_config('app.result_correction','on',true);
  update public.test_results set
    value_numeric=p_value_numeric,
    value_text=p_value_text,
    correction_reason=trim(p_reason),
    entered_by=auth.uid(),
    entered_by_staff_id=p_staff_id,
    updated_at=now()
  where id=p_result_id and tenant_id=p_tenant_id
  returning * into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.publish_report_version(uuid,uuid,uuid,text,text,uuid) from public, anon;
revoke all on function public.correct_published_result(uuid,uuid,uuid,uuid,numeric,text,text,uuid) from public, anon;
revoke insert, update, delete on public.report_versions from authenticated;
grant execute on function public.publish_report_version(uuid,uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.correct_published_result(uuid,uuid,uuid,uuid,numeric,text,text,uuid) to authenticated;

comment on function public.publish_report_version(uuid,uuid,uuid,text,text,uuid) is
  'Atomically publishes a report version and visit state; requires branch access and audited reason for corrections.';
comment on function public.correct_published_result(uuid,uuid,uuid,uuid,numeric,text,text,uuid) is
  'Audited correction for a result in a published visit; audit_logs captures before/after values.';

-- Published versions are append-only; never edit or remove an issued report.
create or replace function private.reject_report_version_mutation()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  raise exception 'Published report versions are immutable';
end;
$$;
drop trigger if exists trg_report_versions_immutable on public.report_versions;
create trigger trg_report_versions_immutable before update or delete on public.report_versions
for each row execute function private.reject_report_version_mutation();

-- Replace the original permissive trigger guard so browser-side direct updates
-- cannot forge a correction_reason and bypass the RPC's audited workflow.
create or replace function private.guard_published_result_correction()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_visit_id uuid;
  v_is_published boolean;
begin
  if tg_op='DELETE' then
    select vt.visit_id into v_visit_id from public.visit_tests vt where vt.id=old.visit_test_id and vt.tenant_id=old.tenant_id;
  else
    select vt.visit_id into v_visit_id from public.visit_tests vt where vt.id=new.visit_test_id and vt.tenant_id=new.tenant_id;
  end if;
  select v.is_published into v_is_published from public.visits v where v.id=v_visit_id;
  if coalesce(v_is_published,false) then
    if tg_op='DELETE' then raise exception 'Published results cannot be deleted'; end if;
    if tg_op='INSERT' then raise exception 'Use the documented correction workflow for published visits'; end if;
    if current_setting('app.result_correction',true) is distinct from 'on' then
      raise exception 'Use the authorized result correction workflow';
    end if;
    if nullif(trim(new.correction_reason),'') is null then
      raise exception 'A published result correction requires a documented reason';
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

-- Extend the shared audit trigger to recognize the report publisher's selected
-- staff identity as well as the authenticated account identity.
create or replace function private.capture_audit_log()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare
  j_new jsonb;
  j_old jsonb;
  v_tenant uuid;
  v_branch uuid;
  v_id text;
  v_staff uuid;
begin
  if tg_op <> 'DELETE' then j_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then j_old := to_jsonb(old); end if;
  v_tenant := coalesce(nullif(j_new->>'tenant_id','')::uuid, nullif(j_old->>'tenant_id','')::uuid);
  v_branch := coalesce(nullif(j_new->>'branch_id','')::uuid, nullif(j_old->>'branch_id','')::uuid);
  v_id := coalesce(j_new->>'id', j_old->>'id');
  v_staff := coalesce(
    nullif(j_new->>'created_by_staff_id',''),nullif(j_new->>'published_by_staff_id',''),
    nullif(j_new->>'approved_by_staff_id',''),nullif(j_new->>'entered_by_staff_id',''),
    nullif(j_new->>'received_by_staff_id',''),nullif(j_new->>'spent_by_staff_id',''),
    nullif(j_new->>'closed_by_staff_id',''),nullif(j_new->>'opened_by_staff_id',''),
    nullif(j_old->>'created_by_staff_id',''),nullif(j_old->>'published_by_staff_id',''),
    nullif(j_old->>'approved_by_staff_id',''),nullif(j_old->>'entered_by_staff_id',''),
    nullif(j_old->>'received_by_staff_id',''),nullif(j_old->>'spent_by_staff_id',''),
    nullif(j_old->>'closed_by_staff_id',''),nullif(j_old->>'opened_by_staff_id','')
  )::uuid;
  if v_tenant is not null then
    insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_staff_id,action,table_name,record_id,old_data,new_data)
    values (v_tenant,v_branch,auth.uid(),v_staff,lower(tg_op),tg_table_name,v_id,
      case when tg_op='INSERT' then null else j_old end,
      case when tg_op='DELETE' then null else j_new end);
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
