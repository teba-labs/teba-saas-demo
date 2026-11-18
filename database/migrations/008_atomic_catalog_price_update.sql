-- Batch 19: atomically replace the current catalog price.
-- Apply manually only after reviewing this migration and confirming the target project.
-- The function is SECURITY INVOKER: table grants and RLS remain in force.

create or replace function public.set_current_test_price(
  p_tenant_id uuid,
  p_test_id uuid,
  p_selling_price numeric
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare
  v_test_id uuid;
  v_price_row public.test_prices;
begin
  if p_tenant_id is null or p_test_id is null then
    raise exception 'Tenant and test are required.' using errcode = '22004';
  end if;

  if p_selling_price is null
     or p_selling_price < 0
     or p_selling_price = 'NaN'::numeric
     or p_selling_price > 9999999999.99 then
    raise exception 'Selling price must be between 0 and 9999999999.99.' using errcode = '22023';
  end if;

  if not private.is_tenant_owner(p_tenant_id) then
    raise exception 'Only the tenant owner may change catalog prices.' using errcode = '42501';
  end if;

  -- Serialize concurrent price changes for this test, including the first price.
  select tc.id
    into v_test_id
    from public.tests_catalog tc
   where tc.tenant_id = p_tenant_id
     and tc.id = p_test_id
   for update;

  if v_test_id is null then
    raise exception 'Catalog test was not found for this tenant.' using errcode = 'P0002';
  end if;

  update public.test_prices
     set is_current = false,
         updated_at = now()
   where tenant_id = p_tenant_id
     and test_id = p_test_id
     and is_current = true;

  insert into public.test_prices (
    tenant_id,
    test_id,
    selling_price,
    effective_from,
    is_current,
    updated_by,
    updated_at
  ) values (
    p_tenant_id,
    p_test_id,
    p_selling_price,
    now(),
    true,
    auth.uid(),
    now()
  )
  returning * into v_price_row;

  return to_jsonb(v_price_row);
end;
$$;

revoke all on function public.set_current_test_price(uuid, uuid, numeric) from public, anon;
grant execute on function public.set_current_test_price(uuid, uuid, numeric) to authenticated;
