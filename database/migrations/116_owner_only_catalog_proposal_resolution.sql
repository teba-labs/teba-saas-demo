-- Catalog proposals are created by branch members but only the tenant owner
-- may approve/reject them. Keep ordinary branch conflict visibility and writes.
-- Preserve the legacy resolution values while adding the catalog-review states.
begin;

alter table public.sync_conflicts
  drop constraint if exists sync_conflicts_resolution_check;

alter table public.sync_conflicts
  add constraint sync_conflicts_resolution_check
  check (
    resolution is null
    or resolution in (
      'accepted_local', 'kept_server', 'merged', 'manual',
      'approved', 'rejected', 'conflict'
    )
  );

drop policy if exists tsl_sync_conflicts_branch_access on public.sync_conflicts;

create policy tsl_sync_conflicts_branch_read
  on public.sync_conflicts for select to authenticated
  using (private.can_access_branch(tenant_id, branch_id));

create policy tsl_sync_conflicts_branch_insert
  on public.sync_conflicts for insert to authenticated
  with check (private.can_access_branch(tenant_id, branch_id));

create policy tsl_sync_conflicts_branch_update
  on public.sync_conflicts for update to authenticated
  using (
    private.can_access_branch(tenant_id, branch_id)
    and (
      entity_type not in ('catalog_test_change', 'catalog_parameter_change')
      or private.is_tenant_owner(tenant_id)
    )
  )
  with check (
    private.can_access_branch(tenant_id, branch_id)
    and (
      entity_type not in ('catalog_test_change', 'catalog_parameter_change')
      or private.is_tenant_owner(tenant_id)
    )
  );

create policy tsl_sync_conflicts_branch_delete
  on public.sync_conflicts for delete to authenticated
  using (
    private.can_access_branch(tenant_id, branch_id)
    and (
      entity_type not in ('catalog_test_change', 'catalog_parameter_change')
      or private.is_tenant_owner(tenant_id)
    )
  );

commit;
