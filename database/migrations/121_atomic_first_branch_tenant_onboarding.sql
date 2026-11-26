-- 121: Provision a usable first branch and doctor-owner identity for every new tenant.
-- A newly registered owner must be able to enter reception/results immediately after setup.
begin;

create or replace function public.platform_create_tenant_for_email(
  p_name text,
  p_slug text,
  p_owner_email text,
  p_plan_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_tenant_id uuid;
  v_owner_id uuid;
  v_branch_id uuid;
  v_email text:=lower(trim(coalesce(p_owner_email,'')));
  v_owner_name text;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrator required' using errcode='42501';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 160 then
    raise exception 'Lab name must be between 2 and 160 characters';
  end if;
  if lower(trim(coalesce(p_slug,''))) !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    raise exception 'Invalid lab slug';
  end if;
  if v_email='' or position('@' in v_email)<2 then
    raise exception 'Valid owner email required';
  end if;

  select u.id,
         coalesce(
           nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
           nullif(btrim(u.raw_user_meta_data->>'name'),''),
           nullif(split_part(v_email,'@',1),'')
         )
    into v_owner_id,v_owner_name
    from auth.users u
   where lower(u.email)=v_email
   limit 1;
  if v_owner_id is null then
    raise exception 'Owner must register an account before lab creation';
  end if;
  if p_plan_id is not null and not exists(
    select 1 from public.subscription_plans sp where sp.id=p_plan_id and sp.is_active
  ) then
    raise exception 'Selected plan unavailable';
  end if;

  insert into public.tenants(name,slug,status)
  values(trim(p_name),lower(trim(p_slug)),'trial')
  returning id into v_tenant_id;

  insert into public.tenant_memberships(tenant_id,user_id,account_type,is_active)
  values(v_tenant_id,v_owner_id,'owner',true);

  insert into public.branches(tenant_id,name)
  values(v_tenant_id,'الفرع الرئيسي')
  returning id into v_branch_id;

  insert into public.branch_memberships(tenant_id,branch_id,user_id,is_active)
  values(v_tenant_id,v_branch_id,v_owner_id,true);

  insert into public.staff_directory(tenant_id,branch_id,display_name,auth_user_id,is_active)
  values(
    v_tenant_id,v_branch_id,
    left(case when length(coalesce(v_owner_name,'')) between 2 and 100 then v_owner_name else 'مدير المعمل' end,100),
    v_owner_id,true
  );

  insert into public.lab_settings(tenant_id,laboratory_name,doctor_name)
  values(v_tenant_id,trim(p_name),case when length(coalesce(v_owner_name,'')) between 2 and 100 then v_owner_name else null end);

  insert into public.print_settings(tenant_id,branch_id,settings_json)
  values(v_tenant_id,null,'{}'::jsonb);

  insert into public.site_settings(tenant_id)
  values(v_tenant_id);

  insert into public.site_branch_profiles(tenant_id,branch_id,public_name,display_order,show_on_site,is_published)
  values(v_tenant_id,v_branch_id,trim(p_name),0,false,false);

  insert into public.tenant_usage(tenant_id)
  values(v_tenant_id);

  insert into public.subscriptions(tenant_id,plan_id,status,starts_at)
  values(v_tenant_id,p_plan_id,'trial',now());

  return v_tenant_id;
exception
  when unique_violation then
    raise exception 'Lab URL, owner membership, or branch identity already exists';
end
$function$;

revoke all on function public.platform_create_tenant_for_email(text,text,text,uuid) from public,anon;
grant execute on function public.platform_create_tenant_for_email(text,text,text,uuid) to authenticated;

comment on function public.platform_create_tenant_for_email(text,text,text,uuid) is
  'Creates a trial tenant with its owner, first active branch, owner operational identity, branch access, print defaults, public branch profile, usage counters, and subscription in one transaction.';

commit;
