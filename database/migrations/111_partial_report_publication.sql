-- 110: Allow authenticated, explicitly marked partial reports without approving or closing the visit.
begin;

alter table public.report_versions
  add column if not exists publication_type text not null default 'final';

alter table public.report_versions
  drop constraint if exists report_versions_publication_type_check;
alter table public.report_versions
  add constraint report_versions_publication_type_check
  check (publication_type in ('final','partial'));

create or replace function private.validate_report_version_publication()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_count integer;
  v_incomplete integer;
  v_visit_status text;
  v_visit_published boolean;
  v_has_previous boolean;
  v_is_partial boolean;
begin
  if new.is_published then
    v_is_partial := new.publication_type='partial';
    if v_is_partial then
      if current_setting('app.report_publication',true) is distinct from 'partial' then
        raise exception 'Use the authorized partial report publication workflow';
      end if;
    elsif current_setting('app.report_publication',true) is distinct from 'on' then
      raise exception 'Use the authorized report publication workflow';
    end if;

    select status, is_published into v_visit_status, v_visit_published
      from public.visits where id=new.visit_id and tenant_id=new.tenant_id;

    select exists(select 1 from public.report_versions rv
      where rv.visit_id=new.visit_id and rv.tenant_id=new.tenant_id and rv.is_published)
      into v_has_previous;

    if v_is_partial then
      if coalesce(v_visit_published,false) or v_visit_status='cancelled' then
        raise exception 'A partial report cannot replace a final or cancelled visit';
      end if;
      select count(*) into v_count
        from public.visit_tests vt
       where vt.visit_id=new.visit_id and vt.tenant_id=new.tenant_id
         and vt.branch_id=new.branch_id and vt.status <> 'cancelled'
         and exists (
           select 1 from public.test_results tr
            where tr.visit_test_id=vt.id and tr.tenant_id=vt.tenant_id
         );
      if v_count=0 then
        raise exception 'A partial report requires at least one saved result';
      end if;
    else
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
    end if;

    if nullif(trim(new.storage_path),'') is null then
      raise exception 'Published report storage path is required';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.publish_partial_report_version(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid,
  p_storage_path text,
  p_staff_id uuid
)
returns public.report_versions
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_visit public.visits%rowtype;
  v_version integer;
  v_report public.report_versions%rowtype;
  v_expected_pattern text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active
  ) then
    raise exception 'An active staff identity for this branch is required';
  end if;

  v_expected_pattern := '^' || p_tenant_id::text || '/' || p_visit_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf' || chr(36);
  if p_storage_path is null or p_storage_path !~ v_expected_pattern then
    raise exception 'Invalid report storage path';
  end if;

  select * into v_visit from public.visits
   where id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id
   for update;
  if not found then raise exception 'Visit not found'; end if;
  if v_visit.is_published or v_visit.status='cancelled' then
    raise exception 'Partial publication is available only for an open, not-yet-finalized visit';
  end if;

  if not exists (
    select 1 from public.site_settings ss
     where ss.tenant_id=p_tenant_id and ss.portal_settings @> '{"enabled":true}'::jsonb
  ) then
    raise exception 'Patient portal is disabled for this lab';
  end if;

  if not exists (
    select 1 from public.visit_tests vt
     join public.test_results tr on tr.visit_test_id=vt.id and tr.tenant_id=vt.tenant_id
    where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id
      and vt.visit_id=p_visit_id and vt.status <> 'cancelled'
  ) then
    raise exception 'A partial report requires at least one saved result';
  end if;

  select coalesce(max(version_number),0)+1 into v_version
    from public.report_versions where tenant_id=p_tenant_id and visit_id=p_visit_id;

  perform set_config('app.report_publication','partial',true);
  insert into public.report_versions(
    tenant_id,branch_id,visit_id,version_number,storage_path,report_snapshot,
    change_reason,created_by,published_by_staff_id,is_published,published_at,publication_type
  ) values (
    p_tenant_id,p_branch_id,p_visit_id,v_version,p_storage_path,
    jsonb_build_object(
      'publication_type','partial',
      'is_partial',true,
      'partial_notice','تقرير جزئي — بعض النتائج لم تصدر بعد. لا يمثل اعتمادًا نهائيًا للزيارة.',
      'visit',jsonb_build_object('id',v_visit.id,'visit_number',v_visit.visit_number,'visit_work_date',v_visit.visit_work_date),
      'published_by_staff_id',p_staff_id,
      'tests',coalesce((
        select jsonb_agg(jsonb_build_object(
          'visit_test_id',vt.id,'test_code',vt.test_code_snapshot,'test_name',vt.test_name_snapshot,
          'status',vt.status,
          'parameters',coalesce((
            select jsonb_agg(jsonb_build_object(
              'code',tr.parameter_code,'name',tr.parameter_name_snapshot,
              'value_numeric',tr.value_numeric,'value_text',tr.value_text,'unit',tr.unit_snapshot,
              'flag',tr.flag,'reference_ranges',tr.reference_range_snapshot
            ) order by tr.parameter_code)
            from public.test_results tr
             where tr.tenant_id=vt.tenant_id and tr.visit_test_id=vt.id
          ),'[]'::jsonb)
        ) order by vt.id)
        from public.visit_tests vt
         where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id
           and vt.visit_id=p_visit_id and vt.status <> 'cancelled'
           and (vt.status='completed' or exists (
             select 1 from public.test_results tr
              where tr.tenant_id=vt.tenant_id and tr.visit_test_id=vt.id
           ))
      ),'[]'::jsonb)
    ),
    null,auth.uid(),p_staff_id,true,now(),'partial'
  ) returning * into v_report;

  -- Deliberately do not update visits.status, visits.is_published, or workday state.
  return v_report;
end;
$function$;

revoke all on function public.publish_partial_report_version(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.publish_partial_report_version(uuid,uuid,uuid,text,uuid) to authenticated;

comment on column public.report_versions.publication_type is
  'final requires approved visit and every requested required result; partial exposes saved results only and never approves the visit.';
comment on function public.publish_partial_report_version(uuid,uuid,uuid,text,uuid) is
  'Publishes a clearly marked partial report version while preserving the visit and workday as open/unapproved.';

notify pgrst, 'reload schema';
commit;
