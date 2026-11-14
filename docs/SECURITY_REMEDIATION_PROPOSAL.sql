-- Предложение: убрать права ролей API Supabase (anon, authenticated) с таблиц и функций приложения
-- в схеме public и не выдавать их новым таблицам и функциям. Обоснование и порядок выката —
-- docs/SECURITY_PRIVILEGE_AUDIT.md.
--
-- СТАТУС: ПРЕДЛОЖЕНИЕ. Не входит в apps/mock-api/src/db/migration-list.ts и сам не применяется.
-- Отдельно от предложения хранения платформы (0013–0017).
--
-- Production (проверено владельцем 2026-11-11): сервер подключается ролью postgres (не суперпользователь,
-- BYPASSRLS), она владеет всеми таблицами public; RLS на всех таблицах уже включён, FORCE выключен;
-- политик и представлений в public нет; у anon и authenticated есть права по умолчанию
-- (в том числе SELECT, INSERT, TRUNCATE). PostgreSQL 17.6.
--
-- Запускать ролью, которой принадлежат таблицы (в production — postgres), ОДНОЙ транзакцией:
--   psql -1 -v ON_ERROR_STOP=1 -f docs/SECURITY_REMEDIATION_PROPOSAL.sql
-- Перед запуском в production — проверенная резервная копия (раздел 7 аудита).
--
-- Что делает:
--   1) проверяет, что текущая роль — владелец каждой таблицы и функции из списков; иначе прерывается,
--      ничего не меняя;
--   2) запоминает прежние права (таблицы, функции, права по умолчанию) — по ним откат
--      (docs/SECURITY_REMEDIATION_ROLLBACK.sql) вернёт ровно то, что было;
--   3) таблицы: REVOKE ALL у anon и authenticated;
--   4) функции приложения: REVOKE EXECUTE у PUBLIC, anon и authenticated (вызывает их только сервер —
--      владелец; триггерам право EXECUTE при срабатывании не нужно);
--   5) права по умолчанию для объектов, которые создаёт текущая роль:
--      - IN SCHEMA public: REVOKE ALL ON TABLES, ON SEQUENCES и ON FUNCTIONS FROM anon, authenticated;
--      - ГЛОБАЛЬНО (без IN SCHEMA): REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC. Встроенное право PUBLIC
--        на функции — глобальное, отозвать его только для одной схемы PostgreSQL не позволяет. Следствие:
--        функции, которые эта роль создаст в ЛЮБОЙ схеме, не будут доступны PUBLIC без явного GRANT;
--   6) проверяет результат: у anon/authenticated нет прав на таблицах и функциях из списков (на 17 —
--      включая MAINTAIN); пробные таблица, последовательность и функция, созданные внутри транзакции,
--      не получают их прав. Иначе — исключение и откат.
-- В production в public есть событийный триггер rls_auto_enable() (SECURITY DEFINER): он включает RLS на
-- каждой новой таблице. Скрипт его не трогает; пробная таблица тоже получает RLS — это не мешает проверке.
-- Права по умолчанию роли supabase_admin в public (такие же, как у postgres) действуют только на объекты,
-- которые создаёт supabase_admin; скрипт их не меняет (объекты Supabase).
-- Чего НЕ делает: не включает и не выключает RLS (в production он уже включён; таблицы без RLS только
-- перечисляются в NOTICE), не включает FORCE, не создаёт политик, не трогает схемы и объекты Supabase
-- (auth, storage, realtime, extensions, graphql…), service_role, права владельца, данные и
-- последовательности (см. аудит, раздел 6). Повторный запуск безопасен: прежнее состояние не перезаписывается.

