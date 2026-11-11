-- Предложение: убрать права ролей API Supabase (anon, authenticated) с таблиц приложения в схеме public
-- и не выдавать их новым таблицам. Обоснование и порядок выката — docs/SECURITY_PRIVILEGE_AUDIT.md.
--
-- СТАТУС: ПРЕДЛОЖЕНИЕ. Не входит в apps/mock-api/src/db/migration-list.ts и сам не применяется.
-- Отдельно от предложения хранения платформы (0013–0017).
--
-- Production (проверено владельцем 2026-11-11): сервер подключается ролью postgres (не суперпользователь,
-- BYPASSRLS), она владеет всеми таблицами public; RLS на всех таблицах уже включён, FORCE выключен;
-- у anon и authenticated есть права по умолчанию (в том числе SELECT, INSERT, TRUNCATE).
--
-- Запускать ролью, которой принадлежат таблицы (в production — postgres), ОДНОЙ транзакцией:
--   psql -1 -v ON_ERROR_STOP=1 -f docs/SECURITY_REMEDIATION_PROPOSAL.sql
-- Перед запуском в production — проверенная резервная копия (раздел 7 аудита).
--
-- Что делает:
--   1) проверяет, что текущая роль — владелец каждой таблицы из списка; иначе прерывается, ничего не меняя;
--   2) запоминает прежние права anon/authenticated (таблицы и права по умолчанию) — по ним откат
--      (docs/SECURITY_REMEDIATION_ROLLBACK.sql) вернёт ровно то, что было;
--   3) REVOKE ALL у anon и authenticated на таблицах из списка;
--   4) ALTER DEFAULT PRIVILEGES FOR ROLE <текущая роль> IN SCHEMA public REVOKE ALL ON TABLES
--      FROM anon, authenticated — новые таблицы, созданные сервером, прав этим ролям не получат;
--   5) проверяет результат: у anon/authenticated нет ни одного права на таблицах из списка, и пробная
--      таблица, созданная внутри транзакции, тоже без их прав. Если нет — исключение, транзакция откатывается.
-- Чего НЕ делает: не включает и не выключает RLS (в production он уже включён; таблицы без RLS только
-- перечисляются в NOTICE), не включает FORCE, не создаёт политик, не трогает схемы и объекты Supabase
-- (auth, storage, realtime, extensions, graphql…), service_role, права владельца, данные, последовательности
-- и функции (см. аудит, раздел 6). Повторный запуск безопасен: прежнее состояние не перезаписывается.

CREATE TABLE IF NOT EXISTS security_remediation_state (
  object_name text PRIMARY KEY,           -- имя таблицы или 'default:tables:<роль>'
  kind text NOT NULL CHECK (kind IN ('table', 'default')),
  anon_privileges text[] NOT NULL,
  authenticated_privileges text[] NOT NULL,
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
  api_roles text[] := ARRAY['anon', 'authenticated'];
  me text := current_user;
  t text;
  r text;
  rel regclass;
  privs text[];
  anon_privs text[];
  auth_privs text[];
  bad text;
BEGIN
  -- 0. Роли API есть только в Supabase (в CI и локально их нет — тогда делать нечего).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ANY (api_roles)) THEN
    RAISE NOTICE 'roles anon/authenticated do not exist: nothing to do';
    RETURN;
  END IF;

  -- 1. Предусловие: текущая роль — владелец каждой существующей таблицы из списка.
  SELECT string_agg(format('%s (owner %s)', c.relname, pg_get_userbyid(c.relowner)), ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY (app_tables)
      AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = me);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'run this as the owner of the application tables; not owned by %: %', me, bad;
  END IF;

  -- 2–3. По таблицам: прежние права (один раз), затем REVOKE.
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

  -- 4. Права по умолчанию для таблиц, которые текущая роль создаст в public.
  anon_privs := '{}';
  auth_privs := '{}';
  FOREACH r IN ARRAY api_roles LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);
    SELECT coalesce(array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type), '{}') INTO privs
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = me)
        AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
        AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = r);
    IF r = 'anon' THEN anon_privs := privs; ELSE auth_privs := privs; END IF;
  END LOOP;
  INSERT INTO security_remediation_state (object_name, kind, anon_privileges, authenticated_privileges)
    VALUES ('default:tables:' || me, 'default', anon_privs, auth_privs)
    ON CONFLICT (object_name) DO NOTHING;
  FOREACH r IN ARRAY api_roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', me, r);
    END IF;
  END LOOP;

  -- 5. Проверка результата. Любое оставшееся право — исключение и откат всей транзакции.
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
        AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION '% still has effective privileges on: %', r, bad;
    END IF;
  END LOOP;
  -- Новая таблица (как её создаст будущая миграция) не должна получить права ролей API.
  CREATE TABLE public.security_remediation_probe (id int);
  SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ', ') INTO bad
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'public.security_remediation_probe'::regclass
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) = ANY (api_roles));
  DROP TABLE public.security_remediation_probe;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'a new table still receives privileges for: % (default privileges defined elsewhere, e.g. without IN SCHEMA or by another role)', bad;
  END IF;

  -- Таблицы public вне списка, где у ролей API остались права: не меняются, только перечисляются.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relname = ANY (app_tables))
      AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE pg_get_userbyid(a.grantee) = ANY (api_roles));
  IF bad IS NOT NULL THEN
    RAISE NOTICE 'tables outside the list still granted to anon/authenticated (not changed): %', bad;
  END IF;
END $$;
