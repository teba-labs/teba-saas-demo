-- Repeatable organism/isolate and antimicrobial susceptibility capture for culture profiles.
create table if not exists public.visit_test_culture_isolates (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 branch_id uuid not null,
 visit_test_id uuid not null,
 isolate_number smallint not null check (isolate_number between 1 and 20),
 organism_name text not null check (length(btrim(organism_name)) between 2 and 200),
 growth_description text,
 colony_count numeric(16,2) check (colony_count is null or colony_count>=0),
 colony_count_unit text not null default 'CFU/mL',
 identification_method text,
 notes text,
 created_by_staff_id uuid not null,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (visit_test_id,isolate_number),
 unique (tenant_id,branch_id,id),
 foreign key (tenant_id,branch_id) references public.branches(tenant_id,id) on delete restrict,
 foreign key (tenant_id,visit_test_id) references public.visit_tests(tenant_id,id) on delete cascade,
 foreign key (tenant_id,branch_id,created_by_staff_id) references public.staff_directory(tenant_id,branch_id,id) on delete restrict
);

create table if not exists public.visit_test_culture_susceptibility (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 branch_id uuid not null,
 isolate_id uuid not null,
 antimicrobial_agent text not null check (length(btrim(antimicrobial_agent)) between 2 and 120),
 test_method text not null check (test_method in ('disk_diffusion','mic','automated','gradient_diffusion','other')),
 measured_value numeric(14,4),
 measured_unit text,
 interpretation text not null check (interpretation in ('S','I','R','SDD','IE','NA','not_interpreted')),
 breakpoint_standard text not null check (breakpoint_standard in ('CLSI','EUCAST','other')),
 breakpoint_edition text not null check (length(btrim(breakpoint_edition)) between 2 and 80),
 breakpoint_table text,
 breakpoint_source_url text,
 qc_status text not null default 'not_documented' check (qc_status in ('passed','failed','not_documented')),
 notes text,
 entered_by_staff_id uuid not null,
 entered_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (isolate_id,antimicrobial_agent),
 foreign key (tenant_id,branch_id,isolate_id)
   references public.visit_test_culture_isolates(tenant_id,branch_id,id) on delete cascade,
 foreign key (tenant_id,branch_id,entered_by_staff_id)
   references public.staff_directory(tenant_id,branch_id,id) on delete restrict,
 check ((measured_value is null and measured_unit is null) or (measured_value is not null and measured_unit is not null))
);

create index if not exists idx_culture_isolates_visit_test on public.visit_test_culture_isolates(tenant_id,branch_id,visit_test_id,isolate_number);
create index if not exists idx_culture_ast_isolate on public.visit_test_culture_susceptibility(tenant_id,branch_id,isolate_id);

alter table public.visit_test_culture_isolates enable row level security;
alter table public.visit_test_culture_susceptibility enable row level security;

revoke all on public.visit_test_culture_isolates,public.visit_test_culture_susceptibility from anon,authenticated;
grant select,insert,update on public.visit_test_culture_isolates,public.visit_test_culture_susceptibility to authenticated;

drop policy if exists culture_isolates_branch_read on public.visit_test_culture_isolates;
create policy culture_isolates_branch_read on public.visit_test_culture_isolates
 for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
drop policy if exists culture_isolates_branch_insert on public.visit_test_culture_isolates;
create policy culture_isolates_branch_insert on public.visit_test_culture_isolates
 for insert to authenticated with check (
  private.can_access_branch(tenant_id,branch_id)
  and exists(select 1 from public.staff_directory s where s.id=created_by_staff_id and s.tenant_id=tenant_id and s.branch_id=branch_id and s.is_active and (s.auth_user_id=auth.uid() or private.is_tenant_owner(tenant_id)))
 );
drop policy if exists culture_isolates_branch_update on public.visit_test_culture_isolates;
create policy culture_isolates_branch_update on public.visit_test_culture_isolates
 for update to authenticated using (private.can_access_branch(tenant_id,branch_id))
 with check (
  private.can_access_branch(tenant_id,branch_id)
  and exists(select 1 from public.staff_directory s where s.id=created_by_staff_id and s.tenant_id=tenant_id and s.branch_id=branch_id and s.is_active and (s.auth_user_id=auth.uid() or private.is_tenant_owner(tenant_id)))
 );

