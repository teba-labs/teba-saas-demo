-- Visit-specific reference interval overrides. Catalog snapshots remain immutable.
create table if not exists public.visit_test_parameter_range_overrides (
  tenant_id uuid not null,
  branch_id uuid not null,
  visit_test_id uuid not null,
  parameter_code text not null check (length(btrim(parameter_code)) between 1 and 40),
  reference_ranges jsonb not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_by_staff_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,visit_test_id,parameter_code),
  foreign key (tenant_id,visit_test_id) references public.visit_tests(tenant_id,id) on delete restrict,
  foreign key (tenant_id,branch_id) references public.branches(tenant_id,id) on delete restrict,
  foreign key (tenant_id,branch_id,updated_by_staff_id) references public.staff_directory(tenant_id,branch_id,id) on delete restrict,
  check (jsonb_typeof(reference_ranges) in ('array','object'))
);
create index if not exists idx_visit_range_overrides_branch_test
  on public.visit_test_parameter_range_overrides(tenant_id,branch_id,visit_test_id);

create table if not exists public.visit_test_parameter_range_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  visit_test_id uuid not null,
  parameter_code text not null,
  old_reference_ranges jsonb,
  new_reference_ranges jsonb not null,
  reason text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_staff_id uuid not null,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id,visit_test_id) references public.visit_tests(tenant_id,id) on delete restrict,
  foreign key (tenant_id,branch_id) references public.branches(tenant_id,id) on delete restrict,
  foreign key (tenant_id,branch_id,actor_staff_id) references public.staff_directory(tenant_id,branch_id,id) on delete restrict
);
create index if not exists idx_visit_range_events_test_parameter
  on public.visit_test_parameter_range_events(tenant_id,branch_id,visit_test_id,parameter_code,occurred_at desc);
create index if not exists idx_visit_range_events_actor_staff
  on public.visit_test_parameter_range_events(tenant_id,branch_id,actor_staff_id);
create index if not exists idx_visit_range_events_actor_user
  on public.visit_test_parameter_range_events(actor_user_id);

alter table public.visit_test_parameter_range_overrides enable row level security;
alter table public.visit_test_parameter_range_events enable row level security;
grant select on public.visit_test_parameter_range_overrides, public.visit_test_parameter_range_events to authenticated;

drop policy if exists visit_range_overrides_branch_read on public.visit_test_parameter_range_overrides;
create policy visit_range_overrides_branch_read on public.visit_test_parameter_range_overrides
 for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
drop policy if exists visit_range_overrides_branch_insert on public.visit_test_parameter_range_overrides;
create policy visit_range_overrides_branch_insert on public.visit_test_parameter_range_overrides
 for insert to authenticated with check (
   private.can_access_branch(tenant_id,branch_id)
   and updated_by=(select auth.uid())
   and exists(select 1 from public.staff_directory sd where sd.id=updated_by_staff_id
     and sd.tenant_id=visit_test_parameter_range_overrides.tenant_id
     and sd.branch_id=visit_test_parameter_range_overrides.branch_id and sd.is_active
     and (private.is_tenant_owner(visit_test_parameter_range_overrides.tenant_id) or sd.auth_user_id=(select auth.uid())))
 );
drop policy if exists visit_range_overrides_branch_update on public.visit_test_parameter_range_overrides;
create policy visit_range_overrides_branch_update on public.visit_test_parameter_range_overrides
 for update to authenticated using (private.can_access_branch(tenant_id,branch_id))
 with check (
   private.can_access_branch(tenant_id,branch_id)
   and updated_by=(select auth.uid())
   and exists(select 1 from public.staff_directory sd where sd.id=updated_by_staff_id
     and sd.tenant_id=visit_test_parameter_range_overrides.tenant_id
     and sd.branch_id=visit_test_parameter_range_overrides.branch_id and sd.is_active
     and (private.is_tenant_owner(visit_test_parameter_range_overrides.tenant_id) or sd.auth_user_id=(select auth.uid())))
 );

