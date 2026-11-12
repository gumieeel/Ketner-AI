-- Предложение миграций хранения платформы агентов (docs/PERSISTENCE_DESIGN.md) — ПОЛНЫЙ вариант, 15 таблиц.
--
-- 12.11.2026: для первой вехи применяется только Slice A — docs/PERSISTENCE_SLICE_A.sql (5 таблиц, исправленная
-- platform_contains_secret, рантайм только agent_gateway). Этот файл — источник для следующих срезов
-- (разрешения и одобрения; Slice B — процессы и подключения n8n, docs/PERSISTENCE_SLICE_B_DEFERRED.md).
--
-- СТАТУС: ПРЕДЛОЖЕНИЕ. Файл не входит в apps/mock-api/src/db/migration-list.ts и сам не применяется.
-- После одобрения каждая часть переносится в migration-list.ts отдельной записью (миграции применяются
-- автоматически при старте сервера, поэтому переносить их можно только после одобрения).
--
-- Правила те же, что у существующих миграций: только добавление; владелец записи — user_id.
-- RLS включается без политик (как в 0012). Это закрывает таблицы только от ролей API Supabase
-- (anon, authenticated). Сервер Ketner работает владельцем таблиц и RLS обходит, как и service_role
-- (BYPASSRLS): изоляцию клиентов RLS не обеспечивает. Её держат проверки владельца в коде и составные
-- внешние ключи (id, user_id): строка не может сослаться на объект другого владельца.
-- Откат — docs/PERSISTENCE_MIGRATIONS_ROLLBACK.sql.
--
-- Требование к базе: PostgreSQL 15+ (ON DELETE SET NULL со списком колонок). CI — 16; версию
-- Supabase-проекта проверить до применения.

-- =================================================================================================
-- 0013_platform_ownership_keys — ключи владения у существующих таблиц и спецификация решения
-- =================================================================================================

-- Составной уникальный ключ для ссылок «объект того же владельца». id и так уникален, поэтому
-- ограничение не может нарушиться на существующих данных.
ALTER TABLE solutions ADD CONSTRAINT solutions_id_user_key UNIQUE (id, user_id);

