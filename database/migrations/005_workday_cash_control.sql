-- Batch 11: explicitly tie cash movements to the manually opened branch workday.
-- Apply after migrations 001-004 on the TEST project only.
alter table public.payments add column if not exists workday_id uuid;
alter table public.expenses add column if not exists workday_id uuid;

-- Backfill historical movements using the visit workday where possible; otherwise
-- use the branch workday matching the movement's local date.
update public.payments py set workday_id = bw.id
from public.branch_workdays bw
join public.tenants t on t.id=bw.tenant_id
where bw.tenant_id=py.tenant_id and bw.branch_id=py.branch_id
  and bw.work_date=(py.received_at at time zone coalesce(t.timezone,'Africa/Cairo'))::date
  and py.workday_id is null;
update public.expenses e set workday_id = bw.id
from public.branch_workdays bw
join public.tenants t on t.id=bw.tenant_id
where bw.tenant_id=e.tenant_id and bw.branch_id=e.branch_id
  and bw.work_date=(e.spent_at at time zone coalesce(t.timezone,'Africa/Cairo'))::date
  and e.workday_id is null;

alter table public.payments drop constraint if exists fk_payments_workday;
alter table public.payments add constraint fk_payments_workday
  foreign key (tenant_id, branch_id, workday_id)
  references public.branch_workdays(tenant_id, branch_id, id) on delete restrict;
alter table public.expenses drop constraint if exists fk_expenses_workday;
alter table public.expenses add constraint fk_expenses_workday
  foreign key (tenant_id, branch_id, workday_id)
  references public.branch_workdays(tenant_id, branch_id, id) on delete restrict;

create or replace function private.add_payment_to_ledger()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_work_date date;
begin
  select work_date into v_work_date from public.branch_workdays
  where id=new.workday_id and tenant_id=new.tenant_id and branch_id=new.branch_id;
  if v_work_date is null then raise exception 'Payment must belong to an open branch workday'; end if;
  insert into public.financial_ledger(tenant_id, branch_id, source_type, source_id, direction, amount, movement_at, work_date, description, created_by)
  values (new.tenant_id, new.branch_id, 'payment', new.id, 'inflow', new.amount, new.received_at, v_work_date, 'Patient payment', new.received_by)
  on conflict (tenant_id, source_type, source_id) do nothing;
  return new;
end;
$$;

create or replace function private.add_expense_to_ledger()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_work_date date;
begin
  select work_date into v_work_date from public.branch_workdays
  where id=new.workday_id and tenant_id=new.tenant_id and branch_id=new.branch_id;
  if v_work_date is null then raise exception 'Expense must belong to an open branch workday'; end if;
  insert into public.financial_ledger(tenant_id, branch_id, source_type, source_id, direction, amount, movement_at, work_date, description, created_by)
  values (new.tenant_id, new.branch_id, 'expense', new.id, 'outflow', new.amount, new.spent_at, v_work_date, coalesce(new.description,'Expense'), new.spent_by)
  on conflict (tenant_id, source_type, source_id) do nothing;
  return new;
end;
$$;

