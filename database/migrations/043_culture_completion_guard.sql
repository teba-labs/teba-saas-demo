-- Do not allow a culture profile to be completed with a positive growth summary but no organism isolate.
create or replace function private.guard_culture_test_completion()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $function$
declare v_growth text; v_has_isolate boolean;
begin
 if new.status='completed' and old.status is distinct from 'completed'
   and new.test_code_snapshot in ('CULTURE_URINE','CULTURE_STOOL') then
  select value_text into v_growth from public.test_results
   where tenant_id=new.tenant_id and visit_test_id=new.id
    and parameter_code in ('CU_GROWTH','CS_GROWTH');
  if v_growth is null then raise exception 'Enter the culture growth status before completing this culture profile'; end if;
  select exists(select 1 from public.visit_test_culture_isolates
   where tenant_id=new.tenant_id and branch_id=new.branch_id and visit_test_id=new.id)
   into v_has_isolate;
  if v_growth in ('Growth','Pathogen isolated') and not v_has_isolate then
   raise exception 'Add at least one identified isolate before completing a positive culture';
  end if;
 end if;
 return new;
end;
$function$;
revoke all on function private.guard_culture_test_completion() from public,anon,authenticated;
drop trigger if exists guard_culture_test_completion on public.visit_tests;
create trigger guard_culture_test_completion
before update of status on public.visit_tests
for each row execute function private.guard_culture_test_completion();