CREATE TABLE IF NOT EXISTS security_remediation_state (
  -- таблица; функция ('имя(аргументы)'); 'default:tables:<роль>'; 'default:functions:<роль>';
  -- 'default:sequences:<роль>'; 'default:functions-global:<роль>'
  object_name text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('table', 'function', 'default')),
  anon_privileges text[] NOT NULL,
  authenticated_privileges text[] NOT NULL,
  public_privileges text[] NOT NULL DEFAULT '{}',   -- права PUBLIC (для функций)
  applied_at timestamptz NOT NULL DEFAULT now()
);
-- Как у всех таблиц production: RLS без политик (владелец и service_role его обходят).
ALTER TABLE security_remediation_state ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  app_tables text[] := ARRAY[
    -- Better Auth (auth/better-auth.ts)
    'user', 'session', 'account', 'verification',
    -- Старые таблицы, создаются сервером при старте (db/sync.ts, code/postgres-driver.ts, images/image-store.ts)
    'ketner_users', 'conversations', 'messages', 'subscriptions', 'feedbacks', 'usage_metrics', 'api_keys',
    'revoked_tokens', 'github_connections', 'crypto_invoices', 'ketner_docs', 'code_projects',
    'code_project_files', 'generated_images',
    -- Устаревший 0000_init.sql (может отсутствовать)
    'billing_events',
    -- Раннер миграций
    'schema_migrations',
    -- Миграции 0001–0011
    'discovery_analyses', 'discovery_opportunities', 'discovery_budget_days', 'discovery_budget_reservations',
    'discovery_plans', 'solutions', 'solution_versions', 'solution_test_cases', 'solution_test_runs',
    'solution_threads', 'solution_messages', 'bot_conversations', 'bot_messages', 'bot_leads',
    'solution_materials', 'solution_runs', 'solution_attempts',
    -- Миграция 0012
    'pricing_versions', 'implementation_estimates', 'implementation_requests', 'pricing_audit_log',
    -- Сама служебная таблица
    'security_remediation_state'
  ];
  -- Функции приложения в public (сигнатура для to_regprocedure).
  app_functions text[] := ARRAY[
    'solutions_legacy_template()'      -- миграция 0011, триггер
  ];
  api_roles text[] := ARRAY['anon', 'authenticated'];
  me text := current_user;
  me_oid oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
  t text;
  r text;
  rel regclass;
  fn regprocedure;
  privs text[];
  anon_privs text[];
  auth_privs text[];
  public_privs text[];
  bad text;
  probe_fn regprocedure;
  -- MAINTAIN появился в PostgreSQL 17; на 16 has_table_privilege его не знает.
  table_privs text := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    || CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ',MAINTAIN' ELSE '' END;
