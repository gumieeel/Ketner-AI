-- Проверка предложения (docs/PERSISTENCE_MIGRATIONS_PROPOSAL.sql) на одноразовой базе.
-- Порядок: миграции 0001–0012, существующие данные (раздел 0), предложение, этот файл (разделы 1–4).
-- Запускается ролью сервера Ketner (владелец таблиц). Каждая строка результата — PASS или FAIL.
\set ON_ERROR_STOP 1

CREATE TEMP TABLE results (section text, name text, outcome text);
CREATE FUNCTION pg_temp.expect_failure(section text, name text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
    INSERT INTO results VALUES (section, name, 'FAIL: accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results VALUES (section, name, 'PASS: ' || SQLSTATE || ' ' || left(SQLERRM, 60));
  END;
END;
$$;
CREATE FUNCTION pg_temp.expect_code(section text, name text, code text, statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
    INSERT INTO results VALUES (section, name, 'FAIL: accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results VALUES (section, name,
      CASE WHEN SQLSTATE = code THEN 'PASS: ' ELSE 'FAIL: wrong reason ' END || SQLSTATE || ' ' || left(SQLERRM, 60));
  END;
END;
$$;
CREATE FUNCTION pg_temp.check(section text, name text, ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (section, name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
$$;
-- Выполняет оператор и возвращает число затронутых строк.
CREATE FUNCTION pg_temp.affected(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE statement;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
-- Атомарное использование разрешения (как в сервисе).
CREATE FUNCTION pg_temp.try_consume(g text, owner text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE authorization_grants SET uses_count = uses_count + 1
  WHERE id = g AND user_id = owner AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR uses_count < max_uses);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 0. Существующие данные после миграций не изменились (их записал seed до предложения)
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.check('0 existing data', 'solutions rows unchanged',
  (SELECT count(*) FROM solutions) = 3
  AND (SELECT md5(string_agg(row_to_json(s)::text, ',' ORDER BY id)) FROM
        (SELECT id, user_id, type, status, name, current_version, active_version, bot, slug, template FROM solutions) s)
      = (SELECT checksum FROM seed_snapshot WHERE name = 'solutions'));
SELECT pg_temp.check('0 existing data', 'solution_versions rows unchanged, no spec rows, no new columns',
  (SELECT count(*) FROM solution_versions) = 4
  AND (SELECT count(*) FROM solution_version_specs) = 0
  AND (SELECT count(*) FROM information_schema.columns WHERE table_name = 'solution_versions') = 4
  AND (SELECT md5(string_agg(solution_id || number || config::text, ',' ORDER BY solution_id, number)) FROM solution_versions)
      = (SELECT checksum FROM seed_snapshot WHERE name = 'solution_versions'));
SELECT pg_temp.check('0 existing data', 'bot conversations, messages, leads unchanged',
  (SELECT count(*) FROM bot_conversations) = 1 AND (SELECT count(*) FROM bot_messages) = 2 AND (SELECT count(*) FROM bot_leads) = 1);
SELECT pg_temp.check('0 existing data', 'Builder still inserts a solution without new columns',
  pg_temp.affected($q$INSERT INTO solutions (id, user_id, type, status, name, current_version, template)
     VALUES ('sol_new', 'user_a', 'assistant', 'draft', 'New', 1, 'personal_assistant')$q$) = 1);

-- ---------------------------------------------------------------------------------------------
-- Данные для проверок
-- ---------------------------------------------------------------------------------------------
INSERT INTO integration_connections (id, user_id, capability, provider, label, auth_kind, engine, engine_credential_id, status, created_by)
  VALUES ('conn_a', 'user_a', 'messengers', 'telegram', 'A bot', 'api_key', 'n8n', 'n8n_cred_a', 'active', 'user_a'),
         ('conn_b', 'user_b', 'messengers', 'telegram', 'B bot', 'api_key', 'n8n', 'n8n_cred_b', 'active', 'user_b'),
         ('conn_a2', 'user_a', 'spreadsheets_sync', 'google_sheets', 'A sheet', 'oauth', 'n8n', 'n8n_cred_a2', 'active', 'user_a');
INSERT INTO workflow_definitions (id, user_id, solution_id, key, logic_origin, instantiation, current_version, state)
  VALUES ('wf_a', 'user_a', 'sol_a', 'notify', 'staff_built', 'per_customer', 1, 'active'),
         ('wf_b', 'user_b', 'sol_b', 'notify', 'staff_built', 'per_customer', 1, 'active');
INSERT INTO workflow_definition_versions (definition_id, user_id, number, definition, created_by)
  VALUES ('wf_a', 'user_a', 1, '{"steps":[]}', 'staff'), ('wf_b', 'user_b', 1, '{"steps":[]}', 'staff');
INSERT INTO workflow_connection_bindings (definition_id, definition_version, user_id, slot, connection_id)
  VALUES ('wf_a', 1, 'user_a', 'notify', 'conn_a');
INSERT INTO provider_workflows (id, provider, provider_workflow_id, scope, user_id, definition_id, definition_version, state, webhook_path, webhook_secret_enc, provider_version)
  VALUES ('pw_a', 'n8n', 'n8n_wf_1', 'tenant', 'user_a', 'wf_a', 1, 'active', 'hook-a', 'v1.enc', '2.46.6');
INSERT INTO authorization_grants (id, user_id, solution_id, action, max_risk, channel, resource_scope, recipient_scope, source, granted_by)
  VALUES ('grant_a', 'user_a', 'sol_a', 'message.send', 'medium', 'telegram',
          '{"kind":"chat","ids":["c1"]}', '{"kind":"recipients","ids":["c1"]}', 'owner', 'user_a');
INSERT INTO authorization_events (id, user_id, subject_type, subject_id, event, actor, data)
  VALUES ('ev_grant_a', 'user_a', 'grant', 'grant_a', 'granted', 'user_a', '{"action":"message.send","channel":"telegram"}');
INSERT INTO approval_requests (id, user_id, solution_id, action, risk, payload_hash, summary, requested_by, expires_at, status, decided_by, decided_at)
  VALUES ('appr_a', 'user_a', 'sol_a', 'message.bulk_send', 'high', 'h1', '{"recipients":12}', 'agent:sol_a', now() + interval '1 day', 'approved', 'user_a', now());
INSERT INTO agent_deployments (id, user_id, solution_id, agent_version, runtime, state, activated_by)
  VALUES ('dep_a', 'user_a', 'sol_a', 1, 'agent_gateway', 'active', 'user_a');
INSERT INTO executions (id, user_id, solution_id, kind, agent_deployment_id, runtime, trigger_kind, trigger_ref, status, trace_id)
  VALUES ('x4', 'user_a', 'sol_a', 'agent', 'dep_a', 'agent_gateway', 'manual', 'm', 'running', 't');

-- ---------------------------------------------------------------------------------------------
-- 1. Изоляция клиентов
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_code('1 isolation', 'bind another tenant credential', '23503',
  $$INSERT INTO workflow_connection_bindings (definition_id, definition_version, user_id, slot, connection_id)
    VALUES ('wf_a', 1, 'user_a', 'sheet', 'conn_b')$$);
SELECT pg_temp.expect_code('1 isolation', 'bind credential claiming the other owner', '23503',
  $$INSERT INTO workflow_connection_bindings (definition_id, definition_version, user_id, slot, connection_id)
    VALUES ('wf_a', 1, 'user_b', 'sheet', 'conn_b')$$);
SELECT pg_temp.expect_code('1 isolation', 'start another tenant workflow', '23503',
  $$INSERT INTO executions (id, user_id, solution_id, kind, workflow_definition_id, workflow_definition_version, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('x1', 'user_a', 'sol_a', 'workflow', 'wf_b', 1, 'webhook', 'route:r1', 'queued', 't')$$);
SELECT pg_temp.expect_code('1 isolation', 'execution under another tenant solution', '23503',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('x2', 'user_b', 'sol_a', 'agent', 'public_page', 'conversation:c1', 'queued', 't')$$);
SELECT pg_temp.expect_code('1 isolation', 'use another tenant grant', '23503',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, grant_id, status, trace_id)
    VALUES ('x3', 'user_b', 'sol_b', 'agent', 'public_page', 'conversation:c2', 'grant_a', 'queued', 't')$$);
SELECT pg_temp.expect_code('1 isolation', 'write into another tenant execution history', '23503',
  $$INSERT INTO execution_events (execution_id, user_id, seq, type) VALUES ('x4', 'user_b', 1, 'status')$$);
SELECT pg_temp.expect_code('1 isolation', 'deploy another tenant agent version', '23503',
  $$INSERT INTO agent_deployments (id, user_id, solution_id, agent_version, runtime, state, activated_by)
    VALUES ('dep_x', 'user_a', 'sol_b', 1, 'agent_gateway', 'active', 'user_a')$$);
SELECT pg_temp.expect_code('1 isolation', 'two open deployments of one agent', '23505',
  $$INSERT INTO agent_deployments (id, user_id, solution_id, agent_version, runtime, state, activated_by)
    VALUES ('dep_2', 'user_a', 'sol_a', 1, 'mastra', 'active', 'user_a')$$);
SELECT pg_temp.check('1 isolation', 'read another tenant executions by owner filter returns nothing',
  (SELECT count(*) FROM executions WHERE user_id = 'user_b' AND id IN (SELECT id FROM executions WHERE user_id = 'user_a')) = 0);
SELECT pg_temp.check('1 isolation', 'consume another tenant grant: 0 rows', pg_temp.try_consume('grant_a', 'user_b') = 0);

-- ---------------------------------------------------------------------------------------------
-- 2. Разрешения: объём, отзыв, срок, секреты
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_code('2 authorization', 'standing grant for HIGH action', '23514',
  $$INSERT INTO authorization_grants (id, user_id, action, max_risk, resource_scope, recipient_scope, source, granted_by)
    VALUES ('g_high', 'user_a', 'message.bulk_send', 'high', '{}', '{}', 'owner', 'user_a')$$);
SELECT pg_temp.expect_code('2 authorization', 'standing grant for CRITICAL action', '23514',
  $$INSERT INTO authorization_grants (id, user_id, action, max_risk, resource_scope, recipient_scope, source, granted_by)
    VALUES ('g_crit', 'user_a', 'payment.refund', 'critical', '{}', '{}', 'owner', 'user_a')$$);
SELECT pg_temp.expect_code('2 authorization', 'wildcard grant', '23514',
  $$INSERT INTO authorization_grants (id, user_id, action, max_risk, resource_scope, recipient_scope, source, granted_by)
    VALUES ('g_any', 'user_a', 'message.*', 'medium', '{}', '{}', 'owner', 'user_a')$$);
SELECT pg_temp.expect_code('2 authorization', 'approval used by two executions', '23505',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, approval_request_id, status, trace_id)
    VALUES ('x5', 'user_a', 'sol_a', 'agent', 'manual', 'm', 'appr_a', 'running', 't'),
           ('x6', 'user_a', 'sol_a', 'agent', 'manual', 'm', 'appr_a', 'running', 't')$$);
SELECT pg_temp.expect_code('2 authorization', 'edit authorization history', 'P0001',
  $$UPDATE authorization_events SET event = 'revoked' WHERE id = 'ev_grant_a'$$);
INSERT INTO authorization_grants (id, user_id, solution_id, action, max_risk, resource_scope, recipient_scope, source, granted_by, granted_at, expires_at, max_uses)
  VALUES ('g_old', 'user_a', 'sol_a', 'message.send', 'medium', '{}', '{}', 'owner', 'user_a', now() - interval '2 days', now() - interval '1 day', NULL),
         ('g_once', 'user_a', 'sol_a', 'message.send', 'medium', '{}', '{}', 'owner', 'user_a', now(), NULL, 1);
SELECT pg_temp.check('2 authorization', 'expired grant not consumed', pg_temp.try_consume('g_old', 'user_a') = 0);
SELECT pg_temp.check('2 authorization', 'grant with max_uses=1: first use', pg_temp.try_consume('g_once', 'user_a') = 1);
SELECT pg_temp.check('2 authorization', 'grant with max_uses=1: second use refused', pg_temp.try_consume('g_once', 'user_a') = 0);
SELECT pg_temp.expect_code('2 authorization', 'refresh token in execution context', '23514',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, context)
    VALUES ('x7', 'user_a', 'sol_a', 'agent', 'manual', 'm', 'queued', 't', '{"oauth":{"refresh_token":"rt_1"}}')$$);
SELECT pg_temp.expect_code('2 authorization', 'bearer token in output metadata', '23514',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, output_meta)
    VALUES ('x8', 'user_a', 'sol_a', 'agent', 'manual', 'm', 'queued', 't', '{"header":"Bearer abcdefghijkl"}')$$);
SELECT pg_temp.expect_code('2 authorization', 'oauthTokenData in an event', '23514',
  $$INSERT INTO execution_events (execution_id, user_id, seq, type, data)
    VALUES ('x4', 'user_a', 1, 'step', '{"oauthTokenData":{"access_token":"x"}}')$$);
SELECT pg_temp.expect_code('2 authorization', 'api key in effect result', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, result_meta)
    VALUES ('x4', 'user_a', 's1', 'message.send', true, 'reserved', 'risk_low', '{"api_key":"k"}')$$);
SELECT pg_temp.expect_code('2 authorization', 'secret stored for an n8n-managed credential', '23514',
  $$INSERT INTO integration_connections (id, user_id, capability, provider, label, auth_kind, engine, engine_credential_id, secret_enc, status, created_by)
    VALUES ('conn_dup', 'user_a', 'crm', 'hubspot', 'dup', 'oauth', 'n8n', 'n8n_cred_x', 'v1.enc', 'active', 'user_a')$$);

-- ---------------------------------------------------------------------------------------------
-- 3. Идемпотентность: повторный вебхук, повтор шага, повтор вызова агента
-- ---------------------------------------------------------------------------------------------
INSERT INTO executions (id, user_id, solution_id, kind, workflow_definition_id, workflow_definition_version, provider, provider_execution_id, trigger_kind, trigger_ref, status, trace_id, idempotency_key, max_retries)
  VALUES ('run_1', 'user_a', 'sol_a', 'workflow', 'wf_a', 1, 'n8n', 'n8n_exec_1', 'webhook', 'route:r1', 'running', 't', 'telegram:update:1001', 2);
SELECT pg_temp.check('3 idempotency', 'duplicate webhook (same event id) creates no second execution',
  pg_temp.affected($q$INSERT INTO executions (id, user_id, solution_id, kind, workflow_definition_id, workflow_definition_version, provider, trigger_kind, trigger_ref, status, trace_id, idempotency_key)
     VALUES ('run_dup', 'user_a', 'sol_a', 'workflow', 'wf_a', 1, 'n8n', 'webhook', 'route:r1', 'queued', 't', 'telegram:update:1001')
     ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING$q$) = 0);
-- Шаг «отправить сообщение»: резерв + использование разрешения в одной транзакции.
INSERT INTO authorization_grants (id, user_id, solution_id, action, max_risk, resource_scope, recipient_scope, source, granted_by)
  VALUES ('g_send', 'user_a', 'sol_a', 'message.send', 'medium', '{}', '{}', 'owner', 'user_a');
DO $$
BEGIN
  INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, grant_id, authorized_by)
    VALUES ('run_1', 'user_a', 'send', 'message.send', true, 'reserved', 'g_send', 'grant:g_send');
  PERFORM pg_temp.try_consume('g_send', 'user_a');
END $$;
UPDATE execution_effects SET status = 'dispatched', dispatched_at = now()
  WHERE execution_id = 'run_1' AND step_key = 'send';
UPDATE execution_effects SET status = 'committed', finished_at = now(), result_ref = 'tg:msg:555'
  WHERE execution_id = 'run_1' AND step_key = 'send';
-- Повтор исполнения (retry) снова доходит до шага «send».
UPDATE executions SET status = 'retrying', retry_count = 1 WHERE id = 'run_1';
SELECT pg_temp.check('3 idempotency', 'retry: step already committed, no second reservation',
  pg_temp.affected($q$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, grant_id, authorized_by)
     VALUES ('run_1', 'user_a', 'send', 'message.send', true, 'reserved', 'g_send', 'grant:g_send')
     ON CONFLICT (execution_id, step_key) DO NOTHING$q$) = 0
  AND (SELECT result_ref FROM execution_effects WHERE execution_id = 'run_1' AND step_key = 'send') = 'tg:msg:555');
