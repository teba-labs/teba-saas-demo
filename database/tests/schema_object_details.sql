select jsonb_build_object(
  'functions',
  (select coalesce(jsonb_agg(
    jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'source_md5', md5(p.prosrc),
      'security_definer', p.prosecdef,
      'config', p.proconfig
    ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  ), '[]'::jsonb) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')),
  'tables_rls',
  (select coalesce(jsonb_agg(
    jsonb_build_object('schema', n.nspname, 'table', c.relname, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity)
    order by n.nspname, c.relname
  ), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'p'))
) as detail_fingerprint;