create or replace function public.record_patient_payment(
  p_tenant_id uuid, p_visit_id uuid, p_amount numeric,
  p_payment_method text, p_idempotency_key uuid, p_staff_id uuid, p_notes text default null
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare v_branch_id uuid; v_workday_id uuid; v_net numeric; v_paid numeric; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select v.branch_id into v_branch_id from public.visits v
    where v.id=p_visit_id and v.tenant_id=p_tenant_id;
  if v_branch_id is null or not private.can_access_branch(p_tenant_id,v_branch_id) then raise exception 'Visit not accessible'; end if;
  if p_staff_id is null or not exists (select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=v_branch_id and sd.is_active) then raise exception 'Select an active staff name for this branch'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid payment amount'; end if;
  select id into v_id from public.payments where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
  if v_id is not null then
    if not exists (select 1 from public.payments where id=v_id and visit_id=p_visit_id and amount=p_amount) then raise exception 'Idempotency key reused with different payment data'; end if;
    return v_id;
  end if;
  select id into v_workday_id from public.branch_workdays
    where tenant_id=p_tenant_id and branch_id=v_branch_id and status='open' for update;
  if v_workday_id is null then raise exception 'Open the branch workday before recording a payment'; end if;
  select vb.net_total into v_net from public.visit_billing vb where vb.visit_id=p_visit_id and vb.tenant_id=p_tenant_id for update;
  if v_net is null then raise exception 'Visit billing not found'; end if;
  select id into v_id from public.payments where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
  if v_id is not null then
    if not exists (select 1 from public.payments where id=v_id and visit_id=p_visit_id and amount=p_amount) then raise exception 'Idempotency key reused with different payment data'; end if;
    return v_id;
  end if;
  select coalesce(sum(py.amount),0) into v_paid from public.payments py where py.visit_id=p_visit_id;
  if v_paid+p_amount>v_net then raise exception 'Payment exceeds remaining balance'; end if;
  insert into public.payments(tenant_id,branch_id,visit_id,workday_id,amount,payment_method,idempotency_key,received_by,received_by_staff_id,notes)
  values(p_tenant_id,v_branch_id,p_visit_id,v_workday_id,p_amount,coalesce(p_payment_method,'cash'),p_idempotency_key,auth.uid(),p_staff_id,p_notes)
  on conflict (tenant_id,idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.payments where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key; end if;
  return v_id;
end;
$$;

create or replace function public.record_branch_expense(
  p_tenant_id uuid, p_branch_id uuid, p_category_id uuid,
  p_amount numeric, p_description text, p_idempotency_key uuid, p_staff_id uuid
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare v_id uuid; v_workday_id uuid;
begin
  if auth.uid() is null or not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch not accessible'; end if;
  if p_staff_id is null or not exists (select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Select an active staff name for this branch'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Invalid expense amount'; end if;
  if not exists (select 1 from public.expense_categories ec where ec.id=p_category_id and ec.tenant_id=p_tenant_id and ec.is_active) then raise exception 'Expense category unavailable'; end if;
  select id into v_workday_id from public.branch_workdays
    where tenant_id=p_tenant_id and branch_id=p_branch_id and status='open' for update;
  if v_workday_id is null then raise exception 'Open the branch workday before recording an expense'; end if;
  insert into public.expenses(tenant_id,branch_id,workday_id,category_id,amount,description,idempotency_key,spent_by,spent_by_staff_id)
  values(p_tenant_id,p_branch_id,v_workday_id,p_category_id,p_amount,p_description,p_idempotency_key,auth.uid(),p_staff_id)
  on conflict (tenant_id,idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.expenses where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
    if not exists(select 1 from public.expenses where id=v_id and branch_id=p_branch_id and category_id=p_category_id and amount=p_amount) then raise exception 'Idempotency key reused with different expense data'; end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.record_patient_payment(uuid,uuid,numeric,text,uuid,uuid,text) from public, anon;
grant execute on function public.record_patient_payment(uuid,uuid,numeric,text,uuid,uuid,text) to authenticated;
revoke all on function public.record_branch_expense(uuid,uuid,uuid,numeric,text,uuid,uuid) from public, anon;
grant execute on function public.record_branch_expense(uuid,uuid,uuid,numeric,text,uuid,uuid) to authenticated;

-- Keep reception's atomic first-payment path compatible with workday-bound cash.
create or replace function public.create_visit_intake(
  p_tenant_id uuid, p_branch_id uuid, p_patient_id uuid, p_visit_number text,
  p_staff_id uuid, p_test_ids uuid[], p_discount_amount numeric default 0,
  p_initial_payment numeric default 0, p_payment_method text default 'cash',
  p_referred_by text default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_visit_id uuid; v_workday_id uuid; v_test_id uuid;
  v_gross numeric(14,2):=0; v_net numeric(14,2);
  v_payment numeric(14,2):=coalesce(p_initial_payment,0);
  v_discount numeric(14,2):=coalesce(p_discount_amount,0);
  v_test_count integer; v_added_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch not accessible'; end if;
  if p_staff_id is null or not exists(select 1 from public.staff_directory sd where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active) then raise exception 'Select an active staff name for this branch'; end if;
  if p_patient_id is null or not exists(select 1 from public.patients p where p.id=p_patient_id and p.tenant_id=p_tenant_id and p.branch_id=p_branch_id) then raise exception 'Patient not found in this branch'; end if;
  if nullif(btrim(p_visit_number),'') is null or length(btrim(p_visit_number))>40 then raise exception 'A valid visit number is required'; end if;
  if p_test_ids is null or cardinality(p_test_ids)=0 then raise exception 'Select at least one test'; end if;
  if exists(select 1 from unnest(p_test_ids) u(test_id) where u.test_id is null) then raise exception 'Invalid test selection'; end if;
  select count(*) into v_test_count from unnest(p_test_ids) u(test_id);
  if v_test_count<>(select count(distinct u.test_id) from unnest(p_test_ids) u(test_id)) then raise exception 'Duplicate test selection'; end if;
  if v_discount<0 or v_payment<0 then raise exception 'Discount and payment cannot be negative'; end if;
  if coalesce(p_payment_method,'cash') not in ('cash','card','wallet','bank_transfer','other') then raise exception 'Unsupported payment method'; end if;
  insert into public.visits(tenant_id,branch_id,patient_id,visit_number,created_by,created_by_staff_id,referred_by,notes)
  values(p_tenant_id,p_branch_id,p_patient_id,btrim(p_visit_number),auth.uid(),p_staff_id,nullif(btrim(p_referred_by),''),nullif(btrim(p_notes),'')) returning id into v_visit_id;
  select workday_id into v_workday_id from public.visits where id=v_visit_id;
  foreach v_test_id in array p_test_ids loop
    insert into public.visit_tests(tenant_id,branch_id,visit_id,test_id,created_by,created_by_staff_id)
    values(p_tenant_id,p_branch_id,v_visit_id,v_test_id,auth.uid(),p_staff_id);
    v_added_count:=v_added_count+1;
  end loop;
  select coalesce(sum(price_snapshot),0) into v_gross from public.visit_tests where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=v_visit_id;
  if v_added_count<>v_test_count then raise exception 'Not all selected tests were added'; end if;
  if v_discount>v_gross then raise exception 'Discount exceeds gross total'; end if;
  v_net:=v_gross-v_discount;
  if v_payment>v_net then raise exception 'Payment exceeds net invoice total'; end if;
  insert into public.visit_billing(tenant_id,branch_id,visit_id,gross_total,discount_amount,created_by)
  values(p_tenant_id,p_branch_id,v_visit_id,v_gross,v_discount,auth.uid());
  if v_payment>0 then
    insert into public.payments(tenant_id,branch_id,visit_id,workday_id,amount,payment_method,idempotency_key,received_by,received_by_staff_id,notes)
    values(p_tenant_id,p_branch_id,v_visit_id,v_workday_id,v_payment,coalesce(p_payment_method,'cash'),gen_random_uuid(),auth.uid(),p_staff_id,'Initial payment at visit intake');
  end if;
  return v_visit_id;
end;
$$;
revoke all on function public.create_visit_intake(uuid,uuid,uuid,text,uuid,uuid[],numeric,numeric,text,text,text) from public, anon;
grant execute on function public.create_visit_intake(uuid,uuid,uuid,text,uuid,uuid[],numeric,numeric,text,text,text) to authenticated;

-- Serialize visit intake against shift closing too. If close wins the row lock,
-- the visit trigger rechecks status and refuses a new visit after closure.
create or replace function private.assign_open_workday_to_visit()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare v_workday public.branch_workdays%rowtype;
begin
  select * into v_workday from public.branch_workdays bw
  where bw.tenant_id=new.tenant_id and bw.branch_id=new.branch_id and bw.status='open'
  order by bw.opened_at desc limit 1 for update;
  if v_workday.id is null then raise exception 'Open the branch workday before registering visits'; end if;
  new.workday_id:=v_workday.id;
  new.visit_work_date:=v_workday.work_date;
  return new;
end;
$$;
