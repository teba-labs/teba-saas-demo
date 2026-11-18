begin;
alter table public.test_prices add column if not exists branch_id uuid;
do $$
begin
 if not exists(select 1 from pg_constraint where conname='test_prices_tenant_id_branch_id_fkey' and conrelid='public.test_prices'::regclass) then
  alter table public.test_prices add constraint test_prices_tenant_id_branch_id_fkey
   foreign key(tenant_id,branch_id) references public.branches(tenant_id,id) on delete restrict;
 end if;
end $$;
drop index if exists public.uq_test_prices_current;
create unique index if not exists uq_test_prices_current_base
 on public.test_prices(tenant_id,test_id) where is_current and branch_id is null;
create unique index if not exists uq_test_prices_current_branch
 on public.test_prices(tenant_id,branch_id,test_id) where is_current and branch_id is not null;
create index if not exists idx_test_prices_branch_lookup
 on public.test_prices(tenant_id,branch_id,test_id,is_current);

create or replace function public.set_current_test_price(
 p_tenant_id uuid,p_test_id uuid,p_selling_price numeric
) returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare v_test_id uuid; v_price_row public.test_prices;
begin
 if p_tenant_id is null or p_test_id is null then raise exception 'Tenant and test are required' using errcode='22004'; end if;
 if p_selling_price is null or p_selling_price<0 or p_selling_price='NaN'::numeric or p_selling_price>9999999999.99 then
  raise exception 'Selling price must be between 0 and 9999999999.99' using errcode='22023';
 end if;
 if not private.is_tenant_owner(p_tenant_id) then raise exception 'Only the tenant owner may change catalog prices' using errcode='42501'; end if;
 select tc.id into v_test_id from public.tests_catalog tc
  where tc.tenant_id=p_tenant_id and tc.id=p_test_id for update;
 if v_test_id is null then raise exception 'Catalog test was not found for this tenant' using errcode='P0002'; end if;
 update public.test_prices set is_current=false,updated_at=now()
  where tenant_id=p_tenant_id and test_id=p_test_id and branch_id is null and is_current;
 insert into public.test_prices(tenant_id,test_id,branch_id,selling_price,effective_from,is_current,updated_by,updated_at)
 values(p_tenant_id,p_test_id,null,p_selling_price,now(),true,auth.uid(),now()) returning * into v_price_row;
 return to_jsonb(v_price_row);
end; $$;
revoke all on function public.set_current_test_price(uuid,uuid,numeric) from public,anon;
grant execute on function public.set_current_test_price(uuid,uuid,numeric) to authenticated;

create or replace function public.set_branch_test_price(
 p_tenant_id uuid,p_branch_id uuid,p_test_id uuid,p_selling_price numeric
) returns jsonb language plpgsql volatile set search_path=pg_catalog as $$
declare v_test_id uuid; v_price_row public.test_prices;
begin
 if p_tenant_id is null or p_branch_id is null or p_test_id is null then raise exception 'Tenant, branch and test are required' using errcode='22004'; end if;
 if p_selling_price is null or p_selling_price<0 or p_selling_price='NaN'::numeric or p_selling_price>9999999999.99 then
  raise exception 'Selling price must be between 0 and 9999999999.99' using errcode='22023';
 end if;
 if not private.is_tenant_owner(p_tenant_id) then raise exception 'Only the tenant owner may change catalog prices' using errcode='42501'; end if;
 if not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=p_tenant_id and b.is_active) then
  raise exception 'Branch was not found or is inactive' using errcode='P0002';
 end if;
 select tc.id into v_test_id from public.tests_catalog tc
  where tc.tenant_id=p_tenant_id and tc.id=p_test_id and tc.is_active for update;
 if v_test_id is null then raise exception 'Catalog test was not found or is inactive' using errcode='P0002'; end if;
 update public.test_prices set is_current=false,updated_at=now()
  where tenant_id=p_tenant_id and branch_id=p_branch_id and test_id=p_test_id and is_current;
 insert into public.test_prices(tenant_id,branch_id,test_id,selling_price,effective_from,is_current,updated_by,updated_at)
 values(p_tenant_id,p_branch_id,p_test_id,p_selling_price,now(),true,auth.uid(),now()) returning * into v_price_row;
 return to_jsonb(v_price_row);
end; $$;
revoke all on function public.set_branch_test_price(uuid,uuid,uuid,numeric) from public,anon;
grant execute on function public.set_branch_test_price(uuid,uuid,uuid,numeric) to authenticated;

create or replace function private.apply_catalog_price_snapshot()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare v_price numeric(12,2); v_code text; v_name text; v_params jsonb;
begin
 if tg_op='UPDATE' then
  if new.price_snapshot is distinct from old.price_snapshot
   or new.technical_snapshot is distinct from old.technical_snapshot
   or new.test_code_snapshot is distinct from old.test_code_snapshot
   or new.test_name_snapshot is distinct from old.test_name_snapshot then
   raise exception 'Visit test price and technical snapshots are immutable';
  end if;
  return new;
 end if;
 select tc.code,tc.name into v_code,v_name from public.tests_catalog tc
  where tc.tenant_id=new.tenant_id and tc.id=new.test_id and tc.is_active;
 if v_code is null then raise exception 'Test is not active in this tenant catalog'; end if;
 select tp.selling_price into v_price from public.test_prices tp
  where tp.tenant_id=new.tenant_id and tp.test_id=new.test_id and tp.is_current
   and (tp.branch_id=new.branch_id or tp.branch_id is null)
  order by (tp.branch_id is not null) desc limit 1;
 if v_price is null then raise exception 'No active price configured for this test and branch'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'code',p.parameter_code,'name',p.parameter_name,'unit',p.unit,
  'value_type',p.value_type,'decimal_places',p.decimal_places,
  'reference_ranges',p.reference_ranges,'choices',p.choices,
  'display_order',p.display_order,'is_required',p.is_required
 ) order by p.display_order,p.parameter_code),'[]'::jsonb)
 into v_params from public.test_parameters p
 where p.tenant_id=new.tenant_id and p.test_id=new.test_id and p.is_active;
 if jsonb_array_length(v_params)=0 then raise exception 'Define at least one active parameter before ordering this test'; end if;
 new.price_snapshot:=v_price; new.test_code_snapshot:=v_code; new.test_name_snapshot:=v_name;
 new.technical_snapshot:=jsonb_build_object('parameters',v_params);
 return new;
