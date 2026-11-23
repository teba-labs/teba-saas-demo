-- 087: Gate tenant imports on a complete, clinically reviewed central definition.
-- Preserve the original import implementation behind a non-executable internal name.
begin;

alter function public.import_master_catalog_test(uuid,uuid)
  rename to import_master_catalog_test_unchecked;

revoke all on function public.import_master_catalog_test_unchecked(uuid,uuid) from public, anon, authenticated;

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

  select * into v_test
    from public.master_catalog_tests
   where id = p_master_test_id;
  if not found then
    raise exception 'Master catalog test was not found';
  end if;

  select * into v_release
    from public.master_catalog_releases
   where id = v_test.release_id
     and status = 'published';
  if not found then
    raise exception 'Only published master catalog tests can be imported';
  end if;

  if v_test.clinical_review_status <> 'verified' then
    raise exception 'This master definition has not passed central clinical review';
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
         )
    into v_parameter_count, v_bad_count
    from public.master_catalog_parameters p
   where p.master_test_id = p_master_test_id;

  if v_parameter_count = 0 then
    raise exception 'This master test has no structured parameters';
  end if;
  if v_bad_count > 0 then
    raise exception 'This master test is not ready: parameters, units, reference intervals, formulas or clinical review are incomplete';
  end if;

  if v_test.test_kind = 'group'
     and coalesce(jsonb_array_length(v_test.definition->'components'),0)=0 then
    raise exception 'Master group has no component definitions';
  end if;

  v_test_id := public.import_master_catalog_test_unchecked(p_tenant_id,p_master_test_id);

  -- Imported definitions are lab-owned copies but remain out of Reception until
  -- the owner explicitly confirms local price and activates the test.
  update public.tests_catalog
     set is_active = false
   where id = v_test_id
     and tenant_id = p_tenant_id;

  return v_test_id;
end;
$function$;

revoke all on function public.import_master_catalog_test(uuid,uuid) from public, anon;
grant execute on function public.import_master_catalog_test(uuid,uuid) to authenticated;

comment on function public.import_master_catalog_test(uuid,uuid) is
  'Imports only centrally verified, structurally complete master definitions. Tenant copy is inactive until owner activation.';

commit;
