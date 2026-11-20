import assert from 'node:assert/strict';
import test from 'node:test';
import { DocStore } from '../store/doc-store.js';
import type { ExecutionJournal } from '../platform/journal.js';
import type { RequestCount } from '../platform/request-count.js';
import { AccountTiers, type AccountTier } from './account-tiers.js';
import { TIER_ENFORCED, TierUsage, decide, tierEnforced, wouldLimit } from './tier-usage.js';

const END = '2026-12-01T00:00:00.000Z';

test('тарифы включены (решение владельца 19.11.2026: до 24.11.2026)', () => {
  assert.equal(TIER_ENFORCED, true);
  assert.equal(tierEnforced(), true);
});

test('решение: без тарифа — только форма; с тарифом — ответ до 110%, дальше режим заявок', () => {
  assert.deepEqual(decide(null, 7, END), {
    tier: null,
    used: 7,
    included: null,
    limit: null,
    state: 'no_tier',
    action: 'form_only',
    periodEnd: END,
  });
  assert.equal(wouldLimit(decide(null, 7, END)), 7, 'без тарифа ограничены все ответы');
  const at = (used: number) => decide('start', used, END);
  assert.equal(at(0).action, 'answer');
  assert.equal(at(800).state, 'warning');
  assert.equal(at(1_000).state, 'grace');
  assert.equal(at(1_099).action, 'answer');
  assert.equal(at(1_100).action, 'leads_only');
  assert.equal(at(1_100).limit, 1_100);
  assert.equal(wouldLimit(at(1_099)), 0);
  assert.equal(wouldLimit(at(1_130)), 30);
});

function fakeJournal(counts: () => RequestCount[]) {
  let calls = 0;
  const journal = {
    async countRequests(_since: string, _until: string, userId?: string) {
      calls += 1;
      return counts().filter((row) => !userId || row.userId === userId);
    },
  } as unknown as ExecutionJournal;
  return { journal, calls: () => calls };
}

test('счётчик: кеш 60 секунд, ответ сразу увеличивает его, новый месяц — заново', async () => {
  let now = new Date('2026-11-15T10:00:00Z');
  let stored = 5;
  const { journal, calls } = fakeJournal(() => [{ userId: 'u1', count: stored }]);
  const usage = new TierUsage({
    tiers: new AccountTiers(new DocStore<AccountTier>('account_tiers')),
    journal: () => journal,
    now: () => now,
  });
  assert.equal(await usage.used('u1'), 5);
  stored = 9;
  assert.equal(await usage.used('u1'), 5, 'из кеша');
  usage.noteCounted('u1');
  assert.equal(await usage.used('u1'), 6, 'ответ учтён сразу');
  now = new Date('2026-11-15T10:01:01Z');
  assert.equal(await usage.used('u1'), 9, 'кеш истёк — значение из журнала');
  assert.equal(calls(), 2);
  assert.equal(await usage.used('nobody'), 0);
});

test('тень: решение «как было бы» — в лог не чаще раза в час на аккаунт; ответ — не пишется', async () => {
  let now = new Date('2026-11-15T10:00:00Z');
  const lines: string[] = [];
  const { journal } = fakeJournal(() => [{ userId: 'u1', count: 3 }]);
  const usage = new TierUsage({
    tiers: new AccountTiers(new DocStore<AccountTier>('account_tiers')),
    journal: () => journal,
    now: () => now,
    log: (line) => lines.push(line),
  });
  const decision = await usage.decision('u1');
  usage.shadow('u1', decision);
  usage.shadow('u1', decision);
  assert.deepEqual(lines, ['[tiers] shadow user=u1 decision=form_only used=3/0 tier=none']);
  now = new Date('2026-11-15T11:00:01Z');
  usage.shadow('u1', decision);
  assert.equal(lines.length, 2);
  usage.shadow('u2', decide('growth', 1, END));
  assert.equal(lines.length, 2, 'ответ по тарифу в лог не пишется');
});

test('сводка: аккаунты с обращениями или с тарифом; «было бы ограничено» — из журнала', async () => {
  const tiers = new AccountTiers(new DocStore<AccountTier>('account_tiers'));
  await tiers.set('paid', 'start', 'admin');
  await tiers.set('quiet', 'growth', 'admin');
  const { journal } = fakeJournal(() => [
    { userId: 'paid', count: 1_150 },
    { userId: 'free', count: 12 },
  ]);
  const usage = new TierUsage({
    tiers,
    journal: () => journal,
    now: () => new Date('2026-11-15T10:00:00Z'),
  });
  const rows = await usage.report();
  assert.deepEqual(
    rows.map((row) => [row.userId, row.tier, row.used, row.action, row.wouldLimit, row.setBy]),
    [
      ['paid', 'start', 1_150, 'leads_only', 50, 'admin'],
      ['free', null, 12, 'form_only', 12, null],
      ['quiet', 'growth', 0, 'answer', 0, 'admin'],
    ],
  );
});

test('тариф записывается с ожиданием базы: сбой записи — ошибка, прежний тариф остаётся', async () => {
  const store = new DocStore<AccountTier>('account_tiers');
  const tiers = new AccountTiers(store);
  await tiers.set('u1', 'start', 'admin');
  let fail = true;
  store.setDbDriver({
    upsert: async () => {
      if (fail) throw new Error('database down');
    },
    remove: async () => {
      if (fail) throw new Error('database down');
    },
  });
  await assert.rejects(tiers.set('u1', 'scale', 'admin'), /database down/);
  assert.equal(tiers.tierOf('u1'), 'start', 'в памяти — прежний тариф');
  await assert.rejects(tiers.remove('u1'), /database down/);
  assert.equal(tiers.tierOf('u1'), 'start');
  fail = false;
  await tiers.set('u1', 'scale', 'admin', 'договорились');
  assert.equal(tiers.tierOf('u1'), 'scale');
  assert.equal(tiers.get('u1')?.note, 'договорились');
  assert.equal(await tiers.remove('u1'), true);
  assert.equal(tiers.tierOf('u1'), null);
});
