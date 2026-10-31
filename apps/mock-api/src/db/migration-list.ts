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
];
