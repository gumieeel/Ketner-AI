-- Slice A: как RLS без политик действует на роли. Запускается суперпользователем одноразовой базы после
-- миграций 0001–0012, данных, Slice A и isolation-check-a.sql (их применяла роль ketner_backend — владелец таблиц).
--
-- Роли воспроизводят Supabase:
--   anon, authenticated — роли API Supabase (NOLOGIN, NOINHERIT, без BYPASSRLS);
--   service_role        — роль API Supabase с BYPASSRLS;
--   authenticator       — роль входа API, переключается на три роли выше через SET ROLE;
--   права по умолчанию: всё на таблицы схемы public для anon, authenticated, service_role
--   (так Supabase настраивает объекты, созданные ролью проекта).
-- Роли сервера Ketner:
--   ketner_backend      — владелец таблиц без BYPASSRLS (так работает сервер: таблицы создаёт он сам);
--   ketner_backend_bypass — то же с BYPASSRLS (на случай, если роль проекта в Supabase имеет BYPASSRLS);
--   ketner_restricted   — не владелец, без BYPASSRLS, с правами на таблицы (каким был бы сервер,
--                         если бы изоляцию хотели держать на RLS).
\set ON_ERROR_STOP 1

CREATE TEMP TABLE rls_results (role text, table_name text, rls text, select_rows text, insert_result text, truncate_result text);

CREATE FUNCTION pg_temp.probe(role_name text, tbl text, insert_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
  ins text;
  trunc text;
  rls_flag text;
BEGIN
  SELECT CASE WHEN c.relrowsecurity THEN 'on' ELSE 'off' END INTO rls_flag
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relname = tbl;
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  BEGIN
    EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO n;
  EXCEPTION WHEN OTHERS THEN
    n := -1;
  END;
  -- Вставка откатывается сразу (своя точка сохранения), результат записывается.
  IF insert_sql IS NULL THEN
    ins := 'not probed (read only)';
  ELSE
  BEGIN
    EXECUTE insert_sql;
    ins := 'inserted (rolled back)';
    RAISE EXCEPTION USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN NULL;
    WHEN OTHERS THEN ins := SQLSTATE || ' ' || left(SQLERRM, 55);
  END;
  END IF;
  -- TRUNCATE: RLS на него не действует; откатывается сразу.
  BEGIN
    EXECUTE format('TRUNCATE public.%I CASCADE', tbl);
    trunc := 'TRUNCATE allowed (rolled back)';
    RAISE EXCEPTION USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN NULL;
    WHEN OTHERS THEN trunc := SQLSTATE || ' ' || left(SQLERRM, 45);
  END;
  RESET ROLE;
  INSERT INTO rls_results VALUES (role_name, tbl, rls_flag, CASE WHEN n < 0 THEN 'no privilege' ELSE n::text END, ins, trunc);
END;
$$;

-- Вставки проб откатываются внутри probe; результаты остаются в rls_results.
DO $$
DECLARE
  r text;
  ins_pricing text := $q$INSERT INTO public.pricing_versions (version, config, catalog, created_by) VALUES (9999, '{}', '{}', 'probe')$q$;
  ins_solutions text := $q$INSERT INTO public.solutions (id, user_id, type, status, name, current_version, template) VALUES ('probe', 'probe', 'assistant', 'draft', 'p', 1, 'personal_assistant')$q$;
  ins_events text := $q$INSERT INTO public.execution_events (execution_id, user_id, seq, type) VALUES ('run_e', 'user_b', 99, 'step')$q$;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'ketner_backend', 'ketner_backend_bypass', 'ketner_restricted'] LOOP
    PERFORM pg_temp.probe(r, 'pricing_versions', ins_pricing);
    PERFORM pg_temp.probe(r, 'solutions', ins_solutions);
    PERFORM pg_temp.probe(r, 'executions', NULL);
    PERFORM pg_temp.probe(r, 'execution_events', ins_events);
  END LOOP;
END $$;
SELECT * FROM rls_results ORDER BY role, table_name;

-- Атрибуты ролей и владелец таблиц: кто обходит RLS и почему.
SELECT rolname, rolsuper AS superuser, rolbypassrls AS bypassrls,
       EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
               WHERE ns.nspname = 'public' AND c.relname = 'executions' AND pg_get_userbyid(c.relowner) = rolname) AS owns_tables
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'ketner_backend', 'ketner_backend_bypass', 'ketner_restricted')
ORDER BY rolname;

-- Существующие таблицы без RLS, которые роли API Supabase могут читать при правах по умолчанию.
SELECT c.relname AS table_without_rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select
FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND c.relname <> 'seed_snapshot'
ORDER BY c.relname;

-- Полные факты по таблицам: владелец, RLS, FORCE RLS, политики, права ролей API Supabase и сервера.
SELECT c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS relrowsecurity,
       c.relforcerowsecurity AS relforcerowsecurity,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
       (SELECT string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public' AND g.table_name = c.relname AND g.grantee = 'anon') AS anon_grants,
       (SELECT string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type) FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public' AND g.table_name = c.relname AND g.grantee = 'service_role') AS service_role_grants
FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN ('seed_snapshot')
ORDER BY c.relrowsecurity, c.relname;
