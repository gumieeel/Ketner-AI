-- Откат docs/PERSISTENCE_SLICE_A.sql: схема возвращается к состоянию после 0012.
-- Удаляет новые таблицы, функции, ограничение solutions_id_user_key и записи раннера 0013–0015.
-- Существующие таблицы и их данные не меняются (проверка — docs/persistence-review/slice-a/run-review-slice-a.sh, раздел 6).
DROP TABLE IF EXISTS execution_effects;
DROP FUNCTION IF EXISTS execution_effects_guard();
DROP TABLE IF EXISTS execution_events;
DROP TABLE IF EXISTS executions;
DROP FUNCTION IF EXISTS executions_insert_refs();
DROP TABLE IF EXISTS agent_deployments;
DROP TABLE IF EXISTS solution_version_specs;
DROP FUNCTION IF EXISTS platform_append_only();
DROP FUNCTION IF EXISTS platform_contains_secret(jsonb);
ALTER TABLE solutions DROP CONSTRAINT IF EXISTS solutions_id_user_key;
DELETE FROM schema_migrations
  WHERE id IN ('0013_platform_agent_specs', '0014_platform_agent_deployments', '0015_platform_agent_executions');