drop policy if exists visit_range_events_branch_read on public.visit_test_parameter_range_events;
create policy visit_range_events_branch_read on public.visit_test_parameter_range_events
 for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
drop policy if exists visit_range_events_branch_insert on public.visit_test_parameter_range_events;
create policy visit_range_events_branch_insert on public.visit_test_parameter_range_events
 for insert to authenticated with check (
   private.can_access_branch(tenant_id,branch_id)
   and actor_user_id=(select auth.uid())
   and exists(select 1 from public.staff_directory sd where sd.id=actor_staff_id
     and sd.tenant_id=visit_test_parameter_range_events.tenant_id
     and sd.branch_id=visit_test_parameter_range_events.branch_id and sd.is_active
     and (private.is_tenant_owner(visit_test_parameter_range_events.tenant_id) or sd.auth_user_id=(select auth.uid())))
 );

-- Result snapshots use the visit-specific override when one exists; catalog values stay untouched.
create or replace function private.validate_result_parameter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_snapshot jsonb;
  v_branch uuid;
  v_parameter jsonb;
  v_override jsonb;
  v_value_type text;
  v_choices jsonb;
begin
  select technical_snapshot, branch_id into v_snapshot, v_branch
    from public.visit_tests
   where id = new.visit_test_id and tenant_id = new.tenant_id;
  if not found then raise exception 'Visit test was not found for this tenant'; end if;

  if new.entered_by_staff_id is not null and not exists (
    select 1 from public.staff_directory sd
     where sd.id = new.entered_by_staff_id and sd.tenant_id = new.tenant_id
       and sd.branch_id = v_branch and sd.is_active
  ) then raise exception 'Selected staff name does not belong to this branch'; end if;

  select p into v_parameter
    from jsonb_array_elements(coalesce(v_snapshot->'parameters', '[]'::jsonb)) p
   where p->>'code' = new.parameter_code limit 1;
  if v_parameter is null then raise exception 'Result parameter is not part of the visit test snapshot'; end if;

  select o.reference_ranges into v_override
    from public.visit_test_parameter_range_overrides o
   where o.tenant_id=new.tenant_id and o.branch_id=v_branch
     and o.visit_test_id=new.visit_test_id and o.parameter_code=new.parameter_code;

  new.parameter_name_snapshot := v_parameter->>'name';
  new.unit_snapshot := v_parameter->>'unit';
  new.reference_range_snapshot := coalesce(v_override, v_parameter->'reference_ranges', '[]'::jsonb);

  v_value_type := coalesce(v_parameter->>'value_type', 'numeric');
  if v_value_type not in ('numeric', 'text', 'boolean', 'choice') then raise exception 'Unsupported value type in visit test snapshot'; end if;
  if v_value_type = 'numeric' then
    if new.value_numeric is null or new.value_text is not null
       or new.value_numeric::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'A numeric parameter requires one finite numeric result';
    end if;
  else
    if new.value_text is null or new.value_numeric is not null then raise exception 'A text, boolean or choice parameter requires only a text result'; end if;
    new.value_text := btrim(new.value_text);
    if new.value_text = '' then raise exception 'A text result cannot be empty'; end if;
  end if;
  if v_value_type = 'boolean' and new.value_text not in ('true', 'false') then raise exception 'A boolean result must be true or false'; end if;
  if v_value_type = 'choice' then
    v_choices := v_parameter->'choices';
    if jsonb_typeof(v_choices) is distinct from 'array' then raise exception 'Choice parameter snapshot must contain a choices array'; end if;
    if not exists(select 1 from jsonb_array_elements_text(v_choices) as choice(value) where choice.value=new.value_text) then
      raise exception 'Result value is not one of the allowed parameter choices';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.set_visit_parameter_range_override(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_parameter_code text,
  p_reference_ranges jsonb,
  p_staff_id uuid,
  p_reason text
) returns public.visit_test_parameter_range_overrides
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $function$
declare
  v_visit public.visits;
  v_test public.visit_tests;
  v_parameter jsonb;
  v_old jsonb;
  v_result public.visit_test_parameter_range_overrides;
  v_account_type text;
  v_expected_staff uuid;
  v_reason text := nullif(left(btrim(coalesce(p_reason,'')),500),'');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  if jsonb_typeof(p_reference_ranges) not in ('array','object') or p_reference_ranges='[]'::jsonb then
    raise exception 'A non-empty reference interval is required';
  end if;
  if v_reason is null or length(v_reason)<3 then raise exception 'A correction reason is required'; end if;

  select tm.account_type into v_account_type from public.tenant_memberships tm
   where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid() and tm.is_active;
  if v_account_type is null then raise exception 'Active tenant membership required'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd
    where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then
    raise exception 'An active staff identity for this branch is required';
  end if;
  if v_account_type='employee' then
    select sd.id into v_expected_staff from public.staff_directory sd
     where sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.auth_user_id=auth.uid() and sd.is_active;
    if v_expected_staff is distinct from p_staff_id then raise exception 'Employee accounts may only act as their own linked active staff identity'; end if;
  elsif v_account_type<>'owner' then raise exception 'Owner or branch employee access required';
  end if;

  select vt.* into v_test from public.visit_tests vt
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and vt.id=p_visit_test_id
   for update;
  if not found then raise exception 'Visit test not found for this tenant and branch'; end if;
  if v_test.status='cancelled' then raise exception 'Cancelled tests cannot have their reference ranges changed'; end if;
  select v.* into v_visit from public.visits v
   where v.tenant_id=p_tenant_id and v.branch_id=p_branch_id and v.id=v_test.visit_id
   for update;
  if not found or v_visit.status in ('approved','published','cancelled') or v_visit.is_published then
    raise exception 'Approved or published visits cannot have their reference ranges changed';
  end if;

  select p into v_parameter from jsonb_array_elements(coalesce(v_test.technical_snapshot->'parameters','[]'::jsonb)) p
   where p->>'code'=p_parameter_code limit 1;
  if v_parameter is null then raise exception 'Parameter is not part of this visit test snapshot'; end if;

  select o.reference_ranges into v_old from public.visit_test_parameter_range_overrides o
   where o.tenant_id=p_tenant_id and o.visit_test_id=p_visit_test_id and o.parameter_code=p_parameter_code;
  if v_old is null then v_old:=coalesce(v_parameter->'reference_ranges','[]'::jsonb); end if;

  insert into public.visit_test_parameter_range_overrides
    (tenant_id,branch_id,visit_test_id,parameter_code,reference_ranges,reason,updated_by,updated_by_staff_id)
  values(p_tenant_id,p_branch_id,p_visit_test_id,p_parameter_code,p_reference_ranges,v_reason,auth.uid(),p_staff_id)
  on conflict(tenant_id,visit_test_id,parameter_code) do update set
    reference_ranges=excluded.reference_ranges,reason=excluded.reason,
    updated_by=excluded.updated_by,updated_by_staff_id=excluded.updated_by_staff_id,updated_at=now()
  returning * into v_result;

  insert into public.visit_test_parameter_range_events
    (tenant_id,branch_id,visit_test_id,parameter_code,old_reference_ranges,new_reference_ranges,reason,actor_user_id,actor_staff_id)
  values(p_tenant_id,p_branch_id,p_visit_test_id,p_parameter_code,v_old,p_reference_ranges,v_reason,auth.uid(),p_staff_id);

  update public.test_results set updated_at=now()
   where tenant_id=p_tenant_id and visit_test_id=p_visit_test_id and parameter_code=p_parameter_code;
  return v_result;
end;
$function$;

revoke all on function public.set_visit_parameter_range_override(uuid,uuid,uuid,text,jsonb,uuid,text) from public, anon;
grant execute on function public.set_visit_parameter_range_override(uuid,uuid,uuid,text,jsonb,uuid,text) to authenticated;
