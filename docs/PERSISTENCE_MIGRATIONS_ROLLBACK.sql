-- Откат предложения docs/PERSISTENCE_MIGRATIONS_PROPOSAL.sql (0017 → 0013).
--
-- Обычный откат при проблеме — откат приложения: миграции только добавляют, старый код новых таблиц
-- не знает и работает без изменений. Этот скрипт нужен, только если схему нужно вернуть к 0012
-- (например, до первого использования таблиц). Он удаляет новые таблицы вместе с данными, поэтому
-- перед ним — резервная копия. Существующие таблицы и их данные не меняются: снимается только
-- добавленное ограничение UNIQUE (id, user_id) у solutions.

BEGIN;

-- 0017
DROP TABLE IF EXISTS execution_effects;
DROP FUNCTION IF EXISTS execution_effects_guard();
DROP TABLE IF EXISTS execution_events;
DROP TABLE IF EXISTS executions;
DROP FUNCTION IF EXISTS executions_insert_refs();

-- 0016
DROP TABLE IF EXISTS authorization_events;
DROP TABLE IF EXISTS approval_requests;
DROP TABLE IF EXISTS authorization_grants;
DROP FUNCTION IF EXISTS platform_append_only();

-- 0015
DROP TABLE IF EXISTS agent_deployments;

-- 0014
DROP TABLE IF EXISTS provider_workflows;
DROP TABLE IF EXISTS workflow_connection_bindings;
DROP TABLE IF EXISTS workflow_definition_versions;
DROP TABLE IF EXISTS workflow_definitions;
DROP TABLE IF EXISTS workflow_template_artifacts;
DROP TABLE IF EXISTS workflow_templates;
DROP TABLE IF EXISTS integration_connections;

-- 0013
DROP TABLE IF EXISTS solution_version_specs;
ALTER TABLE solutions DROP CONSTRAINT IF EXISTS solutions_id_user_key;
DROP FUNCTION IF EXISTS platform_contains_secret(jsonb);

-- Записи раннера о применённых миграциях: иначе раннер посчитает их применёнными.
DELETE FROM schema_migrations WHERE id IN (
  '0013_platform_ownership_keys', '0014_platform_integrations_workflows', '0015_platform_agent_deployments',
  '0016_platform_authorization', '0017_platform_executions'
);

COMMIT;
