-- 125: Keep the current production console compatible until the text-first admin UI is deployed.
begin;
create or replace function public.platform_create_tenant_for_email(
 p_name text,p_slug text,p_owner_email text,p_plan_id uuid default null
) returns uuid
language plpgsql security definer set search_path=pg_catalog
as $function$
begin
 return public.platform_create_tenant_for_email(p_name,p_slug,p_owner_email,null,p_plan_id);
end
$function$;
revoke all on function public.platform_create_tenant_for_email(text,text,text,uuid) from public,anon;
grant execute on function public.platform_create_tenant_for_email(text,text,text,uuid) to authenticated;
comment on function public.platform_create_tenant_for_email(text,text,text,uuid) is
'Backward-compatible wrapper for the currently deployed platform console. Creates the full first-branch tenant setup and uses the Auth profile name or the default manager label when no doctor name is supplied.';
commit;