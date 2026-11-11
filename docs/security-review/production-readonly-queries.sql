-- Запросы ТОЛЬКО для чтения к базе production (Supabase SQL editor или psql). Ничего не меняют:
-- всё выполняется в транзакции READ ONLY и откатывается. Результат каждого блока вставить в ответ.
-- Не вставлять: строки подключения, пароли, ключи.
BEGIN READ ONLY;

-- Q1. Версия сервера (нужна для версии pg_dump/кластера проверки восстановления).
SELECT version();

-- Q2. Роль сервера и роли API.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
FROM pg_roles WHERE rolname IN ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin')
ORDER BY rolname;

-- Q3. Таблицы public: владелец, RLS, FORCE, число политик, права ролей API (одна строка на таблицу).
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
       (SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a WHERE pg_get_userbyid(a.grantee) = 'anon') AS anon,
       (SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a WHERE pg_get_userbyid(a.grantee) = 'authenticated') AS authenticated,
       (SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a WHERE pg_get_userbyid(a.grantee) = 'service_role') AS service_role,
       (SELECT string_agg(DISTINCT pg_get_userbyid(a.grantor), ',') FROM aclexplode(c.relacl) a WHERE pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')) AS granted_by,
       EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0) AS public_grant
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- Q4. Права по умолчанию (кто создаёт объекты -> какие права получают роли). Строки с schema = '*' — глобальные.
SELECT pg_get_userbyid(d.defaclrole) AS creator, coalesce(d.defaclnamespace::regnamespace::text, '*') AS schema,
       d.defaclobjtype::text AS objtype, d.defaclacl::text AS acl
FROM pg_default_acl d ORDER BY 1, 2, 3;

-- Q5. Политики, представления, последовательности и функции в public.
SELECT 'policy' AS kind, tablename || '.' || policyname AS name, cmd || ' roles=' || roles::text AS detail FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'view', viewname, 'owner=' || viewowner FROM pg_views WHERE schemaname = 'public'
UNION ALL SELECT 'matview', matviewname, 'owner=' || matviewowner FROM pg_matviews WHERE schemaname = 'public'
UNION ALL SELECT 'sequence', c.relname, coalesce(c.relacl::text, '-') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S'
UNION ALL SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       'returns=' || pg_get_function_result(p.oid) || ' secdef=' || p.prosecdef || ' acl=' || coalesce(p.proacl::text, 'default (PUBLIC EXECUTE)')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
ORDER BY 1, 2;

-- Q6. Какие схемы открыты через Data API (PostgREST): настройки роли authenticator.
SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'authenticator';

-- Q7. Размер базы и таблиц (для выбора способа резервной копии).
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size, c.reltuples::bigint AS approx_rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC;

ROLLBACK;
