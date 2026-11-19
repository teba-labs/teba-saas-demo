-- Branch archival access hardening.
-- Archived branches remain fully readable by an active tenant owner for history.
-- Employees lose branch-scoped access as soon as the branch is inactive.
-- No branch, membership, patient, visit, result, or financial row is deleted or rewritten.
begin;

create or replace function private.can_access_branch(p_tenant_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select private.is_tenant_owner(p_tenant_id)
    or exists (
      select 1
        from public.branches b
        join public.branch_memberships bm
          on bm.tenant_id = b.tenant_id and bm.branch_id = b.id
        join public.tenant_memberships tm
          on tm.tenant_id = bm.tenant_id and tm.user_id = bm.user_id
       where b.tenant_id = p_tenant_id
         and b.id = p_branch_id
         and b.is_active
         and bm.user_id = auth.uid()
         and bm.is_active
         and tm.is_active
         and tm.account_type = 'employee'
    );
$function$;

-- Preserve the existing permission contract for RLS policy evaluation.
revoke all on function private.can_access_branch(uuid,uuid) from public, anon, authenticated;
grant execute on function private.can_access_branch(uuid,uuid) to authenticated;

commit;
