import assert from 'node:assert/strict';
import test from 'node:test';
import { openTestSql as openSql } from '../testing/sql.js';
import {
  COUNTER_RETENTION,
  MemoryCounterStore,
  PostgresCounterStore,
  type CounterStore,
} from './cost-counters.js';
import {
  BuildAllowance,
  SERVICE_FREE_BUILD_DAILY_USD,
  allowanceRefusal,
} from './build-allowance.js';

/** Одни и те же проверки для памяти и для Postgres. */
async function behaves(store: CounterStore) {
  const a = { key: 'acct:u1:2026-11', limitUsd: 1.5 };
  const b = { key: 'service-day:2026-11-15', limitUsd: 0.05 };
  assert.equal(await store.reserve([a, b], 0.03), true);
  assert.equal(
    await store.reserve([a, b], 0.03),
    false,
    'второй счётчик не пускает — ни один не меняется',
  );
  assert.deepEqual(await store.spent([a.key, b.key, 'missing']), {
    [a.key]: 0.03,
    [b.key]: 0.03,
    missing: 0,
  });
  await store.adjust([a.key, b.key], -0.025);
  assert.deepEqual(await store.spent([a.key, b.key]), { [a.key]: 0.005, [b.key]: 0.005 });
  await store.adjust([a.key], -1);
  assert.equal((await store.spent([a.key]))[a.key], 0, 'не ниже нуля');
  assert.equal(await store.reserve([b], 0.045), true, 'ровно до лимита — можно');
  assert.equal(await store.reserve([b], 0.000001), false);
  assert.equal(await store.reserve([], 1), true);
}

test('счётчики в памяти: резерв по всем сразу, поправка, не ниже нуля', async () => {
  await behaves(new MemoryCounterStore());
});

test('счётчики в Postgres: та же логика и атомарный резерв при параллельных запросах', async (t) => {
  const sql = await openSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  t.after(() => sql.close());
  const store = new PostgresCounterStore(sql.runner);
  await behaves(store);

  // 40 параллельных резервов по $0.03 при лимите $0.30 на общем счётчике и своих счётчиках аккаунтов:
  // проходит ровно 10, счётчик ровно на лимите.
  const service = { key: 'service-day:race', limitUsd: 0.3 };
  const results = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      store.reserve([{ key: `acct:race${i % 4}:2026-11`, limitUsd: 1.5 }, service], 0.03),
    ),
  );
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal((await store.spent([service.key]))[service.key], 0.3);
  const perAccount = await store.spent([0, 1, 2, 3].map((i) => `acct:race${i}:2026-11`));
  assert.equal(
    Math.round(Object.values(perAccount).reduce((sum, v) => sum + v, 0) * 1000),
    300,
    'сумма по аккаунтам совпадает с общим счётчиком: ни одного частичного резерва',
  );
});

test('бесплатный лимит: без тарифа — месяц, сутки и бюджет сервиса; с тарифом — только месяц', async () => {
  const counters = new MemoryCounterStore();
  let now = new Date('2026-11-15T10:00:00Z');
  const tiers = new Map<string, 'growth'>([['paid', 'growth']]);
  const allowance = new BuildAllowance({
    counters: () => counters,
    tierOf: (userId) => tiers.get(userId) ?? null,
    now: () => now,
  });

  // Сутки без тарифа: 500 кредитов = $0.50.
  for (let i = 0; i < 16; i += 1) {
    const r = await allowance.reserve('free', 0.03);
    assert.equal(r.ok, true, `шаг ${i}`);
  }
  const day = await allowance.reserve('free', 0.03);
  assert.deepEqual(day, {
    ok: false,
    code: 'build_allowance_exhausted',
    scope: 'day',
    resetsAt: '2026-11-16T00:00:00.000Z',
  });
  // Расчёт по факту возвращает неистраченное: шаг стоил $0.01 из $0.03.
  const ticket = await allowance.reserve('free-2', 0.03);
  assert.ok(ticket.ok);
  await allowance.settle(ticket.ticket, 0.01);
  assert.equal((await allowance.status('free-2')).month.spentCredits, 10);
  assert.equal((await allowance.status('free-2')).day?.limitCredits, 500);

  // Тариф Growth: 4 000 кредитов в месяц, суточного лимита и бюджета сервиса нет.
  const paid = await allowance.status('paid');
  assert.equal(paid.month.limitCredits, 4000);
  assert.equal(paid.day, null);
  assert.equal(paid.month.resetsAt, '2026-12-01T00:00:00.000Z');

  // На следующий день суточный лимит обновился, месячный считается дальше.
  now = new Date('2026-11-16T00:00:01Z');
  assert.equal((await allowance.reserve('free', 0.03)).ok, true);
  assert.equal((await allowance.status('free')).month.spentCredits, 510);
});

