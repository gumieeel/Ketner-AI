-- Проверка Slice A (docs/PERSISTENCE_SLICE_A.sql) на одноразовой базе.
-- Порядок: миграции 0001–0012, существующие данные (seed-existing.sql), Slice A, этот файл.
-- Запускается ролью сервера Ketner (владелец таблиц). Каждая строка результата — PASS или FAIL.
\set ON_ERROR_STOP 1

CREATE TEMP TABLE results (section text, name text, outcome text);
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
-- Оператор должен пройти (ложный отказ — FAIL); изменения откатываются. Строка PASS пишется после
-- отката: внутри блока она откатывалась вместе с оператором, и принятые операторы не попадали в счёт.
CREATE FUNCTION pg_temp.expect_ok(section text, name text, statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE accepted boolean := false;
BEGIN
  BEGIN
    EXECUTE statement;
    accepted := true;
    RAISE EXCEPTION USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN NULL;
    WHEN OTHERS THEN INSERT INTO results VALUES (section, name, 'FAIL: rejected ' || SQLSTATE || ' ' || left(SQLERRM, 60));
  END;
  IF accepted THEN
    INSERT INTO results VALUES (section, name, 'PASS: accepted');
  END IF;
END;
$$;
-- Отказ именно этим ограничением (а не любым 23514): имя ограничения из диагностики.
CREATE FUNCTION pg_temp.expect_constraint(section text, name text, want text, statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE statement;
    INSERT INTO results VALUES (section, name, 'FAIL: accepted');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = CONSTRAINT_NAME;
    INSERT INTO results VALUES (section, name,
      CASE WHEN SQLSTATE = '23514' AND got = want THEN 'PASS: ' || got
           ELSE 'FAIL: wrong reason ' || SQLSTATE || ' ' || coalesce(got, '-') || ' ' || left(SQLERRM, 60) END);
  END;
END;
$$;
CREATE FUNCTION pg_temp.check(section text, name text, ok boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO results VALUES (section, name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
$$;
CREATE FUNCTION pg_temp.affected(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE statement;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 0. Существующие данные после Slice A не изменились
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.check('0 existing data', 'solutions rows unchanged',
  (SELECT count(*) FROM solutions) = 3
  AND (SELECT md5(string_agg(row_to_json(s)::text, ',' ORDER BY id)) FROM
        (SELECT id, user_id, type, status, name, current_version, active_version, bot, slug, template FROM solutions) s)
      = (SELECT checksum FROM seed_snapshot WHERE name = 'solutions'));
SELECT pg_temp.check('0 existing data', 'solution_versions unchanged, no new columns, no spec rows',
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
SELECT pg_temp.check('0 existing data', 'only the five Slice A tables are new',
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN
     ('solution_version_specs', 'agent_deployments', 'executions', 'execution_events', 'execution_effects')) = 5
  AND (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN
     ('authorization_grants', 'approval_requests', 'authorization_events', 'integration_connections',
      'workflow_templates', 'workflow_definitions', 'provider_workflows')) = 0);

-- ---------------------------------------------------------------------------------------------
-- Данные: бот user_a (sol_a, версия 2) включён
-- ---------------------------------------------------------------------------------------------
INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
  VALUES ('sol_a', 2, 'user_a', '{"specVersion":1,"name":"Керамика"}');
INSERT INTO agent_deployments (id, user_id, solution_id, agent_version, runtime, state, activated_by)
  VALUES ('dep_a', 'user_a', 'sol_a', 2, 'agent_gateway', 'active', 'user_a');

-- ---------------------------------------------------------------------------------------------
-- 1. Изоляция клиентов и рантайм
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_code('1 isolation', 'execution under another tenant solution', '23503',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('x_b_on_a', 'user_b', 'sol_a', 'agent', 'manual', 'm', 'running', 't')$$);
SELECT pg_temp.expect_code('1 isolation', 'execution with another tenant deployment', '23503',
  $$INSERT INTO executions (id, user_id, solution_id, kind, agent_deployment_id, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('x_b_dep', 'user_b', 'sol_b', 'agent', 'dep_a', 'manual', 'm', 'running', 't')$$);
-- sol_c (user_a) без открытого включения: срабатывает именно внешний ключ владельца, а не уникальность.
SELECT pg_temp.expect_code('1 isolation', 'deploy another tenant agent version', '23503',
  $$INSERT INTO agent_deployments (id, user_id, solution_id, agent_version, runtime, state, activated_by)
    VALUES ('dep_b_on_c', 'user_b', 'sol_c', 1, 'agent_gateway', 'active', 'user_b')$$);
SELECT pg_temp.expect_code('1 isolation', 'spec for another tenant solution', '23503',
  $$INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
    VALUES ('sol_a', 1, 'user_b', '{"specVersion":1}')$$);
SELECT pg_temp.expect_code('1 isolation', 'two open deployments of one agent', '23505',
  $$INSERT INTO agent_deployments (id, user_id, solution_id, agent_version, runtime, state, activated_by)
    VALUES ('dep_a2', 'user_a', 'sol_a', 2, 'agent_gateway', 'active', 'user_a')$$);
SELECT pg_temp.expect_code('1 isolation', 'runtime mastra is not allowed (deployment)', '23514',
  $$INSERT INTO agent_deployments (id, user_id, solution_id, agent_version, runtime, state, activated_by)
    VALUES ('dep_m', 'user_b', 'sol_b', 1, 'mastra', 'active', 'user_b')$$);
SELECT pg_temp.expect_code('1 isolation', 'runtime mastra is not allowed (execution)', '23514',
  $$INSERT INTO executions (id, user_id, solution_id, kind, runtime, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('x_m', 'user_a', 'sol_a', 'agent', 'mastra', 'manual', 'm', 'running', 't')$$);
SELECT pg_temp.expect_code('1 isolation', 'workflow executions are not part of Slice A', '23514',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('x_wf', 'user_a', 'sol_a', 'workflow', 'manual', 'm', 'running', 't')$$);
INSERT INTO executions (id, user_id, solution_id, kind, agent_deployment_id, runtime, trigger_kind, trigger_ref, status, trace_id)
  VALUES ('run_a', 'user_a', 'sol_a', 'agent', 'dep_a', 'agent_gateway', 'public_page', 'conversation:conv_1', 'running', 't-a');
SELECT pg_temp.expect_code('1 isolation', 'write into another tenant execution history', '23503',
  $$INSERT INTO execution_events (execution_id, user_id, seq, type) VALUES ('run_a', 'user_b', 1, 'step')$$);
SELECT pg_temp.expect_code('1 isolation', 'effect on another tenant execution', '23503',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
    VALUES ('run_a', 'user_b', 'x', 'knowledge.search', false, 'reserved', 'risk_low')$$);
SELECT pg_temp.expect_code('1 isolation', 'grant authorization source is not part of Slice A', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
    VALUES ('run_a', 'user_a', 'g', 'message.send', true, 'reserved', 'grant:g1')$$);

-- ---------------------------------------------------------------------------------------------
-- 2. Сигнальная проверка секретов: пропуски прежней проверки ловятся, ложные отказы ушли
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_code('2 secrets', 'accessToken (camelCase) in execution context', '23514',
  $$UPDATE executions SET context = '{"accessToken":"ya29.a0AfH6SMBx"}' WHERE id = 'run_a'$$);
SELECT pg_temp.expect_code('2 secrets', 'token = sk-live-… in event data', '23514',
  $$INSERT INTO execution_events (execution_id, user_id, seq, type, data) VALUES ('run_a', 'user_a', 90, 'error', '{"token":"sk-live-..."}')$$);
SELECT pg_temp.expect_code('2 secrets', 'Authorization header in effect result', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, result_meta)
    VALUES ('run_a', 'user_a', 'leak', 'knowledge.search', false, 'reserved', 'risk_low', '{"headers":{"Authorization":"Bearer abcdefgh12345678"}}')$$);
SELECT pg_temp.expect_code('2 secrets', 'API key inside error text', '23514',
  $$UPDATE executions SET error = '{"message":"invalid key sk-proj-AbCdEf0123456789XyZ0"}' WHERE id = 'run_a'$$);
SELECT pg_temp.expect_ok('2 secrets', 'JSON schema with a password field is accepted (event)',
  $$INSERT INTO execution_events (execution_id, user_id, seq, type, data)
    VALUES ('run_a', 'user_a', 91, 'step', '{"inputSchema":{"type":"object","properties":{"password":{"type":"string"}}}}')$$);
SELECT pg_temp.expect_ok('2 secrets', 'text "The bearer certificate is valid" is accepted (output)',
  $$UPDATE executions SET output_meta = '{"excerpt":"The bearer certificate is valid"}' WHERE id = 'run_a'$$);
SELECT pg_temp.expect_ok('2 secrets', 'redaction marker is accepted (effect)',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, result_meta)
    VALUES ('run_a', 'user_a', 'clean', 'knowledge.search', false, 'reserved', 'risk_low', '{"accessToken":"[redacted:secret_field]"}')$$);
SELECT pg_temp.expect_ok('2 secrets', 'specification with password field and token-like text is accepted (no check on specs)',
  $$INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
    VALUES ('sol_a', 1, 'user_a', '{"specVersion":1,"instructions":"Never ask for a password. Bearer abcDEF1234567890ghijkl is an example.","input":{"fields":[{"name":"password"}]}}')$$);

-- ---------------------------------------------------------------------------------------------
-- 3. Сценарий бота и идемпотентность
-- ---------------------------------------------------------------------------------------------
-- Ответ бота: шаг модели (вызов инструмента), поиск в знаниях, шаг модели (ответ), ответ клиенту.
INSERT INTO execution_events (execution_id, user_id, seq, type, data) VALUES ('run_a', 'user_a', 1, 'status', '{"status":"running"}');
INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, usage_run_id)
  VALUES ('run_a', 'user_a', 'model-1', 'reply.draft', false, 'reserved', 'risk_low', 'run_a');
UPDATE execution_effects SET status = 'committed', finished_at = now(), result_meta = '{"toolCalls":1}'
  WHERE execution_id = 'run_a' AND step_key = 'model-1';
INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
  VALUES ('run_a', 'user_a', 'knowledge-1', 'knowledge.search', false, 'reserved', 'risk_low');
UPDATE execution_effects SET status = 'committed', finished_at = now(), result_meta = '{"matches":1}'
  WHERE execution_id = 'run_a' AND step_key = 'knowledge-1';
INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, usage_run_id)
  VALUES ('run_a', 'user_a', 'model-2', 'reply.draft', false, 'reserved', 'risk_low', 'run_a');
UPDATE execution_effects SET status = 'committed', finished_at = now() WHERE execution_id = 'run_a' AND step_key = 'model-2';
INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
  VALUES ('run_a', 'user_a', 'reply', 'reply.send_in_session', false, 'reserved', 'legacy_bot_enablement:sol_a');
UPDATE execution_effects SET status = 'committed', finished_at = now(), result_ref = 'bot_message:m3'
  WHERE execution_id = 'run_a' AND step_key = 'reply';
UPDATE executions SET status = 'succeeded', stop_reason = 'answer', started_at = now() - interval '2 seconds', finished_at = now(),
  cost_usd = 0.00046, credits_usd = 0.00046, usage_run_id = 'run_a'
  WHERE id = 'run_a';
SELECT pg_temp.check('3 bot scenario', 'one bot reply: 4 committed effects, legacy enablement authorizes the reply',
  (SELECT count(*) FROM execution_effects WHERE execution_id = 'run_a' AND status = 'committed') = 4
  AND (SELECT authorized_by FROM execution_effects WHERE execution_id = 'run_a' AND step_key = 'reply') = 'legacy_bot_enablement:sol_a'
  AND (SELECT stop_reason FROM executions WHERE id = 'run_a') = 'answer');
-- Повтор шага модели после сбоя процесса: резерв не создаётся второй раз — модель не вызывается повторно.
SELECT pg_temp.check('3 bot scenario', 'repeated model step finds the committed effect (no second model call)',
  pg_temp.affected($q$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
     VALUES ('run_a', 'user_a', 'model-1', 'reply.draft', false, 'reserved', 'risk_low')
     ON CONFLICT (execution_id, step_key) DO NOTHING$q$) = 0);
SELECT pg_temp.expect_code('3 idempotency', 'same channel event twice (idempotency key)', '23505',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, idempotency_key)
    VALUES ('wh_1', 'user_a', 'sol_a', 'agent', 'webhook', 'route:r', 'running', 't', 'telegram:update:1');
    INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, idempotency_key)
    VALUES ('wh_2', 'user_a', 'sol_a', 'agent', 'webhook', 'route:r', 'running', 't', 'telegram:update:1')$$);
SELECT pg_temp.expect_code('3 idempotency', 'retries above the cap', '23514',
  $$UPDATE executions SET retry_count = 4, max_retries = 3 WHERE id = 'run_a'$$);
SELECT pg_temp.expect_code('3 idempotency', 'execution without a solution at insert', '23502',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id)
    VALUES ('x_none', 'user_a', NULL, 'agent', 'manual', 'm', 'running', 't')$$);
