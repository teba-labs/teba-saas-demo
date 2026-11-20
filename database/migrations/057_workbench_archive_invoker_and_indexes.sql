-- Keep the workbench archive RPC under caller privileges and make actor policy explicit.
alter function public.set_visit_workbench_hidden(uuid,uuid,uuid,uuid,boolean,text) security invoker;

drop policy if exists visit_workbench_archive_events_branch_insert on public.visit_workbench_archive_events;
create policy visit_workbench_archive_events_branch_insert
  on public.visit_workbench_archive_events for insert to authenticated
  with check (
    private.can_access_branch(tenant_id, branch_id)
    and actor_user_id = (select auth.uid())
    and exists (
      select 1 from public.staff_directory sd
       where sd.id = actor_staff_id
         and sd.tenant_id = visit_workbench_archive_events.tenant_id
         and sd.branch_id = visit_workbench_archive_events.branch_id
         and sd.is_active
         and (
           private.is_tenant_owner(visit_workbench_archive_events.tenant_id)
           or sd.auth_user_id = (select auth.uid())
         )
    )
  );

create index if not exists idx_visit_archive_events_actor_staff
  on public.visit_workbench_archive_events(tenant_id,branch_id,actor_staff_id)
  where actor_staff_id is not null;
create index if not exists idx_visit_archive_events_actor_user
  on public.visit_workbench_archive_events(actor_user_id)
  where actor_user_id is not null;
create index if not exists idx_visits_workbench_hidden_by
  on public.visits(workbench_hidden_by)
  where workbench_hidden_by is not null;
create index if not exists idx_visits_workbench_restored_by
  on public.visits(workbench_restored_by)
  where workbench_restored_by is not null;
