-- 095: Finalize completeness gates for method, specimen and categorical choices.
begin;

create or replace function public.import_master_catalog_test(
  p_tenant_id uuid,
  p_master_test_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_test public.master_catalog_tests%rowtype;
  v_release public.master_catalog_releases%rowtype;
  v_parameter_count integer;
  v_bad_count integer;
  v_test_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_tenant_owner(p_tenant_id) then
    raise exception 'Only the tenant owner may import master catalog tests';
  end if;

  select * into v_test from public.master_catalog_tests where id=p_master_test_id;
  if not found then raise exception 'Master catalog test was not found'; end if;

  select * into v_release from public.master_catalog_releases
   where id=v_test.release_id and status='published';
  if not found then raise exception 'Only published master catalog tests can be imported'; end if;

  if v_test.clinical_review_status <> 'verified' then
    raise exception 'This master definition has not passed central clinical review';
  end if;
  if nullif(btrim(v_test.definition->>'method'),'') is null
     or nullif(btrim(v_test.definition->>'specimen'),'') is null then
    raise exception 'Master test method and specimen must be defined before import';
  end if;

  select count(*),
         count(*) filter (
           where p.clinical_review_status <> 'verified'
              or p.clinical_metadata->>'template_placeholder' = 'true'
              or (p.value_type = 'numeric' and nullif(btrim(p.unit),'') is null)
              or (p.value_type = 'numeric'
                  and coalesce(jsonb_array_length(p.reference_ranges),0)=0
                  and p.reference_interval_status <> 'not_applicable')
              or (p.result_source = 'calculated' and p.formula is null)
              or (p.value_type = 'choice' and coalesce(jsonb_array_length(p.choices),0)=0)
         )
    into v_parameter_count,v_bad_count
    from public.master_catalog_parameters p
   where p.master_test_id=p_master_test_id;

  if v_parameter_count=0 then raise exception 'This master test has no structured parameters'; end if;
  if v_bad_count>0 then
    raise exception 'This master test is not ready: parameter review, units, ranges, formulas or choices are incomplete';
  end if;
  if v_test.test_kind='group'
     and coalesce(jsonb_array_length(v_test.definition->'components'),0)=0 then
    raise exception 'Master group has no component definitions';
  end if;

  v_test_id := public.import_master_catalog_test_unchecked(p_tenant_id,p_master_test_id);
  update public.tests_catalog set is_active=false
   where id=v_test_id and tenant_id=p_tenant_id;
  return v_test_id;
end;
$function$;

revoke all on function public.import_master_catalog_test(uuid,uuid) from public, anon;
grant execute on function public.import_master_catalog_test(uuid,uuid) to authenticated;

create or replace function private.guard_master_import_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_count integer;
  v_invalid integer;
begin
  if tg_op <> 'UPDATE' or old.is_active is true or new.is_active is not true then
    return new;
  end if;

  if not exists (
    select 1 from public.tenant_catalog_master_links l
     where l.tenant_id=new.tenant_id and l.test_id=new.id
  ) then return new; end if;

  if nullif(btrim(new.method),'') is null or nullif(btrim(new.specimen),'') is null then
    raise exception 'لا يمكن اعتماد التحليل: طريقة القياس والعينة غير مكتملتين';
  end if;

  select count(*),
         count(*) filter (
           where (p.value_type='numeric' and nullif(btrim(p.unit),'') is null)
              or (p.value_type='numeric'
                  and coalesce(jsonb_array_length(p.reference_ranges),0)=0
                  and p.reference_interval_status <> 'not_applicable')
              or (p.result_source='calculated' and p.formula is null)
              or (p.value_type='choice' and coalesce(jsonb_array_length(p.choices),0)=0)
              or p.clinical_review_status <> 'verified'
              or p.clinical_metadata->>'template_placeholder'='true'
         )
    into v_count,v_invalid
    from public.test_parameters p
   where p.tenant_id=new.tenant_id and p.test_id=new.id and p.is_active=true;

  if v_count=0 then raise exception 'لا يمكن اعتماد التحليل: لا توجد بارامترات نشطة'; end if;
  if v_invalid>0 then
    raise exception 'لا يمكن تشغيل التحليل قبل اكتمال الوحدات والرينجات والاختيارات والمعادلات ومراجعة البارامترات';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_master_import_activation() from public, anon, authenticated;

commit;
