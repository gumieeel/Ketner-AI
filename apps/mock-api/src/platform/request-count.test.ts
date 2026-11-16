import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { MIGRATIONS } from '../db/migration-list.js';
import { openTestSql } from '../testing/sql.js';
import {
  MemoryExecutionJournal,
  PostgresExecutionJournal,
  type ExecutionJournal,
} from './journal.js';
import { isCountedRequest } from './request-count.js';

const OWNER = 'owner-count';
const TRIGGERS = ['public_page', 'webhook', 'manual', 'chat_message'] as const;
const STATUSES = ['succeeded', 'failed', 'timed_out', 'cancelled'] as const;
const STOPS = [
  'answer',
  'escalated',
  'max_steps',
  'max_tool_calls',
  'budget',
  'failures',
  'timeout',
  'cancelled',
  'error',
] as const;

interface Combo {
  id: string;
  triggerKind: (typeof TRIGGERS)[number];
  status: (typeof STATUSES)[number];
  stopReason: (typeof STOPS)[number];
  steps: number;
}

const combos: Combo[] = TRIGGERS.flatMap((triggerKind) =>
  STATUSES.flatMap((status) =>
    STOPS.flatMap((stopReason) =>
      [0, 1].map((steps) => ({
        id: `x_${triggerKind}_${status}_${stopReason}_${steps}`,
        triggerKind,
        status,
        stopReason,
        steps,
      })),
    ),
  ),
);

/**
 * Правило раздела 5.1, записанное независимо от кода: посетитель или событие, `succeeded`, не
 * `failures`, модель вызывалась. Это 2 вида запуска × 8 причин остановки = 16 из 288.
 */
const EXPECTED = combos.filter(
  (c) =>
    (c.triggerKind === 'public_page' || c.triggerKind === 'webhook') &&
    c.status === 'succeeded' &&
    c.stopReason !== 'failures' &&
    c.steps >= 1,
);

test('обращение: правило 5.1 по всем сочетаниям вида запуска, статуса, причины остановки и шагов', () => {
  assert.equal(combos.length, 288);
  assert.equal(EXPECTED.length, 16);
  for (const c of combos) {
    assert.equal(
      isCountedRequest({ ...c, outputMeta: { steps: c.steps } }),
      EXPECTED.includes(c),
      c.id,
    );
  }
  // Передача сотруднику (9 из 16 в production) считается; проба владельца — нет.
  assert.equal(
    isCountedRequest({
      triggerKind: 'public_page',
      status: 'succeeded',
      stopReason: 'escalated',
      outputMeta: { steps: 1 },
    }),
    true,
  );
  assert.equal(
    isCountedRequest({
      triggerKind: 'manual',
      status: 'succeeded',
      stopReason: 'answer',
      outputMeta: { steps: 2 },
    }),
    false,
  );
  // Число шагов строкой или без него — не считается (так же, как в SQL).
  assert.equal(
    isCountedRequest({
      triggerKind: 'public_page',
      status: 'succeeded',
      stopReason: 'answer',
      outputMeta: { steps: '1' },
    }),
    false,
  );
});

async function fill(journal: ExecutionJournal) {
  for (const c of combos) {
    await journal.start({
      id: c.id,
      userId: OWNER,
      solutionId: 'sol-count',
      solutionVersion: 1,
      deploymentId: null,
      triggerKind: c.triggerKind,
      triggerRef: `conversation:${c.id}`,
      inputMeta: {},
      traceId: c.id,
    });
    await journal.finish(c.id, OWNER, {
      status: c.status,
      stopReason: c.stopReason,
      costUsd: 0.0004,
      creditsUsd: 0,
      outputMeta: { steps: c.steps },
      error: null,
    });
  }
}

const window = () => ({
  since: new Date(Date.now() - 60 * 60_000).toISOString(),
  until: new Date(Date.now() + 60 * 60_000).toISOString(),
});

test('обращения в журнале в памяти: ровно сочетания правила, по аккаунту и по всем', async () => {
  const journal = new MemoryExecutionJournal();
  await fill(journal);
  const { since, until } = window();
  assert.deepEqual(await journal.countRequests(since, until, OWNER), [
    { userId: OWNER, count: EXPECTED.length },
  ]);
  assert.deepEqual(await journal.countRequests(since, until), [
    { userId: OWNER, count: EXPECTED.length },
  ]);
  assert.deepEqual(await journal.countRequests(since, until, 'someone-else'), []);
  // Вне периода — ничего: конец не включается.
  assert.deepEqual(
    await journal.countRequests(until, new Date(Date.now() + 2 * 3600_000).toISOString()),
    [],
  );
});

test('обращения в Postgres: тот же SQL-вариант правила даёт то же число', async (t) => {
  const sql = await openTestSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  t.after(() => sql.close());
  await runMigrations(sql.db, MIGRATIONS);
  await sql.runner.query(
    `INSERT INTO solutions (id, user_id, type, status, name, current_version, active_version, template)
     VALUES ('sol-count', $1, 'customer_bot', 'active', 'Счётчик', 1, 1, 'customer_bot')`,
    [OWNER],
  );
  const journal = new PostgresExecutionJournal(sql.runner);
  await fill(journal);
  const { since, until } = window();
  assert.deepEqual(await journal.countRequests(since, until, OWNER), [
    { userId: OWNER, count: EXPECTED.length },
  ]);
  assert.deepEqual(await journal.countRequests(since, until), [
    { userId: OWNER, count: EXPECTED.length },
  ]);
  assert.deepEqual(await journal.countRequests(since, until, 'someone-else'), []);
  // Исполнение без итога (идёт сейчас) не считается.
  await journal.start({
    id: 'x_running',
    userId: OWNER,
    solutionId: 'sol-count',
    solutionVersion: 1,
    deploymentId: null,
    triggerKind: 'public_page',
    triggerRef: 'conversation:running',
    inputMeta: {},
    traceId: 'x_running',
  });
  assert.equal((await journal.countRequests(since, until, OWNER))[0]?.count, EXPECTED.length);
});