SELECT pg_temp.check('3 idempotency', 'grant used once despite retry',
  (SELECT uses_count FROM authorization_grants WHERE id = 'g_send') = 1);
-- Вызов агента из процесса (шаг с моделью): повторный HTTP-вызов из n8n не вызывает модель снова.
INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, usage_run_id, authorized_by)
  VALUES ('run_1', 'user_a', 'agent_reply', 'reply.draft', false, 'reserved', 'run_1', 'risk_low');
UPDATE execution_effects SET status = 'committed', finished_at = now(), result_ref = 'draft:77'
  WHERE execution_id = 'run_1' AND step_key = 'agent_reply';
SELECT pg_temp.check('3 idempotency', 'repeated agent call finds the committed result (no second model call, no second charge)',
  pg_temp.affected($q$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, usage_run_id, authorized_by)
     VALUES ('run_1', 'user_a', 'agent_reply', 'reply.draft', false, 'reserved', 'run_1', 'risk_low')
     ON CONFLICT (execution_id, step_key) DO NOTHING$q$) = 0);
SELECT pg_temp.expect_code('3 idempotency', 'retries above the cap', '23514',
  $$UPDATE executions SET retry_count = 3 WHERE id = 'run_1'$$);
SELECT pg_temp.expect_code('3 idempotency', 'same provider execution id twice', '23505',
  $$INSERT INTO executions (id, user_id, solution_id, kind, workflow_definition_id, workflow_definition_version, provider, provider_execution_id, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('run_2', 'user_a', 'sol_a', 'workflow', 'wf_a', 1, 'n8n', 'n8n_exec_1', 'webhook', 'route:r1', 'queued', 't')$$);
SELECT pg_temp.expect_code('3 idempotency', 'execution without a solution at insert', '23502',
  $$INSERT INTO executions (id, user_id, kind, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('x9', 'user_a', 'agent', 'manual', 'm', 'queued', 't')$$);

-- ---------------------------------------------------------------------------------------------
-- 4. Удаление и хранение
-- ---------------------------------------------------------------------------------------------
-- Подключение, которое использует процесс, нельзя удалить строкой — только отозвать.
SELECT pg_temp.expect_code('4 deletion', 'hard-delete a bound credential', '23503',
  $$DELETE FROM integration_connections WHERE id = 'conn_a'$$);
SELECT pg_temp.expect_code('4 deletion', 'revoked credential keeps n8n reference', '23514',
  $$UPDATE integration_connections SET status = 'revoked', revoked_at = now(), revoked_by = 'user_a' WHERE id = 'conn_a2'$$);
UPDATE integration_connections SET status = 'revoked', revoked_at = now(), revoked_by = 'user_a', engine_credential_id = NULL
  WHERE id = 'conn_a2';
SELECT pg_temp.check('4 deletion', 'revoked credential: metadata kept, no secret, no n8n reference',
  (SELECT engine_credential_id IS NULL AND secret_enc IS NULL AND label = 'A sheet' FROM integration_connections WHERE id = 'conn_a2'));
UPDATE executions SET status = 'succeeded', retry_count = 1, finished_at = now(), started_at = now() - interval '1 second',
  cost_usd = 0.012, credits_usd = 0.012, usage_run_id = 'run_1' WHERE id = 'run_1';
INSERT INTO execution_events (execution_id, user_id, seq, type, action, grant_id, data)
  VALUES ('run_1', 'user_a', 1, 'authorization', 'message.send', 'g_send', '{"result":"used"}');
-- Удаление процесса: исполнения остаются с номером версии и ссылкой на исполнителя.
DELETE FROM workflow_definitions WHERE id = 'wf_a';
SELECT pg_temp.check('4 deletion', 'workflow deleted: execution kept with version and provider ids',
  (SELECT workflow_definition_id IS NULL AND workflow_definition_version = 1 AND provider = 'n8n'
     AND provider_execution_id = 'n8n_exec_1' FROM executions WHERE id = 'run_1')
  AND (SELECT count(*) FROM provider_workflows WHERE id = 'pw_a') = 0);
-- Удаление решения (как в Builder): настройки, развёртывания и разрешения уходят; журнал, стоимость и
-- журнал разрешений остаются; подключения клиента остаются.
DELETE FROM solutions WHERE id = 'sol_a';
SELECT pg_temp.check('4 deletion', 'solution deleted: execution kept with cost, solution_id NULL',
  (SELECT solution_id IS NULL AND credits_usd = 0.012 AND usage_run_id = 'run_1' FROM executions WHERE id = 'run_1'));
SELECT pg_temp.check('4 deletion', 'solution deleted: execution events and effects kept',
  (SELECT count(*) FROM execution_events WHERE execution_id = 'run_1') = 1
  AND (SELECT count(*) FROM execution_effects WHERE execution_id = 'run_1') = 2);
SELECT pg_temp.check('4 deletion', 'solution deleted: grants removed, references NULL, history kept',
  (SELECT count(*) FROM authorization_grants WHERE solution_id IS NULL AND id IN ('grant_a', 'g_send')) = 0
  AND (SELECT grant_id IS NULL FROM execution_effects WHERE execution_id = 'run_1' AND step_key = 'send')
  AND (SELECT count(*) FROM authorization_events WHERE subject_id = 'grant_a') = 1);
SELECT pg_temp.check('4 deletion', 'solution deleted: deployments and versions removed',
  (SELECT count(*) FROM agent_deployments WHERE solution_id = 'sol_a') = 0
  AND (SELECT count(*) FROM solution_versions WHERE solution_id = 'sol_a') = 0);
SELECT pg_temp.check('4 deletion', 'solution deleted: customer connections kept',
  (SELECT count(*) FROM integration_connections WHERE user_id = 'user_a') = 2);
SELECT pg_temp.check('4 deletion', 'solution deleted: no grant became account-wide',
  (SELECT count(*) FROM authorization_grants WHERE user_id = 'user_a' AND solution_id IS NULL) = 0);
SELECT pg_temp.check('4 deletion', 'solution deleted: event keeps owner, identity and grant reference',
  (SELECT user_id = 'user_a' AND seq = 1 AND type = 'authorization' AND action = 'message.send' AND grant_id = 'g_send'
     FROM execution_events WHERE execution_id = 'run_1'));
SELECT pg_temp.check('4 deletion', 'solution deleted: effect keeps authorized_by although grant row is gone',
  (SELECT authorized_by = 'grant:g_send' AND grant_id IS NULL AND provider_idempotency_key = 'ketner:run_1:send'
     FROM execution_effects WHERE execution_id = 'run_1' AND step_key = 'send'));
-- Срок хранения: удаление исполнения уносит его события и эффекты, журнал разрешений остаётся.
DELETE FROM executions WHERE id = 'run_1';
SELECT pg_temp.check('4 deletion', 'retention: execution purge removes events and effects only',
  (SELECT count(*) FROM execution_events WHERE execution_id = 'run_1') = 0
  AND (SELECT count(*) FROM execution_effects WHERE execution_id = 'run_1') = 0
  AND (SELECT count(*) FROM authorization_events WHERE user_id = 'user_a') = 1);


-- ---------------------------------------------------------------------------------------------
-- 5. Неизменяемость эффектов и событий; удаление разрешения напрямую
-- ---------------------------------------------------------------------------------------------
INSERT INTO solutions (id, user_id, type, status, name, current_version, template)
  VALUES ('sol_e', 'user_e', 'customer_bot', 'active', 'E', 1, 'customer_bot');
INSERT INTO solution_versions (solution_id, number, config) VALUES ('sol_e', 1, '{}');
INSERT INTO authorization_grants (id, user_id, solution_id, action, max_risk, resource_scope, recipient_scope, source, granted_by)
  VALUES ('g_e', 'user_e', 'sol_e', 'message.send', 'medium', '{}', '{}', 'owner', 'user_e');
INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, grant_id, status, trace_id, max_retries)
  VALUES ('run_e', 'user_e', 'sol_e', 'agent', 'channel_event', 'chat:9', 'g_e', 'running', 't', 2);
INSERT INTO execution_events (execution_id, user_id, seq, type, action, grant_id, data)
  VALUES ('run_e', 'user_e', 1, 'authorization', 'message.send', 'g_e', '{"result":"used"}');
INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, grant_id, authorized_by)
  VALUES ('run_e', 'user_e', 'send', 'message.send', true, 'reserved', 'g_e', 'grant:g_e');