BEGIN
  -- 0. Роли API есть только в Supabase (в CI и локально их нет — тогда делать нечего).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ANY (api_roles)) THEN
    RAISE NOTICE 'roles anon/authenticated do not exist: nothing to do';
    RETURN;
  END IF;

  -- 1. Предусловие: текущая роль — владелец каждой существующей таблицы и функции из списков.
  SELECT string_agg(format('%s (owner %s)', c.relname, pg_get_userbyid(c.relowner)), ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY (app_tables)
      AND c.relowner <> me_oid;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'run this as the owner of the application tables; not owned by %: %', me, bad;
  END IF;
  SELECT string_agg(format('%s (owner %s)', p.oid::regprocedure, pg_get_userbyid(p.proowner)), ', ') INTO bad
    FROM unnest(app_functions) f(sig) JOIN pg_proc p ON p.oid = to_regprocedure('public.' || f.sig)
    WHERE p.proowner <> me_oid;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'run this as the owner of the application functions; not owned by %: %', me, bad;
  END IF;

  -- 2–3. Таблицы: прежние права (один раз), затем REVOKE.
  FOREACH t IN ARRAY app_tables LOOP
    rel := to_regclass(format('public.%I', t));
    CONTINUE WHEN rel IS NULL;
    anon_privs := '{}';
    auth_privs := '{}';
    FOREACH r IN ARRAY api_roles LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
      SELECT coalesce(array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type), '{}') INTO privs
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE c.oid = rel AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = r);
      IF r = 'anon' THEN anon_privs := privs; ELSE auth_privs := privs; END IF;
      -- Права на отдельные колонки снимаются вместе с правами на таблицу; откат их не вернёт.
      IF EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
                 WHERE a.attrelid = rel AND x.grantee = (SELECT oid FROM pg_roles WHERE rolname = r)) THEN
        RAISE NOTICE 'column privileges of % on % will be revoked and are not restored by the rollback', r, t;
      END IF;
    END LOOP;
    INSERT INTO security_remediation_state (object_name, kind, anon_privileges, authenticated_privileges)
      VALUES (t, 'table', anon_privs, auth_privs)
      ON CONFLICT (object_name) DO NOTHING;
    FOREACH r IN ARRAY api_roles LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', rel, r);
      END IF;
    END LOOP;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      RAISE NOTICE 'table % has RLS disabled (not changed by this script)', t;
    END IF;
  END LOOP;

  -- 4. Функции: прежние права (NULL в proacl = встроенное право: EXECUTE у PUBLIC), затем REVOKE.
  FOREACH t IN ARRAY app_functions LOOP
    fn := to_regprocedure('public.' || t);
    CONTINUE WHEN fn IS NULL;
    SELECT coalesce((SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type)
                       FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon')), '{}'),
           coalesce((SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type)
                       FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')), '{}'),
           coalesce((SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type)
                       FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      WHERE a.grantee = 0), '{}')
      INTO anon_privs, auth_privs, public_privs
      FROM pg_proc p WHERE p.oid = fn;
    INSERT INTO security_remediation_state (object_name, kind, anon_privileges, authenticated_privileges, public_privileges)
      VALUES (t, 'function', anon_privs, auth_privs, public_privs)
      ON CONFLICT (object_name) DO NOTHING;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    FOREACH r IN ARRAY api_roles LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', fn, r);
      END IF;
    END LOOP;
  END LOOP;

  -- 5. Права по умолчанию для объектов, которые создаст текущая роль.
  -- 5a. Таблицы, последовательности и функции в public: роли API.
  FOREACH t IN ARRAY ARRAY['r', 'S', 'f'] LOOP
    anon_privs := '{}';
    auth_privs := '{}';
    FOREACH r IN ARRAY api_roles LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
      SELECT coalesce(array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type), '{}') INTO privs
        FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        WHERE d.defaclrole = me_oid AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = t::"char"
          AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = r);
      IF r = 'anon' THEN anon_privs := privs; ELSE auth_privs := privs; END IF;
    END LOOP;
    INSERT INTO security_remediation_state (object_name, kind, anon_privileges, authenticated_privileges)
      VALUES (CASE t WHEN 'r' THEN 'default:tables:' WHEN 'S' THEN 'default:sequences:' ELSE 'default:functions:' END || me,
              'default', anon_privs, auth_privs)
      ON CONFLICT (object_name) DO NOTHING;
    FOREACH r IN ARRAY api_roles LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON %s FROM %I',
                       me, CASE t WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' ELSE 'FUNCTIONS' END, r);
      END IF;
    END LOOP;
  END LOOP;
  -- 5b. Функции глобально: PUBLIC. Нет записи в pg_default_acl — действует встроенное право (EXECUTE у PUBLIC).
  SELECT coalesce((SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type)
                     FROM aclexplode(coalesce(
                       (SELECT d.defaclacl FROM pg_default_acl d
                         WHERE d.defaclrole = me_oid AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f'),
                       acldefault('f', me_oid))) a
                    WHERE a.grantee = 0), '{}')
    INTO public_privs;
  INSERT INTO security_remediation_state (object_name, kind, anon_privileges, authenticated_privileges, public_privileges)
    VALUES ('default:functions-global:' || me, 'default', '{}', '{}', public_privs)
    ON CONFLICT (object_name) DO NOTHING;
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', me);

  -- 6. Проверка результата. Любое оставшееся право — исключение и откат всей транзакции.
  SELECT string_agg(DISTINCT format('%s: %s', c.relname, pg_get_userbyid(a.grantee)), ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname = 'public' AND c.relname = ANY (app_tables)
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) = ANY (api_roles));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'privileges remain after REVOKE (granted by another role or to PUBLIC): %', bad;
  END IF;
  FOREACH r IN ARRAY api_roles LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    SELECT string_agg(c.relname, ', ') INTO bad
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY (app_tables)
        AND has_table_privilege(r, c.oid, table_privs);
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION '% still has effective privileges on: %', r, bad;
    END IF;
    SELECT string_agg(f.sig, ', ') INTO bad
      FROM unnest(app_functions) f(sig)
      WHERE to_regprocedure('public.' || f.sig) IS NOT NULL
        AND has_function_privilege(r, to_regprocedure('public.' || f.sig), 'EXECUTE');
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION '% can still execute: %', r, bad;
    END IF;
  END LOOP;
  -- Новые таблица, последовательность и функция (как их создаст будущая миграция) не должны получить
  -- права ролей API и PUBLIC.
  CREATE TABLE public.security_remediation_probe (id int);
  CREATE SEQUENCE public.security_remediation_probe_seq;
  SELECT string_agg(r2, ', ') INTO bad
    FROM unnest(api_roles) r2
    WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r2)
      AND has_sequence_privilege(r2, 'public.security_remediation_probe_seq', 'USAGE,SELECT,UPDATE');
  DROP SEQUENCE public.security_remediation_probe_seq;
  IF bad IS NOT NULL THEN
    DROP TABLE public.security_remediation_probe;
    RAISE EXCEPTION 'a new sequence still receives privileges for: % (default privileges defined elsewhere)', bad;
  END IF;
  CREATE FUNCTION public.security_remediation_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
  probe_fn := 'public.security_remediation_probe_fn()'::regprocedure;
  SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ', ') INTO bad
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'public.security_remediation_probe'::regclass
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) = ANY (api_roles));
  IF bad IS NOT NULL THEN
    DROP TABLE public.security_remediation_probe;
    RAISE EXCEPTION 'a new table still receives privileges for: % (default privileges defined elsewhere, e.g. without IN SCHEMA or by another role)', bad;
  END IF;
  SELECT string_agg(r2, ', ') INTO bad
    FROM unnest(api_roles) r2
    WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r2) AND has_function_privilege(r2, probe_fn, 'EXECUTE');
  DROP TABLE public.security_remediation_probe;
  DROP FUNCTION public.security_remediation_probe_fn();
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'a new function is still executable by: % (default privileges defined elsewhere)', bad;
  END IF;

  -- Таблицы и функции public вне списков, где у ролей API или PUBLIC остались права: не меняются, только перечисляются.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relname = ANY (app_tables))
      AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE pg_get_userbyid(a.grantee) = ANY (api_roles));
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'tables outside the list still granted to anon/authenticated (not changed): %', bad;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND NOT (p.oid::regprocedure::text = ANY (app_functions))
      AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'functions outside the list still executable by anon (not changed): %', bad;
  END IF;
END $$;
