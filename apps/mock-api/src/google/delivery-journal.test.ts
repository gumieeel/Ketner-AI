import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { PostgresExecutionJournal } from '../platform/journal.js';
import { openTestSql } from '../testing/sql.js';
import {
  DELIVERY_STEP,
  LEASE_MS,
  MAX_ATTEMPTS,
  MemoryDeliveryJournal,
  PostgresDeliveryJournal,
  RETRY_PAUSES_MS,
  isFinalFailure,
  nextStepKey,
  type DeliveryJournal,
} from './delivery-journal.js';

const USER = 'u-d';
const SOLUTION = 'sol-d';

test('ключ следующего шага и окончательный сбой', () => {
  assert.equal(nextStepKey('sheet_append'), 'sheet_append_r1');
  assert.equal(nextStepKey('sheet_append_r4'), 'sheet_append_r5');
  assert.equal(nextStepKey('sheet_append_r5'), null);
  assert.equal(nextStepKey('model-1'), null);
  assert.equal(isFinalFailure({ attempts: 1, resultMeta: { retry: true } }), false);
  assert.equal(isFinalFailure({ attempts: MAX_ATTEMPTS, resultMeta: { retry: true } }), true);
  assert.equal(isFinalFailure({ attempts: 1, resultMeta: { retry: false } }), true);
});

/**
 * Общая логика: память и Postgres ведут себя одинаково. `later(ms)` — момент для `due` через `ms`
 * после последнего перехода; `expireLease` — аренда шага истекла (процесс умер).
 */