test('бесплатный лимит: бюджет сервиса $3 в сутки общий для аккаунтов без тарифа', async () => {
  const counters = new MemoryCounterStore();
  const allowance = new BuildAllowance({
    counters: () => counters,
    now: () => new Date('2026-11-15T10:00:00Z'),
  });
  assert.equal(SERVICE_FREE_BUILD_DAILY_USD, 3);
  // 6 аккаунтов по $0.50 = $3.00 — бюджет ровно израсходован.
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await allowance.reserve(`u${i}`, 0.5)).ok, true);
  }
  const refused = await allowance.reserve('u7', 0.01);
  assert.equal(refused.ok, false);
  assert.equal(
    !refused.ok && refused.code === 'build_allowance_exhausted' && refused.scope,
    'service',
  );
  const text = allowanceRefusal('ru', refused as never);
  assert.equal(text.status, 402);
  assert.match(text.message, /у всего сервиса/);
});

test('бесплатный лимит: база недоступна — шаг не начинается (503), баланс не используется', async () => {
  const logged: string[] = [];
  const broken: CounterStore = {
    reserve: async () => {
      throw new Error('connection refused');
    },
    adjust: async () => {
      throw new Error('connection refused');
    },
    spent: async () => ({}),
    claim: async () => false,
    purge: async () => 0,
  };
  const allowance = new BuildAllowance({
    counters: () => broken,
    log: (message) => logged.push(message),
  });
  const r = await allowance.reserve('u1', 0.03);
  assert.deepEqual(r, { ok: false, code: 'allowance_unavailable' });
  assert.equal(allowanceRefusal('ru', r as never).status, 503);
  // Сбой расчёта по факту не бросает: резерв остаётся по потолку, сообщение в логе.
  await allowance.settle({ userId: 'u1', keys: ['k'], capUsd: 0.03 }, 0.01);
  assert.equal(logged.length, 2);
});

test('бюджет сервиса прошёл 80% — один сигнал администратору в сутки; на следующий день — снова', async () => {
  const counters = new MemoryCounterStore();
  let now = new Date('2026-11-15T10:00:00Z');
  const signals: Array<{ day: string; share: number }> = [];
  const allowance = new BuildAllowance({
    counters: () => counters,
    now: () => now,
    onServiceBudgetHigh: (status) => {
      signals.push({ day: status.day, share: Math.round(status.share * 100) / 100 });
    },
  });
  // 4 аккаунта по $0.50 = $2.00 (67%) — сигнала нет.
  for (let i = 0; i < 4; i += 1) assert.equal((await allowance.reserve(`u${i}`, 0.5)).ok, true);
  assert.equal(signals.length, 0);
  // Пятый — $2.50 (83%): сигнал. Шестой — $3.00: второго сигнала в те же сутки нет.
  assert.equal((await allowance.reserve('u4', 0.5)).ok, true);
  assert.equal((await allowance.reserve('u5', 0.5)).ok, true);
  assert.deepEqual(signals, [{ day: '2026-11-15', share: 0.83 }]);
  assert.deepEqual(await allowance.serviceStatus(), {
    day: '2026-11-15',
    spentUsd: 3,
    limitUsd: 3,
    share: 1,
    resetsAt: '2026-11-16T00:00:00.000Z',
  });
  now = new Date('2026-11-16T09:00:00Z');
  for (let i = 0; i < 5; i += 1) await allowance.reserve(`v${i}`, 0.5);
  assert.deepEqual(
    signals.map((s) => s.day),
    ['2026-11-15', '2026-11-16'],
  );
});

