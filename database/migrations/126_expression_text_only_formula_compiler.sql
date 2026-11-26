-- 126: Enforce expression-only authoring for all master formula imports.
-- The master catalog stores readable arithmetic text. JSONB exists only as the compiled tenant runtime AST.
begin;
create or replace function private.master_formula_text_to_jsonb(p_formula text)
returns jsonb
language plpgsql
immutable
set search_path=pg_catalog,private
as $function$
declare
  v_text text:=btrim(p_formula);
  v_tokens text[];
  v_result private.formula_parse_result;
  v_compact text;
  v_joined text;
begin
  if v_text is null or v_text='' then return null; end if;
  if left(v_text,1) in ('{','[') then
    raise exception 'اكتب المعادلة كتعبير حسابي نصي، ولا تدخل صيغة JSON.'
      using errcode='22023';
  end if;
  select array_agg(m[1]) into v_tokens
    from regexp_matches(v_text,'([A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:[.][0-9]+)?|[.][0-9]+|[()+*/,-])','g') as m;
  if coalesce(array_length(v_tokens,1),0)=0 then
    raise exception 'اكتب معادلة حسابية نصية صحيحة.' using errcode='22023';
  end if;
  select string_agg(x,'') into v_joined from unnest(v_tokens) x;
  v_compact:=regexp_replace(v_text,'[[:space:]]','','g');
  if v_joined is distinct from v_compact then
    raise exception 'يوجد رمز غير مدعوم في المعادلة.' using errcode='22023';
  end if;
  v_result:=private.parse_formula_expression(v_tokens,1);
  if v_result.next_pos<>array_length(v_tokens,1)+1 then
    raise exception 'يوجد جزء زائد بعد نهاية المعادلة.' using errcode='22023';
  end if;
  if not private.formula_ast_has_parameter(v_result.node) then
    raise exception 'المعادلة يجب أن تعتمد على بارامتر واحد على الأقل.' using errcode='22023';
  end if;
  return v_result.node;
end
$function$;
revoke all on function private.master_formula_text_to_jsonb(text) from public,anon;
grant execute on function private.master_formula_text_to_jsonb(text) to authenticated;
comment on function private.master_formula_text_to_jsonb(text) is
'Compiles plain arithmetic expression text into the internal JSONB runtime AST. JSON text input is explicitly rejected.';
commit;