import type { Migration } from './migrate.js';

/**
 * Версионные миграции по порядку (правила — в `db/migrate.ts`). Применённую миграцию не меняют и
 * не удаляют: изменение схемы — всегда новая запись в конце списка.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    // Платформа решений, этап 2 (docs/MIGRATION_PLAN.md): анализы задач, найденные возможности
    // и суточный бюджет бесплатных анализов (docs/discovery-models.md, раздел 3).
    id: '0001_discovery',
    sql: `
      CREATE TABLE discovery_analyses (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        guest boolean NOT NULL DEFAULT false,
        ip_hash text,
        ip_limited boolean NOT NULL DEFAULT false,
        mode text NOT NULL CHECK (mode IN ('free', 'paid', 'deep')),
        language text NOT NULL CHECK (language IN ('ru', 'en')),
        status text NOT NULL,
        input_text text NOT NULL,
        context jsonb,
        questions jsonb NOT NULL DEFAULT '[]'::jsonb,
        answers jsonb NOT NULL DEFAULT '{}'::jsonb,
        summary text,
        stage_runs jsonb NOT NULL DEFAULT '{}'::jsonb,
        budget_day date NOT NULL,
        idempotency_key text,
        saved boolean NOT NULL DEFAULT false,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX discovery_analyses_idempotency
        ON discovery_analyses (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX discovery_analyses_user ON discovery_analyses (user_id, created_at DESC);
      CREATE INDEX discovery_analyses_day ON discovery_analyses (budget_day, mode);
      CREATE INDEX discovery_analyses_ip ON discovery_analyses (ip_hash, budget_day)
        WHERE ip_hash IS NOT NULL;

      CREATE TABLE discovery_opportunities (
        id text PRIMARY KEY,
        analysis_id text NOT NULL REFERENCES discovery_analyses (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        position integer NOT NULL,
        title text NOT NULL,
        feasibility_status text NOT NULL
          CHECK (feasibility_status IN ('ready', 'needs_setup', 'needs_integration', 'not_supported')),
        priority integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX discovery_opportunities_analysis
        ON discovery_opportunities (analysis_id, user_id, position);

      CREATE TABLE discovery_budget_days (
        day date PRIMARY KEY,
        limit_usd numeric(12, 6) NOT NULL,
        spent_usd numeric(12, 6) NOT NULL DEFAULT 0,
        reserved_usd numeric(12, 6) NOT NULL DEFAULT 0
      );

      CREATE TABLE discovery_budget_reservations (
        id text PRIMARY KEY,
        day date NOT NULL REFERENCES discovery_budget_days (day),
        analysis_id text NOT NULL,
        stage text NOT NULL,
        cap_usd numeric(12, 6) NOT NULL,
        actual_usd numeric(12, 6),
        status text NOT NULL CHECK (status IN ('held', 'running', 'settled', 'released')),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX discovery_budget_reservations_open
        ON discovery_budget_reservations (expires_at) WHERE status IN ('held', 'running');
      CREATE INDEX discovery_budget_reservations_analysis
        ON discovery_budget_reservations (analysis_id);
    `,
  },
  {
    // Этап 4: удаление анализа. Запись остаётся без содержимого (текст, контекст, ответы, отчёт
    // стираются, возможности удаляются), чтобы удаление не обнуляло суточные лимиты бесплатных
    // анализов: они считают и удалённые анализы.
    id: '0002_discovery_deleted',
    sql: `
      ALTER TABLE discovery_analyses ADD COLUMN deleted_at timestamptz;
      CREATE INDEX discovery_analyses_saved ON discovery_analyses (user_id, saved)
        WHERE deleted_at IS NULL;
    `,
  },
  {
    // Этап 5: планы внедрения. Один план на возможность (уникальный индекс защищает от двойного
    // запуска); план удаляется вместе с возможностью (повторный поиск возможностей, удаление
    // анализа). Шаги со статусами — в `data`, запись защищена версией, как анализ.
    id: '0003_discovery_plans',
    sql: `
      CREATE TABLE discovery_plans (
        id text PRIMARY KEY,
        analysis_id text NOT NULL REFERENCES discovery_analyses (id) ON DELETE CASCADE,
        opportunity_id text NOT NULL REFERENCES discovery_opportunities (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('brief', 'full')),
        mode text NOT NULL CHECK (mode IN ('free', 'paid', 'deep')),
        sponsored boolean NOT NULL DEFAULT false,
        status text NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
        data jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX discovery_plans_opportunity ON discovery_plans (opportunity_id);
      CREATE INDEX discovery_plans_analysis ON discovery_plans (analysis_id, user_id);
    `,
  },
  {
    // Этап 6: Builder — персональные помощники. Настройки хранятся версиями, тест-кейсы и прогоны
    // привязаны к версии, у помощника свой чат. Всё удаляется вместе с помощником.
    id: '0004_solutions',
    sql: `
      CREATE TABLE solutions (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        type text NOT NULL CHECK (type IN ('assistant')),
        status text NOT NULL CHECK (status IN ('draft', 'active', 'paused')),
        name text NOT NULL,
        current_version integer NOT NULL,
        active_version integer,
        source jsonb,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX solutions_user ON solutions (user_id, updated_at DESC);

      CREATE TABLE solution_versions (
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        number integer NOT NULL,
        config jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (solution_id, number)
      );

      CREATE TABLE solution_test_cases (
        id text PRIMARY KEY,
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        position integer NOT NULL,
        input text NOT NULL,
        criteria jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX solution_test_cases_solution ON solution_test_cases (solution_id, position);

      CREATE TABLE solution_test_runs (
        id text PRIMARY KEY,
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        version_number integer NOT NULL,
        cases_hash text NOT NULL,
        status text NOT NULL CHECK (status IN ('running', 'done')),
        results jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      );
      CREATE INDEX solution_test_runs_solution ON solution_test_runs (solution_id, created_at DESC);

      CREATE TABLE solution_threads (
        id text PRIMARY KEY,
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        title text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX solution_threads_solution ON solution_threads (solution_id, updated_at DESC);

      CREATE TABLE solution_messages (
        id text PRIMARY KEY,
        thread_id text NOT NULL REFERENCES solution_threads (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        role text NOT NULL CHECK (role IN ('user', 'assistant')),
        content text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL CHECK (status IN ('complete', 'error')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX solution_messages_thread ON solution_messages (thread_id, created_at);
    `,
  },
  {
    // Анализ по плану (docs/AUTOMATION_PLAN.md, этап A): карта из пяти областей и прочитанный
    // сайт из описания. Область и рецепт возможности лежат в её `data`.
    id: '0005_discovery_coverage',
    sql: `
      ALTER TABLE discovery_analyses ADD COLUMN coverage jsonb;
      ALTER TABLE discovery_analyses ADD COLUMN source jsonb;
    `,
  },
  {
    // Бот для клиентов (docs/AUTOMATION_PLAN.md, этап B): тип решения `customer_bot`, его
    // настройки и адрес страницы, диалоги посетителей и заявки владельцу.
    id: '0006_customer_bots',
    sql: `
      ALTER TABLE solutions DROP CONSTRAINT IF EXISTS solutions_type_check;
      ALTER TABLE solutions ADD CONSTRAINT solutions_type_check
        CHECK (type IN ('assistant', 'customer_bot'));
      ALTER TABLE solutions ADD COLUMN bot jsonb;
      ALTER TABLE solutions ADD COLUMN slug text;
      CREATE UNIQUE INDEX solutions_slug ON solutions (slug) WHERE slug IS NOT NULL;

      CREATE TABLE bot_conversations (
        id text PRIMARY KEY,
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        visitor_id text NOT NULL,
        message_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX bot_conversations_solution ON bot_conversations (solution_id, updated_at DESC);

      CREATE TABLE bot_messages (
        id text PRIMARY KEY,
        conversation_id text NOT NULL REFERENCES bot_conversations (id) ON DELETE CASCADE,
        solution_id text NOT NULL,
        user_id text NOT NULL,
        role text NOT NULL CHECK (role IN ('user', 'assistant')),
        content text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        credits_usd numeric(12, 6) NOT NULL DEFAULT 0,
        status text NOT NULL CHECK (status IN ('complete', 'error')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX bot_messages_conversation ON bot_messages (conversation_id, created_at);
      CREATE INDEX bot_messages_solution_day ON bot_messages (solution_id, created_at);

      CREATE TABLE bot_leads (
        id text PRIMARY KEY,
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        conversation_id text,
        name text NOT NULL,
        contact text NOT NULL,
        question text NOT NULL DEFAULT '',
        status text NOT NULL CHECK (status IN ('new', 'done')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX bot_leads_solution ON bot_leads (solution_id, created_at DESC);
    `,
  },
  {
    // Builder: виды решений (помощник, инструмент, процесс) и шаблон из реестра
    // builder/templates.ts. Существующие решения получают шаблон по своему типу и работают как раньше.
    id: '0007_solution_templates',
    sql: `
      ALTER TABLE solutions DROP CONSTRAINT IF EXISTS solutions_type_check;
      ALTER TABLE solutions ADD CONSTRAINT solutions_type_check
        CHECK (type IN ('assistant', 'customer_bot', 'tool', 'workflow'));
      ALTER TABLE solutions ADD COLUMN template text;
      UPDATE solutions
        SET template = CASE type WHEN 'customer_bot' THEN 'customer_bot' ELSE 'personal_assistant' END
        WHERE template IS NULL;
      ALTER TABLE solutions ALTER COLUMN template SET NOT NULL;
    `,
  },
  {
    // Материалы инструментов (учебный помощник): извлечённый браузером текст документа по частям.
    // Исходный файл не хранится. outline — части без текста, для списков.
    id: '0008_solution_materials',
    sql: `
      CREATE TABLE solution_materials (
        id text PRIMARY KEY,
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        name text NOT NULL,
        format text NOT NULL CHECK (format IN ('pdf', 'docx', 'pptx', 'xlsx', 'txt')),
        size_bytes integer NOT NULL CHECK (size_bytes > 0),
        char_count integer NOT NULL CHECK (char_count > 0),
        outline jsonb NOT NULL,
        sections jsonb NOT NULL,
        content_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX solution_materials_content ON solution_materials (solution_id, content_hash);
      CREATE INDEX solution_materials_owner ON solution_materials (user_id, solution_id, created_at DESC);
    `,
  },
  {
    // Запуски операций инструментов (конспект, таблица…): вход, источники без текста, цена до запуска,
    // результат и фактическое списание. Идемпотентность — уникальный ключ пользователя; в одном
    // инструменте одновременно идёт не больше одного запуска (частичный уникальный индекс).
    id: '0009_solution_runs',
    sql: `
      CREATE TABLE solution_runs (
        id text PRIMARY KEY,
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        operation text NOT NULL,
        status text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
        version_number integer NOT NULL,
        input jsonb NOT NULL,
        input_hash text NOT NULL,
        sources jsonb NOT NULL,
        quote jsonb NOT NULL,
        result jsonb,
        result_schema integer NOT NULL DEFAULT 1,
        model jsonb,
        cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
        credits_usd numeric(12, 6) NOT NULL DEFAULT 0,
        error jsonb,
        idempotency_key text NOT NULL,
        claim_token text,
        lease_expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz
      );
      CREATE UNIQUE INDEX solution_runs_idempotency ON solution_runs (user_id, idempotency_key);
      CREATE UNIQUE INDEX solution_runs_one_active ON solution_runs (solution_id)
        WHERE status IN ('queued', 'running');
      CREATE INDEX solution_runs_solution ON solution_runs (solution_id, user_id, created_at DESC);
      CREATE INDEX solution_runs_active_owner ON solution_runs (user_id)
        WHERE status IN ('queued', 'running');
    `,
  },
  {
    // Попытки прохождения вопросов (тест, самопроверка): ответы, проверка и баллы. Удаляются вместе
    // с запуском, из которого взяты вопросы. По ним считается прогресс по темам.
    id: '0010_solution_attempts',
    sql: `
      CREATE TABLE solution_attempts (
        id text PRIMARY KEY,
        run_id text NOT NULL REFERENCES solution_runs (id) ON DELETE CASCADE,
        solution_id text NOT NULL REFERENCES solutions (id) ON DELETE CASCADE,
        user_id text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('quiz', 'self_check')),
        status text NOT NULL CHECK (status IN ('in_progress', 'submitted', 'graded')),
        question_ids jsonb NOT NULL,
        answers jsonb NOT NULL DEFAULT '{}'::jsonb,
        results jsonb,
        score numeric(8, 2),
        max_score numeric(8, 2) NOT NULL,
        retry_of text,
        grade_run_id text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        submitted_at timestamptz,
        graded_at timestamptz
      );
      CREATE INDEX solution_attempts_owner ON solution_attempts (user_id, solution_id, created_at DESC);
      CREATE INDEX solution_attempts_run ON solution_attempts (run_id);
    `,
  },
  {
    // Совместимость с кодом до 0007 (откат приложения): он вставляет решения без колонки template.
    // Для его типов шаблон выводится из типа; явно указанный шаблон не меняется. Инструмент,
    // процесс или неизвестный тип без шаблона по-прежнему отклоняется (NOT NULL) — без подмены
    // помощником.
    id: '0011_solution_template_legacy_insert',
    sql: `
      CREATE OR REPLACE FUNCTION solutions_legacy_template() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.template IS NULL THEN
          IF NEW.type = 'assistant' THEN
            NEW.template := 'personal_assistant';
          ELSIF NEW.type = 'customer_bot' THEN
            NEW.template := 'customer_bot';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER solutions_legacy_template
        BEFORE INSERT ON solutions
        FOR EACH ROW EXECUTE FUNCTION solutions_legacy_template();
    `,
  },
  {
    // Смета внедрения (docs/BUSINESS_DISCOVERY_PRICING_PLAN.md): версии настроек и каталога работ,
    // сметы анализов со снимком расчёта, заявки на внедрение и журнал действий администраторов.
    // Только добавление таблиц. RLS включается без политик: сервер работает владельцем таблиц и
    // его не касается, а прямой доступ ролей anon/authenticated через API Supabase закрыт.
    id: '0012_implementation_pricing',
    sql: `
      CREATE TABLE pricing_versions (
        version integer PRIMARY KEY CHECK (version > 0),
        config jsonb NOT NULL,
        catalog jsonb NOT NULL,
        note text NOT NULL DEFAULT '',
        created_by text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE implementation_estimates (
        id text PRIMARY KEY,
        analysis_id text NOT NULL REFERENCES discovery_analyses (id) ON DELETE CASCADE,
        generation integer NOT NULL CHECK (generation > 0),
        scope text NOT NULL CHECK (scope IN ('opportunity', 'combined')),
        scope_key text NOT NULL,
        opportunity_ids jsonb NOT NULL,
        pricing_version integer NOT NULL REFERENCES pricing_versions (version),
        fingerprint text NOT NULL,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX implementation_estimates_scope
        ON implementation_estimates (analysis_id, generation, scope_key);
      CREATE INDEX implementation_estimates_created ON implementation_estimates (created_at DESC);

      CREATE TABLE implementation_requests (
        id text PRIMARY KEY,
        user_id text NOT NULL,
        analysis_id text REFERENCES discovery_analyses (id) ON DELETE SET NULL,
        estimate_id text NOT NULL,
        scope text NOT NULL CHECK (scope IN ('opportunity', 'combined')),
        status text NOT NULL CHECK (status IN ('new', 'reviewing', 'clarification_needed',
          'technical_review', 'proposal_preparing', 'proposal_sent', 'approved', 'in_progress',
          'testing', 'completed', 'rejected', 'cancelled')),
        pricing_version integer NOT NULL REFERENCES pricing_versions (version),
        data jsonb NOT NULL,
        idempotency_key text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX implementation_requests_idempotency
        ON implementation_requests (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX implementation_requests_user ON implementation_requests (user_id, created_at DESC);
      CREATE INDEX implementation_requests_status ON implementation_requests (status, updated_at DESC);

      CREATE TABLE pricing_audit_log (
        id text PRIMARY KEY,
        entity_type text NOT NULL CHECK (entity_type IN ('pricing_version', 'estimate', 'request')),
        entity_id text NOT NULL,
        actor_id text NOT NULL,
        action text NOT NULL,
        previous jsonb,
        next jsonb,
        reason text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX pricing_audit_log_entity ON pricing_audit_log (entity_type, entity_id, created_at);

      ALTER TABLE pricing_versions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE implementation_estimates ENABLE ROW LEVEL SECURITY;
      ALTER TABLE implementation_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE pricing_audit_log ENABLE ROW LEVEL SECURITY;
    `,
  },
  {
    // Платформа агентов, Slice A (docs/PERSISTENCE_SLICE_A.sql): ключ владения у решений, снимок
    // спецификации версии, служебные функции (сигнальная проверка секретов, «только добавление»).
    // ТОЛЬКО В ВЕТКЕ claude/great-euler-rppwsj: в main не переносить до одобрения выката владельцем.
    // Текст дословно совпадает с разделом docs/PERSISTENCE_SLICE_A.sql (тест db/slice-a-migrations.test.ts).
    // String.raw: в регулярных выражениях SQL есть обратные косые черты.
    id: '0013_platform_agent_specs',
    sql: String.raw`
-- =================================================================================================
-- 0013_platform_agent_specs — ключ владения у решений, снимок спецификации, служебные функции
-- =================================================================================================

ALTER TABLE solutions ADD CONSTRAINT solutions_id_user_key UNIQUE (id, user_id);

-- Сигнальная проверка (tripwire) «в метаданных журнала похоже на секрет». НЕ граница безопасности:
-- код очищает метаданные до записи (apps/mock-api/src/platform/secrets.ts — те же правила), а эта
-- проверка срабатывает, только если правила кода и базы разошлись. Правила:
--   1) поле с секретным именем (…token, …secret, password, apiKey, privateKey, cookie, …TokenData;
--      без учёта регистра, «_», «-») и СТРОКОВЫМ значением от 4 символов — имя поля в JSON-схеме
--      (значение — объект) и пустая строка не срабатывают;
--   2) поле authorization со значением вида «Bearer|Basic|Token|Digest <8+ символов>»;
--   3) известные форматы токенов в любой строке, включая текст; «Bearer» — только с токеном от 20
--      символов с цифрой, поэтому «The bearer certificate is valid» не срабатывает;
--   отметка об очистке «[redacted]» / «[redacted:<причина>]» секретом не считается.
CREATE FUNCTION platform_contains_secret(doc jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH RECURSIVE walk(key, value, depth) AS (
    SELECT NULL::text, doc, 0 WHERE doc IS NOT NULL
    UNION ALL
    SELECT c.key, c.value, w.depth + 1
    FROM walk w
    CROSS JOIN LATERAL (
      SELECT e.key, e.value
        FROM jsonb_each(CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value ELSE '{}'::jsonb END) e
      UNION ALL
      SELECT NULL::text, a.value
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value ELSE '[]'::jsonb END) a
    ) c
    WHERE w.depth < 32
  ), strings AS (
    SELECT key, lower(regexp_replace(coalesce(key, ''), '[^A-Za-z0-9]', '', 'g')) AS nkey, value #>> '{}' AS s
    FROM walk
    WHERE jsonb_typeof(value) = 'string'
  )
  SELECT EXISTS (
    SELECT 1 FROM strings
    WHERE s !~ '^\[redacted(:[a-z_]+)?\]$'
      AND (
        (key IS NOT NULL AND nkey = 'authorization' AND s ~* '^(bearer|basic|token|digest)\s+\S{8,}')
        OR (key IS NOT NULL AND nkey ~ '(token|secret|password|passwd|apikey|privatekey|cookie|tokendata)$'
            AND length(s) >= 4)
        OR s ~ '\msk-[A-Za-z0-9][A-Za-z0-9_-]{19,}'
        OR s ~ '\m[rs]k_(live|test)_[A-Za-z0-9]{10,}'
        OR s ~ '\m(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})'
        OR s ~ '\mxox[abprs]-[A-Za-z0-9-]{10,}'
        OR s ~ '\mAKIA[0-9A-Z]{16}\M'
        OR s ~ 'eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
        OR s ~ '-----BEGIN [A-Z ]*PRIVATE KEY-----'
        OR s ~ '\m[0-9]{8,10}:[A-Za-z0-9_-]{35}'
        OR s ~ '[Bb][Ee][Aa][Rr][Ee][Rr]\s+(?=[A-Za-z0-9._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{20,}'
      )
  )
$$;
REVOKE EXECUTE ON FUNCTION platform_contains_secret(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION platform_contains_secret(jsonb) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE EXECUTE ON FUNCTION platform_contains_secret(jsonb) FROM authenticated; END IF;
END $$;

CREATE FUNCTION platform_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
REVOKE EXECUTE ON FUNCTION platform_append_only() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION platform_append_only() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE EXECUTE ON FUNCTION platform_append_only() FROM authenticated; END IF;
END $$;

-- Снимок AgentSpec/SolutionSpec у версии решения; существующая solution_versions не меняется. Нет
-- строки — спецификация выводится из настроек версии (platform/agent-spec.ts → agentSpecFromLegacy).
-- Проверки секретов здесь НЕТ: спецификация — свободный текст и имена полей (инструкции, знания,
-- схемы входа и выхода), и сигнальная проверка давала бы ложные отказы. Спецификацию проверяет Zod.
CREATE TABLE solution_version_specs (
  solution_id text NOT NULL,
  version_number integer NOT NULL,
  user_id text NOT NULL,
  -- Объект с версией спецификации 1. JSON-строка и массив отклоняются; отсутствие версии — тоже
  -- (IS NOT DISTINCT FROM не пропускает NULL, в отличие от прежнего сравнения через =).
  spec jsonb NOT NULL CONSTRAINT solution_version_specs_spec_object
    CHECK (jsonb_typeof(spec) = 'object' AND (spec ->> 'specVersion') IS NOT DISTINCT FROM '1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (solution_id, version_number),
  FOREIGN KEY (solution_id, version_number) REFERENCES solution_versions (solution_id, number) ON DELETE CASCADE,
  FOREIGN KEY (solution_id, user_id) REFERENCES solutions (id, user_id) ON DELETE CASCADE
);

-- RLS без политик (в production событийный триггер rls_auto_enable включит его и сам; явно — чтобы
-- поведение не зависело от настройки проекта Supabase). Роли API Supabase прав не получают.
ALTER TABLE solution_version_specs ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  role_name text;
  table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY ARRAY['solution_version_specs'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
`,
  },
  {
    // Slice A: включения агента и рантайм (только 'agent_gateway' — собственный цикл поверх AIGateway).
    // ТОЛЬКО В ВЕТКЕ claude/great-euler-rppwsj: в main не переносить до одобрения выката владельцем.
    // Текст дословно совпадает с разделом docs/PERSISTENCE_SLICE_A.sql (тест db/slice-a-migrations.test.ts).
    // String.raw: в регулярных выражениях SQL есть обратные косые черты.
    id: '0014_platform_agent_deployments',
    sql: String.raw`
-- =================================================================================================
-- 0014_platform_agent_deployments — включения агента и рантайм
-- =================================================================================================

-- История включений агента. solutions.status и solutions.active_version остаются источником истины о
-- том, что работает сейчас; здесь — привязка версии к рантайму и история. Открытая строка
-- (ended_at IS NULL) — одна на решение, пишется в той же транзакции, что и solutions.
-- Рантайм — только 'agent_gateway': собственный цикл агента поверх AIGateway (решение 12.11.2026,
-- docs/MASTRA_SPIKE.md, docs/AGENT_LOOP_CONVERGENCE.md). 'mastra' в ограничение не входит.
CREATE TABLE agent_deployments (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  solution_id text NOT NULL,
  agent_version integer NOT NULL,
  runtime text NOT NULL CHECK (runtime IN ('agent_gateway')),
  binding_version integer NOT NULL DEFAULT 1 CHECK (binding_version = 1),
  state text NOT NULL CHECK (state IN ('active', 'paused', 'failed', 'ended')),
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('new_version', 'paused_by_owner', 'paused_by_limit', 'deleted', 'runtime_changed')),
  CONSTRAINT agent_deployments_id_user_key UNIQUE (id, user_id),
  CONSTRAINT agent_deployments_ended CHECK ((state = 'ended') = (ended_at IS NOT NULL)),
  FOREIGN KEY (solution_id, user_id) REFERENCES solutions (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (solution_id, agent_version) REFERENCES solution_versions (solution_id, number) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agent_deployments_open ON agent_deployments (solution_id) WHERE ended_at IS NULL;
CREATE INDEX agent_deployments_owner ON agent_deployments (user_id, activated_at DESC);

-- RLS без политик (в production событийный триггер rls_auto_enable включит его и сам; явно — чтобы
-- поведение не зависело от настройки проекта Supabase). Роли API Supabase прав не получают.
ALTER TABLE agent_deployments ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  role_name text;
  table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY ARRAY['agent_deployments'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
`,
  },
  {
    // Slice A: журнал исполнений агента — исполнение, события, эффекты (docs/PERSISTENCE_DESIGN.md, 4.1, 9).
    // ТОЛЬКО В ВЕТКЕ claude/great-euler-rppwsj: в main не переносить до одобрения выката владельцем.
    // Текст дословно совпадает с разделом docs/PERSISTENCE_SLICE_A.sql (тест db/slice-a-migrations.test.ts).
    // String.raw: в регулярных выражениях SQL есть обратные косые черты.
    id: '0015_platform_agent_executions',
    sql: String.raw`
-- =================================================================================================
-- 0015_platform_agent_executions — журнал исполнений агента: исполнение, события, эффекты
-- =================================================================================================

-- Исполнение агента. Ссылок на разрешения, одобрения, процессы и исполнителей n8n в Slice A нет:
-- их добавят следующие срезы (ALTER TABLE ADD COLUMN — новые пустые колонки, без перезаписи).
CREATE TABLE executions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  -- NULL только после удаления решения: строка журнала остаётся (итог и стоимость), см. триггер ниже.
  solution_id text,
  solution_version integer,
  kind text NOT NULL CHECK (kind = 'agent'),
  agent_deployment_id text,
  runtime text CHECK (runtime IN ('agent_gateway')),
  trigger_kind text NOT NULL
    CHECK (trigger_kind IN ('chat_message', 'public_page', 'webhook', 'schedule', 'manual', 'channel_event')),
  -- Ссылка на источник без данных: 'conversation:<id>', 'route:<id>', 'test_run:<id>'.
  trigger_ref text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'retrying', 'cancelled', 'timed_out')),
  -- Причина остановки цикла (docs/AGENT_LOOP_CONVERGENCE.md): answer, escalated, max_steps, …
  stop_reason text CHECK (stop_reason IN ('answer', 'escalated', 'max_steps', 'max_tool_calls', 'budget',
    'timeout', 'cancelled', 'failures', 'error')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries integer NOT NULL DEFAULT 0 CHECK (max_retries BETWEEN 0 AND 3),
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  credits_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (credits_usd >= 0),
  -- Связь с учётом шлюза (UsageRecord.runId): расход считает AIGateway, здесь — итог.
  usage_run_id text,
  -- Очищенные метаданные (platform/secrets.ts → sanitizeForJournal): размеры, имена полей, отпечатки.
  input_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  idempotency_key text,
  parent_execution_id text,
  trace_id text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executions_id_user_key UNIQUE (id, user_id),
  CONSTRAINT executions_retry_limit CHECK (retry_count <= max_retries),
  CONSTRAINT executions_timing CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CONSTRAINT executions_finished_reason CHECK (stop_reason IS NULL OR finished_at IS NOT NULL),
  -- Метаданные — только JSON-объекты: строка с JSON внутри (двойное кодирование) или массив — отказ.
  CONSTRAINT executions_context_object CHECK (jsonb_typeof(context) = 'object'),
  CONSTRAINT executions_input_meta_object CHECK (jsonb_typeof(input_meta) = 'object'),
  CONSTRAINT executions_output_meta_object CHECK (jsonb_typeof(output_meta) = 'object'),
  CONSTRAINT executions_error_object CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  -- Сигнальная проверка (не граница безопасности): код очищает метаданные до записи.
  CONSTRAINT executions_no_secrets CHECK (
    NOT platform_contains_secret(context) AND NOT platform_contains_secret(input_meta)
    AND NOT platform_contains_secret(output_meta) AND NOT platform_contains_secret(error)
  ),
  FOREIGN KEY (solution_id, user_id) REFERENCES solutions (id, user_id) ON DELETE SET NULL (solution_id),
  FOREIGN KEY (agent_deployment_id, user_id) REFERENCES agent_deployments (id, user_id)
    ON DELETE SET NULL (agent_deployment_id),
  FOREIGN KEY (parent_execution_id, user_id) REFERENCES executions (id, user_id) ON DELETE SET NULL (parent_execution_id)
);

-- При создании исполнение обязано указывать решение; пустой ссылка становится только при удалении решения.
CREATE FUNCTION executions_insert_refs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.solution_id IS NULL THEN
    RAISE EXCEPTION 'execution % must reference a solution', NEW.id USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION executions_insert_refs() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION executions_insert_refs() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE EXECUTE ON FUNCTION executions_insert_refs() FROM authenticated; END IF;
END $$;
CREATE TRIGGER executions_insert_refs BEFORE INSERT ON executions
  FOR EACH ROW EXECUTE FUNCTION executions_insert_refs();
CREATE UNIQUE INDEX executions_idempotency ON executions (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX executions_owner ON executions (user_id, created_at DESC);
CREATE INDEX executions_solution ON executions (solution_id, created_at DESC) WHERE solution_id IS NOT NULL;
CREATE INDEX executions_active ON executions (status, queued_at) WHERE status IN ('queued', 'running', 'retrying');

-- События исполнения: шаги, проверки прав, повторы, ошибки, расход. Только добавление.
CREATE TABLE execution_events (
  execution_id text NOT NULL,
  user_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  type text NOT NULL CHECK (type IN ('status', 'step', 'authorization', 'retry', 'error', 'cost')),
  action text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, seq),
  FOREIGN KEY (execution_id, user_id) REFERENCES executions (id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_events_data_object CHECK (jsonb_typeof(data) = 'object'),
  CONSTRAINT execution_events_no_secrets CHECK (NOT platform_contains_secret(data))
);
CREATE TRIGGER execution_events_append_only
  BEFORE UPDATE ON execution_events FOR EACH ROW EXECUTE FUNCTION platform_append_only();

-- Эффекты исполнения: не больше одного действия на логический шаг (execution_id, step_key).
-- Машина состояний — docs/PERSISTENCE_DESIGN.md, 4.1 (reserved → dispatched → committed | failed | unknown;
-- внутреннее действие Ketner — reserved → committed | failed). Источник авторизации в Slice A —
-- 'risk_low' или 'legacy_bot_enablement:<solution id>' (все действия бота: platform/risk.ts +
-- legacyApprovalPolicy('customer_bot')). 'grant:' и 'approval:' добавит срез разрешений.
CREATE TABLE execution_effects (
  execution_id text NOT NULL,
  user_id text NOT NULL,
  step_key text NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  action text NOT NULL,
  external boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'dispatched', 'committed', 'failed', 'unknown', 'denied')),
  authorized_by text NOT NULL CHECK (authorized_by ~ '^legacy_bot_enablement:.+$|^risk_low$'),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 4),
  provider_idempotency_key text GENERATED ALWAYS AS ('ketner:' || execution_id || ':' || step_key) STORED,
  provider_supports_idempotency boolean NOT NULL DEFAULT false,
  idempotency_expires_at timestamptz,
  lease_expires_at timestamptz,
  dispatched_at timestamptz,
  failure_stage text CHECK (failure_stage IN ('before_dispatch', 'provider_rejected', 'reconciled_not_done')),
  resolved_by text,
  result_ref text,
  usage_run_id text,
  result_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (execution_id, step_key),
  FOREIGN KEY (execution_id, user_id) REFERENCES executions (id, user_id) ON DELETE CASCADE,
  CONSTRAINT execution_effects_open CHECK ((status IN ('reserved', 'dispatched')) = (finished_at IS NULL)),
  CONSTRAINT execution_effects_lease CHECK ((status IN ('reserved', 'dispatched')) = (lease_expires_at IS NOT NULL)),
  CONSTRAINT execution_effects_internal CHECK (external OR (status NOT IN ('dispatched', 'unknown') AND dispatched_at IS NULL)),
  CONSTRAINT execution_effects_dispatch_time CHECK ((status = 'dispatched') <= (dispatched_at IS NOT NULL)),
  CONSTRAINT execution_effects_key_retention
    CHECK (dispatched_at IS NULL OR NOT provider_supports_idempotency OR idempotency_expires_at IS NOT NULL),
  CONSTRAINT execution_effects_failure_stage CHECK ((status = 'failed') = (failure_stage IS NOT NULL)),
  CONSTRAINT execution_effects_result_meta_object CHECK (jsonb_typeof(result_meta) = 'object'),
  CONSTRAINT execution_effects_no_secrets CHECK (NOT platform_contains_secret(result_meta))
);
CREATE INDEX execution_effects_owner ON execution_effects (user_id, reserved_at DESC);
CREATE INDEX execution_effects_open_leases ON execution_effects (lease_expires_at) WHERE status IN ('reserved', 'dispatched');
CREATE INDEX execution_effects_unknown ON execution_effects (user_id, finished_at) WHERE status = 'unknown';

CREATE FUNCTION execution_effects_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('reserved', 'denied') OR NEW.attempts <> 1 OR NEW.dispatched_at IS NOT NULL THEN
      RAISE EXCEPTION 'execution effect must start as reserved or denied' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'reserved' AND NEW.lease_expires_at IS NULL THEN
      NEW.lease_expires_at := now() + interval '5 minutes';
    ELSIF NEW.status = 'denied' THEN
      NEW.lease_expires_at := NULL;
      NEW.finished_at := coalesce(NEW.finished_at, now());
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.execution_id <> OLD.execution_id OR NEW.user_id <> OLD.user_id OR NEW.step_key <> OLD.step_key
     OR NEW.action <> OLD.action OR NEW.external <> OLD.external OR NEW.authorized_by <> OLD.authorized_by
     OR NEW.provider_supports_idempotency <> OLD.provider_supports_idempotency
     OR NEW.reserved_at <> OLD.reserved_at THEN
    RAISE EXCEPTION 'execution effect identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.idempotency_expires_at IS NOT NULL AND NEW.idempotency_expires_at IS DISTINCT FROM OLD.idempotency_expires_at THEN
    RAISE EXCEPTION 'idempotency key retention cannot be changed' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = OLD.status THEN
    IF (NEW.result_ref, NEW.result_meta, NEW.usage_run_id, NEW.attempts, NEW.finished_at, NEW.dispatched_at,
        NEW.failure_stage, NEW.resolved_by)
       IS DISTINCT FROM (OLD.result_ref, OLD.result_meta, OLD.usage_run_id, OLD.attempts, OLD.finished_at,
        OLD.dispatched_at, OLD.failure_stage, OLD.resolved_by)
       OR (OLD.status NOT IN ('reserved', 'dispatched') AND NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at) THEN
      RAISE EXCEPTION 'execution effect in status % cannot be modified', OLD.status USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  ok := CASE
    WHEN OLD.status = 'reserved' AND NEW.status = 'dispatched' THEN
      OLD.external AND NEW.dispatched_at IS NOT NULL AND NEW.attempts = OLD.attempts
    WHEN OLD.status = 'reserved' AND NEW.status = 'failed' THEN
      NEW.failure_stage = 'before_dispatch' AND NEW.attempts = OLD.attempts
    WHEN OLD.status = 'reserved' AND NEW.status = 'denied' THEN NEW.attempts = OLD.attempts
    WHEN OLD.status = 'reserved' AND NEW.status = 'committed' THEN NOT OLD.external AND NEW.attempts = OLD.attempts
    WHEN OLD.status = 'dispatched' AND NEW.status = 'committed' THEN NEW.attempts = OLD.attempts
    WHEN OLD.status = 'dispatched' AND NEW.status = 'failed' THEN
      NEW.failure_stage = 'provider_rejected' AND NEW.attempts = OLD.attempts
    WHEN OLD.status = 'dispatched' AND NEW.status = 'unknown' THEN NEW.attempts = OLD.attempts
    WHEN OLD.status = 'unknown' AND NEW.status IN ('committed', 'failed') THEN
      NEW.resolved_by IS NOT NULL AND NEW.attempts = OLD.attempts
      AND (NEW.status = 'committed' OR NEW.failure_stage = 'reconciled_not_done')
    WHEN OLD.status = 'unknown' AND NEW.status = 'reserved' THEN
      OLD.provider_supports_idempotency AND OLD.idempotency_expires_at > now() AND NEW.attempts = OLD.attempts + 1
    WHEN OLD.status = 'failed' AND NEW.status = 'reserved' THEN NEW.attempts = OLD.attempts + 1
    ELSE false
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'execution effect: % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('reserved', 'dispatched') THEN
    NEW.lease_expires_at := NULL;
  END IF;
  IF NEW.status = 'reserved' THEN
    NEW.failure_stage := NULL;
    NEW.finished_at := NULL;
    NEW.result_ref := NULL;
    IF NEW.lease_expires_at IS NULL OR NEW.lease_expires_at <= now() THEN
      RAISE EXCEPTION 'retry needs a fresh lease' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION execution_effects_guard() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION execution_effects_guard() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE EXECUTE ON FUNCTION execution_effects_guard() FROM authenticated; END IF;
END $$;
CREATE TRIGGER execution_effects_guard BEFORE INSERT OR UPDATE ON execution_effects
  FOR EACH ROW EXECUTE FUNCTION execution_effects_guard();

-- RLS без политик (в production событийный триггер rls_auto_enable включит его и сам; явно — чтобы
-- поведение не зависело от настройки проекта Supabase). Роли API Supabase прав не получают.
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_effects ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  role_name text;
  table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY ARRAY['executions', 'execution_events', 'execution_effects'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
`,
  },
];
