/**
 * Журнал исполнений: пакет после ответа (3b) и reaper зависших исполнений (3c) — на памяти и на
 * настоящем Postgres (TEST_DATABASE_URL или PGlite; без них Postgres-тесты пропускаются).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { SqlRunner } from '../code/postgres-driver.js';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { openTestSql } from '../testing/sql.js';
import {
  REAPER_MIN_AGE_MS,
  reapOnce,
  reaperThreshold,
  startExecutionReaper,
} from './execution-reaper.js';
import {
  MemoryExecutionJournal,
  PostgresExecutionJournal,
  REAPED_ERROR,
  type ExecutionJournal,
  type JournalBatch,
  type StartExecution,
} from './journal.js';

const OWNER = 'owner-j';
const MINUTE = 60_000;

const start = (id: string): StartExecution => ({
  id,
  userId: OWNER,
  solutionId: 'sol-j',
  solutionVersion: 1,
  deploymentId: null,
  triggerKind: 'public_page',
  triggerRef: `conversation:${id}`,
  idempotencyKey: `bot_message:${id}`,
  inputMeta: { messages: 1 },
  traceId: id,
});

const batch = (overrides: Partial<JournalBatch['finish']> = {}): JournalBatch => ({
  effects: [
    {
      stepKey: 'model-1',
      action: 'reply.draft',
      authorizedBy: 'risk_low',
      reserved: false,
      outcome: 'committed',
      resultMeta: { toolCalls: 1 },
    },
    {
      stepKey: 'tool-1-call_1',
      action: 'knowledge.search',
      authorizedBy: 'risk_low',
      reserved: false,
      outcome: 'failed',
      resultMeta: { error: { code: 'tool_failed', message: 'token sk-live-abcdef0123456789' } },
    },
  ],
  events: [
    { type: 'cost', action: null, data: { step: 1, costUsd: 0.001 } },
    {
      type: 'error',
      action: null,
      data: { code: 'tool_failed', token: 'sk-live-abcdef0123456789' },
    },
    { type: 'status', action: null, data: { stopReason: 'answer' } },
  ],
  finish: {
    status: 'succeeded',
    stopReason: 'answer',
    costUsd: 0.002,
    creditsUsd: 0.002,
    outputMeta: { steps: 2 },
    error: null,
    ...overrides,
  },
});

function counting(inner: SqlRunner): SqlRunner & { count: number } {
  const runner = {
    count: 0,
    async query<T>(text: string, params?: unknown[]) {
      runner.count += 1;
      return inner.query<T>(text, params);
    },
  };
  return runner;
}

async function withPostgres(
  t: test.TestContext,
  body: (sql: SqlRunner, journal: PostgresExecutionJournal) => Promise<void>,
) {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    await sql.runner.query(
      `INSERT INTO solutions (id, user_id, type, status, name, current_version, active_version, template)
       VALUES ('sol-j', $1, 'customer_bot', 'active', 'Журнал', 1, 1, 'customer_bot')`,
      [OWNER],
    );
    await body(sql.runner, new PostgresExecutionJournal(sql.runner));
  } finally {
    await sql.close();
  }
}

// ── Пакет после ответа (3b) ──────────────────────────────────────────────────────────────────

test('3b, Postgres: пакет — два обращения к базе; события продолжают нумерацию; секреты вычищены', async (t) => {
  await withPostgres(t, async (sql, plain) => {
    await plain.start(start('exec_a'));
    await plain.event('exec_a', OWNER, 'step', null, { note: 'written before the batch' });
    const runner = counting(sql);
    const journal = new PostgresExecutionJournal(runner);
    await journal.record('exec_a', OWNER, batch());
    assert.equal(runner.count, 2, 'эффекты и события — одна команда, итоги — вторая');

    const [execution] = await sql.query<Record<string, unknown>>(
      `SELECT status, stop_reason, credits_usd::float AS credits, output_meta, finished_at IS NOT NULL AS finished
         FROM executions WHERE id = 'exec_a'`,
    );
    assert.deepEqual(execution, {
      status: 'succeeded',
      stop_reason: 'answer',
      credits: 0.002,
      output_meta: { steps: 2 },
      finished: true,
    });
    const effects = await sql.query<{
      step_key: string;
      status: string;
      failure_stage: string | null;
    }>(`SELECT step_key, status, failure_stage FROM execution_effects ORDER BY step_key`);
    assert.deepEqual(
      effects.map((e) => [e.step_key, e.status, e.failure_stage]),
      [
        ['model-1', 'committed', null],
        ['tool-1-call_1', 'failed', 'before_dispatch'],
      ],
    );
    const events = await sql.query<{ seq: number; type: string; data: Record<string, unknown> }>(
      `SELECT seq, type, data FROM execution_events WHERE execution_id = 'exec_a' ORDER BY seq`,
    );
    assert.deepEqual(
      events.map((e) => [e.seq, e.type]),
      [
        [1, 'step'],
        [2, 'cost'],
        [3, 'error'],
        [4, 'status'],
      ],
    );
    const stored =
      JSON.stringify(await sql.query(`SELECT data FROM execution_events`)) +
      JSON.stringify(await sql.query(`SELECT result_meta FROM execution_effects`));
    assert.ok(!stored.includes('sk-live-abcdef'), 'секрет не попал в журнал');
    assert.match(stored, /redacted/);
  });
});

test('3b, Postgres: заранее зарезервированный внешний эффект пакет только закрывает', async (t) => {
  await withPostgres(t, async (_sql, journal) => {
    await journal.start(start('exec_b'));
    assert.equal(
      await journal.reserveEffect('exec_b', OWNER, 'tool-1-x', 'lead.create', 'risk_low'),
      'reserved',
    );
    await journal.record('exec_b', OWNER, {
      effects: [
        {
          stepKey: 'tool-1-x',
          action: 'lead.create',
          authorizedBy: 'risk_low',
          reserved: true,
          outcome: 'committed',
          resultMeta: { ok: true },
        },
      ],
      events: [],
      finish: batch().finish,
    });
    const rows = await _sql.query<{ status: string }>(
      `SELECT status FROM execution_effects WHERE execution_id = 'exec_b'`,
    );
    assert.deepEqual([...rows], [{ status: 'committed' }]);
  });
});

// ── Reaper (3c) ──────────────────────────────────────────────────────────────────────────────

test("3c: порог reaper'а не меньше 10 минут и пяти сроков прогона", () => {
  assert.equal(reaperThreshold({ maxRunMs: 60_000 }), 15 * MINUTE);
  assert.equal(REAPER_MIN_AGE_MS, 10 * MINUTE);
  assert.throws(
    () => reaperThreshold({ maxRunMs: 60_000, olderThanMs: 5 * MINUTE }),
    /below the minimum/,
  );
  assert.throws(
    () => reaperThreshold({ maxRunMs: 180_000, olderThanMs: 14 * MINUTE }),
    /minimum 900000 ms/,
  );
  assert.equal(reaperThreshold({ maxRunMs: 180_000, olderThanMs: 15 * MINUTE }), 15 * MINUTE);
});

async function age(sql: SqlRunner, id: string, minutes: number) {
  await sql.query(
    `UPDATE executions SET started_at = now() - make_interval(mins => $2), queued_at = now() - make_interval(mins => $2)
      WHERE id = $1`,
    [id, minutes],
  );
}

test('3c, Postgres: закрывает только зависшие; живой и законченный не трогает; не больше limit', async (t) => {
  await withPostgres(t, async (sql, journal) => {
    for (const id of ['exec_old', 'exec_older', 'exec_live', 'exec_done'])
      await journal.start(start(id));
    await age(sql, 'exec_old', 60);
    await age(sql, 'exec_older', 120);
    await age(sql, 'exec_live', 1);
    await age(sql, 'exec_done', 90);
    await journal.record('exec_done', OWNER, { effects: [], events: [], finish: batch().finish });
    // У зависшего: внутренний эффект в reserved и внешний в dispatched (исход неизвестен).
    await journal.reserveEffect('exec_old', OWNER, 'model-1', 'reply.draft', 'risk_low');
    await sql.query(
      `INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by)
       VALUES ('exec_old', $1, 'tool-1-send', 'message.send', true, 'reserved', 'risk_low')`,
      [OWNER],
    );
    await sql.query(
      `UPDATE execution_effects SET status = 'dispatched', dispatched_at = now() WHERE step_key = 'tool-1-send'`,
    );

    const options = { maxRunMs: 60_000, limit: 1, log: () => {} };
    const first = await reapOnce(journal, options);
    assert.deepEqual(
      first.map((r) => r.id),
      ['exec_older'],
      'сначала самое старое, не больше limit',
    );
    const second = await reapOnce(journal, options);
    assert.deepEqual(
      second.map((r) => r.id),
      ['exec_old'],
    );
    assert.deepEqual(await reapOnce(journal, options), []);

    const rows = await sql.query<{
      id: string;
      status: string;
      stop_reason: string | null;
      error: unknown;
    }>(`SELECT id, status, stop_reason, error FROM executions ORDER BY id`);
    assert.deepEqual(
      rows.map((r) => [r.id, r.status, r.stop_reason, r.error]),
      [
        ['exec_done', 'succeeded', 'answer', null],
        ['exec_live', 'running', null, null],
        ['exec_old', 'failed', 'error', REAPED_ERROR],
        ['exec_older', 'failed', 'error', REAPED_ERROR],
      ],
    );
    const effects = await sql.query<{ step_key: string; status: string; result_meta: unknown }>(
      `SELECT step_key, status, result_meta FROM execution_effects WHERE execution_id = 'exec_old' ORDER BY step_key`,
    );
    assert.deepEqual(
      effects.map((e) => [e.step_key, e.status, e.result_meta]),
      [
        ['model-1', 'failed', { reaped: true }],
        ['tool-1-send', 'dispatched', {}],
      ],
    );

    // Поздний итог самого прогона не переписывает закрытое reaper'ом исполнение.
    await journal.record('exec_old', OWNER, batch());
    await journal.finish('exec_old', OWNER, batch().finish);
    const [late] = await sql.query<{ status: string }>(
      `SELECT status FROM executions WHERE id = 'exec_old'`,
    );
    assert.equal(late?.status, 'failed');
  });
});

test('3c: память — то же правило; проходы не накладываются', async () => {
  const journal = new MemoryExecutionJournal();
  await journal.start(start('exec_old'));
  await journal.start(start('exec_live'));
  journal.startedAt.set('exec_old', Date.now() - 30 * MINUTE);
  await journal.reserveEffect('exec_old', OWNER, 'model-1', 'reply.draft', 'risk_low');
  let calls = 0;
  const slow: ExecutionJournal = Object.assign(Object.create(journal) as ExecutionJournal, {
    reapStale: async (input: { olderThanMs: number; limit: number }) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return journal.reapStale(input);
    },
  });
  const reaper = startExecutionReaper(slow, {
    maxRunMs: 60_000,
    intervalMs: 3_600_000,
    log: () => {},
  });
  try {
    const [a, b] = await Promise.all([reaper.runOnce(), reaper.runOnce()]);
    assert.equal(calls, 1, 'второй вызов ждёт текущий проход');
    assert.deepEqual(
      a.map((r) => r.id),
      ['exec_old'],
    );
    assert.equal(a, b);
  } finally {
    reaper.stop();
  }
  assert.equal(journal.executions.get('exec_old')?.status, 'failed');
  assert.deepEqual(journal.executions.get('exec_old')?.error, REAPED_ERROR);
  assert.equal(journal.executions.get('exec_live')?.status, 'running');
  assert.equal(journal.effects.get('exec_old:model-1')?.status, 'failed');
});
