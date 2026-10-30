import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../db/migrate.js';
import { openTestSql as openSql } from '../testing/sql.js';
import { MIGRATIONS } from '../db/migration-list.js';
import {
  MemoryBudgetStore,
  PostgresBudgetStore,
  budgetDayOf,
  nextBudgetReset,
  type BudgetStore,
} from './budget.js';

const DAY = '2026-10-30';
const LATER = '2099-01-01T00:00:00.000Z';
const item = (id: string, capUsd: number, stage: 'context' | 'discovery' | 'plan' = 'context') => ({
  id,
  analysisId: id.split(':')[0],
  stage,
  capUsd,
  expiresAt: LATER,
});

/** Одни и те же проверки для памяти и для Postgres. */
async function budgetContract(store: BudgetStore): Promise<void> {
  // Резерв проходит, пока потрачено + зарезервировано + новый резерв ≤ лимит.
  assert.equal(
    await store.reserve(DAY, 0.05, [item('a:context', 0.02), item('a:plan', 0.01, 'plan')]),
    true,
  );
  assert.deepEqual(await store.day(DAY), {
    day: DAY,
    limitUsd: 0.05,
    spentUsd: 0,
    reservedUsd: 0.03,
  });
  assert.equal(await store.reserve(DAY, 0.05, [item('b:context', 0.03)]), false, 'не помещается');
  assert.equal((await store.forAnalysis('b')).length, 0, 'неудачный резерв ничего не создал');

  // Этап закрыт по факту: резерв возвращён, потрачено — фактическая сумма.
  assert.equal(await store.start('a:context', LATER), true);
  assert.equal(await store.settle('a:context', 0.004), true);
  assert.equal(await store.settle('a:context', 0.004), false, 'повторный расчёт ничего не меняет');
  assert.deepEqual(await store.day(DAY), {
    day: DAY,
    limitUsd: 0.05,
    spentUsd: 0.004,
    reservedUsd: 0.01,
  });

  // Неначатый этап возвращается целиком.
  assert.equal(await store.release('a:plan'), true);
  assert.deepEqual(await store.day(DAY), {
    day: DAY,
    limitUsd: 0.05,
    spentUsd: 0.004,
    reservedUsd: 0,
  });

  // Просрочка: неначатый — вернуть, начатый — закрыть по потолку.
  await store.reserve(DAY, 0.05, [
    { ...item('c:context', 0.01), expiresAt: '2026-10-30T00:10:00.000Z' },
    { ...item('c:discovery', 0.02, 'discovery'), expiresAt: '2026-10-30T00:10:00.000Z' },
  ]);
  await store.start('c:context', '2026-10-30T00:10:00.000Z');
  assert.equal(await store.expire('2026-10-30T00:20:00.000Z'), 2);
}

test('бюджет в памяти: резерв, расчёт по факту, возврат и просрочка', async () => {
  const store = new MemoryBudgetStore();
  await budgetContract(store);
  const day = await store.day(DAY);
  // c:context закрыт по потолку 0.01, c:discovery возвращён.
  assert.equal(day?.spentUsd, 0.014);
  assert.equal(day?.reservedUsd, 0);
});

test('бюджет в памяти: параллельные резервы не превышают лимит', async () => {
  const store = new MemoryBudgetStore();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      store.reserve(DAY, 0.1, [item(`p${index}:context`, 0.03)]),
    ),
  );
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal((await store.day(DAY))?.reservedUsd, 0.09);
});

test('сутки бюджета и момент сброса: UTC и Москва', () => {
  const now = new Date('2026-10-30T22:30:00.000Z');
  assert.equal(budgetDayOf(now, 'UTC'), '2026-10-30');
  assert.equal(budgetDayOf(now, 'Europe/Moscow'), '2026-10-31');
  assert.equal(nextBudgetReset(now, 'UTC').toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(nextBudgetReset(now, 'Europe/Moscow').toISOString(), '2026-10-31T21:00:00.000Z');
});

test('бюджет в Postgres: та же логика и атомарный резерв при параллельных запросах', async (t) => {
  const sql = await openSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  try {
    await runMigrations(sql.db, MIGRATIONS);
    const store = new PostgresBudgetStore(sql.runner);
    await budgetContract(store);
    const day = await store.day(DAY);
    assert.equal(day?.spentUsd, 0.014);
    assert.equal(day?.reservedUsd, 0);

    const PARALLEL = '2026-11-01';
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.reserve(PARALLEL, 0.1, [item(`q${index}:context`, 0.03)]),
      ),
    );
    assert.equal(results.filter(Boolean).length, 3, 'из 20 одновременных резервов прошли ровно 3');
    assert.equal((await store.day(PARALLEL))?.reservedUsd, 0.09);
  } finally {
    await sql.close();
  }
});
