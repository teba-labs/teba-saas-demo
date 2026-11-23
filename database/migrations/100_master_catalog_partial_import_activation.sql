-- Allow a tenant owner to import and activate a published master definition
-- even when optional clinical metadata is not yet available. Missing fields remain NULL/empty.
-- Importability/operational approval is separate from central clinical verification.
begin;

create or replace function private.guard_master_import_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if tg_op <> 'UPDATE' or old.is_active is true or new.is_active is not true then
    return new;
  end if;

  if not exists (
    select 1 from public.tenant_catalog_master_links l
     where l.tenant_id = new.tenant_id and l.test_id = new.id
  ) then
    return new;
  end if;

  -- Do not block operational activation for absent method, specimen, units, ranges,
  -- choices, or clinical-review metadata. These remain visibly incomplete and editable.
  -- Result screens/report rendering must omit absent ranges and must not infer H/L flags.
  return new;
end;
$function$;

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
  v_master public.master_catalog_tests%rowtype;
  v_release public.master_catalog_releases%rowtype;
  v_test_id uuid;
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

  -- The unchecked routine performs the tenant ownership, duplicate and snapshot work.
  -- It is intentionally not directly executable by authenticated clients.
  v_test_id := public.import_master_catalog_test_unchecked(p_tenant_id, p_master_test_id);
  return v_test_id;
end;
$function$;

revoke all on function public.import_master_catalog_test(uuid, uuid) from public, anon;
grant execute on function public.import_master_catalog_test(uuid, uuid) to authenticated;

comment on function public.import_master_catalog_test(uuid, uuid) is
  'Owner-only import of a published master definition. Missing clinical metadata never blocks import; missing fields remain blank for later local completion.';

comment on function private.guard_master_import_activation() is
  'Allows tenant owners to activate imported master tests with partial metadata. No missing clinical field is fabricated or treated as a blocker.';

commit;