UPDATE execution_effects SET status = 'dispatched', dispatched_at = now() WHERE execution_id = 'run_e' AND step_key = 'send';
UPDATE execution_effects SET status = 'committed', finished_at = now(), result_ref = 'tg:1' WHERE execution_id = 'run_e' AND step_key = 'send';
SELECT pg_temp.expect_code('5 immutability', 'effect cannot start as committed', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, finished_at)
    VALUES ('run_e', 'user_e', 'x', 'message.send', true, 'committed', 'risk_low', now())$$);
SELECT pg_temp.expect_code('5 immutability', 'external effect cannot skip dispatch (reserved -> committed)', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
    VALUES ('run_e', 'user_e', 'skip', 'message.send', true, 'reserved', 'risk_low');
    UPDATE execution_effects SET status = 'committed', finished_at = now() WHERE execution_id = 'run_e' AND step_key = 'skip'$$);
SELECT pg_temp.expect_code('5 immutability', 'internal effect cannot be dispatched', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
    VALUES ('run_e', 'user_e', 'internal', 'lead.create', false, 'reserved', 'risk_low');
    UPDATE execution_effects SET status = 'dispatched', dispatched_at = now() WHERE execution_id = 'run_e' AND step_key = 'internal'$$);
SELECT pg_temp.expect_code('5 immutability', 'committed effect cannot be reserved again', '23514',
  $$UPDATE execution_effects SET status = 'reserved', finished_at = NULL, attempts = 2, lease_expires_at = now() + interval '5 minutes'
    WHERE execution_id = 'run_e' AND step_key = 'send'$$);
