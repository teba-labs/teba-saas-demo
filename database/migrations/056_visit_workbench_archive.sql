-- Safe hide/restore for a visit in the results workbench. Medical data is never deleted.
alter table public.visits
  add column if not exists workbench_hidden_at timestamptz,
  add column if not exists workbench_hidden_by uuid references auth.users(id) on delete set null,
  add column if not exists workbench_hidden_by_staff_id uuid,
  add column if not exists workbench_hidden_reason text,
  add column if not exists workbench_restored_at timestamptz,
  add column if not exists workbench_restored_by uuid references auth.users(id) on delete set null,
  add column if not exists workbench_restored_by_staff_id uuid;

create index if not exists idx_visits_workbench_visible
  on public.visits(tenant_id, branch_id, visit_work_date desc)
  where workbench_hidden_at is null;

create table if not exists public.visit_workbench_archive_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  visit_id uuid not null,
  action text not null check (action in ('hidden','restored')),
  reason text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_staff_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id, visit_id)
    references public.visits(tenant_id, branch_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, actor_staff_id)
    references public.staff_directory(tenant_id, branch_id, id) on delete restrict
);
create index if not exists idx_visit_workbench_archive_events_visit
  on public.visit_workbench_archive_events(tenant_id, branch_id, visit_id, occurred_at desc);

alter table public.visit_workbench_archive_events enable row level security;
grant select on public.visit_workbench_archive_events to authenticated;
drop policy if exists visit_workbench_archive_events_branch_read on public.visit_workbench_archive_events;
create policy visit_workbench_archive_events_branch_read
  on public.visit_workbench_archive_events for select to authenticated
  using (private.can_access_branch(tenant_id, branch_id));

create or replace function public.set_visit_workbench_hidden(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid,
  p_staff_id uuid,
  p_hidden boolean,
  p_reason text default null
) returns public.visits
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_visit public.visits;
  v_account_type text;
  v_expected_staff uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  select tm.account_type into v_account_type
    from public.tenant_memberships tm
   where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type is null then raise exception 'Active tenant membership required'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
     where sd.id=p_staff_id and sd.tenant_id=p_tenant_id
       and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'An active staff identity for this branch is required'; end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd
     where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id
       and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then
      raise exception 'Employee accounts may only act as their own linked staff identity';
    end if;
  elsif v_account_type<>'owner' then
    raise exception 'Owner or branch employee access required';
  end if;

  if p_hidden then
    update public.visits
       set workbench_hidden_at=now(), workbench_hidden_by=auth.uid(),
           workbench_hidden_by_staff_id=p_staff_id,
           workbench_hidden_reason=nullif(left(btrim(coalesce(p_reason,'')),500),'')
     where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id
     returning * into v_visit;
  else
    update public.visits
       set workbench_hidden_at=null, workbench_hidden_by=null,
           workbench_hidden_by_staff_id=null, workbench_hidden_reason=null,
           workbench_restored_at=now(), workbench_restored_by=auth.uid(),
           workbench_restored_by_staff_id=p_staff_id
     where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_visit_id
     returning * into v_visit;
  end if;
  if not found then raise exception 'Visit not found for this tenant and branch'; end if;

  insert into public.visit_workbench_archive_events
    (tenant_id,branch_id,visit_id,action,reason,actor_user_id,actor_staff_id)
  values (p_tenant_id,p_branch_id,p_visit_id,case when p_hidden then 'hidden' else 'restored' end,
    nullif(left(btrim(coalesce(p_reason,'')),500),''),auth.uid(),p_staff_id);
  return v_visit;
end;
$function$;

revoke all on function public.set_visit_workbench_hidden(uuid,uuid,uuid,uuid,boolean,text) from public, anon;
grant execute on function public.set_visit_workbench_hidden(uuid,uuid,uuid,uuid,boolean,text) to authenticated;
