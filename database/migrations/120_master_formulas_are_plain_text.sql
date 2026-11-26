-- 120: Make the master catalog formula field a real human-readable expression.
-- The compiled JSONB AST remains an internal tenant execution detail only.
begin;

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='private' and t.typname='formula_parse_result'
  ) then
    create type private.formula_parse_result as (node jsonb, next_pos integer);
  end if;
end $$;

create or replace function private.parse_formula_primary(p_tokens text[], p_pos integer)
returns private.formula_parse_result
language plpgsql immutable set search_path=pg_catalog,private
as $$
declare
  v_token text; v_pos integer:=p_pos; v_args jsonb:='[]'::jsonb;
  v_child private.formula_parse_result; v_node jsonb; v_name text;
begin
  v_token:=p_tokens[v_pos];
  if v_token is null then raise exception 'المعادلة غير مكتملة.' using errcode='22023'; end if;
  if v_token ~ '^(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)$' then
    return row(jsonb_build_object('const',v_token::numeric),v_pos+1)::private.formula_parse_result;
  elsif v_token ~ '^[A-Za-z_][A-Za-z0-9_]*$' then
    v_name:=lower(v_token); v_pos:=v_pos+1;
    if p_tokens[v_pos]='(' then
      v_pos:=v_pos+1;
      if p_tokens[v_pos]<>')' then
        loop
          v_child:=private.parse_formula_expression(p_tokens,v_pos);
          v_args:=v_args||jsonb_build_array(v_child.node); v_pos:=v_child.next_pos;
          exit when p_tokens[v_pos]<>',';
          v_pos:=v_pos+1;
        end loop;
      end if;
      if p_tokens[v_pos]<>')' then raise exception 'قوس غير مغلق في المعادلة.' using errcode='22023'; end if;
      v_pos:=v_pos+1;
      if not ((v_name='abs' and jsonb_array_length(v_args)=1)
        or (v_name='round' and jsonb_array_length(v_args) between 1 and 2)
        or (v_name in ('min','max') and jsonb_array_length(v_args)>=2)) then
        raise exception 'دالة حسابية غير معروفة أو عدد مدخلات غير صحيح: %',v_name using errcode='22023';
      end if;
      return row(jsonb_build_object('op',v_name,'args',v_args),v_pos)::private.formula_parse_result;
    end if;
    return row(jsonb_build_object('param',v_token),v_pos)::private.formula_parse_result;
  elsif v_token='-' then
    v_child:=private.parse_formula_primary(p_tokens,v_pos+1);
    return row(jsonb_build_object('op','multiply','args',jsonb_build_array(jsonb_build_object('const',-1),v_child.node)),v_child.next_pos)::private.formula_parse_result;
  elsif v_token='+' then
    return private.parse_formula_primary(p_tokens,v_pos+1);
  elsif v_token='(' then
    v_child:=private.parse_formula_expression(p_tokens,v_pos+1);
    if p_tokens[v_child.next_pos]<>')' then raise exception 'قوس غير مغلق.' using errcode='22023'; end if;
    return row(v_child.node,v_child.next_pos+1)::private.formula_parse_result;
  end if;
  raise exception 'عنصر غير صالح في المعادلة: %',v_token using errcode='22023';
end $$;

create or replace function private.parse_formula_product(p_tokens text[], p_pos integer)
returns private.formula_parse_result
language plpgsql immutable set search_path=pg_catalog,private
as $$
declare
  v_left private.formula_parse_result; v_right private.formula_parse_result; v_op text; v_pos integer;
begin
  v_left:=private.parse_formula_primary(p_tokens,p_pos); v_pos:=v_left.next_pos;
  while p_tokens[v_pos] in ('*','/') loop
    v_op:=p_tokens[v_pos]; v_right:=private.parse_formula_primary(p_tokens,v_pos+1);
    v_left:=row(jsonb_build_object('op',case when v_op='*' then 'multiply' else 'divide' end,
      'args',jsonb_build_array(v_left.node,v_right.node)),v_right.next_pos)::private.formula_parse_result;
    v_pos:=v_right.next_pos;
  end loop;
  return v_left;
end $$;

create or replace function private.parse_formula_expression(p_tokens text[], p_pos integer)
returns private.formula_parse_result
language plpgsql immutable set search_path=pg_catalog,private
as $$
declare
  v_left private.formula_parse_result; v_right private.formula_parse_result; v_op text; v_pos integer;
begin
  v_left:=private.parse_formula_product(p_tokens,p_pos); v_pos:=v_left.next_pos;
  while p_tokens[v_pos] in ('+','-') loop
    v_op:=p_tokens[v_pos]; v_right:=private.parse_formula_product(p_tokens,v_pos+1);
    v_left:=row(jsonb_build_object('op',case when v_op='+' then 'add' else 'subtract' end,
      'args',jsonb_build_array(v_left.node,v_right.node)),v_right.next_pos)::private.formula_parse_result;
    v_pos:=v_right.next_pos;
  end loop;
  return v_left;
end $$;

create or replace function private.master_formula_text_to_jsonb(p_formula text)
returns jsonb
language plpgsql immutable
set search_path=pg_catalog,private
as $$
declare
  v_text text:=btrim(p_formula); v_json jsonb; v_tokens text[]; v_result private.formula_parse_result;
  v_compact text; v_joined text;
begin
  if v_text is null or v_text='' then return null; end if;
  if left(v_text,1) in ('{','[') then
    begin v_json:=v_text::jsonb;
    exception when others then v_json:=null;
    end;
    if v_json is not null then
      if jsonb_typeof(v_json)<>'object' then raise exception 'صيغة المعادلة المحفوظة غير صحيحة.' using errcode='22023'; end if;
      return v_json;
    end if;
  end if;
  select array_agg(m[1]) into v_tokens
  from regexp_matches(v_text,'([A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:[.][0-9]+)?|[.][0-9]+|[()+*/,-])','g') as m;
  if coalesce(array_length(v_tokens,1),0)=0 then raise exception 'اكتب معادلة حسابية نصية صحيحة.' using errcode='22023'; end if;
  select string_agg(x,'') into v_joined from unnest(v_tokens) x;
  v_compact:=regexp_replace(v_text,'[[:space:]]','','g');
  if v_joined is distinct from v_compact then raise exception 'يوجد رمز غير مدعوم في المعادلة.' using errcode='22023'; end if;
  v_result:=private.parse_formula_expression(v_tokens,1);
  if v_result.next_pos<>array_length(v_tokens,1)+1 then raise exception 'يوجد جزء زائد بعد نهاية المعادلة.' using errcode='22023'; end if;
  if not (v_result.node ? 'param' or v_result.node ? 'args') then raise exception 'المعادلة يجب أن تعتمد على بارامتر واحد على الأقل.' using errcode='22023'; end if;
  return v_result.node;
end $$;

-- Replace serialized AST text in the master authoring column with the expression
-- that doctors edit. formula_expression is retained as the backwards-compatible alias.
update public.master_catalog_parameters
   set formula=formula_expression
 where result_source='calculated'
   and nullif(btrim(formula_expression),'') is not null;

revoke all on function private.parse_formula_primary(text[],integer) from public,anon;
revoke all on function private.parse_formula_product(text[],integer) from public,anon;
revoke all on function private.parse_formula_expression(text[],integer) from public,anon;
revoke all on function private.master_formula_text_to_jsonb(text) from public,anon;
grant execute on function private.master_formula_text_to_jsonb(text) to authenticated;

comment on column public.master_catalog_parameters.formula is
  'Human-readable arithmetic expression text. The tenant runtime compiles this to a private JSONB AST at import time.';

commit;