async function behaves(
  journal: DeliveryJournal,
  helpers: {
    later: (ms: number) => number;
    expireLease: (leadId: string, stepKey: string) => Promise<void>;
  },
) {
  // Начало: исполнение и шаг reserved; повтор для той же заявки — без второго шага.
  const first = await journal.start({ userId: USER, solutionId: SOLUTION, leadId: 'l1' });
  assert.equal(first.created, true);
  assert.equal(first.effect?.status, 'reserved');
  assert.equal(first.effect?.stepKey, DELIVERY_STEP);
  assert.equal(first.effect?.attempts, 1);
  const again = await journal.start({ userId: USER, solutionId: SOLUTION, leadId: 'l1' });
  assert.equal(again.created, false);
  assert.equal(again.effect?.stepKey, DELIVERY_STEP);

  // Удачная запись: reserved → dispatched → committed. Второй dispatch того же шага не проходит.
  const dispatched = await journal.dispatch(first.effect!);
  assert.equal(dispatched?.status, 'dispatched');
  assert.equal(await journal.dispatch(first.effect!), null, 'шаг уже отправлен');
  const committed = await journal.commit(dispatched!, "'Заявки'!A2:G2", { http: 200, rows: 1 });
  assert.equal(committed?.status, 'committed');
  assert.deepEqual(committed?.resultMeta, { http: 200, rows: 1 });
  assert.equal(await journal.commit(dispatched!, '', {}), null, 'второй commit не проходит');

  // Временный сбой: повтор только после паузы; 4 попытки — и всё.
  const l2 = (await journal.start({ userId: USER, solutionId: SOLUTION, leadId: 'l2' })).effect!;
  let current = (await journal.fail((await journal.dispatch(l2))!, {
    http: 503,
    code: 'http_5xx',
    retry: true,
  }))!;
  assert.equal(current.status, 'failed');
  assert.ok(!(await journal.due(helpers.later(1000), 10)).some((e) => e.leadId === 'l2'));
  assert.ok(
    (await journal.due(helpers.later(RETRY_PAUSES_MS[0] + 1000), 10)).some(
      (e) => e.leadId === 'l2',
    ),
  );
  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const retried = await journal.retry(current);
    assert.equal(retried?.attempts, attempt);
    assert.equal(retried?.status, 'reserved');
    current = (await journal.fail((await journal.dispatch(retried!))!, {
      http: 503,
      code: 'http_5xx',
      retry: true,
    }))!;
  }
  assert.equal(current.attempts, MAX_ATTEMPTS);
  assert.equal(await journal.retry(current), null, 'пятой попытки нет');
  assert.ok(
    !(await journal.due(helpers.later(60 * 60_000), 10)).some((e) => e.leadId === 'l2'),
    'после 4 попыток обход не повторяет',
  );
  assert.equal((await journal.failed(USER, 10)).map((e) => e.leadId).includes('l2'), true);

  // Кнопка «повторить»: новый шаг sheet_append_r1 со своими попытками.
  const manual = await journal.newStep(current, 'sheet_append_r1');
  assert.equal(manual?.stepKey, 'sheet_append_r1');
  assert.equal(manual?.attempts, 1);
  assert.equal((await journal.latest(USER, 'l2'))?.stepKey, 'sheet_append_r1');
  assert.equal(
    await journal.newStep(current, 'sheet_append_r2'),
    null,
    'старый шаг — не последний',
  );
  await journal.commit((await journal.dispatch(manual!))!, 'r', { http: 200, rows: 1 });
  assert.ok(!(await journal.failed(USER, 10)).some((e) => e.leadId === 'l2'));

  // Неясный исход: unknown; повторить вслепую нельзя, только сверка.
  const l3 = (await journal.start({ userId: USER, solutionId: SOLUTION, leadId: 'l3' })).effect!;
  const unknown = await journal.markUnknown((await journal.dispatch(l3))!);
  assert.equal(unknown?.status, 'unknown');
  assert.equal(await journal.retry(unknown!), null);
  assert.ok((await journal.due(helpers.later(0), 10)).some((e) => e.leadId === 'l3'));
  assert.equal(await journal.commit(unknown!, '', {}), null, 'без сверки не закрыть');
  const resolved = await journal.commit(
    unknown!,
    '',
    { http: 200, rows: 1 },
    'reconcile:sheet_id_column',
  );
  assert.equal(resolved?.status, 'committed');

  // Сверка не нашла строку: failed (reconciled_not_done), затем обычный повтор.
  const l4 = (await journal.start({ userId: USER, solutionId: SOLUTION, leadId: 'l4' })).effect!;
  const unknown4 = (await journal.markUnknown((await journal.dispatch(l4))!))!;
  const notDone = await journal.fail(
    unknown4,
    { code: 'not_written', retry: true },
    'reconcile:sheet_id_column',
  );
  assert.equal(notDone?.status, 'failed');
  assert.equal((await journal.retry(notDone!))?.attempts, 2);

  // Сбой до отправки (нет подключения): без повтора.
  const l5 = (await journal.start({ userId: USER, solutionId: SOLUTION, leadId: 'l5' })).effect!;
  const waiting = await journal.fail(l5, { code: 'reconnect_required', retry: false });
  assert.equal(waiting?.status, 'failed');
  assert.ok(!(await journal.due(helpers.later(60 * 60_000), 10)).some((e) => e.leadId === 'l5'));

  // Аренда истекла: reserved и dispatched попадают в обход; новая аренда — одному процессу.
  const l6 = (await journal.start({ userId: USER, solutionId: SOLUTION, leadId: 'l6' })).effect!;
  assert.equal(await journal.renewLease(l6), null, 'аренда ещё действует');
  await helpers.expireLease('l6', DELIVERY_STEP);
  const stale = (await journal.due(helpers.later(0), 50)).find((e) => e.leadId === 'l6');
  assert.equal(stale?.status, 'reserved');
  const renewed = await journal.renewLease(stale!);
  assert.ok(renewed && Date.parse(renewed.leaseExpiresAt!) > helpers.later(LEASE_MS / 2));
  assert.equal(await journal.renewLease(stale!), null, 'второй процесс аренду не получит');

  // Состояния нескольких заявок сразу, чужой аккаунт ничего не видит.
  const states = await journal.latestFor(USER, ['l1', 'l2', 'l3', 'nope']);
  assert.deepEqual([...states.entries()].map(([id, e]) => [id, e.status]).sort(), [
    ['l1', 'committed'],
    ['l2', 'committed'],
    ['l3', 'committed'],
  ]);
  assert.equal((await journal.latestFor('someone-else', ['l1'])).size, 0);
  assert.equal(await journal.latest('someone-else', 'l1'), null);
}

