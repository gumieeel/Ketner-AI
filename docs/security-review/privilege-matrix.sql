-- Права ролей API и RLS по всем таблицам схемы public (одна строка на таблицу).
\pset format unaligned
\pset tuples_only on
SELECT c.relname || '|owner=' || pg_get_userbyid(c.relowner) || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
  || '|anon=' || coalesce((SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a
       WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon')), '-')
  || '|authenticated=' || coalesce((SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a
       WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')), '-')
  || '|service_role=' || coalesce((SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a
       WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'service_role')), '-')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;
