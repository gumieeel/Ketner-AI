import assert from 'node:assert/strict';
import test from 'node:test';
import { CreditStore, DAY_MS, type GrantInput } from './credit-store.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const inDays = (days: number): string => new Date(NOW + days * DAY_MS).toISOString();

function input(overrides: Partial<GrantInput> & Pick<GrantInput, 'id'>): GrantInput {
  return {
    userId: 'u1',
    kind: 'plan',
    amountUsd: 3,
    expiresAt: inDays(30),
    ...overrides,
  };
}

test('грант с тем же id второй раз ничего не создаёт', () => {
  const store = new CreditStore();
  const first = store.grant(input({ id: 'pay_1' }), NOW);
  assert.equal(first.duplicate, false);
  const again = store.grant(input({ id: 'pay_1', amountUsd: 99 }), NOW);
  assert.equal(again.duplicate, true);
  assert.equal(again.grant.amountUsd, 3);
  assert.equal(store.balanceOf('u1', NOW).remainingUsd, 3);
  assert.equal(store.allOf('u1').length, 1);
});

test('списание идёт сначала из гранта, который сгорает раньше', () => {
  const store = new CreditStore();
  store.grant(input({ id: 'late', amountUsd: 5, expiresAt: inDays(60) }), NOW);
  store.grant(input({ id: 'early', amountUsd: 2, expiresAt: inDays(10) }), NOW);

  assert.equal(store.debit('u1', 3, NOW), 3);
  assert.equal(store.get('early')?.remainingUsd, 0);
  assert.equal(store.get('late')?.remainingUsd, 4);
  assert.equal(store.balanceOf('u1', NOW).remainingUsd, 4);
});

test('списание не уходит ниже остатка и возвращает, сколько списано', () => {
  const store = new CreditStore();
  store.grant(input({ id: 'g', amountUsd: 1 }), NOW);
  assert.equal(store.debit('u1', 5, NOW), 1);
  assert.equal(store.balanceOf('u1', NOW).remainingUsd, 0);
  assert.equal(store.debit('u1', 1, NOW), 0);
  assert.equal(store.debit('u1', 0, NOW), 0);
  assert.equal(store.debit('u1', -1, NOW), 0);
});

test('сгоревший, отозванный и потраченный гранты в баланс не входят', () => {
  const store = new CreditStore();
  store.grant(input({ id: 'expired', amountUsd: 4, expiresAt: inDays(-1) }), NOW - 2 * DAY_MS);
  store.grant(input({ id: 'revoked', amountUsd: 4, paymentId: 'pay_r' }), NOW);
  store.grant(input({ id: 'ok', amountUsd: 2 }), NOW);
  store.revokeByPayment('pay_r');

  const balance = store.balanceOf('u1', NOW);
  assert.equal(balance.remainingUsd, 2);
  assert.equal(balance.nextExpiresAt, inDays(30));
  assert.equal(balance.nextExpiringUsd, 2);
  assert.deepEqual(
    store.activeOf('u1', NOW).map((g) => g.id),
    ['ok'],
  );
  // «Живой» грант — не отозванный и не истёкший, даже если кредиты потрачены.
  store.debit('u1', 2, NOW);
  assert.deepEqual(
    store.liveOf('u1', NOW).map((g) => g.id),
    ['ok'],
  );
  assert.equal(store.activeOf('u1', NOW).length, 0);
});

test('остаток предыдущего периода сгорает на один период позже и тратится первым', () => {
  const store = new CreditStore();
  // Период 1 оплачен в день 0: живёт 30 + 30 дней. Период 2 оплачен в день 30: живёт до дня 90.
  store.grant(input({ id: 'p1', amountUsd: 3, expiresAt: inDays(60) }), NOW);
  const dayThirty = NOW + 30 * DAY_MS;
  store.grant(input({ id: 'p2', amountUsd: 3, expiresAt: inDays(90) }), dayThirty);

  assert.equal(store.balanceOf('u1', dayThirty).remainingUsd, 6);
  assert.equal(store.balanceOf('u1', dayThirty).nextExpiresAt, inDays(60));

  store.debit('u1', 2, dayThirty);
  assert.equal(store.get('p1')?.remainingUsd, 1);
  assert.equal(store.get('p2')?.remainingUsd, 3);

  // На 61-й день остаток периода 1 сгорает: перенос только на один период.
  const dayOver = NOW + 61 * DAY_MS;
  const balance = store.balanceOf('u1', dayOver);
  assert.equal(balance.remainingUsd, 3);
  assert.equal(balance.nextExpiresAt, inDays(90));
});

