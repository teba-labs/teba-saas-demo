-- Keep the catalog import RPC invoker-secure. The underlying routine is safe for
-- authenticated callers because it independently verifies auth.uid() and tenant ownership.
begin;

grant execute on function public.import_master_catalog_test_unchecked(uuid, uuid) to authenticated;

create or replace function public.import_master_catalog_test(
  p_tenant_id uuid,
  p_master_test_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_master public.master_catalog_tests%rowtype;
  v_release public.master_catalog_releases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_tenant_owner(p_tenant_id) then
    raise exception 'Only the tenant owner may import master catalog tests';
  end if;

  select * into v_master
    from public.master_catalog_tests
   where id = p_master_test_id;
  if not found then
    raise exception 'Master catalog test was not found';
  end if;

  select * into v_release
    from public.master_catalog_releases
   where id = v_master.release_id and status = 'published';
  if not found then
    raise exception 'Only tests in a published master release can be imported';
  end if;

  return public.import_master_catalog_test_unchecked(p_tenant_id, p_master_test_id);
end;
$function$;

revoke all on function public.import_master_catalog_test(uuid, uuid) from public, anon;
grant execute on function public.import_master_catalog_test(uuid, uuid) to authenticated;

commit;