-- Запросы к production только для чтения. Каждый запрос — один оператор SELECT с одним набором строк:
-- выполнять в Supabase SQL editor ПО ОДНОМУ (вставить один запрос, выполнить, скопировать результат).
-- Ни один запрос ничего не меняет и не создаёт. Результат вставлять без строк подключения и ключей.
-- Уже проверено владельцем 11.11.2026 и здесь не запрашивается: роль сервера и её атрибуты, владелец
-- таблиц, RLS/FORCE, политики и представления (нет), версия (PostgreSQL 17.6).

-- R1. Права на каждую таблицу public (одна строка на таблицу).
SELECT c.relname AS table_name,
       (SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a WHERE a.grantee = 'anon'::regrole) AS anon,
       (SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a WHERE a.grantee = 'authenticated'::regrole) AS authenticated,
       (SELECT string_agg(DISTINCT a.privilege_type, ',' ORDER BY a.privilege_type) FROM aclexplode(c.relacl) a WHERE a.grantee = 'service_role'::regrole) AS service_role,
       (SELECT string_agg(DISTINCT pg_get_userbyid(a.grantor), ',') FROM aclexplode(c.relacl) a WHERE a.grantee IN ('anon'::regrole, 'authenticated'::regrole)) AS granted_by,
       EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0) AS public_grant,
       EXISTS (SELECT 1 FROM pg_attribute att CROSS JOIN LATERAL aclexplode(att.attacl) x
               WHERE att.attrelid = c.oid AND x.grantee IN ('anon'::regrole, 'authenticated'::regrole)) AS column_grants
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- R2. Права по умолчанию: кто создаёт объекты и какие права получают роли. schema = '*' — глобальные.
SELECT pg_get_userbyid(d.defaclrole) AS creator,
       coalesce(d.defaclnamespace::regnamespace::text, '*') AS schema,
       d.defaclobjtype::text AS object_type,   -- r таблицы, S последовательности, f функции, T типы, n схемы
       d.defaclacl::text AS acl
FROM pg_default_acl d
ORDER BY 1, 2, 3;

-- R3. Последовательности и функции в public с их правами.
SELECT 'sequence' AS kind, c.relname AS name, pg_get_userbyid(c.relowner) AS owner,
       coalesce(c.relacl::text, '-') AS acl, NULL::text AS detail
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
UNION ALL
SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_userbyid(p.proowner),
       coalesce(p.proacl::text, 'default (EXECUTE to PUBLIC)'),
       'returns ' || pg_get_function_result(p.oid) || CASE WHEN p.prosecdef THEN ', SECURITY DEFINER' ELSE '' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY 1, 2;

-- R4. Настройки ролей API (здесь может быть pgrst.db_schemas). Если пусто — открытые схемы смотреть
-- в панели Supabase: Project Settings → Data API → Exposed schemas.
SELECT r.rolname, coalesce(array_to_string(r.rolconfig, '; '), '-') AS settings
FROM pg_roles r
WHERE r.rolname IN ('authenticator', 'anon', 'authenticated', 'service_role')
ORDER BY r.rolname;

-- R5. Размер базы и таблиц public (для резервной копии: время pg_dump и место).
SELECT '(database)' AS name, pg_size_pretty(pg_database_size(current_database())) AS size, NULL::bigint AS approx_rows,
       pg_database_size(current_database()) AS bytes
UNION ALL
SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)), c.reltuples::bigint, pg_total_relation_size(c.oid)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY bytes DESC;