test('журнал доставки в памяти', async () => {
  const clock = Date.parse('2026-11-21T12:00:00Z');
  const journal = new MemoryDeliveryJournal(() => clock);
  await behaves(journal, {
    later: (ms) => clock + ms,
    expireLease: async (leadId, stepKey) => {
      const effect = journal.effects.get(`delivery:${leadId}\u0000${stepKey}`)!;
      effect.leaseExpiresAt = new Date(clock - 1000).toISOString();
    },
  });
  // Состояние исполнения следует за шагом.
  assert.equal(journal.executions.get('delivery:l1')?.status, 'succeeded');
  assert.equal(journal.executions.get('delivery:l5')?.status, 'failed');
  assert.equal(journal.executions.get('delivery:l4')?.status, 'running');
});

test('журнал доставки в Postgres: та же логика, база принимает каждый переход', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  t.after(() => sql.close());
  await runMigrations(sql.db, MIGRATIONS);
  const q = sql.runner.query.bind(sql.runner);
  await q(
    `INSERT INTO solutions (id, user_id, type, status, name, current_version, active_version, template)
           VALUES ($1, $2, 'customer_bot', 'active', 'Бот', 1, 1, 'customer_bot')`,
    [SOLUTION, USER],
  );
  const journal = new PostgresDeliveryJournal(sql.runner);
  await behaves(journal, {
    later: (ms) => Date.now() + ms,
    expireLease: async (leadId, stepKey) => {
      await q(
        `UPDATE execution_effects SET lease_expires_at = now() - interval '1 second'
          WHERE execution_id = $1 AND step_key = $2`,
        [`delivery:${leadId}`, stepKey],
      );
    },
  });

  const executions = await q<{
    id: string;
    kind: string;
    trigger_kind: string;
    trigger_ref: string;
    status: string;
    stop_reason: string | null;
    idempotency_key: string;
    runtime: string | null;
  }>(
    `SELECT id, kind, trigger_kind, trigger_ref, status, stop_reason, idempotency_key, runtime
       FROM executions WHERE user_id = $1 ORDER BY id`,
    [USER],
  );
  const byId = Object.fromEntries(executions.map((row) => [row.id, row]));
  assert.deepEqual(byId['delivery:l1'], {
    id: 'delivery:l1',
    kind: 'delivery',
    trigger_kind: 'lead_created',
    trigger_ref: 'lead:l1',
    status: 'succeeded',
    stop_reason: null,
    idempotency_key: 'sheet:l1',
    runtime: null,
  });
  assert.equal(byId['delivery:l5']?.status, 'failed');
  assert.equal(byId['delivery:l5']?.stop_reason, 'failures');
  assert.equal(byId['delivery:l4']?.status, 'running');

  // Эффекты: внешние, без ключа идемпотентности у провайдера, в result_meta только коды.
  const effects = await q<{
    external: boolean;
    provider_supports_idempotency: boolean;
    authorized_by: string;
    action: string;
    result_meta: unknown;
  }>(
    `SELECT external, provider_supports_idempotency, authorized_by, action, result_meta
       FROM execution_effects WHERE user_id = $1`,
    [USER],
  );
  assert.ok(effects.length >= 7);
  for (const effect of effects) {
    assert.equal(effect.external, true);
    assert.equal(effect.provider_supports_idempotency, false);
    assert.equal(effect.authorized_by, 'risk_low');
    assert.equal(effect.action, 'sheet.append_row');
    for (const key of Object.keys(effect.result_meta as object)) {
      assert.ok(['http', 'rows', 'code', 'retry'].includes(key), key);
    }
  }
  const resolved = await q<{ resolved_by: string; failure_stage: string | null; status: string }>(
    `SELECT resolved_by, failure_stage, status FROM execution_effects WHERE resolved_by IS NOT NULL ORDER BY execution_id`,
  );
  assert.deepEqual(
    resolved.map((row) => [row.status, row.failure_stage]),
    [
      ['committed', null],
      ['reserved', null],
    ],
    'l3 сверка нашла строку; l4 после «не записано» снова в работе',
  );

  // Доставка не засчитывается обращением тарифа и не закрывается reaper'ом исполнений агента.
  const agents = new PostgresExecutionJournal(sql.runner);
  assert.deepEqual(
    await agents.countRequests('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z', USER),
    [],
  );
  await q(`UPDATE executions SET started_at = now() - interval '2 hours' WHERE user_id = $1`, [
    USER,
  ]);
  assert.deepEqual(await agents.reapStale({ olderThanMs: 60_000, limit: 50 }), []);
});
