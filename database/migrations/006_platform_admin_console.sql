-- Batch 14: platform metadata administration. TEST project only; no patient data returned.
begin;
create or replace function public.platform_list_tenants()
returns table(tenant_id uuid,tenant_name text,tenant_slug text,tenant_status text,created_at timestamptz,branch_count bigint,patient_count bigint,visit_count bigint,storage_bytes bigint,subscription_id uuid,subscription_status text,plan_id uuid,plan_name text,trial_ends_at timestamptz,subscription_ends_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not private.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 return query select t.id,t.name,t.slug,t.status,t.created_at,
 coalesce((select count(*) from public.branches b where b.tenant_id=t.id),0),coalesce(u.patient_count,0),coalesce(u.visit_count,0),coalesce(u.storage_bytes,0),
 s.id,s.status,s.plan_id,p.plan_name,s.trial_ends_at,s.ends_at
 from public.tenants t left join public.tenant_usage u on u.tenant_id=t.id
 left join lateral(select ss.* from public.subscriptions ss where ss.tenant_id=t.id order by ss.created_at desc,ss.id desc limit 1)s on true
 left join public.subscription_plans p on p.id=s.plan_id order by t.created_at desc;
end $$;
create or replace function public.platform_create_tenant_for_email(p_name text,p_slug text,p_owner_email text,p_plan_id uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant_id uuid; v_owner_id uuid; v_email text:=lower(trim(coalesce(p_owner_email,'')));
begin
 if not private.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 160 then raise exception 'Lab name must be between 2 and 160 characters'; end if;
 if lower(trim(coalesce(p_slug,''))) !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then raise exception 'Invalid lab slug'; end if;
 if v_email='' or position('@' in v_email)<2 then raise exception 'Valid owner email required'; end if;
 select u.id into v_owner_id from auth.users u where lower(u.email)=v_email limit 1;
 if v_owner_id is null then raise exception 'Owner must register an account before lab creation'; end if;
 if p_plan_id is not null and not exists(select 1 from public.subscription_plans sp where sp.id=p_plan_id and sp.is_active) then raise exception 'Selected plan unavailable'; end if;
 insert into public.tenants(name,slug,status) values(trim(p_name),lower(trim(p_slug)),'trial') returning id into v_tenant_id;
 insert into public.tenant_memberships(tenant_id,user_id,account_type,is_active) values(v_tenant_id,v_owner_id,'owner',true);
 insert into public.lab_settings(tenant_id,laboratory_name) values(v_tenant_id,trim(p_name));
 insert into public.site_settings(tenant_id) values(v_tenant_id);
 insert into public.tenant_usage(tenant_id) values(v_tenant_id);
 insert into public.subscriptions(tenant_id,plan_id,status,starts_at) values(v_tenant_id,p_plan_id,'trial',now());
 return v_tenant_id;
exception when unique_violation then raise exception 'Lab URL or owner membership already exists';
end $$;
create or replace function public.platform_update_tenant_status(p_tenant_id uuid,p_status text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not private.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 if p_status not in ('trial','active','suspended','expired','closed') then raise exception 'Invalid tenant status'; end if;
 update public.tenants set status=p_status where id=p_tenant_id;
 if not found then raise exception 'Lab not found'; end if;
end $$;
create or replace function public.platform_update_subscription(p_tenant_id uuid,p_plan_id uuid,p_status text,p_trial_ends_at timestamptz default null,p_ends_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid;
begin
 if not private.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 if p_status not in ('trial','active','past_due','suspended','expired','cancelled') then raise exception 'Invalid subscription status'; end if;
 if not exists(select 1 from public.tenants t where t.id=p_tenant_id) then raise exception 'Lab not found'; end if;
 if p_plan_id is not null and not exists(select 1 from public.subscription_plans sp where sp.id=p_plan_id and sp.is_active) then raise exception 'Selected plan unavailable'; end if;
 select s.id into v_id from public.subscriptions s where s.tenant_id=p_tenant_id order by s.created_at desc,s.id desc limit 1 for update;
 if v_id is null then
  insert into public.subscriptions(tenant_id,plan_id,status,starts_at,trial_ends_at,ends_at) values(p_tenant_id,p_plan_id,p_status,now(),p_trial_ends_at,p_ends_at) returning id into v_id;
 else
  update public.subscriptions set plan_id=p_plan_id,status=p_status,trial_ends_at=p_trial_ends_at,ends_at=p_ends_at,updated_at=now() where id=v_id;
 end if;
 return v_id;
end $$;
revoke all on function public.platform_list_tenants() from public,anon;
revoke all on function public.platform_create_tenant_for_email(text,text,text,uuid) from public,anon;
revoke all on function public.platform_update_tenant_status(uuid,text) from public,anon;
revoke all on function public.platform_update_subscription(uuid,uuid,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.platform_list_tenants() to authenticated;
grant execute on function public.platform_create_tenant_for_email(text,text,text,uuid) to authenticated;
grant execute on function public.platform_update_tenant_status(uuid,text) to authenticated;
grant execute on function public.platform_update_subscription(uuid,uuid,text,timestamptz,timestamptz) to authenticated;

create or replace function public.platform_update_tenant_and_subscription(
 p_tenant_id uuid,p_tenant_status text,p_plan_id uuid,p_subscription_status text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid;
begin
 if not private.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
 if p_tenant_status not in ('trial','active','suspended','expired','closed') then raise exception 'Invalid tenant status'; end if;
 if p_subscription_status not in ('trial','active','past_due','suspended','expired','cancelled') then raise exception 'Invalid subscription status'; end if;
 if p_plan_id is not null and not exists(select 1 from public.subscription_plans sp where sp.id=p_plan_id and sp.is_active) then raise exception 'Selected plan unavailable'; end if;
 update public.tenants set status=p_tenant_status where id=p_tenant_id;
 if not found then raise exception 'Lab not found'; end if;
 select s.id into v_id from public.subscriptions s where s.tenant_id=p_tenant_id order by s.created_at desc,s.id desc limit 1 for update;
 if v_id is null then
  insert into public.subscriptions(tenant_id,plan_id,status,starts_at) values(p_tenant_id,p_plan_id,p_subscription_status,now());
 else
  update public.subscriptions set plan_id=p_plan_id,status=p_subscription_status,updated_at=now() where id=v_id;
 end if;
end $$;
revoke all on function public.platform_update_tenant_and_subscription(uuid,text,uuid,text) from public,anon;
grant execute on function public.platform_update_tenant_and_subscription(uuid,text,uuid,text) to authenticated;

commit;