SELECT pg_temp.expect_code('3 idempotency', 'stop reason requires a finish time', '23514',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, stop_reason)
    VALUES ('x_sr', 'user_a', 'sol_a', 'agent', 'manual', 'm', 'running', 't', 'max_steps')$$);

-- ---------------------------------------------------------------------------------------------
-- 4. Удаление и хранение
-- ---------------------------------------------------------------------------------------------
-- Срок хранения: удаление исполнения уносит его события и эффекты.
INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id)
  VALUES ('run_old', 'user_a', 'sol_a', 'agent', 'manual', 'm', 'running', 't');
INSERT INTO execution_events (execution_id, user_id, seq, type) VALUES ('run_old', 'user_a', 1, 'step');
INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
  VALUES ('run_old', 'user_a', 's', 'knowledge.search', false, 'reserved', 'risk_low');
DELETE FROM executions WHERE id = 'run_old';
SELECT pg_temp.check('4 deletion', 'retention: deleting an execution removes its events and effects',
  (SELECT count(*) FROM execution_events WHERE execution_id = 'run_old') = 0
  AND (SELECT count(*) FROM execution_effects WHERE execution_id = 'run_old') = 0);
-- Удаление решения (как в Builder): спецификации и включения уходят; журнал исполнений остаётся.
DELETE FROM solutions WHERE id = 'sol_a';
SELECT pg_temp.check('4 deletion', 'solution deleted: specs and deployments removed',
  (SELECT count(*) FROM solution_version_specs WHERE solution_id = 'sol_a') = 0
  AND (SELECT count(*) FROM agent_deployments WHERE solution_id = 'sol_a') = 0);