SELECT pg_temp.expect_code('5 immutability', 'committed effect result cannot be rewritten', '23514',
  $$UPDATE execution_effects SET result_ref = 'tg:2' WHERE execution_id = 'run_e' AND step_key = 'send'$$);
SELECT pg_temp.expect_code('5 immutability', 'authorization source cannot be rewritten', '23514',
  $$UPDATE execution_effects SET authorized_by = 'risk_low' WHERE execution_id = 'run_e' AND step_key = 'send'$$);
SELECT pg_temp.expect_code('5 immutability', 'grant reference cannot be replaced', '23514',
  $$UPDATE execution_effects SET grant_id = 'g_other' WHERE execution_id = 'run_e' AND step_key = 'send'$$);
SELECT pg_temp.expect_code('5 immutability', 'external flag cannot be changed', '23514',
  $$UPDATE execution_effects SET external = false WHERE execution_id = 'run_e' AND step_key = 'send'$$);
-- Прямое удаление разрешения: исполнение и события остаются, ссылки в исполнении и эффекте обнуляются,
-- источник авторизации в эффекте и ссылка в событии сохраняются.
DELETE FROM authorization_grants WHERE id = 'g_e';
SELECT pg_temp.check('5 immutability', 'grant deleted: execution kept, grant_id NULL',
  (SELECT grant_id IS NULL AND status = 'running' FROM executions WHERE id = 'run_e'));
SELECT pg_temp.check('5 immutability', 'grant deleted: event kept with owner, seq and grant reference',
  (SELECT count(*) = 1 AND bool_and(user_id = 'user_e' AND seq = 1 AND grant_id = 'g_e') FROM execution_events WHERE execution_id = 'run_e'));
SELECT pg_temp.check('5 immutability', 'grant deleted: effect keeps authorized_by',
  (SELECT authorized_by = 'grant:g_e' AND grant_id IS NULL AND status = 'committed' FROM execution_effects WHERE execution_id = 'run_e' AND step_key = 'send'));
SELECT pg_temp.expect_code('5 immutability', 'execution event cannot be edited', 'P0001',
  $$UPDATE execution_events SET data = '{}' WHERE execution_id = 'run_e'$$);

SELECT section, name, outcome FROM results ORDER BY outcome LIKE 'PASS%', section, name;
SELECT count(*) FILTER (WHERE outcome LIKE 'PASS%') AS passed, count(*) FILTER (WHERE outcome LIKE 'FAIL%') AS failed FROM results;