test('несколько грантов с одним сроком суммируются в «сгорит в ближайший момент»', () => {
  const store = new CreditStore();
  store.grant(input({ id: 'plan', amountUsd: 3, expiresAt: inDays(20) }), NOW);
  store.grant(input({ id: 'bonus', kind: 'bonus', amountUsd: 0.2, expiresAt: inDays(20) }), NOW);
  store.grant(input({ id: 'later', amountUsd: 1, expiresAt: inDays(40) }), NOW);
  const balance = store.balanceOf('u1', NOW);
  assert.equal(balance.remainingUsd, 4.2);
  assert.equal(balance.nextExpiringUsd, 3.2);
});

test('возврат платежа отзывает оба гранта (тариф и бонус) и считает потраченное', () => {
  const store = new CreditStore();
  store.grant(input({ id: 'pay_9', amountUsd: 3, paymentId: 'pay_9' }), NOW);
  store.grant(input({ id: 'pay_9:bonus', kind: 'bonus', amountUsd: 0.2, paymentId: 'pay_9' }), NOW);
  store.grant(input({ id: 'other', amountUsd: 1 }), NOW);
  assert.equal(store.spentFromPayment('pay_9'), 0);

  store.debit('u1', 1.5, NOW);
  assert.equal(store.spentFromPayment('pay_9'), 1.5);

  const revoked = store.revokeByPayment('pay_9');
  assert.equal(revoked.length, 2);
  assert.ok(revoked.every((g) => g.status === 'revoked' && g.remainingUsd === 0));
  assert.equal(store.balanceOf('u1', NOW).remainingUsd, 1);
});

test('индекс по пользователям: чужие гранты не попадают в баланс и переживают загрузку из базы', () => {
  const store = new CreditStore();
  store.grant(input({ id: 'a', userId: 'u1', amountUsd: 1 }), NOW);
  store.grant(input({ id: 'b', userId: 'u2', amountUsd: 7 }), NOW);
  assert.equal(store.balanceOf('u1', NOW).remainingUsd, 1);
  assert.equal(store.balanceOf('u2', NOW).remainingUsd, 7);
  assert.equal(store.balanceOf('nobody', NOW).remainingUsd, 0);

  // loadExternal добавляет документы из PostgreSQL: индекс по пользователям собирается заново.
  const snapshot = store.all();
  const restored = new CreditStore();
  assert.equal(restored.balanceOf('u1', NOW).remainingUsd, 0);
  restored.loadExternal(snapshot);
  assert.equal(restored.balanceOf('u1', NOW).remainingUsd, 1);
  assert.equal(restored.balanceOf('u2', NOW).remainingUsd, 7);
  // Документы, которые пришли из базы уже после первого запроса баланса, тоже учитываются.
  const late = new CreditStore();
  assert.equal(late.balanceOf('u2', NOW).remainingUsd, 0);
  late.loadExternal(snapshot.filter((g) => g.userId === 'u2'));
  assert.equal(late.balanceOf('u2', NOW).remainingUsd, 7);
  assert.equal(late.balanceOf('u1', NOW).remainingUsd, 0);
});

test('дробные доллары не накапливают погрешность списания', () => {
  const store = new CreditStore();
  store.grant(input({ id: 'g', amountUsd: 0.3 }), NOW);
  for (let i = 0; i < 3; i += 1) store.debit('u1', 0.1, NOW);
  assert.equal(store.balanceOf('u1', NOW).remainingUsd, 0);
});
