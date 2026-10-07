import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBillingPlan, SUBSCRIPTION_GRACE_MS } from './plan-resolver.js';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

test('free остаётся free независимо от подписки', () => {
  const r = resolveBillingPlan({
    storedPlan: 'free',
    subscription: { plan: 'pro', status: 'active', renewsAt: iso(86_400_000) },
    now: NOW,
  });
  assert.deepEqual(r, { plan: 'free', expired: false });
});

test('оплаченный и не истёкший тариф сохраняется', () => {
  const r = resolveBillingPlan({
    storedPlan: 'pro',
    subscription: { plan: 'pro', status: 'active', renewsAt: iso(5 * 86_400_000) },
    now: NOW,
  });
  assert.deepEqual(r, { plan: 'pro', expired: false });
});

test('тариф истёк и льготный период прошёл — сводится к free', () => {
  const r = resolveBillingPlan({
    storedPlan: 'ultra',
    subscription: { plan: 'ultra', status: 'active', renewsAt: iso(-SUBSCRIPTION_GRACE_MS - 1000) },
    now: NOW,
  });
  assert.deepEqual(r, { plan: 'free', expired: true });
});

test('внутри льготного периода тариф ещё действует', () => {
  const r = resolveBillingPlan({
    storedPlan: 'plus',
    subscription: { plan: 'plus', status: 'active', renewsAt: iso(-1000) },
    now: NOW,
  });
  assert.deepEqual(r, { plan: 'plus', expired: false });
});

test('отменённая подписка действует до конца периода, потом free', () => {
  const live = resolveBillingPlan({
    storedPlan: 'pro',
    subscription: { plan: 'pro', status: 'canceled', renewsAt: iso(86_400_000) },
    now: NOW,
  });
  assert.equal(live.plan, 'pro');
  const dead = resolveBillingPlan({
    storedPlan: 'pro',
    subscription: { plan: 'pro', status: 'canceled', renewsAt: iso(-1000) },
    now: NOW,
  });
  assert.deepEqual(dead, { plan: 'free', expired: true });
  const noDate = resolveBillingPlan({
    storedPlan: 'pro',
    subscription: { plan: 'pro', status: 'canceled', renewsAt: null },
    now: NOW,
  });
  assert.equal(noDate.plan, 'free');
});

test('нет записи подписки — платный тариф из профиля не отнимается', () => {
  assert.equal(resolveBillingPlan({ storedPlan: 'pro', subscription: null, now: NOW }).plan, 'pro');
  assert.equal(
    resolveBillingPlan({
      storedPlan: 'pro',
      subscription: { plan: 'free', status: 'active', renewsAt: null },
      now: NOW,
    }).plan,
    'pro',
  );
});

test('VIP всегда ultra', () => {
  const r = resolveBillingPlan({
    storedPlan: 'free',
    isVip: true,
    subscription: { plan: 'pro', status: 'canceled', renewsAt: iso(-86_400_000 * 40) },
    now: NOW,
  });
  assert.deepEqual(r, { plan: 'ultra', expired: false });
});
