-- 088: Prevent incomplete imported master definitions from being activated in Reception.
begin;

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
     where l.tenant_id = new.tenant_id
       and l.test_id = new.id
  ) then
    return new;
  end if;

  select count(*),
         count(*) filter (
           where (p.value_type = 'numeric' and nullif(btrim(p.unit),'') is null)
              or (p.value_type = 'numeric'
                  and coalesce(jsonb_array_length(p.reference_ranges),0)=0
                  and p.reference_interval_status <> 'not_applicable')
              or (p.result_source = 'calculated' and p.formula is null)
              or (p.value_type = 'choice' and coalesce(jsonb_array_length(p.choices),0)=0)
              or p.clinical_review_status <> 'verified'
              or p.clinical_metadata->>'template_placeholder' = 'true'
         )
    into v_count, v_invalid
    from public.test_parameters p
   where p.tenant_id = new.tenant_id
     and p.test_id = new.id
     and p.is_active = true;

  if v_count = 0 then
    raise exception 'لا يمكن اعتماد التحليل: لا توجد بارامترات نشطة';
  end if;
  if v_invalid > 0 then
    raise exception 'لا يمكن تشغيل التحليل قبل اكتمال الوحدات والرينجات والاختيارات والمعادلات ومراجعة البارامترات';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_master_import_activation() from public, anon, authenticated;

drop trigger if exists guard_master_import_activation on public.tests_catalog;
create trigger guard_master_import_activation
before update of is_active on public.tests_catalog
for each row
execute function private.guard_master_import_activation();

commit;
