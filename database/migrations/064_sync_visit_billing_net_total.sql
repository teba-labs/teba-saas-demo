-- Recompute both gross and net visit totals when a result-workbench test is added.
create or replace function private.sync_visit_billing_for_added_test(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_visit_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_gross numeric(14,2);
  v_discount numeric(14,2);
  v_has_billing boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id,p_branch_id) then raise exception 'Branch access denied'; end if;
  perform 1 from public.visits v where v.tenant_id=p_tenant_id and v.branch_id=p_branch_id and v.id=p_visit_id for update;
  if not found then raise exception 'Visit not found for billing update'; end if;

  select coalesce(sum(vt.price_snapshot),0)::numeric(14,2) into v_gross
    from public.visit_tests vt
   where vt.tenant_id=p_tenant_id and vt.branch_id=p_branch_id and vt.visit_id=p_visit_id and vt.status<>'cancelled';
  select vb.discount_amount into v_discount
    from public.visit_billing vb where vb.visit_id=p_visit_id and vb.tenant_id=p_tenant_id and vb.branch_id=p_branch_id
    for update;
  v_has_billing := found;
  if v_has_billing then
    if coalesce(v_discount,0)>v_gross then raise exception 'Existing visit discount exceeds the updated gross total'; end if;
    update public.visit_billing set gross_total=v_gross
     where visit_id=p_visit_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
  else
    insert into public.visit_billing(tenant_id,branch_id,visit_id,gross_total,discount_amount,created_by)
    values(p_tenant_id,p_branch_id,p_visit_id,v_gross,0,auth.uid());
  end if;
end;
$function$;