test('сигнал о бюджете: сбой отправки не мешает резерву', async () => {
  const counters = new MemoryCounterStore();
  const logged: string[] = [];
  const allowance = new BuildAllowance({
    counters: () => counters,
    log: (message) => logged.push(message),
    onServiceBudgetHigh: () => {
      throw new Error('telegram down');
    },
  });
  for (let i = 0; i < 5; i += 1) assert.equal((await allowance.reserve(`u${i}`, 0.5)).ok, true);
  assert.deepEqual(logged, ['[allowance] сигнал о бюджете сервиса не отправлен']);
});

test('счётчики в Postgres: отметка сигнала одна на сутки, старые строки удаляются', async (t) => {
  const sql = await openSql();
  if (!sql) {
    t.skip('нет PGlite и TEST_DATABASE_URL');
    return;
  }
  t.after(() => sql.close());
  const store = new PostgresCounterStore(sql.runner);
  // Отметка: из двух одновременных попыток проходит одна; повтор — нет.
  const claims = await Promise.all([
    store.claim('service-day-alert:2026-11-15'),
    store.claim('service-day-alert:2026-11-15'),
  ]);
  assert.deepEqual(claims.filter(Boolean).length, 1);
  assert.equal(await store.claim('service-day-alert:2026-11-15'), false);
  // Письма владельцу об объёме тарифа (billing/tier-alerts.ts): живут, как месячные строки.
  assert.equal(await store.claim('tier-alert:u1:2025-09-01:warning'), true);
  assert.equal(await store.claim('tier-alert:u1:2026-12-01:warning'), true);

  for (const key of [
    'acct-day:u1:2026-08-01',
    'service-day:2026-08-01',
    'acct-day:u1:2026-11-15',
    'acct:u1:2025-08',
    'acct:u1:2026-11',
  ]) {
    await store.reserve([{ key, limitUsd: 10 }], 0.01);
  }
  const age = (key: string, days: number) =>
    sql.runner.query(
      `UPDATE ketner_docs SET updated_at = now() - make_interval(days => $2)
       WHERE namespace = 'cost_counters' AND id = $1`,
      [key, days],
    );
  await age('acct-day:u1:2026-08-01', 106);
  await age('service-day:2026-08-01', 106);
  await age('service-day-alert:2026-11-15', 61);
  await age('acct:u1:2025-08', 460);
  await age('acct:u1:2026-11', 61);
  await age('tier-alert:u1:2025-09-01:warning', 430);
  await age('tier-alert:u1:2026-12-01:warning', 20);
  const removed = await store.purge(COUNTER_RETENTION);
  assert.equal(removed, 5);
  const left = await sql.runner.query<{ id: string }>(
    `SELECT id FROM ketner_docs WHERE namespace = 'cost_counters' ORDER BY id`,
  );
  assert.deepEqual(
    left.map((row) => row.id),
    ['acct-day:u1:2026-11-15', 'acct:u1:2026-11', 'tier-alert:u1:2026-12-01:warning'],
    'суточные старше 60 дней и месячные старше 400 удалены; свежие и текущий месяц — нет',
  );
});

test('отказ «лимит исчерпан» для клиента: без сумм в кредитах, месяц — обновится 1-го, сутки — завтра', () => {
  const refusal = (scope: 'month' | 'day') =>
    ({
      ok: false,
      code: 'build_allowance_exhausted',
      scope,
      resetsAt: '2026-12-01T00:00:00.000Z',
    }) as const;
  const month = allowanceRefusal('ru', refusal('month'));
  assert.equal(month.status, 402);
  assert.equal(month.message, 'Бесплатный лимит на этот месяц исчерпан, обновится 1-го.');
  assert.equal(
    allowanceRefusal('ru', refusal('day')).message,
    'Бесплатный лимит на сегодня исчерпан, обновится завтра.',
  );
  assert.equal(
    allowanceRefusal('en', refusal('month')).message,
    "This month's free allowance is used up; it renews on the 1st.",
  );
  for (const scope of ['month', 'day'] as const) {
    assert.doesNotMatch(allowanceRefusal('ru', refusal(scope)).message, /кредит/);
  }
});
