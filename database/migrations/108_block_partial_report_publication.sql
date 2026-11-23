-- 108: Prevent publishing a final patient-portal report while any requested test is unfinished.
begin;

alter table public.site_settings
  alter column portal_settings set default jsonb_build_object(
    'enabled', false,
    'title', 'بوابة نتائج التحاليل',
    'intro', 'أدخل اسم المريض ورقم الزيارة كما هو موضح في إيصال المعمل لعرض أحدث تقرير معتمد.',
    'patient_name_label', 'اسم المريض بالكامل',
    'visit_number_label', 'رقم الزيارة',
    'submit_label', 'عرض التقرير',
    'help_text', 'لا تشارك رابط التقرير مع أي شخص آخر. رابط التحميل مؤقت.',
    'accent_color', '#147c72'
  );

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
as $function$
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
     or right(lower(p_storage_path),4) <> '.pdf' then
    raise exception 'Invalid report storage path';
  end if;

  select * into v_visit from public.visits
    where id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id
    for update;
  if not found then raise exception 'Visit not found'; end if;

  if not exists (
    select 1 from public.site_settings ss
    where ss.tenant_id=p_tenant_id and ss.portal_settings @> '{"enabled":true}'::jsonb
  ) then
    raise exception 'Patient portal is disabled for this lab';
  end if;

  if v_visit.is_published then
    if nullif(trim(p_change_reason),'') is null then
      raise exception 'A correction reason is required for an already-published report';
    end if;
  elsif v_visit.status <> 'approved' then
    raise exception 'Visit must be approved before publication';
  end if;

  if exists (
    select 1 from public.visit_tests vt
     where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id
       and vt.visit_id=p_visit_id and vt.status not in ('completed','cancelled')
  ) then
    raise exception 'All visit tests must be completed before report publication';
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
$function$;

commit;