SELECT pg_temp.check('4 deletion', 'solution deleted: execution kept with cost, solution and deployment references NULL',
  (SELECT solution_id IS NULL AND agent_deployment_id IS NULL AND credits_usd = 0.00046 AND user_id = 'user_a'
     FROM executions WHERE id = 'run_a'));
SELECT pg_temp.check('4 deletion', 'solution deleted: events and effects kept',
  (SELECT count(*) FROM execution_events WHERE execution_id = 'run_a') = 1
  AND (SELECT count(*) FROM execution_effects WHERE execution_id = 'run_a') = 4);

-- ---------------------------------------------------------------------------------------------
-- 5. Неизменяемость эффектов и событий
-- ---------------------------------------------------------------------------------------------
INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, max_retries)
  VALUES ('run_e', 'user_b', 'sol_b', 'agent', 'channel_event', 'chat:9', 'running', 't', 2);
INSERT INTO execution_events (execution_id, user_id, seq, type, action, data)
  VALUES ('run_e', 'user_b', 1, 'authorization', 'reply.send_in_session', '{"result":"allowed","source":"legacy_bot_enablement"}');
INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
  VALUES ('run_e', 'user_b', 'send', 'message.send', true, 'reserved', 'legacy_bot_enablement:sol_b');
UPDATE execution_effects SET status = 'dispatched', dispatched_at = now() WHERE execution_id = 'run_e' AND step_key = 'send';
UPDATE execution_effects SET status = 'committed', finished_at = now(), result_ref = 'tg:1' WHERE execution_id = 'run_e' AND step_key = 'send';
SELECT pg_temp.expect_code('5 immutability', 'effect cannot start as committed', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, finished_at)
    VALUES ('run_e', 'user_b', 'x', 'message.send', true, 'committed', 'risk_low', now())$$);
