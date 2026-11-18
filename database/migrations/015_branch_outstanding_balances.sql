-- Secure branch-scoped outstanding balance query for reception collections.
-- Candidate source migration only; reconcile TEST migration drift before applying.
create or replace function public.list_branch_outstanding_balances(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_limit integer default 50
)
returns table (
  visit_id uuid,
  patient_name text,
  visit_number text,
  net_total numeric,
  paid_total numeric,
  balance numeric,
  visit_work_date date
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
  select v.id,
         p.full_name,
         v.visit_number,
         vb.net_total,
         coalesce(sum(py.amount), 0)::numeric as paid_total,
         (vb.net_total - coalesce(sum(py.amount), 0))::numeric as balance,
         v.visit_work_date
    from public.visits v
    join public.patients p
      on p.id = v.patient_id and p.tenant_id = v.tenant_id
    join public.visit_billing vb
      on vb.visit_id = v.id and vb.tenant_id = v.tenant_id
    left join public.payments py
      on py.visit_id = v.id and py.tenant_id = v.tenant_id
   where v.tenant_id = p_tenant_id
     and v.branch_id = p_branch_id
     and v.status <> 'cancelled'
     and coalesce(vb.net_total, vb.gross_total - vb.discount_amount) > 0
   group by v.id, p.full_name, v.visit_number, vb.net_total, vb.gross_total,
            vb.discount_amount, v.visit_work_date, v.created_at
  having (coalesce(vb.net_total, vb.gross_total - vb.discount_amount)
          - coalesce(sum(py.amount), 0)) > 0
   order by v.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$function$;

revoke all on function public.list_branch_outstanding_balances(uuid,uuid,integer) from public, anon;
grant execute on function public.list_branch_outstanding_balances(uuid,uuid,integer) to authenticated;
