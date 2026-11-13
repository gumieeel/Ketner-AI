-- Slice A хранения платформы: всё, что нужно, чтобы выполнить и записать одно исполнение агента
-- (бот для клиентов). Обоснование таблиц — docs/PERSISTENCE_DESIGN.md, раздел 9.
--
-- СТАТУС: ПРЕДЛОЖЕНИЕ. Не входит в apps/mock-api/src/db/migration-list.ts и сам не применяется.
-- Заменяет для первой вехи docs/PERSISTENCE_MIGRATIONS_PROPOSAL.sql (полный вариант остаётся источником
-- для следующих срезов: разрешения и одобрения — когда появится действие, требующее их; процессы и
-- подключения n8n — Slice B, docs/PERSISTENCE_SLICE_B_DEFERRED.md).
--
-- Правила: только добавление; владелец записи — user_id; составные внешние ключи (id, user_id) не дают
-- сослаться на объект другого владельца. RLS включается без политик, роли API Supabase прав не получают,
-- EXECUTE на функции есть только у владельца (docs/SECURITY_PRIVILEGE_AUDIT.md).
-- Требование к базе: PostgreSQL 15+ (ON DELETE SET NULL со списком колонок); production — 17.6.
-- Откат — docs/PERSISTENCE_SLICE_A_ROLLBACK.sql.
--
-- Каждый раздел ниже самодостаточен (свои RLS и REVOKE) и ДОСЛОВНО совпадает с записью в
-- apps/mock-api/src/db/migration-list.ts (только в ветке claude/great-euler-rppwsj, до одобрения выката);
-- совпадение проверяет тест db/slice-a-migrations.test.ts.

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
  spec jsonb NOT NULL CHECK (spec ->> 'specVersion' = '1'),
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
