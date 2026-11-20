-- =================================================================================================
-- 0016_google_sheets — ПРЕДЛОЖЕНИЕ для ревью (docs/STAGE_F_SHEETS.md). НЕ добавлено в
-- apps/mock-api/src/db/migration-list.ts и не применяется ни к одной базе. После одобрения владельцем
-- текст переносится в migration-list.ts дословно отдельным PR.
-- =================================================================================================

-- 1. Подключение Google одного аккаунта Ketner: refresh-токен только в зашифрованном виде
--    (AES-256-GCM, platform/token-crypto.ts, метка 'google-token'). Access-токен не хранится.
CREATE TABLE google_connections (
  user_id text PRIMARY KEY,
  google_sub text NOT NULL,
  google_email text,
  scopes text NOT NULL,
  refresh_token_enc text,
  spreadsheet_id text,
  spreadsheet_url text,
  status text NOT NULL CHECK (status IN ('connected', 'reconnect_required', 'sheet_missing', 'disconnected')),
  -- Только код сбоя (invalid_grant, not_found, trashed, quota, http_5xx, …), без текста ответа Google.
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,40}$'),
  last_error_at timestamptz,
  last_ok_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Подключено — значит есть чем ходить в Google; отключено — токена нет.
  CONSTRAINT google_connections_token CHECK (
    (status = 'disconnected' AND refresh_token_enc IS NULL)
    OR (status <> 'disconnected' AND refresh_token_enc IS NOT NULL)
  ),
  -- Зашифрованная форма: v1.<iv>.<tag>.<body> (base64url). Открытый токен Google сюда не пройдёт.
  CONSTRAINT google_connections_token_format CHECK (
    refresh_token_enc IS NULL OR refresh_token_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  ),
  CONSTRAINT google_connections_drive_file CHECK (scopes LIKE '%https://www.googleapis.com/auth/drive.file%')
);

-- Доступ только серверу (как у таблиц журнала в 0015): роли API Supabase прав не получают.
ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE google_connections FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- 2. Журнал: доставка заявки — отдельный вид исполнения со своим триггером.
--    'lead_created' не входит в COUNTED_TRIGGERS (platform/request-count.ts): доставка в таблицу не
--    засчитывается обращением тарифа. Имена ограничений — те, что Postgres дал встроенным CHECK в 0015
--    (<таблица>_<колонка>_check): executions_kind_check и executions_trigger_kind_check — сверено на
--    локальной тестовой схеме после 0000–0015 (20.11.2026).
ALTER TABLE executions DROP CONSTRAINT executions_kind_check;
ALTER TABLE executions ADD CONSTRAINT executions_kind_check CHECK (kind IN ('agent', 'delivery'));

ALTER TABLE executions DROP CONSTRAINT executions_trigger_kind_check;
ALTER TABLE executions ADD CONSTRAINT executions_trigger_kind_check
  CHECK (trigger_kind IN ('chat_message', 'public_page', 'webhook', 'schedule', 'manual', 'channel_event', 'lead_created'));

-- Доставка не исполняется агентом: у неё нет развёртывания и среды исполнения агента. Триггер
-- 'lead_created' — только у доставки, у агента его быть не может.
ALTER TABLE executions ADD CONSTRAINT executions_delivery_shape CHECK (
  (kind = 'delivery') = (trigger_kind = 'lead_created')
  AND (kind <> 'delivery' OR (agent_deployment_id IS NULL AND runtime IS NULL AND trigger_ref LIKE 'lead:%'))
);

-- Эффекты: шаг доставки — 'sheet_append' (первые 4 попытки) или 'sheet_append_r<n>' (ручной повтор);
-- существующие CHECK на step_key ('^[a-z][a-z0-9_-]{0,63}$') и authorized_by ('risk_low') уже подходят,
-- менять execution_effects не нужно.

-- Откат (для ревью; выполнять только вместе с удалением кода доставки):
--   DELETE FROM executions WHERE kind = 'delivery';
--   ALTER TABLE executions DROP CONSTRAINT executions_delivery_shape;
--   ALTER TABLE executions DROP CONSTRAINT executions_trigger_kind_check;
--   ALTER TABLE executions ADD CONSTRAINT executions_trigger_kind_check
--     CHECK (trigger_kind IN ('chat_message', 'public_page', 'webhook', 'schedule', 'manual', 'channel_event'));
--   ALTER TABLE executions DROP CONSTRAINT executions_kind_check;
--   ALTER TABLE executions ADD CONSTRAINT executions_kind_check CHECK (kind = 'agent');
--   DROP TABLE google_connections;
