-- Batch 27: keep cross-branch payment retries idempotent after staff/workday changes.
-- Replays are checked before requiring the selected staff record to remain active.
create or replace function public.record_patient_payment(
  p_tenant_id uuid,
  p_visit_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_idempotency_key uuid,
  p_staff_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_origin_branch_id uuid;
  v_collection_branch_id uuid;
  v_workday_id uuid;
  v_net numeric;
  v_paid numeric;
  v_id uuid;
  v_existing public.payments%rowtype;
  v_method text := coalesce(p_payment_method, 'cash');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_idempotency_key is null then raise exception 'A stable payment idempotency key is required'; end if;

  select v.branch_id into v_origin_branch_id
  from public.visits v
  where v.id=p_visit_id and v.tenant_id=p_tenant_id;
  if v_origin_branch_id is null then raise exception 'Visit not found for this tenant'; end if;

  -- A committed retry is acknowledged before mutable staff/workday checks.
  select * into v_existing from public.payments
  where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
  if found then
    if not private.can_access_branch(p_tenant_id,v_existing.branch_id) then
      raise exception 'Payment collection branch is not accessible';
    end if;
    if v_existing.origin_branch_id is distinct from v_origin_branch_id
       or v_existing.visit_id is distinct from p_visit_id
       or v_existing.amount is distinct from p_amount
       or v_existing.payment_method is distinct from v_method
       or v_existing.received_by_staff_id is distinct from p_staff_id
       or v_existing.notes is distinct from p_notes then
      raise exception 'Idempotency key reused with different payment data';
    end if;
    return v_existing.id;
  end if;

  select sd.branch_id into v_collection_branch_id
  from public.staff_directory sd
  where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.is_active;
  if v_collection_branch_id is null
     or not private.can_access_branch(p_tenant_id,v_collection_branch_id) then
    raise exception 'Select an active staff member from a branch you can access';
  end if;

  if p_amount is null or p_amount<=0 then raise exception 'Invalid payment amount'; end if;
  if v_method not in ('cash','card','wallet','bank_transfer','other') then raise exception 'Unsupported payment method'; end if;

  select id into v_workday_id from public.branch_workdays
  where tenant_id=p_tenant_id and branch_id=v_collection_branch_id and status='open'
  for update;
  if v_workday_id is null then raise exception 'Open the collecting branch workday before recording a payment'; end if;

  select vb.net_total into v_net from public.visit_billing vb
  where vb.visit_id=p_visit_id and vb.tenant_id=p_tenant_id for update;
  if v_net is null then raise exception 'Visit billing not found'; end if;

  select coalesce(sum(py.amount),0) into v_paid
  from public.payments py where py.tenant_id=p_tenant_id and py.visit_id=p_visit_id;
  if v_paid+p_amount>v_net then raise exception 'Payment exceeds remaining balance'; end if;

  insert into public.payments(
    tenant_id,branch_id,origin_branch_id,visit_id,workday_id,amount,
    payment_method,idempotency_key,received_by,received_by_staff_id,notes
  ) values (
    p_tenant_id,v_collection_branch_id,v_origin_branch_id,p_visit_id,v_workday_id,
    p_amount,v_method,p_idempotency_key,auth.uid(),p_staff_id,p_notes
  ) on conflict (tenant_id,idempotency_key) do nothing returning id into v_id;

  if v_id is null then
    select * into v_existing from public.payments
    where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
    if not found
       or v_existing.branch_id is distinct from v_collection_branch_id
       or v_existing.origin_branch_id is distinct from v_origin_branch_id
       or v_existing.visit_id is distinct from p_visit_id
       or v_existing.amount is distinct from p_amount
       or v_existing.payment_method is distinct from v_method
       or v_existing.received_by_staff_id is distinct from p_staff_id
       or v_existing.notes is distinct from p_notes then
      raise exception 'Idempotency key reused with different payment data';
    end if;
    return v_existing.id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.record_patient_payment(uuid,uuid,numeric,text,uuid,uuid,text) from public,anon;
grant execute on function public.record_patient_payment(uuid,uuid,numeric,text,uuid,uuid,text) to authenticated;
