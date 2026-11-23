-- 103: One-action visit completion for front-desk and laboratory staff.
-- Saves remain draft-safe; this RPC validates the whole visit, completes its tests,
-- and approves the visit in one database transaction. No per-test completion clicks.
begin;

create or replace function public.approve_visit_with_auto_completion(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid,
  p_staff_id uuid
)
returns public.visits
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_visit public.visits%rowtype;
  v_total integer;
  v_missing text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then
    raise exception 'Branch access denied' using errcode='42501';
  end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active
  ) then
    raise exception 'An active staff identity for this branch is required';
  end if;

  select * into v_visit
    from public.visits
   where id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id
   for update;
  if not found then raise exception 'Visit not found for this tenant and branch'; end if;
  if v_visit.is_published then raise exception 'Published visit cannot be re-approved'; end if;
  if v_visit.status='approved' then raise exception 'Visit is already approved'; end if;
  if v_visit.status='cancelled' then raise exception 'Cancelled visit cannot be approved'; end if;

  select count(*) into v_total
    from public.visit_tests
   where tenant_id=p_tenant_id and branch_id=p_branch_id
     and visit_id=p_visit_id and status<>'cancelled';
  if v_total=0 then raise exception 'لا توجد تحاليل فعالة لاعتمادها في هذه الزيارة.'; end if;

  -- Match the existing conditional-field behavior before checking completeness.
  delete from public.test_results tr
   using public.visit_tests vt,
         jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters','[]'::jsonb)) p
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id
     and vt.visit_id=p_visit_id and vt.status<>'cancelled'
     and tr.tenant_id=p_tenant_id and tr.visit_test_id=vt.id
     and tr.parameter_code=p->>'code'
     and not private.result_parameter_is_visible(
       p_tenant_id,vt.id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb
     );

  delete from public.test_results tr
   using public.visit_tests vt,
         jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters','[]'::jsonb)) p
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id
     and vt.visit_id=p_visit_id and vt.status<>'cancelled'
     and tr.tenant_id=p_tenant_id and tr.visit_test_id=vt.id
     and tr.parameter_code=p->>'code'
     and not private.result_parameter_value_matches_display_rules(
       p_tenant_id,vt.id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb,
       tr.value_numeric,tr.value_text
     );

  select string_agg(
           coalesce(vt.test_name_snapshot,'تحليل') || ' — ' ||
           coalesce(p->>'name',p->>'parameter_name',p->>'code','بارامتر'),
           '، ' order by vt.test_name_snapshot,p->>'code'
         )
    into v_missing
    from public.visit_tests vt
    cross join lateral jsonb_array_elements(coalesce(vt.technical_snapshot->'parameters','[]'::jsonb)) p
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id
     and vt.visit_id=p_visit_id and vt.status<>'cancelled'
     and coalesce((p->>'is_required')::boolean,true)
     and not (
       coalesce(p->>'result_source','manual')='calculated'
       and nullif(p->'formula','null'::jsonb) is null
     )
     and private.result_parameter_is_visible(
       p_tenant_id,vt.id,coalesce(p->'display_rules','[]'::jsonb),'[]'::jsonb
     )
     and not exists (
       select 1 from public.test_results tr
        where tr.tenant_id=p_tenant_id and tr.visit_test_id=vt.id
          and tr.parameter_code=p->>'code'
          and (tr.value_numeric is not null or nullif(btrim(tr.value_text),'') is not null)
     );

  if v_missing is not null then
    raise exception 'نتائج مطلوبة لم تُسجل بعد: %',v_missing using errcode='23514';
  end if;

  -- Complete all eligible tests and approve the visit atomically.
  perform set_config('app.atomic_result_transition','on',true);
  update public.visit_tests
     set status='completed',
         completed_by_staff_id=coalesce(completed_by_staff_id,p_staff_id),
         completed_at=coalesce(completed_at,now())
   where tenant_id=p_tenant_id and branch_id=p_branch_id
     and visit_id=p_visit_id and status not in ('completed','cancelled');

  update public.visits
     set status='approved',
         approved_by_staff_id=p_staff_id,
         approved_at=now()
   where id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id
   returning * into v_visit;

  return v_visit;
end;
$function$;

revoke all on function public.approve_visit_with_auto_completion(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.approve_visit_with_auto_completion(uuid,uuid,uuid,uuid) to authenticated;

comment on function public.approve_visit_with_auto_completion(uuid,uuid,uuid,uuid) is
  'One-action, atomic completion and approval for a visit after validating all required visible results. Replaces the staff-facing sequence of completing every test separately.';
commit;