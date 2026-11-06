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
];