SELECT pg_temp.expect_code('5 immutability', 'external effect cannot skip dispatch (reserved -> committed)', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
    VALUES ('run_e', 'user_b', 'skip', 'message.send', true, 'reserved', 'risk_low');
    UPDATE execution_effects SET status = 'committed', finished_at = now() WHERE execution_id = 'run_e' AND step_key = 'skip'$$);
SELECT pg_temp.expect_code('5 immutability', 'internal effect cannot be dispatched', '23514',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
    VALUES ('run_e', 'user_b', 'internal', 'lead.create', false, 'reserved', 'risk_low');
    UPDATE execution_effects SET status = 'dispatched', dispatched_at = now() WHERE execution_id = 'run_e' AND step_key = 'internal'$$);
SELECT pg_temp.expect_code('5 immutability', 'committed effect cannot be reserved again', '23514',
  $$UPDATE execution_effects SET status = 'reserved', finished_at = NULL, attempts = 2, lease_expires_at = now() + interval '5 minutes'
    WHERE execution_id = 'run_e' AND step_key = 'send'$$);
SELECT pg_temp.expect_code('5 immutability', 'committed effect result cannot be rewritten', '23514',
  $$UPDATE execution_effects SET result_ref = 'tg:2' WHERE execution_id = 'run_e' AND step_key = 'send'$$);
