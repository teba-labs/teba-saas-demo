-- Preserve imported financial row revisions and activate them only after owner approval.
begin;

alter table public.owner_financial_import_rows
  add column if not exists is_active boolean not null default true,
  add column if not exists pending_approval boolean not null default false;

create index if not exists owner_financial_import_rows_active_period_idx
  on public.owner_financial_import_rows(tenant_id,period_date,branch_id)
  where is_active = true;

create index if not exists owner_financial_import_rows_pending_period_idx
  on public.owner_financial_import_rows(tenant_id,period_date,branch_id)
  where pending_approval = true;

create or replace function public.activate_owner_financial_import_period(
  p_tenant_id uuid,
  p_period_month date,
  p_branch_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_end date;
  v_changed integer := 0;
begin
  if auth.uid() is null or not private.is_tenant_owner(p_tenant_id) then
    raise exception 'Tenant owner access required' using errcode = '42501';
  end if;
  if p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date then
    raise exception 'A first-of-month period is required' using errcode = '22023';
  end if;
  v_end := (p_period_month + interval '1 month')::date;

  with pending as materialized (
    select id, period_date, metric_key, item_name, category_name, currency_code, branch_id
    from public.owner_financial_import_rows
    where tenant_id = p_tenant_id
      and period_date >= p_period_month
      and period_date < v_end
      and pending_approval = true
      and (p_branch_id is null or branch_id = p_branch_id)
  ),
  affected as (
    select r.id, r.pending_approval as activate_row
    from public.owner_financial_import_rows r
    where r.tenant_id = p_tenant_id
      and r.period_date >= p_period_month
      and r.period_date < v_end
      and (p_branch_id is null or r.branch_id = p_branch_id)
      and (
        r.pending_approval = true
        or (
          r.is_active = true
          and exists (
            select 1 from pending p
            where p.period_date = r.period_date
              and p.metric_key = r.metric_key
              and p.item_name is not distinct from r.item_name
              and p.category_name is not distinct from r.category_name
              and p.currency_code is not distinct from r.currency_code
              and p.branch_id is not distinct from r.branch_id
          )
        )
      )
  )
  update public.owner_financial_import_rows r
     set is_active = a.activate_row,
         pending_approval = false
    from affected a
   where r.id = a.id;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.activate_owner_financial_import_period(uuid,date,uuid) from public, anon;
grant execute on function public.activate_owner_financial_import_period(uuid,date,uuid) to authenticated;

commit;
