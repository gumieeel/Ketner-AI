// Идемпотентность под одновременными запросами (одноразовая база, роль сервера Ketner).
// Запуск: node idempotency-race.mjs <postgres-url> (после миграций, данных и предложения).
//
// Списание кредитов смоделировано таблицей review_charges:
// сервис вызывает модель (и списывает) или провайдера только тот запрос, который выиграл резерв.
// Так считается, сколько раз произошло списание и внешнее действие.
import postgres from '../../node_modules/postgres/src/index.js';

const url = process.argv[2];
const pool = postgres(url, { max: 24, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const N = 20;

/** Входящий вебхук: создать исполнение по ключу события; новое исполнение вызывает модель и списывает. */
async function deliverWebhook(eventId) {
  return pool.begin(async (tx) => {
    const created = await tx`
      INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, idempotency_key)
      VALUES (${'wh_' + Math.random().toString(36).slice(2)}, 'user_i', 'sol_i', 'agent', 'webhook', 'route:r', 'running', 't', ${eventId})
      ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING id`;
    if (created.length === 0) return 'duplicate';
    await tx`INSERT INTO review_charges (run_id, credits) VALUES (${created[0].id}, 4)`;
    return 'created';
  });
}

/** Шаг с моделью: резерв эффекта; выигравший вызывает модель (списание) и фиксирует результат. */
async function agentStep(executionId, stepKey) {
  return pool.begin(async (tx) => {
    const reserved = await tx`
      INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, usage_run_id)
      VALUES (${executionId}, 'user_i', ${stepKey}, 'reply.draft', false, 'reserved', 'risk_low', ${executionId})
      ON CONFLICT (execution_id, step_key) DO NOTHING RETURNING step_key`;
    if (reserved.length === 0) {
      const [existing] = await tx`SELECT status, result_ref FROM execution_effects
                                  WHERE execution_id = ${executionId} AND step_key = ${stepKey}`;
      return `existing:${existing.status}`;
    }
    await tx`INSERT INTO review_charges (run_id, credits) VALUES (${executionId}, 7)`;
    await tx`UPDATE execution_effects SET status = 'committed', finished_at = now(), result_ref = 'draft:1'
             WHERE execution_id = ${executionId} AND step_key = ${stepKey}`;
    return 'charged';
  });
}

try {
  await pool`CREATE TABLE review_charges (id bigserial PRIMARY KEY, run_id text NOT NULL, credits integer NOT NULL)`;
  await pool`INSERT INTO solutions (id, user_id, type, status, name, current_version, template)
             VALUES ('sol_i', 'user_i', 'customer_bot', 'active', 'I', 1, 'customer_bot')`;
  await pool`INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, max_retries)
             VALUES ('run_i', 'user_i', 'sol_i', 'agent', 'webhook', 'route:r', 'running', 't', 3)`;

  // 1. Один и тот же вебхук доставлен 20 раз одновременно.
  const deliveries = await Promise.all(
    Array.from({ length: N }, () => deliverWebhook('telegram:update:777')),
  );
  const [{ executions }] =
    await pool`SELECT count(*)::int AS executions FROM executions WHERE idempotency_key = 'telegram:update:777'`;
  const [{ charges: webhookCharges }] =
    await pool`SELECT count(*)::int AS charges FROM review_charges WHERE run_id LIKE 'wh_%'`;
  check(
    `${N} concurrent identical webhooks → 1 execution`,
    executions === 1,
    `created=${deliveries.filter((d) => d === 'created').length}, duplicates=${deliveries.filter((d) => d === 'duplicate').length}`,
  );
  check('… and 1 charge', webhookCharges === 1, `charges=${webhookCharges}`);

  // 2. Один шаг с моделью запрошен 20 раз одновременно (повторы HTTP-узла n8n, гонка воркеров).
  const steps = await Promise.all(
    Array.from({ length: N }, () => agentStep('run_i', 'agent_reply')),
  );
  const [{ charges: stepCharges }] =
    await pool`SELECT count(*)::int AS charges FROM review_charges WHERE run_id = 'run_i'`;
  check(
    `${N} concurrent identical step requests → 1 model call and 1 charge`,
    stepCharges === 1 && steps.filter((s) => s === 'charged').length === 1,
    `charged=${steps.filter((s) => s === 'charged').length}, existing=${steps.filter((s) => s.startsWith('existing')).length}, charges=${stepCharges}`,
  );

  // 3. Повтор того же шага позже (тот же ключ) — готовый результат, без списания.
  const later = await agentStep('run_i', 'agent_reply');
  const [{ charges: afterRepeat }] =
    await pool`SELECT count(*)::int AS charges FROM review_charges WHERE run_id = 'run_i'`;
  check(
    'repeat with the same key after commit → stored result, no charge',
    later === 'existing:committed' && afterRepeat === 1,
    `${later}, charges=${afterRepeat}`,
  );

  // Повторы упавших и неясных шагов — отдельный сценарий effect-retry.mjs.
} catch (error) {
  check('scenario ran without errors', false, String(error));
} finally {
  await pool`DROP TABLE IF EXISTS review_charges`.catch(() => {});
  await pool.end();
}

for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(
  `passed=${results.filter((r) => r.ok).length} failed=${results.filter((r) => !r.ok).length}`,
);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