-- Признак «в документе есть секрет»: ключи токенов и паролей или значение «Bearer …». Используется
-- проверками журналов и разрешений как второй рубеж после очистки в коде.
CREATE FUNCTION platform_contains_secret(doc jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT doc IS NOT NULL AND (
      doc::text ~* '"(access_token|refresh_token|id_token|client_secret|password|passwd|api_key|apikey|authorization|oauthtokendata|private_key|secret)"\s*:'
      OR doc::text ~* 'bearer\s+[a-z0-9._~+/=-]{8,}'
    )
  $$;
-- Функцию вызывает только сервер (владелец). По умолчанию EXECUTE есть у PUBLIC, а права по умолчанию
-- Supabase дают его anon/authenticated — через Data API она была бы вызываема. Отзываем.
REVOKE EXECUTE ON FUNCTION platform_contains_secret(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION platform_contains_secret(jsonb) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE EXECUTE ON FUNCTION platform_contains_secret(jsonb) FROM authenticated; END IF;
END $$;

-- Снимок SolutionSpec у версии решения — отдельной таблицей, существующая solution_versions не
-- меняется. Нет строки — спецификация выводится из настроек версии (platform/agent-spec.ts).
CREATE TABLE solution_version_specs (
  solution_id text NOT NULL,
  version_number integer NOT NULL,
  user_id text NOT NULL,
  spec jsonb NOT NULL CHECK (spec ->> 'specVersion' = '1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (solution_id, version_number),
  FOREIGN KEY (solution_id, version_number) REFERENCES solution_versions (solution_id, number) ON DELETE CASCADE,
  FOREIGN KEY (solution_id, user_id) REFERENCES solutions (id, user_id) ON DELETE CASCADE,
  CONSTRAINT solution_version_specs_no_secrets CHECK (NOT platform_contains_secret(spec))
);
ALTER TABLE solution_version_specs ENABLE ROW LEVEL SECURITY;

-- =================================================================================================
-- 0014_platform_integrations_workflows — подключения клиентов и процессы
-- =================================================================================================

-- Подключение клиента к внешнему сервису. Секрет хранится там, где исполняется действие:
-- engine = 'n8n' — только ссылка на учётные данные в n8n, секрета у Ketner нет;
-- engine = 'ketner' — секрет зашифрован AES-256-GCM (как github_connections) для действий,
-- которые выполняет сам Ketner. Токены OAuth, переданные в n8n, у Ketner не остаются.
CREATE TABLE integration_connections (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  capability text NOT NULL,
  provider text NOT NULL,
  label text NOT NULL,
  auth_kind text NOT NULL CHECK (auth_kind IN ('api_key', 'service_account', 'oauth')),
  engine text NOT NULL CHECK (engine IN ('n8n', 'ketner')),
  engine_credential_id text,
  secret_enc text,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('pending', 'active', 'failed', 'revoked')),
  last_checked_at timestamptz,
  created_by text NOT NULL,
  revoked_by text,
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_connections_id_user_key UNIQUE (id, user_id),
  CONSTRAINT integration_connections_secret_place CHECK (secret_enc IS NULL OR engine = 'ketner'),
  CONSTRAINT integration_connections_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  -- Отозванное подключение не хранит ни секрета, ни ссылки на учётные данные исполнителя.
  CONSTRAINT integration_connections_revoked_clean
    CHECK (status <> 'revoked' OR (secret_enc IS NULL AND engine_credential_id IS NULL))
);
CREATE UNIQUE INDEX integration_connections_engine_ref
  ON integration_connections (engine, engine_credential_id) WHERE engine_credential_id IS NOT NULL;
CREATE INDEX integration_connections_owner ON integration_connections (user_id, status);

-- Каталог процессов, написанных командой Ketner (общий, без данных клиентов).
CREATE TABLE workflow_templates (
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  -- Компонент процесса на языке Ketner (workflowComponentSchema), без деталей исполнителя.
  definition jsonb NOT NULL,
  input_schema jsonb NOT NULL,
  -- Виды подключений, которые шаблон ждёт: [{ "slot": "notify", "capability": "messengers" }].
  connection_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'deprecated')),
  created_by text NOT NULL,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version),
  CONSTRAINT workflow_templates_approval CHECK ((status = 'draft') = (approved_at IS NULL)),
  CONSTRAINT workflow_templates_no_secrets CHECK (NOT platform_contains_secret(definition))
);

-- Артефакт шаблона для конкретного исполнителя (например, JSON процесса n8n, собранный сотрудником).
CREATE TABLE workflow_template_artifacts (
  template_id text NOT NULL,
  template_version integer NOT NULL,
  provider text NOT NULL,
  provider_version text NOT NULL,
  artifact jsonb NOT NULL,
  checksum text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, template_version, provider),
  FOREIGN KEY (template_id, template_version) REFERENCES workflow_templates (id, version),
  CONSTRAINT workflow_template_artifacts_no_secrets CHECK (NOT platform_contains_secret(artifact))
);

