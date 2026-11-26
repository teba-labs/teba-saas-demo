-- 124: Reject calculated expressions that do not reference another parameter.
begin;
create or replace function private.formula_ast_has_parameter(p_node jsonb)
returns boolean
language sql immutable set search_path=pg_catalog,private
as $$
  select case
    when jsonb_typeof(p_node)<>'object' then false
    when p_node ? 'param' then true
    when jsonb_typeof(p_node->'args')='array' then exists(
      select 1 from jsonb_array_elements(p_node->'args') child
       where private.formula_ast_has_parameter(child)
    )
    else false
  end
$$;

create or replace function private.master_formula_text_to_jsonb(p_formula text)
returns jsonb language plpgsql immutable set search_path=pg_catalog,private as $$
declare v_text text:=btrim(p_formula); v_json jsonb; v_tokens text[]; v_result private.formula_parse_result; v_compact text; v_joined text;
begin
 if v_text is null or v_text='' then return null; end if;
 if left(v_text,1) in ('{','[') then
  begin v_json:=v_text::jsonb; exception when others then v_json:=null; end;
  if v_json is not null then
   if jsonb_typeof(v_json)<>'object' then raise exception 'صيغة المعادلة المحفوظة غير صحيحة.' using errcode='22023'; end if;
   if not private.formula_ast_has_parameter(v_json) then raise exception 'المعادلة يجب أن تعتمد على بارامتر واحد على الأقل.' using errcode='22023'; end if;
   return v_json;
  end if;
 end if;
 select array_agg(m[1]) into v_tokens from regexp_matches(v_text,'([A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:[.][0-9]+)?|[.][0-9]+|[()+*/,-])','g') as m;
 if coalesce(array_length(v_tokens,1),0)=0 then raise exception 'اكتب معادلة حسابية نصية صحيحة.' using errcode='22023'; end if;
 select string_agg(x,'') into v_joined from unnest(v_tokens) x;
 v_compact:=regexp_replace(v_text,'[[:space:]]','','g');
 if v_joined is distinct from v_compact then raise exception 'يوجد رمز غير مدعوم في المعادلة.' using errcode='22023'; end if;
 v_result:=private.parse_formula_expression(v_tokens,1);
 if v_result.next_pos<>array_length(v_tokens,1)+1 then raise exception 'يوجد جزء زائد بعد نهاية المعادلة.' using errcode='22023'; end if;
 if not private.formula_ast_has_parameter(v_result.node) then raise exception 'المعادلة يجب أن تعتمد على بارامتر واحد على الأقل.' using errcode='22023'; end if;
 return v_result.node;
end $$;
revoke all on function private.formula_ast_has_parameter(jsonb) from public,anon;
grant execute on function private.formula_ast_has_parameter(jsonb) to authenticated;
revoke all on function private.master_formula_text_to_jsonb(text) from public,anon;
grant execute on function private.master_formula_text_to_jsonb(text) to authenticated;
commit;