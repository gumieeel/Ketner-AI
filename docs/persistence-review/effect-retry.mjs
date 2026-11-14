// Безопасные повторы внешних действий: двухфазная отправка, сбои, неясные исходы, сверка, гонки.
// Запуск: node effect-retry.mjs <postgres-url> (после миграций, данных и предложения).
//
// Каждая операция — отдельная явная транзакция; состояние шага блокируется SELECT … FOR UPDATE.
// Проверки читают состояние отдельными запросами после фиксации: ни одна проверка не смотрит на
// снимок, сделанный до проверяемого перехода.
//
// Провайдер смоделирован таблицей review_provider_log: одна строка — одно выполненное у провайдера
// действие. Провайдер с ключом идемпотентности не выполняет действие повторно для того же ключа;
// провайдер без ключа выполняет каждый запрос.
import postgres from '../../node_modules/postgres/src/index.js';

const url = process.argv[2];
const sql = postgres(url, { max: 16, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const EXEC = 'retry_run';

// ── Сервис Ketner (модель) ────────────────────────────────────────────────────────────────

/** Резерв или повтор шага. Возвращает: reserved | retried | in_progress | already_done | needs_reconciliation. */
async function reserve(step, { idempotent }) {
  return sql.begin(async (tx) => {
    const inserted = await tx`
      INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, provider_supports_idempotency)
      VALUES (${EXEC}, 'user_x', ${step}, 'message.send', true, 'reserved', 'risk_low', ${idempotent})
      ON CONFLICT (execution_id, step_key) DO NOTHING RETURNING step_key`;
    if (inserted.length === 1) return 'reserved';
    const [row] = await tx`
      SELECT status, lease_expires_at > now() AS live FROM execution_effects
      WHERE execution_id = ${EXEC} AND step_key = ${step} FOR UPDATE`;
    if (row.status === 'committed') return 'already_done';
    if (row.status === 'reserved' || row.status === 'dispatched') return 'in_progress';
    if (row.status === 'failed' || row.status === 'unknown') {
      try {
        await tx.savepoint(async (sp) => {
          await sp`UPDATE execution_effects SET status = 'reserved', attempts = attempts + 1,
                     lease_expires_at = now() + interval '5 minutes'
                   WHERE execution_id = ${EXEC} AND step_key = ${step}`;
        });
        return 'retried';
      } catch (error) {
        if (error.code === '23514') return 'needs_reconciliation';
        throw error;
      }
    }
    return row.status;
  });
}

/** Фиксация «отправлено» — отдельной транзакцией ДО запроса провайдеру. */
async function markDispatched(step, retentionMs) {
  await sql.begin(async (tx) => {
    const [row] = await tx`SELECT status, idempotency_expires_at, provider_supports_idempotency
                           FROM execution_effects WHERE execution_id = ${EXEC} AND step_key = ${step} FOR UPDATE`;
    if (row.status !== 'reserved') throw new Error(`dispatch from ${row.status}`);
    const expires = row.provider_supports_idempotency
      ? (row.idempotency_expires_at ?? new Date(Date.now() + retentionMs))
      : null;
    await tx`UPDATE execution_effects SET status = 'dispatched', dispatched_at = now(), idempotency_expires_at = ${expires}
             WHERE execution_id = ${EXEC} AND step_key = ${step}`;
  });
}

async function finish(step, status, extra = {}) {
  await sql.begin(async (tx) => {
    await tx`SELECT 1 FROM execution_effects WHERE execution_id = ${EXEC} AND step_key = ${step} FOR UPDATE`;
    await tx`UPDATE execution_effects SET status = ${status}, finished_at = now(),
               failure_stage = ${extra.failureStage ?? null}, resolved_by = ${extra.resolvedBy ?? null},
               result_ref = ${extra.resultRef ?? null}
             WHERE execution_id = ${EXEC} AND step_key = ${step}`;
  });
}

/** Восстановление зависших шагов: reserved → failed(before_dispatch), dispatched → unknown. */
async function recoverStale() {
  return sql.begin(async (tx) => {
    const stale = await tx`SELECT step_key, status FROM execution_effects
                           WHERE status IN ('reserved', 'dispatched') AND lease_expires_at <= now()
                           FOR UPDATE SKIP LOCKED`;
    for (const row of stale) {
      if (row.status === 'reserved') {
        await tx`UPDATE execution_effects SET status = 'failed', failure_stage = 'before_dispatch', finished_at = now()
                 WHERE execution_id = ${EXEC} AND step_key = ${row.step_key}`;
      } else {
        await tx`UPDATE execution_effects SET status = 'unknown', finished_at = now()
                 WHERE execution_id = ${EXEC} AND step_key = ${row.step_key}`;
      }
    }
    return stale.map((r) => `${r.step_key}:${r.status}`);
  });
}

/** «Падение» воркера: аренда истекает, шаг остаётся в своём статусе. */
async function crash(step) {
  await sql`UPDATE execution_effects SET lease_expires_at = now() - interval '1 second'
            WHERE execution_id = ${EXEC} AND step_key = ${step}`;
}

// ── Провайдер (модель) ────────────────────────────────────────────────────────────────────

/** mode: ok | reject | timeout_after_perform | timeout_before_perform. */
async function provider(step, { idempotent, mode }) {
  const [effect] = await sql`SELECT provider_idempotency_key FROM execution_effects
                             WHERE execution_id = ${EXEC} AND step_key = ${step}`;
  if (mode === 'reject' || mode === 'timeout_before_perform')
    return mode === 'reject' ? 'rejected' : 'timeout';
  if (idempotent) {
    const done =
      await sql`SELECT 1 FROM review_provider_log WHERE request_key = ${effect.provider_idempotency_key}`;
    if (done.length > 0) return mode === 'ok' ? 'ok_cached' : 'timeout';
  }
  await sql`INSERT INTO review_provider_log (logical, request_key) VALUES (${step}, ${effect.provider_idempotency_key})`;
  return mode === 'ok' ? 'ok' : 'timeout';
}

const performed = async (step) =>
  (await sql`SELECT count(*)::int AS n FROM review_provider_log WHERE logical = ${step}`)[0].n;
const state = async (step) =>
  (
    await sql`SELECT status, attempts, failure_stage, resolved_by FROM execution_effects
             WHERE execution_id = ${EXEC} AND step_key = ${step}`
  )[0];

try {
  await sql`CREATE TABLE review_provider_log (id bigserial PRIMARY KEY, logical text NOT NULL, request_key text NOT NULL)`;
  await sql`CREATE TABLE review_charges (charge_key text PRIMARY KEY, credits integer NOT NULL)`;
  await sql`INSERT INTO solutions (id, user_id, type, status, name, current_version, template)
            VALUES ('sol_x', 'user_x', 'customer_bot', 'active', 'X', 1, 'customer_bot')`;
  await sql`INSERT INTO executions (id, user_id, solution_id, kind, trigger_kind, trigger_ref, status, trace_id, max_retries)
            VALUES (${EXEC}, 'user_x', 'sol_x', 'agent', 'channel_event', 'chat:1', 'running', 't', 3)`;
  const DAY = 24 * 3600 * 1000;

  // 1. Сбой до отправки: воркер упал после резерва, «отправлено» не зафиксировано.
  await reserve('c1', { idempotent: false });
  await crash('c1');
  const recovered1 = await recoverStale();
  const s1 = await state('c1');
  check(
    '1. failure before dispatch → recovery marks failed(before_dispatch)',
    s1.status === 'failed' && s1.failure_stage === 'before_dispatch',
    `${recovered1} → ${JSON.stringify(s1)}`,
  );
  const r1 = await reserve('c1', { idempotent: false });
  await markDispatched('c1');
  const p1 = await provider('c1', { idempotent: false, mode: 'ok' });
  await finish('c1', 'committed', { resultRef: 'tg:1' });
  check(
    '1. … retry is safe without provider idempotency: 1 provider action',
    r1 === 'retried' && p1 === 'ok' && (await performed('c1')) === 1,
    `retry=${r1}, performed=${await performed('c1')}`,
  );

  // 2. Подтверждённый отказ провайдера.
  await reserve('c2', { idempotent: false });
  await markDispatched('c2');
  const p2 = await provider('c2', { idempotent: false, mode: 'reject' });
  await finish('c2', 'failed', { failureStage: 'provider_rejected' });
  const r2 = await reserve('c2', { idempotent: false });
  await markDispatched('c2');
  await provider('c2', { idempotent: false, mode: 'ok' });
  await finish('c2', 'committed', { resultRef: 'tg:2' });
  const s2 = await state('c2');
  check(
    '2. confirmed provider rejection → retry allowed, 1 provider action',
    p2 === 'rejected' &&
      r2 === 'retried' &&
      s2.status === 'committed' &&
      s2.attempts === 2 &&
      (await performed('c2')) === 1,
    JSON.stringify(s2),
  );

  // 3a. Успех у провайдера, затем падение Ketner; провайдер БЕЗ ключа идемпотентности.
  await reserve('c3a', { idempotent: false });
  await markDispatched('c3a');
  await provider('c3a', { idempotent: false, mode: 'ok' });
  await crash('c3a');
  await recoverStale();
  const s3a = await state('c3a');
  const r3a = await reserve('c3a', { idempotent: false });
  check(
    '3a. provider success + Ketner crash → unknown; automatic retry refused',
    s3a.status === 'unknown' && r3a === 'needs_reconciliation' && (await performed('c3a')) === 1,
    `state=${s3a.status}, retry=${r3a}`,
  );
  await finish('c3a', 'committed', {
    resolvedBy: 'reconciliation:telegram',
    resultRef: 'tg:found',
  });
  check(
    '3a. … reconciliation finds the action → committed, still 1 provider action',
    (await state('c3a')).status === 'committed' && (await performed('c3a')) === 1,
  );

  // 3b. То же у провайдера С ключом идемпотентности (ключ ещё хранится).
  await reserve('c3b', { idempotent: true });
  await markDispatched('c3b', DAY);
  await provider('c3b', { idempotent: true, mode: 'ok' });
  await crash('c3b');
  await recoverStale();
  const r3b = await reserve('c3b', { idempotent: true });
  await markDispatched('c3b', DAY);
  const p3b = await provider('c3b', { idempotent: true, mode: 'ok' });
  await finish('c3b', 'committed', { resultRef: 'inv:1' });
  check(
    '3b. provider success + crash, idempotent provider → retry with the same key, no second action',
    r3b === 'retried' && p3b === 'ok_cached' && (await performed('c3b')) === 1,
    `retry=${r3b}, provider=${p3b}, performed=${await performed('c3b')}`,
  );

  // 4. Таймаут, исход неизвестен (провайдер на самом деле не выполнил); без ключа.
  await reserve('c4', { idempotent: false });
  await markDispatched('c4');
  const p4 = await provider('c4', { idempotent: false, mode: 'timeout_before_perform' });
  await finish('c4', 'unknown');
  const r4 = await reserve('c4', { idempotent: false });
  let noActor = '';
  try {
    await finish('c4', 'failed', { failureStage: 'reconciled_not_done' });
  } catch (error) {
    noActor = error.code;
  }
  await finish('c4', 'failed', { failureStage: 'reconciled_not_done', resolvedBy: 'user:user_x' });
  const r4b = await reserve('c4', { idempotent: false });
  await markDispatched('c4');
  await provider('c4', { idempotent: false, mode: 'ok' });
  await finish('c4', 'committed', { resultRef: 'tg:4' });
  check(
    '4. timeout → unknown; retry refused; resolving needs an actor',
    p4 === 'timeout' && r4 === 'needs_reconciliation' && noActor === '23514',
    `retry=${r4}, without actor=${noActor}`,
  );
  check(
    '4. … owner confirms "not done" → retry → 1 provider action',
    r4b === 'retried' &&
      (await performed('c4')) === 1 &&
      (await state('c4')).status === 'committed',
  );

  // 5. Повтор после неясного исхода: ключ у провайдера ещё хранится / уже истёк.
  await reserve('c5', { idempotent: true });
  await markDispatched('c5', DAY);
  await provider('c5', { idempotent: true, mode: 'timeout_after_perform' });
  await finish('c5', 'unknown');
  const r5 = await reserve('c5', { idempotent: true });
  await markDispatched('c5', DAY);
  const p5 = await provider('c5', { idempotent: true, mode: 'ok' });
  await finish('c5', 'committed', { resultRef: 'inv:5' });
  check(
    '5. unknown + key retained → retry returns the original result, 1 provider action',
    r5 === 'retried' && p5 === 'ok_cached' && (await performed('c5')) === 1,
    `retry=${r5}, provider=${p5}`,
  );

  await reserve('c5x', { idempotent: true });
  await markDispatched('c5x', 300); // провайдер хранит ключ 300 мс
  await provider('c5x', { idempotent: true, mode: 'timeout_after_perform' });
  await finish('c5x', 'unknown');
  await sleep(600);
  const r5x = await reserve('c5x', { idempotent: true });
  let extend = '';
  try {
    await sql`UPDATE execution_effects SET idempotency_expires_at = now() + interval '1 day'
              WHERE execution_id = ${EXEC} AND step_key = 'c5x'`;
  } catch (error) {
    extend = error.code;
  }
  check(
    '5. unknown + key retention expired → retry refused, retention cannot be extended',
    r5x === 'needs_reconciliation' && extend === '23514' && (await performed('c5x')) === 1,
    `retry=${r5x}, extend=${extend}`,
  );

  // 6. Одновременные повторы одного логического эффекта.
  await reserve('c6', { idempotent: false });
  await markDispatched('c6');
  await provider('c6', { idempotent: false, mode: 'reject' });
  await finish('c6', 'failed', { failureStage: 'provider_rejected' });
  const racers = await Promise.all(
    Array.from({ length: 10 }, () => reserve('c6', { idempotent: false })),
  );
  const s6 = await state('c6');
  check(
    '6. 10 concurrent retries of a failed effect → exactly 1 retry',
    racers.filter((r) => r === 'retried').length === 1 &&
      s6.attempts === 2 &&
      s6.status === 'reserved',
    `retried=${racers.filter((r) => r === 'retried').length}, in_progress=${racers.filter((r) => r === 'in_progress').length}, attempts=${s6.attempts}`,
  );

  await reserve('c6b', { idempotent: true });
  await markDispatched('c6b', DAY);
  await provider('c6b', { idempotent: true, mode: 'timeout_after_perform' });
  await finish('c6b', 'unknown');
  const racers2 = await Promise.all(
    Array.from({ length: 10 }, () => reserve('c6b', { idempotent: true })),
  );
  check(
    '6. 10 concurrent retries after unknown (idempotent provider) → exactly 1 retry',
    racers2.filter((r) => r === 'retried').length === 1 && (await state('c6b')).attempts === 2,
    `retried=${racers2.filter((r) => r === 'retried').length}`,
  );

  let direct = '';
  try {
    await sql.begin(async (tx) => {
      await tx`INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
               VALUES (${EXEC}, 'user_x', 'c6c', 'message.send', true, 'reserved', 'risk_low')`;
      await tx`UPDATE execution_effects SET status = 'dispatched', dispatched_at = now() WHERE execution_id = ${EXEC} AND step_key = 'c6c'`;
      await tx`UPDATE execution_effects SET status = 'unknown', finished_at = now() WHERE execution_id = ${EXEC} AND step_key = 'c6c'`;
      await tx`UPDATE execution_effects SET status = 'dispatched', dispatched_at = now() WHERE execution_id = ${EXEC} AND step_key = 'c6c'`;
    });
  } catch (error) {
    direct = error.code;
  }
  check(
    'state machine: unknown → dispatched directly is refused',
    direct === '23514',
    `sqlstate=${direct}`,
  );

  // 7. Списание кредитов не зависит от исполнения у провайдера.
  const charge = (key) =>
    sql`INSERT INTO review_charges (charge_key, credits) VALUES (${key}, 7) ON CONFLICT (charge_key) DO NOTHING`;
  await sql.begin(async (tx) => {
    await tx`INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, usage_run_id)
             VALUES (${EXEC}, 'user_x', 'model', 'reply.draft', false, 'reserved', 'risk_low', ${EXEC})`;
  });
  await charge(`ketner:${EXEC}:model`);
  await finish('model', 'committed', { resultRef: 'draft:1' });
  for (let i = 0; i < 3; i += 1) await charge(`ketner:${EXEC}:model`); // повторные вызовы с тем же ключом
  check(
    '7. model step charged once; provider retries above (c1–c6) add no charges',
    (await sql`SELECT count(*)::int AS n FROM review_charges`)[0].n === 1,
  );
} catch (error) {
  check('scenario ran without errors', false, String(error));
} finally {
  await sql`DROP TABLE IF EXISTS review_provider_log`.catch(() => {});
  await sql`DROP TABLE IF EXISTS review_charges`.catch(() => {});
  await sql.end();
}

for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(
  `passed=${results.filter((r) => r.ok).length} failed=${results.filter((r) => !r.ok).length}`,
);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
