-- Allow tenant owners to import any published master definition that has a parameter set.
-- Clinical review status is copied unchanged; importability is not clinical approval.
create or replace function private.guard_tenant_master_catalog_link()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_parameter_count integer;
begin
  if not exists (
    select 1 from public.master_catalog_tests
    where id = new.master_test_id
  ) then
    raise exception 'Master catalog test was not found';
  end if;

  select count(*) into v_parameter_count
    from public.master_catalog_parameters
   where master_test_id = new.master_test_id;

  if v_parameter_count = 0 then
    raise exception 'Master catalog test has no result parameters';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_tenant_master_catalog_link() from public, anon, authenticated;
