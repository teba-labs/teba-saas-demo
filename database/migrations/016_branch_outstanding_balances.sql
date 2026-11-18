-- Branch-scoped outstanding balances without exposing payment rows from other collection branches.
create or replace function public.list_branch_outstanding_balances(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_limit integer default 50
)
returns table (
  visit_id uuid,
  visit_number text,
  patient_name text,
  gross_total numeric,
  discount_amount numeric,
  net_total numeric,
  paid_total numeric,
  balance numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.can_access_branch(p_tenant_id, p_branch_id) then
    raise exception 'Branch access denied';
  end if;

  return query
  select vb.visit_id,
         v.visit_number,
         p.full_name,
         vb.gross_total,
         vb.discount_amount,
         coalesce(vb.net_total, vb.gross_total - vb.discount_amount) as net_total,
         coalesce(sum(py.amount), 0)::numeric as paid_total,
         greatest(coalesce(vb.net_total, vb.gross_total - vb.discount_amount) - coalesce(sum(py.amount), 0), 0)::numeric as balance
    from public.visit_billing vb
    join public.visits v on v.id = vb.visit_id and v.tenant_id = vb.tenant_id
    join public.patients p on p.id = v.patient_id and p.tenant_id = v.tenant_id
    left join public.payments py on py.tenant_id = vb.tenant_id and py.visit_id = vb.visit_id
   where vb.tenant_id = p_tenant_id and vb.branch_id = p_branch_id
   group by vb.visit_id, v.visit_number, p.full_name, v.created_at,
            vb.gross_total, vb.discount_amount, vb.net_total
  having coalesce(vb.net_total, vb.gross_total - vb.discount_amount) - coalesce(sum(py.amount), 0) > 0.005
   order by v.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$function$;

revoke all on function public.list_branch_outstanding_balances(uuid,uuid,integer) from public, anon;
grant execute on function public.list_branch_outstanding_balances(uuid,uuid,integer) to authenticated;