SELECT pg_temp.expect_code('5 immutability', 'authorization source cannot be rewritten', '23514',
  $$UPDATE execution_effects SET authorized_by = 'risk_low' WHERE execution_id = 'run_e' AND step_key = 'send'$$);
SELECT pg_temp.expect_code('5 immutability', 'external flag cannot be changed', '23514',
  $$UPDATE execution_effects SET external = false WHERE execution_id = 'run_e' AND step_key = 'send'$$);
SELECT pg_temp.expect_code('5 immutability', 'execution event cannot be edited', 'P0001',
  $$UPDATE execution_events SET data = '{}' WHERE execution_id = 'run_e'$$);

-- ---------------------------------------------------------------------------------------------
-- 6. Форма JSON: в каждом столбце-объекте JSON-строка (двойное кодирование) и массив отклоняются
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_constraint('6 json shape', 'spec: JSON string', 'solution_version_specs_spec_object',
  $$INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
    VALUES ('sol_b', 1, 'user_b', '"{\"specVersion\":1}"')$$);
SELECT pg_temp.expect_constraint('6 json shape', 'spec: JSON array', 'solution_version_specs_spec_object',
  $$INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
    VALUES ('sol_b', 1, 'user_b', '[{"specVersion":1}]')$$);
SELECT pg_temp.expect_constraint('6 json shape', 'spec: object without specVersion (NULL no longer passes)', 'solution_version_specs_spec_object',
  $$INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
    VALUES ('sol_b', 1, 'user_b', '{"name":"Без версии"}')$$);
SELECT pg_temp.expect_constraint('6 json shape', 'spec: specVersion 2', 'solution_version_specs_spec_object',
  $$INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
    VALUES ('sol_b', 1, 'user_b', '{"specVersion":2}')$$);
SELECT pg_temp.expect_ok('6 json shape', 'spec: object with specVersion 1 is accepted',
  $$INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
    VALUES ('sol_b', 1, 'user_b', '{"specVersion":1,"name":"Бот"}')$$);

