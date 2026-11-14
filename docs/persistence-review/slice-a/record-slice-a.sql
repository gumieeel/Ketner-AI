-- Записи раннера для Slice A — как их сделает runMigrations после переноса в migration-list.ts.
INSERT INTO schema_migrations (id, checksum) VALUES
  ('0013_platform_agent_specs', 'proposal'), ('0014_platform_agent_deployments', 'proposal'),
  ('0015_platform_agent_executions', 'proposal');
