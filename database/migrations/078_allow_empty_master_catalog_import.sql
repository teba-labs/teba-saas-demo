-- Allow importing published master catalog definitions even when parameters are not yet structured.
-- Importability is a workflow permission, not clinical approval. Empty/incomplete definitions
-- remain marked with their existing review status and must be completed locally before use.
create or replace function private.guard_tenant_master_catalog_link()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
begin
  if not exists (
    select 1
      from public.master_catalog_tests
     where id = new.master_test_id
  ) then
    raise exception 'Master catalog test was not found';
  end if;

  -- Zero parameters are allowed so the tenant owner can add a local parameter set.
  -- Clinical review status is deliberately not promoted or changed by this import.
  return new;
end;
$function$;

revoke all on function private.guard_tenant_master_catalog_link() from public, anon, authenticated;