end; $$;

create or replace function public.create_visit_intake_idempotent(
 p_operation_id uuid,p_tenant_id uuid,p_branch_id uuid,p_patient_id uuid,
 p_visit_number text,p_staff_id uuid,p_test_ids uuid[],
 p_discount_amount numeric default 0,p_initial_payment numeric default 0,
 p_payment_method text default 'cash',p_referred_by text default null,
 p_notes text default null,p_expected_prices jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
 v_payload jsonb; v_existing private.offline_visit_intake_receipts%rowtype; v_visit_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_operation_id is null then raise exception 'A stable offline operation ID is required'; end if;
 if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch not accessible'; end if;
 v_payload:=jsonb_build_object(
  'patient_id',p_patient_id,'visit_number',btrim(coalesce(p_visit_number,'')),
  'staff_id',p_staff_id,'test_ids',to_jsonb(coalesce(p_test_ids,array[]::uuid[])),
  'discount_amount',coalesce(p_discount_amount,0),'initial_payment',coalesce(p_initial_payment,0),
  'payment_method',coalesce(p_payment_method,'cash'),
  'referred_by',nullif(btrim(coalesce(p_referred_by,'')),''),'notes',nullif(btrim(coalesce(p_notes,'')),''),
  'expected_prices',coalesce(p_expected_prices,'[]'::jsonb)
 );
 perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||p_operation_id::text,0));
 select * into v_existing from private.offline_visit_intake_receipts
  where tenant_id=p_tenant_id and operation_id=p_operation_id;
 if found then
  if v_existing.branch_id<>p_branch_id or v_existing.payload<>v_payload then raise exception 'Offline operation ID was reused with different visit data'; end if;
  return v_existing.visit_id;
 end if;
 if jsonb_typeof(coalesce(p_expected_prices,'[]'::jsonb))<>'array' then raise exception 'Offline price snapshot is missing or incomplete; refresh the catalog before syncing'; end if;
 if jsonb_array_length(coalesce(p_expected_prices,'[]'::jsonb))<>cardinality(coalesce(p_test_ids,array[]::uuid[]))
  or (select count(distinct x.test_id) from jsonb_to_recordset(coalesce(p_expected_prices,'[]'::jsonb)) as x(test_id uuid,price_id uuid,selling_price numeric))<>cardinality(coalesce(p_test_ids,array[]::uuid[]))
  or exists(select 1 from unnest(coalesce(p_test_ids,array[]::uuid[])) t(test_id)
   where not exists(select 1 from jsonb_to_recordset(coalesce(p_expected_prices,'[]'::jsonb)) as x(test_id uuid,price_id uuid,selling_price numeric) where x.test_id=t.test_id)) then
  raise exception 'Offline price snapshot is missing or incomplete; refresh the catalog before syncing';
 end if;
 perform 1 from public.test_prices tp
 join jsonb_to_recordset(coalesce(p_expected_prices,'[]'::jsonb)) e(test_id uuid,price_id uuid,selling_price numeric)
  on tp.tenant_id=p_tenant_id and tp.test_id=e.test_id and tp.is_current
   and (tp.branch_id=p_branch_id or tp.branch_id is null)
 for share of tp;
 if exists(
  select 1 from jsonb_to_recordset(coalesce(p_expected_prices,'[]'::jsonb)) e(test_id uuid,price_id uuid,selling_price numeric)
  left join lateral(
   select tp.id,tp.selling_price from public.test_prices tp
   where tp.tenant_id=p_tenant_id and tp.test_id=e.test_id and tp.is_current
    and (tp.branch_id=p_branch_id or tp.branch_id is null)
   order by (tp.branch_id is not null) desc limit 1
  ) current_price on true
  where e.price_id is null or e.selling_price is null
   or current_price.id is null or current_price.id<>e.price_id
   or current_price.selling_price<>e.selling_price
 ) then raise exception 'OFFLINE_PRICE_CONFLICT: one or more test prices changed; review the visit before syncing'; end if;
 v_visit_id:=public.create_visit_intake(
  p_tenant_id,p_branch_id,p_patient_id,p_visit_number,p_staff_id,p_test_ids,
  p_discount_amount,p_initial_payment,p_payment_method,p_referred_by,p_notes
 );
 insert into private.offline_visit_intake_receipts(tenant_id,branch_id,operation_id,payload,visit_id,created_by)
 values(p_tenant_id,p_branch_id,p_operation_id,v_payload,v_visit_id,auth.uid());
 return v_visit_id;
end; $$;
revoke all on function public.create_visit_intake_idempotent(uuid,uuid,uuid,uuid,text,uuid,uuid[],numeric,numeric,text,text,text,jsonb) from public,anon;
grant execute on function public.create_visit_intake_idempotent(uuid,uuid,uuid,uuid,text,uuid,uuid[],numeric,numeric,text,text,text,jsonb) to authenticated;
commit;