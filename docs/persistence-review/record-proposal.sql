-- Записи раннера для предложения — как их сделает runMigrations после переноса в migration-list.ts.
INSERT INTO schema_migrations (id, checksum) VALUES
  ('0013_platform_ownership_keys', 'proposal'), ('0014_platform_integrations_workflows', 'proposal'),
  ('0015_platform_agent_deployments', 'proposal'), ('0016_platform_authorization', 'proposal'),
  ('0017_platform_executions', 'proposal');
