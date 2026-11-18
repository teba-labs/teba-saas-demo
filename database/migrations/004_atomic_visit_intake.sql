-- Batch 10: create a visit, its test snapshots, billing and optional first payment atomically.
-- Apply only after migrations 001-003 on the TEST Supabase project.
create or replace function public.create_visit_intake(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_patient_id uuid,
  p_visit_number text,
  p_staff_id uuid,
  p_test_ids uuid[],
  p_discount_amount numeric default 0,
  p_initial_payment numeric default 0,
  p_payment_method text default 'cash',
  p_referred_by text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_visit_id uuid;
  v_test_id uuid;
  v_gross numeric(14,2) := 0;
  v_net numeric(14,2);
  v_payment numeric(14,2) := coalesce(p_initial_payment, 0);
  v_discount numeric(14,2) := coalesce(p_discount_amount, 0);
  v_test_count integer;
  v_added_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id, p_branch_id) then raise exception 'Branch not accessible'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff_directory sd
    where sd.id=p_staff_id and sd.tenant_id=p_tenant_id and sd.branch_id=p_branch_id and sd.is_active
  ) then raise exception 'Select an active staff name for this branch'; end if;
  if p_patient_id is null or not exists (
    select 1 from public.patients p
    where p.id=p_patient_id and p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
  ) then raise exception 'Patient not found in this branch'; end if;
  if nullif(btrim(p_visit_number), '') is null or length(btrim(p_visit_number)) > 40 then
    raise exception 'A valid visit number is required';
  end if;
  if p_test_ids is null or cardinality(p_test_ids)=0 then raise exception 'Select at least one test'; end if;
  if exists (select 1 from unnest(p_test_ids) as u(test_id) where u.test_id is null) then raise exception 'Invalid test selection'; end if;
  select count(*) into v_test_count from unnest(p_test_ids) as u(test_id);
  if v_test_count <> (select count(distinct u.test_id) from unnest(p_test_ids) as u(test_id)) then
    raise exception 'Duplicate test selection';
  end if;
  if v_discount < 0 or v_payment < 0 then raise exception 'Discount and payment cannot be negative'; end if;
  if coalesce(p_payment_method,'cash') not in ('cash','card','wallet','bank_transfer','other') then
    raise exception 'Unsupported payment method';
  end if;

  insert into public.visits(tenant_id,branch_id,patient_id,visit_number,created_by,created_by_staff_id,referred_by,notes)
  values(p_tenant_id,p_branch_id,p_patient_id,btrim(p_visit_number),auth.uid(),p_staff_id,
    nullif(btrim(p_referred_by),''),nullif(btrim(p_notes),''))
  returning id into v_visit_id;

  foreach v_test_id in array p_test_ids loop
    insert into public.visit_tests(tenant_id,branch_id,visit_id,test_id,created_by,created_by_staff_id)
    values(p_tenant_id,p_branch_id,v_visit_id,v_test_id,auth.uid(),p_staff_id);
    v_added_count := v_added_count + 1;
  end loop;

  select coalesce(sum(price_snapshot),0) into v_gross
  from public.visit_tests where tenant_id=p_tenant_id and branch_id=p_branch_id and visit_id=v_visit_id;
  if v_added_count <> v_test_count then raise exception 'Not all selected tests were added'; end if;
  if v_discount > v_gross then raise exception 'Discount exceeds gross total'; end if;
  v_net := v_gross-v_discount;
  if v_payment > v_net then raise exception 'Payment exceeds net invoice total'; end if;

  insert into public.visit_billing(tenant_id,branch_id,visit_id,gross_total,discount_amount,created_by)
  values(p_tenant_id,p_branch_id,v_visit_id,v_gross,v_discount,auth.uid());

  if v_payment > 0 then
    insert into public.payments(tenant_id,branch_id,visit_id,amount,payment_method,idempotency_key,received_by,received_by_staff_id,notes)
    values(p_tenant_id,p_branch_id,v_visit_id,v_payment,coalesce(p_payment_method,'cash'),gen_random_uuid(),auth.uid(),p_staff_id,'Initial payment at visit intake');
  end if;
  return v_visit_id;
end;
$$;

revoke all on function public.create_visit_intake(uuid,uuid,uuid,text,uuid,uuid[],numeric,numeric,text,text,text) from public, anon;
grant execute on function public.create_visit_intake(uuid,uuid,uuid,text,uuid,uuid[],numeric,numeric,text,text,text) to authenticated;