-- Процесс клиента: логическое определение Ketner, независимое от исполнителя.
CREATE TABLE workflow_definitions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  solution_id text,
  key text NOT NULL,
  logic_origin text NOT NULL CHECK (logic_origin IN ('catalog_template', 'staff_built', 'generated')),
  instantiation text NOT NULL CHECK (instantiation IN ('shared', 'per_customer')),
  template_id text,
  template_version integer,
  current_version integer NOT NULL CHECK (current_version > 0),
  state text NOT NULL
    CHECK (state IN ('draft', 'validated', 'provisioned', 'active', 'inactive', 'failed', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_definitions_id_user_key UNIQUE (id, user_id),
  FOREIGN KEY (solution_id, user_id) REFERENCES solutions (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (template_id, template_version) REFERENCES workflow_templates (id, version),
  CONSTRAINT workflow_definitions_template
    CHECK ((logic_origin = 'catalog_template') = (template_id IS NOT NULL AND template_version IS NOT NULL))
);
CREATE UNIQUE INDEX workflow_definitions_solution_key
  ON workflow_definitions (solution_id, key) WHERE solution_id IS NOT NULL;
CREATE INDEX workflow_definitions_owner ON workflow_definitions (user_id, updated_at DESC);

CREATE TABLE workflow_definition_versions (
  definition_id text NOT NULL,
  user_id text NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  definition jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (definition_id, number),
  FOREIGN KEY (definition_id, user_id) REFERENCES workflow_definitions (id, user_id) ON DELETE CASCADE,
  CONSTRAINT workflow_definition_versions_no_secrets CHECK (NOT platform_contains_secret(definition))
);

-- Какие подключения клиента использует версия процесса. Составные ключи: подключение и процесс
-- обязаны принадлежать одному владельцу — сослаться на чужие учётные данные нельзя на уровне базы.
CREATE TABLE workflow_connection_bindings (
  definition_id text NOT NULL,
  definition_version integer NOT NULL,
  user_id text NOT NULL,
  slot text NOT NULL,
  connection_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (definition_id, definition_version, slot),
  FOREIGN KEY (definition_id, definition_version)
    REFERENCES workflow_definition_versions (definition_id, number) ON DELETE CASCADE,
  FOREIGN KEY (definition_id, user_id) REFERENCES workflow_definitions (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id, user_id) REFERENCES integration_connections (id, user_id)
);
CREATE INDEX workflow_connection_bindings_connection ON workflow_connection_bindings (connection_id);

-- Объект у исполнителя (процесс n8n). scope = 'platform' — общий процесс шаблона (режим «готовый
-- процесс» для всех клиентов, без подключений клиента); scope = 'tenant' — экземпляр одного клиента.
CREATE TABLE provider_workflows (
  id text PRIMARY KEY,
  provider text NOT NULL,
  provider_workflow_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('platform', 'tenant')),
  user_id text,
  definition_id text,
  definition_version integer,
  template_id text,
  template_version integer,
  state text NOT NULL CHECK (state IN ('provisioned', 'active', 'inactive', 'failed', 'deleted')),
  -- Секрет вызова вебхука процесса (Header Auth), зашифрован; путь вебхука — случайный.
  webhook_path text NOT NULL,
  webhook_secret_enc text NOT NULL,
  provider_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_workflows_ref UNIQUE (provider, provider_workflow_id),
  CONSTRAINT provider_workflows_webhook UNIQUE (provider, webhook_path),
  CONSTRAINT provider_workflows_scope CHECK (
    (scope = 'tenant' AND user_id IS NOT NULL AND definition_id IS NOT NULL AND definition_version IS NOT NULL)
    OR (scope = 'platform' AND user_id IS NULL AND definition_id IS NULL AND template_id IS NOT NULL)
  ),
  FOREIGN KEY (definition_id, user_id) REFERENCES workflow_definitions (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (template_id, template_version) REFERENCES workflow_templates (id, version)
);
CREATE UNIQUE INDEX provider_workflows_tenant_live
  ON provider_workflows (definition_id) WHERE scope = 'tenant' AND state <> 'deleted';

-- =================================================================================================
-- 0015_platform_agent_deployments — развёртывания агентов и привязка к рантайму
-- =================================================================================================

-- История включений агента. solutions.status и solutions.active_version остаются источником истины о
-- том, что работает сейчас (существующий код их читает); эта таблица хранит привязку версии к
-- рантайму и историю. Открытая строка (ended_at IS NULL) — одна на решение и пишется в той же
-- транзакции, что и solutions. Нет строки — действует привязка по умолчанию (agent_gateway).
CREATE TABLE agent_deployments (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  solution_id text NOT NULL,
  agent_version integer NOT NULL,
  runtime text NOT NULL CHECK (runtime IN ('agent_gateway', 'mastra')),
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

-- =================================================================================================
-- 0016_platform_authorization — заранее выданные разрешения, одобрения и их журнал
-- =================================================================================================

-- Заранее выданное разрешение. Одно действие на запись (без масок): разрешение не может покрыть
-- другие действия. Только риск LOW и MEDIUM: HIGH и CRITICAL разрешением не покрываются никогда —
-- для них одобрение каждого раза (approval_requests) или проверенный процесс.
CREATE TABLE authorization_grants (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  -- На что выдано: решение (и его агенты и процессы) или весь аккаунт (solution_id IS NULL).
  solution_id text,
  action text NOT NULL CHECK (action ~ '^[a-z]+(\.[a-z_]+)+$'),
  -- Риск действия на момент выдачи; сервер сверяет его с текущим риском действия при каждом
  -- использовании и не применяет разрешение, если риск вырос.
  max_risk text NOT NULL CHECK (max_risk IN ('low', 'medium')),
  channel text,
  -- Ресурсы: { "kind": "bot_page", "solutionId": "…" } или { "kind": "sheet", "ids": ["…"] }.
  resource_scope jsonb NOT NULL,
  -- Получатели: { "kind": "session_visitor" } (только собеседник открытого диалога),
  -- { "kind": "recipients", "ids": [...] } или { "kind": "none" }.
  recipient_scope jsonb NOT NULL,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_day integer CHECK (max_uses_per_day IS NULL OR max_uses_per_day > 0),
  max_credits_per_use integer CHECK (max_credits_per_use IS NULL OR max_credits_per_use > 0),
  uses_count integer NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  expires_at timestamptz,
  source text NOT NULL CHECK (source IN ('owner', 'admin', 'legacy_bot_enablement')),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT authorization_grants_id_user_key UNIQUE (id, user_id),
  CONSTRAINT authorization_grants_uses CHECK (max_uses IS NULL OR uses_count <= max_uses),
  CONSTRAINT authorization_grants_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT authorization_grants_expiry CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT authorization_grants_no_secrets
    CHECK (NOT platform_contains_secret(resource_scope) AND NOT platform_contains_secret(recipient_scope)),
  FOREIGN KEY (solution_id, user_id) REFERENCES solutions (id, user_id) ON DELETE CASCADE
);
CREATE INDEX authorization_grants_lookup
  ON authorization_grants (user_id, action, solution_id) WHERE revoked_at IS NULL;

-- Одобрение одного конкретного действия человеком. Привязано к отпечатку действия (payload_hash):
-- одобрение нельзя применить к другому действию или повторно (уникальность в executions).
CREATE TABLE approval_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  solution_id text,
  action text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high', 'critical')),
  -- CRITICAL одобряется только в рамках проверенного процесса.
  verified_process_id text,
  payload_hash text NOT NULL,
  summary jsonb NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  decided_by text,
  decided_at timestamptz,
  decision_reason text,
  CONSTRAINT approval_requests_id_user_key UNIQUE (id, user_id),
  CONSTRAINT approval_requests_decision
    CHECK ((status IN ('approved', 'rejected')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT approval_requests_critical CHECK (risk <> 'critical' OR verified_process_id IS NOT NULL),
  CONSTRAINT approval_requests_no_secrets CHECK (NOT platform_contains_secret(summary)),
  FOREIGN KEY (solution_id, user_id) REFERENCES solutions (id, user_id) ON DELETE CASCADE
);
CREATE INDEX approval_requests_pending ON approval_requests (user_id, requested_at DESC) WHERE status = 'pending';

-- Журнал разрешений и одобрений: только добавление. Нет внешних ключей на разрешения и одобрения,
-- чтобы история пережила удаление решения; владелец — user_id.
CREATE TABLE authorization_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('grant', 'approval')),
  subject_id text NOT NULL,
  event text NOT NULL CHECK (event IN ('granted', 'used', 'denied', 'limit_reached', 'expired', 'revoked',
    'requested', 'approved', 'rejected', 'cancelled')),
  actor text NOT NULL,
  execution_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authorization_events_no_secrets CHECK (NOT platform_contains_secret(data))
);
CREATE INDEX authorization_events_subject ON authorization_events (subject_type, subject_id, created_at);
CREATE INDEX authorization_events_owner ON authorization_events (user_id, created_at DESC);

CREATE FUNCTION platform_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
-- Функцию вызывает только сервер (владелец). По умолчанию EXECUTE есть у PUBLIC, а права по умолчанию
-- Supabase дают его anon/authenticated — через Data API она была бы вызываема. Отзываем.
REVOKE EXECUTE ON FUNCTION platform_append_only() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION platform_append_only() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE EXECUTE ON FUNCTION platform_append_only() FROM authenticated; END IF;
END $$;
CREATE TRIGGER authorization_events_append_only
  BEFORE UPDATE ON authorization_events FOR EACH ROW EXECUTE FUNCTION platform_append_only();

-- =================================================================================================
-- 0017_platform_executions — журнал исполнений агентов и процессов
-- =================================================================================================

CREATE TABLE executions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  -- NULL только после удаления решения: строка журнала остаётся (итог и стоимость), см. триггер ниже.
  solution_id text,
  solution_version integer,
  kind text NOT NULL CHECK (kind IN ('agent', 'workflow')),
  agent_deployment_id text,
  runtime text CHECK (runtime IN ('agent_gateway', 'mastra')),
  workflow_definition_id text,
  workflow_definition_version integer,
  provider text,
  provider_execution_id text,
  trigger_kind text NOT NULL
    CHECK (trigger_kind IN ('chat_message', 'public_page', 'webhook', 'schedule', 'manual', 'channel_event')),
  -- Ссылка на источник без данных: 'route:<id>', 'schedule:<id>', 'conversation:<id>'.
  trigger_ref text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  grant_id text,
  approval_request_id text,
  status text NOT NULL CHECK (status IN ('queued', 'waiting_approval', 'running', 'succeeded', 'failed',
    'retrying', 'cancelled', 'timed_out')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries integer NOT NULL DEFAULT 0 CHECK (max_retries BETWEEN 0 AND 3),
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  credits_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (credits_usd >= 0),
  -- Связь с учётом шлюза (UsageRecord.runId): расход считает AIGateway, здесь — итог.
  usage_run_id text,
  -- Очищенные метаданные: размеры, имена полей, отпечатки, короткие безопасные выдержки.
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
  -- Номер версии процесса сохраняется и после удаления определения.
  CONSTRAINT executions_kind_refs CHECK (
    (kind = 'agent' AND workflow_definition_id IS NULL AND workflow_definition_version IS NULL)
    OR (kind = 'workflow' AND workflow_definition_version IS NOT NULL)
  ),
  CONSTRAINT executions_provider_ref CHECK ((provider_execution_id IS NULL) OR (provider IS NOT NULL)),
  CONSTRAINT executions_timing CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CONSTRAINT executions_no_secrets CHECK (
    NOT platform_contains_secret(context) AND NOT platform_contains_secret(input_meta)
    AND NOT platform_contains_secret(output_meta) AND NOT platform_contains_secret(error)
  ),
  FOREIGN KEY (solution_id, user_id) REFERENCES solutions (id, user_id) ON DELETE SET NULL (solution_id),
  FOREIGN KEY (agent_deployment_id, user_id) REFERENCES agent_deployments (id, user_id)
    ON DELETE SET NULL (agent_deployment_id),
  FOREIGN KEY (workflow_definition_id, user_id) REFERENCES workflow_definitions (id, user_id)
    ON DELETE SET NULL (workflow_definition_id),
  FOREIGN KEY (grant_id, user_id) REFERENCES authorization_grants (id, user_id) ON DELETE SET NULL (grant_id),
  FOREIGN KEY (approval_request_id, user_id) REFERENCES approval_requests (id, user_id)
    ON DELETE SET NULL (approval_request_id),
  FOREIGN KEY (parent_execution_id, user_id) REFERENCES executions (id, user_id) ON DELETE SET NULL (parent_execution_id)
);

-- При создании исполнение обязано указывать решение, а исполнение процесса — определение процесса.
-- Пустыми эти ссылки становятся только при удалении объектов (ON DELETE SET NULL выше).
CREATE FUNCTION executions_insert_refs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.solution_id IS NULL THEN
    RAISE EXCEPTION 'execution % must reference a solution', NEW.id USING ERRCODE = '23502';
  END IF;
  IF NEW.kind = 'workflow' AND NEW.workflow_definition_id IS NULL THEN
    RAISE EXCEPTION 'workflow execution % must reference a workflow definition', NEW.id USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END;
$$;
-- Функцию вызывает только сервер (владелец). По умолчанию EXECUTE есть у PUBLIC, а права по умолчанию
-- Supabase дают его anon/authenticated — через Data API она была бы вызываема. Отзываем.
REVOKE EXECUTE ON FUNCTION executions_insert_refs() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION executions_insert_refs() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE EXECUTE ON FUNCTION executions_insert_refs() FROM authenticated; END IF;
END $$;
CREATE TRIGGER executions_insert_refs BEFORE INSERT ON executions
  FOR EACH ROW EXECUTE FUNCTION executions_insert_refs();
CREATE UNIQUE INDEX executions_idempotency ON executions (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Одно одобрение — одно исполнение.
CREATE UNIQUE INDEX executions_approval_once ON executions (approval_request_id) WHERE approval_request_id IS NOT NULL;
CREATE UNIQUE INDEX executions_provider_ref_key
  ON executions (provider, provider_execution_id) WHERE provider_execution_id IS NOT NULL;
CREATE INDEX executions_owner ON executions (user_id, created_at DESC);
CREATE INDEX executions_solution ON executions (solution_id, created_at DESC) WHERE solution_id IS NOT NULL;
CREATE INDEX executions_active ON executions (status, queued_at) WHERE status IN ('queued', 'running', 'retrying', 'waiting_approval');

-- События исполнения: шаги, проверки разрешений, повторы, ошибки, расход. Только добавление.
CREATE TABLE execution_events (
  execution_id text NOT NULL,
  user_id text NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  type text NOT NULL CHECK (type IN ('status', 'step', 'authorization', 'retry', 'error', 'cost')),
  action text,
  grant_id text,
  approval_request_id text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, seq),
  FOREIGN KEY (execution_id, user_id) REFERENCES executions (id, user_id) ON DELETE CASCADE,
  -- grant_id и approval_request_id — без внешнего ключа: события только добавляются (каскадное
  -- обнуление ссылки противоречило бы запрету изменений), а для аудита ссылка должна пережить удаление
  -- разрешения. Принадлежность проверяется при использовании разрешения (consume по user_id).
  CONSTRAINT execution_events_no_secrets CHECK (NOT platform_contains_secret(data))
);
CREATE TRIGGER execution_events_append_only
  BEFORE UPDATE ON execution_events FOR EACH ROW EXECUTE FUNCTION platform_append_only();

-- Эффекты исполнения: не больше одного действия на логический шаг (execution_id, step_key).
--
-- Внешнее действие (external = true) проходит две фиксации:
--   1) reserved   — шаг зарезервирован и авторизован (разрешение использовано), запрос ещё НЕ отправлен;
--   2) dispatched — фиксируется ДО отправки запроса провайдеру; с этого момента запрос мог уйти;
--   3) итог: committed (провайдер подтвердил), failed (провайдер отклонил / сверка показала «не выполнено»),
--      unknown (ответа нет: таймаут, обрыв, падение Ketner после отправки).
-- Внутреннее действие Ketner (external = false: заявка, черновик, вызов модели) — reserved → committed | failed.
--
-- Повтор:
--   failed → reserved (attempts + 1) — безопасно: действие не выполнено (не отправлено, отклонено или
--     подтверждено сверкой);
--   unknown → reserved (attempts + 1) — ТОЛЬКО если провайдер поддерживает ключ идемпотентности
--     и срок хранения ключа у провайдера не истёк (idempotency_expires_at > now()): повтор отправит
--     тот же provider_idempotency_key, и провайдер вернёт итог первого запроса;
--   иначе unknown → committed | failed только сверкой с провайдером или решением человека
--     (resolved_by обязателен), и лишь из failed — новый повтор.
-- Зависший шаг (истекла аренда): reserved → failed (before_dispatch) — безопасно, запрос не уходил;
--   dispatched → unknown — исход неизвестен.
CREATE TABLE execution_effects (
  execution_id text NOT NULL,
  user_id text NOT NULL,
  step_key text NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  action text NOT NULL,
  external boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'dispatched', 'committed', 'failed', 'unknown', 'denied')),
  -- Чем действие было разрешено, неизменно: 'grant:<id>', 'approval:<id>',
  -- 'legacy_bot_enablement:<solution id>', 'risk_low'. Остаётся после удаления разрешения или одобрения.
  authorized_by text NOT NULL CHECK (authorized_by ~ '^(grant|approval|legacy_bot_enablement):.+$|^risk_low$'),
  grant_id text,
  approval_request_id text,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 4),
  -- Ключ идемпотентности для провайдера: одинаков при всех повторах шага.
  provider_idempotency_key text GENERATED ALWAYS AS ('ketner:' || execution_id || ':' || step_key) STORED,
  provider_supports_idempotency boolean NOT NULL DEFAULT false,
  -- Срок, до которого провайдер помнит ключ (первая отправка + срок хранения ключа у провайдера).
  idempotency_expires_at timestamptz,
  -- Аренда воркера для reserved/dispatched: после истечения шаг считается зависшим.
  lease_expires_at timestamptz,
  dispatched_at timestamptz,
  failure_stage text CHECK (failure_stage IN ('before_dispatch', 'provider_rejected', 'reconciled_not_done')),
  -- Кто разрешил неясный исход: 'reconciliation:<провайдер>' или 'user:<id>'.
  resolved_by text,
  -- Ссылка на результат у владельца данных: id сообщения бота, заявки, сообщения у провайдера.
  result_ref text,
  -- Связь с учётом AIGateway (UsageRecord.runId) для шагов с вызовом модели.
  usage_run_id text,
  result_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (execution_id, step_key),
  FOREIGN KEY (execution_id, user_id) REFERENCES executions (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (grant_id, user_id) REFERENCES authorization_grants (id, user_id) ON DELETE SET NULL (grant_id),
  FOREIGN KEY (approval_request_id, user_id) REFERENCES approval_requests (id, user_id)
    ON DELETE SET NULL (approval_request_id),
  CONSTRAINT execution_effects_open CHECK ((status IN ('reserved', 'dispatched')) = (finished_at IS NULL)),
  CONSTRAINT execution_effects_lease CHECK ((status IN ('reserved', 'dispatched')) = (lease_expires_at IS NOT NULL)),
  CONSTRAINT execution_effects_internal CHECK (external OR (status NOT IN ('dispatched', 'unknown') AND dispatched_at IS NULL)),
  CONSTRAINT execution_effects_dispatch_time CHECK ((status = 'dispatched') <= (dispatched_at IS NOT NULL)),
  -- Провайдер с ключом идемпотентности: срок хранения ключа известен с первой отправки.
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
    -- Аренда по умолчанию для нового резерва; у отказа аренды нет.
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
  -- Срок хранения ключа задаётся при первой отправке и дальше не меняется (не продлевается повторами).
  IF OLD.idempotency_expires_at IS NOT NULL AND NEW.idempotency_expires_at IS DISTINCT FROM OLD.idempotency_expires_at THEN
    RAISE EXCEPTION 'idempotency key retention cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF (NEW.grant_id IS DISTINCT FROM OLD.grant_id AND NEW.grant_id IS NOT NULL)
     OR (NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id AND NEW.approval_request_id IS NOT NULL) THEN
    RAISE EXCEPTION 'execution effect authorization reference cannot be replaced' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = OLD.status THEN
    -- Без смены статуса: только продление аренды открытого шага или обнуление ссылок (ON DELETE SET NULL).
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
    -- Отправка: только внешнее действие, из reserved, с фиксацией времени отправки.
    WHEN OLD.status = 'reserved' AND NEW.status = 'dispatched' THEN
      OLD.external AND NEW.dispatched_at IS NOT NULL AND NEW.attempts = OLD.attempts
    -- Сбой до отправки (в том числе истёкшая аренда): запрос не уходил.
    WHEN OLD.status = 'reserved' AND NEW.status = 'failed' THEN
      NEW.failure_stage = 'before_dispatch' AND NEW.attempts = OLD.attempts
    WHEN OLD.status = 'reserved' AND NEW.status = 'denied' THEN NEW.attempts = OLD.attempts
    -- Внутреннее действие Ketner завершается без отправки.
    WHEN OLD.status = 'reserved' AND NEW.status = 'committed' THEN NOT OLD.external AND NEW.attempts = OLD.attempts
    -- Итог отправки.
    WHEN OLD.status = 'dispatched' AND NEW.status = 'committed' THEN NEW.attempts = OLD.attempts
    WHEN OLD.status = 'dispatched' AND NEW.status = 'failed' THEN
      NEW.failure_stage = 'provider_rejected' AND NEW.attempts = OLD.attempts
    WHEN OLD.status = 'dispatched' AND NEW.status = 'unknown' THEN NEW.attempts = OLD.attempts
    -- Неясный исход: сверка или решение человека.
    WHEN OLD.status = 'unknown' AND NEW.status IN ('committed', 'failed') THEN
      NEW.resolved_by IS NOT NULL AND NEW.attempts = OLD.attempts
      AND (NEW.status = 'committed' OR NEW.failure_stage = 'reconciled_not_done')
    -- Повтор после неясного исхода — только с тем же ключом у провайдера, который его ещё помнит.
    WHEN OLD.status = 'unknown' AND NEW.status = 'reserved' THEN
      OLD.provider_supports_idempotency AND OLD.idempotency_expires_at > now() AND NEW.attempts = OLD.attempts + 1
    -- Повтор после подтверждённого невыполнения.
    WHEN OLD.status = 'failed' AND NEW.status = 'reserved' THEN NEW.attempts = OLD.attempts + 1
    ELSE false
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'execution effect: % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  -- Выход из открытых статусов снимает аренду.
  IF NEW.status NOT IN ('reserved', 'dispatched') THEN
    NEW.lease_expires_at := NULL;
  END IF;
  -- Новая попытка начинается с чистого итога.
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
-- Функцию вызывает только сервер (владелец). По умолчанию EXECUTE есть у PUBLIC, а права по умолчанию
-- Supabase дают его anon/authenticated — через Data API она была бы вызываема. Отзываем.
REVOKE EXECUTE ON FUNCTION execution_effects_guard() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION execution_effects_guard() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE EXECUTE ON FUNCTION execution_effects_guard() FROM authenticated; END IF;
END $$;
CREATE TRIGGER execution_effects_guard BEFORE INSERT OR UPDATE ON execution_effects
  FOR EACH ROW EXECUTE FUNCTION execution_effects_guard();


-- RLS без политик для всех новых таблиц (как в 0012).
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_template_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_connection_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_effects ENABLE ROW LEVEL SECURITY;

-- Роли API Supabase не получают никаких прав на новые таблицы. RLS без политик и так закрывает
-- SELECT/INSERT/UPDATE/DELETE, но не TRUNCATE и не REFERENCES; права по умолчанию Supabase выдают
-- им всё. В базах без этих ролей (CI, локальная разработка) блок ничего не делает.
DO $$
DECLARE
  role_name text;
  table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      FOREACH table_name IN ARRAY ARRAY['solution_version_specs', 'integration_connections', 'workflow_templates', 'workflow_template_artifacts',
        'workflow_definitions', 'workflow_definition_versions', 'workflow_connection_bindings', 'provider_workflows',
        'agent_deployments', 'authorization_grants', 'approval_requests', 'authorization_events', 'executions',
        'execution_events', 'execution_effects'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;
