-- Batch 25: acknowledge an already-committed cash operation before checking
-- mutable business state (staff/category/workday) that may have changed since.
-- Review and apply separately to TEST only; this file is not auto-executed.

create or replace function public.record_patient_payment(
  p_tenant_id uuid, p_visit_id uuid, p_amount numeric,
  p_payment_method text, p_idempotency_key uuid, p_staff_id uuid, p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_branch_id uuid;
  v_workday_id uuid;
  v_net numeric;
  v_paid numeric;
  v_id uuid;
  v_existing public.payments%rowtype;
  v_method text := coalesce(p_payment_method, 'cash');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_idempotency_key is null then raise exception 'A stable payment idempotency key is required'; end if;

  select v.branch_id into v_branch_id
  from public.visits v
  where v.id = p_visit_id and v.tenant_id = p_tenant_id;
  if v_branch_id is null or not private.can_access_branch(p_tenant_id, v_branch_id) then
    raise exception 'Visit not accessible';
  end if;

  -- A retry must be acknowledged even if the staff member was deactivated
  -- or the workday was closed after the original transaction committed.
  select * into v_existing
  from public.payments
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.branch_id is distinct from v_branch_id
       or v_existing.visit_id is distinct from p_visit_id
       or v_existing.amount is distinct from p_amount
       or v_existing.payment_method is distinct from v_method
       or v_existing.received_by_staff_id is distinct from p_staff_id
       or v_existing.notes is distinct from p_notes then
      raise exception 'Idempotency key reused with different payment data';
    end if;
    return v_existing.id;
  end if;

  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
    where sd.id = p_staff_id and sd.tenant_id = p_tenant_id
      and sd.branch_id = v_branch_id and sd.is_active
  ) then raise exception 'Select an active staff name for this branch'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid payment amount'; end if;

  select id into v_workday_id
  from public.branch_workdays
  where tenant_id = p_tenant_id and branch_id = v_branch_id and status = 'open'
  for update;
  if v_workday_id is null then raise exception 'Open the branch workday before recording a payment'; end if;

  select vb.net_total into v_net
  from public.visit_billing vb
  where vb.visit_id = p_visit_id and vb.tenant_id = p_tenant_id
  for update;
  if v_net is null then raise exception 'Visit billing not found'; end if;

  -- Recheck after acquiring the billing lock to close the concurrent retry race.
  select * into v_existing
  from public.payments
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.branch_id is distinct from v_branch_id
       or v_existing.visit_id is distinct from p_visit_id
       or v_existing.amount is distinct from p_amount
       or v_existing.payment_method is distinct from v_method
       or v_existing.received_by_staff_id is distinct from p_staff_id
       or v_existing.notes is distinct from p_notes then
      raise exception 'Idempotency key reused with different payment data';
    end if;
    return v_existing.id;
  end if;

  select coalesce(sum(py.amount), 0) into v_paid
  from public.payments py where py.visit_id = p_visit_id;
  if v_paid + p_amount > v_net then raise exception 'Payment exceeds remaining balance'; end if;

  insert into public.payments(
    tenant_id, branch_id, visit_id, workday_id, amount, payment_method,
    idempotency_key, received_by, received_by_staff_id, notes
  ) values (
    p_tenant_id, v_branch_id, p_visit_id, v_workday_id, p_amount, v_method,
    p_idempotency_key, auth.uid(), p_staff_id, p_notes
  ) on conflict (tenant_id, idempotency_key) do nothing returning id into v_id;

  if v_id is null then
    select * into v_existing from public.payments
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    if not found
       or v_existing.branch_id is distinct from v_branch_id
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

create or replace function public.record_branch_expense(
  p_tenant_id uuid, p_branch_id uuid, p_category_id uuid,
  p_amount numeric, p_description text, p_idempotency_key uuid, p_staff_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id uuid;
  v_workday_id uuid;
  v_existing public.expenses%rowtype;
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id, p_branch_id) then
    raise exception 'Branch not accessible';
  end if;
  if p_idempotency_key is null then raise exception 'A stable expense idempotency key is required'; end if;

  -- Replay check precedes mutable staff/category/workday validation.
  select * into v_existing
  from public.expenses
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.branch_id is distinct from p_branch_id
       or v_existing.category_id is distinct from p_category_id
       or v_existing.amount is distinct from p_amount
       or v_existing.description is distinct from p_description
       or v_existing.spent_by_staff_id is distinct from p_staff_id then
      raise exception 'Idempotency key reused with different expense data';
    end if;
    return v_existing.id;
  end if;

  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
    where sd.id = p_staff_id and sd.tenant_id = p_tenant_id
      and sd.branch_id = p_branch_id and sd.is_active
  ) then raise exception 'Select an active staff name for this branch'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid expense amount'; end if;
  if not exists (
    select 1 from public.expense_categories ec
    where ec.id = p_category_id and ec.tenant_id = p_tenant_id and ec.is_active
  ) then raise exception 'Expense category unavailable'; end if;

  select id into v_workday_id
  from public.branch_workdays
  where tenant_id = p_tenant_id and branch_id = p_branch_id and status = 'open'
  for update;
  if v_workday_id is null then raise exception 'Open the branch workday before recording an expense'; end if;

  insert into public.expenses(
    tenant_id, branch_id, workday_id, category_id, amount, description,
    idempotency_key, spent_by, spent_by_staff_id
  ) values (
    p_tenant_id, p_branch_id, v_workday_id, p_category_id, p_amount, p_description,
    p_idempotency_key, auth.uid(), p_staff_id
  ) on conflict (tenant_id, idempotency_key) do nothing returning id into v_id;

  if v_id is null then
    select * into v_existing from public.expenses
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
    if not found
       or v_existing.branch_id is distinct from p_branch_id
       or v_existing.category_id is distinct from p_category_id
       or v_existing.amount is distinct from p_amount
       or v_existing.description is distinct from p_description
       or v_existing.spent_by_staff_id is distinct from p_staff_id then
      raise exception 'Idempotency key reused with different expense data';
    end if;
    return v_existing.id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.record_patient_payment(uuid,uuid,numeric,text,uuid,uuid,text) from public, anon;
grant execute on function public.record_patient_payment(uuid,uuid,numeric,text,uuid,uuid,text) to authenticated;
revoke all on function public.record_branch_expense(uuid,uuid,uuid,numeric,text,uuid,uuid) from public, anon;
grant execute on function public.record_branch_expense(uuid,uuid,uuid,numeric,text,uuid,uuid) to authenticated;
