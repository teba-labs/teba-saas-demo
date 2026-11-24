-- 109: Patient portal is opt-in per tenant and settings are saved atomically.
begin;

alter table public.tenants
  add column if not exists patient_portal_enabled boolean not null default false;

alter table public.site_settings
  alter column portal_settings set default jsonb_build_object(
    'enabled', false,
    'title', 'استعلام النتائج',
    'subtitle', 'أدخل رقم المريض ورقم الزيارة وكود الاستلام',
    'helpText', 'إذا لم تتوفر البيانات، تواصل مع المعمل.',
    'logoUrl', null,
    'primaryColor', '#0f766e'
  );

update public.tenants set patient_portal_enabled=false;
update public.site_settings
   set portal_settings=jsonb_set(coalesce(portal_settings,'{}'::jsonb),'{enabled}','false'::jsonb,true),
       updated_at=now();

create or replace function public.save_patient_portal_settings(
  p_tenant_id uuid,
  p_portal_settings jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_enabled boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.is_tenant_owner(p_tenant_id) then raise exception 'Tenant owner access required'; end if;
  if jsonb_typeof(p_portal_settings) <> 'object' then raise exception 'Portal settings must be a JSON object'; end if;
  if jsonb_typeof(p_portal_settings->'enabled') <> 'boolean' then raise exception 'Portal enabled must be an explicit boolean'; end if;

  v_enabled := (p_portal_settings->>'enabled')::boolean;

  insert into public.site_settings(tenant_id,portal_settings,updated_by,updated_at)
  values(p_tenant_id,p_portal_settings,auth.uid(),now())
  on conflict (tenant_id) do update
    set portal_settings=excluded.portal_settings,
        updated_by=auth.uid(),
        updated_at=now();

  update public.tenants
     set patient_portal_enabled=v_enabled
   where id=p_tenant_id;

  return v_enabled;
end;
$function$;

revoke all on function public.save_patient_portal_settings(uuid,jsonb) from public, anon;
grant execute on function public.save_patient_portal_settings(uuid,jsonb) to authenticated;

comment on column public.tenants.patient_portal_enabled is
  'Explicit tenant opt-in for patient portal and portal-based WhatsApp result sharing. Disabled by default.';
comment on function public.save_patient_portal_settings(uuid,jsonb) is
  'Owner-only atomic update of patient portal configuration and the tenant feature flag.';

commit;
