-- Prevent importing any master item until both its definition and all result parameters have been clinically verified.
create or replace function private.guard_tenant_master_catalog_link()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_test_status text;
  v_parameter_count integer;
  v_unverified_count integer;
begin
  select clinical_review_status into v_test_status
    from public.master_catalog_tests where id=new.master_test_id;
  if v_test_status is distinct from 'verified' then
    raise exception 'Master catalog test must be clinically verified before tenant import';
  end if;

  select count(*),count(*) filter (where clinical_review_status<>'verified')
    into v_parameter_count,v_unverified_count
    from public.master_catalog_parameters where master_test_id=new.master_test_id;
  if v_parameter_count=0 then raise exception 'Master catalog test has no result parameters'; end if;
  if v_unverified_count>0 then raise exception 'All master result parameters must be clinically verified before tenant import'; end if;
  return new;
end;
$function$;

revoke all on function private.guard_tenant_master_catalog_link() from public,anon,authenticated;
drop trigger if exists guard_tenant_master_catalog_link on public.tenant_catalog_master_links;
create trigger guard_tenant_master_catalog_link
before insert or update of master_test_id on public.tenant_catalog_master_links
for each row execute function private.guard_tenant_master_catalog_link();
