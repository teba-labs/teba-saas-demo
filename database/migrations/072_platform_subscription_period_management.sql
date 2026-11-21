-- 072: Atomic platform subscription period management.
begin;
create or replace function public.platform_update_tenant_subscription_period(
 p_tenant_id uuid,p_tenant_status text,p_plan_id uuid,p_subscription_status text,
 p_trial_ends_at timestamptz default null,p_subscription_ends_at timestamptz default null
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_subscription_id uuid;
begin
 if not private.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 if p_tenant_status not in ('trial','active','suspended','expired','closed') then raise exception 'Invalid tenant status'; end if;
 if p_subscription_status not in ('trial','active','past_due','suspended','expired','cancelled') then raise exception 'Invalid subscription status'; end if;
 if p_trial_ends_at is not null and p_subscription_ends_at is not null and p_subscription_ends_at < p_trial_ends_at then raise exception 'Subscription end cannot precede trial end'; end if;
 if p_plan_id is not null and not exists(select 1 from public.subscription_plans sp where sp.id=p_plan_id and sp.is_active) then raise exception 'Selected plan unavailable'; end if;
 update public.tenants set status=p_tenant_status where id=p_tenant_id;
 if not found then raise exception 'Lab not found'; end if;
 select s.id into v_subscription_id from public.subscriptions s where s.tenant_id=p_tenant_id order by s.created_at desc,s.id desc limit 1 for update;
 if v_subscription_id is null then
  insert into public.subscriptions(tenant_id,plan_id,status,starts_at,trial_ends_at,ends_at) values(p_tenant_id,p_plan_id,p_subscription_status,now(),p_trial_ends_at,p_subscription_ends_at);
 else
  update public.subscriptions set plan_id=p_plan_id,status=p_subscription_status,trial_ends_at=p_trial_ends_at,ends_at=p_subscription_ends_at,updated_at=now() where id=v_subscription_id;
 end if;
end $$;
revoke all on function public.platform_update_tenant_subscription_period(uuid,text,uuid,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.platform_update_tenant_subscription_period(uuid,text,uuid,text,timestamptz,timestamptz) to authenticated;
commit;
