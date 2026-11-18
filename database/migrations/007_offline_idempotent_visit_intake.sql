-- Batch 15: idempotent offline visit intake receipt.
-- Apply only to the TEST Supabase project after migrations 001-006.
-- The advisory transaction lock serializes retries using the same operation UUID.

create table if not exists private.offline_visit_intake_receipts (
  tenant_id uuid not null,
  branch_id uuid not null,
  operation_id uuid not null,
  payload jsonb not null,
  visit_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, operation_id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, visit_id) references public.visits(tenant_id, branch_id, id) on delete restrict
);

revoke all on table private.offline_visit_intake_receipts from public, anon, authenticated;

create or replace function public.create_visit_intake_idempotent(
  p_operation_id uuid,
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
  p_notes text default null,
  p_expected_prices jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payload jsonb;
  v_existing private.offline_visit_intake_receipts%rowtype;
  v_visit_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_operation_id is null then raise exception 'A stable offline operation ID is required'; end if;
  if not private.can_access_branch(p_tenant_id, p_branch_id) then raise exception 'Branch not accessible'; end if;

  v_payload := jsonb_build_object(
    'patient_id', p_patient_id,
    'visit_number', btrim(coalesce(p_visit_number,'')),
    'staff_id', p_staff_id,
    'test_ids', to_jsonb(coalesce(p_test_ids, array[]::uuid[])),
    'discount_amount', coalesce(p_discount_amount,0),
    'initial_payment', coalesce(p_initial_payment,0),
    'payment_method', coalesce(p_payment_method,'cash'),
    'referred_by', nullif(btrim(coalesce(p_referred_by,'')),''),
    'notes', nullif(btrim(coalesce(p_notes,'')),''),
    'expected_prices', coalesce(p_expected_prices,'[]'::jsonb)
  );

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_operation_id::text, 0));

  select * into v_existing
  from private.offline_visit_intake_receipts
  where tenant_id=p_tenant_id and operation_id=p_operation_id;

  if found then
    if v_existing.branch_id <> p_branch_id or v_existing.payload <> v_payload then
      raise exception 'Offline operation ID was reused with different visit data';
    end if;
    return v_existing.visit_id;
  end if;

  if jsonb_typeof(coalesce(p_expected_prices,'[]'::jsonb)) <> 'array' then
    raise exception 'Offline price snapshot is missing or incomplete; refresh the catalog before syncing';
  end if;
  if jsonb_array_length(coalesce(p_expected_prices,'[]'::jsonb)) <> cardinality(coalesce(p_test_ids,array[]::uuid[]))
     or (select count(distinct x.test_id) from jsonb_to_recordset(coalesce(p_expected_prices,'[]'::jsonb)) as x(test_id uuid, price_id uuid, selling_price numeric)) <> cardinality(coalesce(p_test_ids,array[]::uuid[]))
     or exists (select 1 from unnest(coalesce(p_test_ids,array[]::uuid[])) t(test_id) where not exists (select 1 from jsonb_to_recordset(coalesce(p_expected_prices,'[]'::jsonb)) as x(test_id uuid, price_id uuid, selling_price numeric) where x.test_id=t.test_id)) then
    raise exception 'Offline price snapshot is missing or incomplete; refresh the catalog before syncing';
  end if;
  perform 1
  from public.test_prices current_price
  join jsonb_to_recordset(coalesce(p_expected_prices,'[]'::jsonb)) as expected(test_id uuid, price_id uuid, selling_price numeric)
    on current_price.tenant_id=p_tenant_id and current_price.test_id=expected.test_id and current_price.is_current
  for share of current_price;

  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_expected_prices,'[]'::jsonb)) as expected(test_id uuid, price_id uuid, selling_price numeric)
    left join public.test_prices current_price
      on current_price.tenant_id=p_tenant_id and current_price.test_id=expected.test_id and current_price.is_current
    where expected.price_id is null or expected.selling_price is null
       or current_price.id is null or current_price.id <> expected.price_id
       or current_price.selling_price <> expected.selling_price
  ) then
    raise exception 'OFFLINE_PRICE_CONFLICT: one or more test prices changed; review the visit before syncing';
  end if;

  v_visit_id := public.create_visit_intake(
    p_tenant_id, p_branch_id, p_patient_id, p_visit_number, p_staff_id,
    p_test_ids, p_discount_amount, p_initial_payment, p_payment_method,
    p_referred_by, p_notes
  );

  insert into private.offline_visit_intake_receipts(
    tenant_id, branch_id, operation_id, payload, visit_id, created_by
  ) values (
    p_tenant_id, p_branch_id, p_operation_id, v_payload, v_visit_id, auth.uid()
  );

  return v_visit_id;
end;
$$;

revoke all on function public.create_visit_intake_idempotent(uuid,uuid,uuid,uuid,text,uuid,uuid[],numeric,numeric,text,text,text,jsonb) from public, anon;
grant execute on function public.create_visit_intake_idempotent(uuid,uuid,uuid,uuid,text,uuid,uuid[],numeric,numeric,text,text,text,jsonb) to authenticated;
