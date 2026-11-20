-- Cover culture-table foreign keys and cache auth.uid() once per statement in RLS predicates.
create index if not exists idx_culture_isolates_tenant_visit
 on public.visit_test_culture_isolates(tenant_id,visit_test_id);
create index if not exists idx_culture_isolates_tenant_branch_staff
 on public.visit_test_culture_isolates(tenant_id,branch_id,created_by_staff_id);
create index if not exists idx_culture_isolates_created_by
 on public.visit_test_culture_isolates(created_by);
create index if not exists idx_culture_ast_tenant_branch_staff
 on public.visit_test_culture_susceptibility(tenant_id,branch_id,entered_by_staff_id);
create index if not exists idx_culture_ast_entered_by
 on public.visit_test_culture_susceptibility(entered_by);

drop policy if exists culture_isolates_branch_insert on public.visit_test_culture_isolates;
create policy culture_isolates_branch_insert on public.visit_test_culture_isolates
 for insert to authenticated with check (
  private.can_access_branch(tenant_id,branch_id)
  and exists(select 1 from public.staff_directory s
   where s.id=visit_test_culture_isolates.created_by_staff_id
    and s.tenant_id=visit_test_culture_isolates.tenant_id
    and s.branch_id=visit_test_culture_isolates.branch_id
    and s.is_active and (s.auth_user_id=(select auth.uid()) or private.is_tenant_owner(visit_test_culture_isolates.tenant_id)))
 );
drop policy if exists culture_isolates_branch_update on public.visit_test_culture_isolates;
create policy culture_isolates_branch_update on public.visit_test_culture_isolates
 for update to authenticated using (private.can_access_branch(tenant_id,branch_id))
 with check (
  private.can_access_branch(tenant_id,branch_id)
  and exists(select 1 from public.staff_directory s
   where s.id=visit_test_culture_isolates.created_by_staff_id
    and s.tenant_id=visit_test_culture_isolates.tenant_id
    and s.branch_id=visit_test_culture_isolates.branch_id
    and s.is_active and (s.auth_user_id=(select auth.uid()) or private.is_tenant_owner(visit_test_culture_isolates.tenant_id)))
 );

drop policy if exists culture_ast_branch_insert on public.visit_test_culture_susceptibility;
create policy culture_ast_branch_insert on public.visit_test_culture_susceptibility
 for insert to authenticated with check (
  private.can_access_branch(tenant_id,branch_id)
  and exists(select 1 from public.staff_directory s
   where s.id=visit_test_culture_susceptibility.entered_by_staff_id
    and s.tenant_id=visit_test_culture_susceptibility.tenant_id
    and s.branch_id=visit_test_culture_susceptibility.branch_id
    and s.is_active and (s.auth_user_id=(select auth.uid()) or private.is_tenant_owner(visit_test_culture_susceptibility.tenant_id)))
 );
drop policy if exists culture_ast_branch_update on public.visit_test_culture_susceptibility;
create policy culture_ast_branch_update on public.visit_test_culture_susceptibility
 for update to authenticated using (private.can_access_branch(tenant_id,branch_id))
 with check (
  private.can_access_branch(tenant_id,branch_id)
  and exists(select 1 from public.staff_directory s
   where s.id=visit_test_culture_susceptibility.entered_by_staff_id
    and s.tenant_id=visit_test_culture_susceptibility.tenant_id
    and s.branch_id=visit_test_culture_susceptibility.branch_id
    and s.is_active and (s.auth_user_id=(select auth.uid()) or private.is_tenant_owner(visit_test_culture_susceptibility.tenant_id)))
 );
