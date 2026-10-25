import assert from 'node:assert/strict';
import test from 'node:test';
import { PremiumCreditStore } from './premium-credit-store.js';

const DAY = 24 * 3_600_000;

test('кредиты пакетов: начисление по id платежа один раз, списание с того, что сгорает раньше', () => {
  const store = new PremiumCreditStore();
  const now = Date.now();
  store.grant({ id: 'p-late', userId: 'u', packId: 'premium-5', amountUsd: 5, days: 30 }, now);
  store.grant(
    { id: 'p-early', userId: 'u', packId: 'premium-3', amountUsd: 3, days: 30 },
    now - 10 * DAY,
  );
  assert.equal(
    store.grant({ id: 'p-late', userId: 'u', packId: 'premium-5', amountUsd: 5, days: 30 }, now)
      .duplicate,
    true,
  );
  assert.deepEqual(store.balanceOf('u', now), {
    remainingUsd: 8,
    nextExpiresAt: new Date(now + 20 * DAY).toISOString(),
  });

  assert.equal(store.debit('u', 3.5, now), 3.5);
  assert.equal(store.get('p-early')?.remainingUsd, 0, 'сначала тратится то, что сгорает раньше');
  assert.equal(store.get('p-late')?.remainingUsd, 4.5);
  // Больше, чем есть, не списывается.
  assert.equal(store.debit('u', 10, now), 4.5);
  assert.equal(store.balanceOf('u', now).remainingUsd, 0);
});

test('кредиты пакетов: через 30 дней сгорают, возврат их снимает, чужие не тратятся', () => {
  const store = new PremiumCreditStore();
  const now = Date.now();
  store.grant({ id: 'a', userId: 'u1', packId: 'premium-5', amountUsd: 5, days: 30 }, now);
  store.grant({ id: 'b', userId: 'u2', packId: 'premium-5', amountUsd: 5, days: 30 }, now);
  assert.equal(store.balanceOf('u1', now + 31 * DAY).remainingUsd, 0, 'сгорели');
  assert.equal(store.debit('u1', 1, now + 31 * DAY), 0);
  store.revoke('a');
  assert.equal(store.balanceOf('u1', now).remainingUsd, 0);
  assert.equal(store.balanceOf('u2', now).remainingUsd, 5);
});