SELECT pg_temp.expect_constraint('6 json shape', 'executions.' || col || ': JSON ' || kind, 'executions_' || col || '_object',
  format('UPDATE executions SET %I = %L WHERE id = %L', col, val, 'run_e'))
FROM (VALUES ('context'), ('input_meta'), ('output_meta'), ('error')) AS c(col),
     (VALUES ('string', '"{\"steps\":1}"'), ('array', '[{"steps":1}]')) AS v(kind, val);
SELECT pg_temp.expect_constraint('6 json shape', 'executions.input_meta: JSON string at insert', 'executions_input_meta_object',
  $$INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, input_meta)
    VALUES ('x_json', 'user_b', 'sol_b', 'agent', 'manual', 'm', 'running', 't', '"{\"messages\":1}"')$$);
SELECT pg_temp.expect_ok('6 json shape', 'executions: objects everywhere and error NULL are accepted',
  $$UPDATE executions SET context = '{}', input_meta = '{"messages":1}', output_meta = '{"steps":2}', error = NULL WHERE id = 'run_e'$$);
SELECT pg_temp.expect_ok('6 json shape', 'executions: error object is accepted',
  $$UPDATE executions SET error = '{"code":"reaped_stale_running"}' WHERE id = 'run_e'$$);

SELECT pg_temp.expect_constraint('6 json shape', 'execution_events.data: JSON string', 'execution_events_data_object',
  $$INSERT INTO execution_events (execution_id, user_id, seq, type, data) VALUES ('run_e', 'user_b', 50, 'cost', '"{\"step\":1}"')$$);
SELECT pg_temp.expect_constraint('6 json shape', 'execution_events.data: JSON array', 'execution_events_data_object',
  $$INSERT INTO execution_events (execution_id, user_id, seq, type, data) VALUES ('run_e', 'user_b', 51, 'cost', '[{"step":1}]')$$);
SELECT pg_temp.expect_ok('6 json shape', 'execution_events.data: object is accepted',
  $$INSERT INTO execution_events (execution_id, user_id, seq, type, data) VALUES ('run_e', 'user_b', 52, 'cost', '{"step":1}')$$);

SELECT pg_temp.expect_constraint('6 json shape', 'execution_effects.result_meta: JSON string', 'execution_effects_result_meta_object',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, result_meta)
    VALUES ('run_e', 'user_b', 'js', 'knowledge.search', false, 'reserved', 'risk_low', '"{\"matches\":1}"')$$);
SELECT pg_temp.expect_constraint('6 json shape', 'execution_effects.result_meta: JSON array', 'execution_effects_result_meta_object',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, result_meta)
    VALUES ('run_e', 'user_b', 'ja', 'knowledge.search', false, 'reserved', 'risk_low', '[1]')$$);
SELECT pg_temp.expect_constraint('6 json shape', 'execution_effects.result_meta: JSON string when committing', 'execution_effects_result_meta_object',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
    VALUES ('run_e', 'user_b', 'jc', 'knowledge.search', false, 'reserved', 'risk_low');
    UPDATE execution_effects SET status = 'committed', finished_at = now(), result_meta = '"{\"matches\":1}"'
    WHERE execution_id = 'run_e' AND step_key = 'jc'$$);
SELECT pg_temp.expect_ok('6 json shape', 'execution_effects.result_meta: object is accepted when committing',
  $$INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
    VALUES ('run_e', 'user_b', 'jo', 'knowledge.search', false, 'reserved', 'risk_low');
    UPDATE execution_effects SET status = 'committed', finished_at = now(), result_meta = '{"matches":1}'
    WHERE execution_id = 'run_e' AND step_key = 'jo'$$);

SELECT section, name, outcome FROM results ORDER BY outcome LIKE 'PASS%', section, name;
SELECT count(*) FILTER (WHERE outcome LIKE 'PASS%') AS passed, count(*) FILTER (WHERE outcome LIKE 'FAIL%') AS failed FROM results;