drop policy if exists culture_ast_branch_read on public.visit_test_culture_susceptibility;
create policy culture_ast_branch_read on public.visit_test_culture_susceptibility
 for select to authenticated using (private.can_access_branch(tenant_id,branch_id));
drop policy if exists culture_ast_branch_insert on public.visit_test_culture_susceptibility;
create policy culture_ast_branch_insert on public.visit_test_culture_susceptibility
 for insert to authenticated with check (
  private.can_access_branch(tenant_id,branch_id)
  and exists(select 1 from public.staff_directory s where s.id=entered_by_staff_id and s.tenant_id=tenant_id and s.branch_id=branch_id and s.is_active and (s.auth_user_id=auth.uid() or private.is_tenant_owner(tenant_id)))
 );
drop policy if exists culture_ast_branch_update on public.visit_test_culture_susceptibility;
create policy culture_ast_branch_update on public.visit_test_culture_susceptibility
 for update to authenticated using (private.can_access_branch(tenant_id,branch_id))
 with check (
  private.can_access_branch(tenant_id,branch_id)
  and exists(select 1 from public.staff_directory s where s.id=entered_by_staff_id and s.tenant_id=tenant_id and s.branch_id=branch_id and s.is_active and (s.auth_user_id=auth.uid() or private.is_tenant_owner(tenant_id)))
 );

create or replace function private.guard_culture_result_write()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $function$
declare v_test_code text; v_test_status text; v_visit_status text; v_published boolean;
begin
 select vt.test_code_snapshot,vt.status,v.status,v.is_published
 into v_test_code,v_test_status,v_visit_status,v_published
 from public.visit_tests vt join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id and v.branch_id=vt.branch_id
 where vt.id=new.visit_test_id and vt.tenant_id=new.tenant_id and vt.branch_id=new.branch_id;
 if v_test_code not in ('CULTURE_URINE','CULTURE_STOOL') then raise exception 'Culture results can only be saved for a culture profile'; end if;
 if v_test_status in ('completed','cancelled') or v_visit_status in ('cancelled','closed') or coalesce(v_published,false) then
  raise exception 'Culture results cannot be changed after test completion or report publication';
 end if;
 if not private.can_access_branch(new.tenant_id,new.branch_id) then raise exception 'Branch access denied'; end if;
 return new;
end;
$function$;
revoke all on function private.guard_culture_result_write() from public,anon,authenticated;
drop trigger if exists guard_culture_isolate_write on public.visit_test_culture_isolates;
create trigger guard_culture_isolate_write before insert or update on public.visit_test_culture_isolates
 for each row execute function private.guard_culture_result_write();

create or replace function private.guard_culture_ast_write()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $function$
declare v_test_code text; v_test_status text; v_visit_status text; v_published boolean;
begin
 select vt.test_code_snapshot,vt.status,v.status,v.is_published
 into v_test_code,v_test_status,v_visit_status,v_published
 from public.visit_test_culture_isolates ci
 join public.visit_tests vt on vt.id=ci.visit_test_id and vt.tenant_id=ci.tenant_id and vt.branch_id=ci.branch_id
 join public.visits v on v.id=vt.visit_id and v.tenant_id=vt.tenant_id and v.branch_id=vt.branch_id
 where ci.id=new.isolate_id and ci.tenant_id=new.tenant_id and ci.branch_id=new.branch_id;
 if v_test_code not in ('CULTURE_URINE','CULTURE_STOOL') then raise exception 'AST can only be saved for a culture profile'; end if;
 if v_test_status in ('completed','cancelled') or v_visit_status in ('cancelled','closed') or coalesce(v_published,false) then
  raise exception 'AST cannot be changed after test completion or report publication';
 end if;
 if not private.can_access_branch(new.tenant_id,new.branch_id) then raise exception 'Branch access denied'; end if;
 return new;
end;
$function$;
revoke all on function private.guard_culture_ast_write() from public,anon,authenticated;
drop trigger if exists guard_culture_ast_write on public.visit_test_culture_susceptibility;
create trigger guard_culture_ast_write before insert or update on public.visit_test_culture_susceptibility
 for each row execute function private.guard_culture_ast_write();

comment on table public.visit_test_culture_isolates is 'Repeatable organism/isolate findings for urine and stool culture visit tests.';
comment on table public.visit_test_culture_susceptibility is 'Isolate-specific antimicrobial susceptibility observations, with explicit method and breakpoint standard/edition.';
