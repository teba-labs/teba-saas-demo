-- 074: Idempotent server acknowledgement for offline draft-result batches.
-- This does not enable offline completion, approval, correction, or report publication.
begin;

create table if not exists private.offline_operation_receipts (
  tenant_id uuid not null,
  branch_id uuid not null,
  operation_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  payload jsonb not null,
  result_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (tenant_id, branch_id, operation_id)
);
revoke all on table private.offline_operation_receipts from public, anon, authenticated;

create or replace function public.save_draft_results_idempotent(
  p_operation_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_test_id uuid,
  p_staff_id uuid,
  p_results jsonb
) returns setof public.test_results
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_receipt private.offline_operation_receipts%rowtype;
  v_payload jsonb;
  v_result_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_operation_id is null then raise exception 'Offline operation ID is required'; end if;
  if not private.can_access_branch(p_tenant_id, p_branch_id) then
    raise exception 'Branch access denied' using errcode='42501';
  end if;
  v_payload := jsonb_build_object(
    'visit_test_id', p_visit_test_id,
    'staff_id', p_staff_id,
    'results', p_results
  );

  insert into private.offline_operation_receipts
    (tenant_id, branch_id, operation_id, created_by, payload)
  values
    (p_tenant_id, p_branch_id, p_operation_id, auth.uid(), v_payload)
  on conflict (tenant_id, branch_id, operation_id) do nothing;

  select * into v_receipt
    from private.offline_operation_receipts
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id
   for update;
  if not found then raise exception 'Offline operation receipt could not be locked'; end if;
  if v_receipt.created_by is distinct from auth.uid() then
    raise exception 'Offline operation belongs to another user' using errcode='42501';
  end if;
  if v_receipt.payload is distinct from v_payload then
    raise exception 'Idempotency key reused with different payload';
  end if;

  if cardinality(v_receipt.result_ids) > 0 then
    return query
      select tr.* from public.test_results tr
       where tr.tenant_id=p_tenant_id
         and tr.visit_test_id=p_visit_test_id
         and tr.id=any(v_receipt.result_ids)
       order by tr.entered_at, tr.id;
    return;
  end if;

  select coalesce(array_agg(saved.id), '{}'::uuid[])
    into v_result_ids
    from public.save_draft_results_atomic(
      p_tenant_id, p_branch_id, p_visit_test_id, p_staff_id, p_results
    ) saved;
  if cardinality(v_result_ids) = 0 then
    raise exception 'Draft result save returned no acknowledged rows';
  end if;

  update private.offline_operation_receipts
     set result_ids=v_result_ids, completed_at=now()
   where tenant_id=p_tenant_id and branch_id=p_branch_id and operation_id=p_operation_id;

  return query
    select tr.* from public.test_results tr
     where tr.tenant_id=p_tenant_id
       and tr.visit_test_id=p_visit_test_id
       and tr.id=any(v_result_ids)
     order by tr.entered_at, tr.id;
end;
$function$;

revoke all on function public.save_draft_results_idempotent(uuid,uuid,uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_draft_results_idempotent(uuid,uuid,uuid,uuid,uuid,jsonb) to authenticated;

commit;
