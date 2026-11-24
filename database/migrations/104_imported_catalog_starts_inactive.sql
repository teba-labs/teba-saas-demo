-- 104: Keep newly imported master definitions inactive until a lab explicitly approves them.
-- Existing imports are left untouched; this changes only first-time imports.
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
  v_existing uuid;
  v_test_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_tenant_owner(p_tenant_id) then
    raise exception 'Only the tenant owner may import master catalog tests';
  end if;

  select test_id into v_existing
    from public.tenant_catalog_master_links
   where tenant_id = p_tenant_id
     and master_test_id = p_master_test_id;

  v_test_id := public.import_master_catalog_test_unchecked(p_tenant_id, p_master_test_id);

  -- The underlying importer creates a copy with is_active=true.
  -- Deactivate only a newly-created tenant copy so the operator can review it
  -- and explicitly activate it with the dedicated catalog action.
  if v_existing is null then
    update public.tests_catalog
       set is_active = false
     where tenant_id = p_tenant_id
       and id = v_test_id;
  end if;

  return v_test_id;
end;
$function$;

revoke all on function public.import_master_catalog_test(uuid, uuid) from public, anon;
grant execute on function public.import_master_catalog_test(uuid, uuid) to authenticated;

comment on function public.import_master_catalog_test(uuid, uuid) is
  'Owner-only import of a published master definition. New tenant copies start inactive until explicit local activation; existing imported copies are returned unchanged.';

commit;
