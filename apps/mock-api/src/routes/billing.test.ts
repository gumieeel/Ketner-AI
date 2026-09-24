import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson, startTestServer } from '../testing/server.js';
import type { AuthSession, PlanItem, Subscription } from '../types.js';

test('billing: каталог тарифов GET /api/plans', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/plans`);
  assert.equal(response.status, 200);

  const { plans } = await readJson<{ plans: PlanItem[] }>(response);
  assert.equal(plans.length, 5);
  assert.equal(plans[0]?.id, 'free');
  assert.equal(plans[1]?.id, 'gpt-pro');
  assert.equal(plans[2]?.id, 'claude-pro');
  assert.equal(plans[3]?.id, 'gemini-pro');
  assert.equal(plans[4]?.id, 'ultra');
  assert.equal(plans[1]?.priceMonthly, 1199);
  assert.equal(plans[4]?.priceMonthly, 2499);
});

test('billing: получение подписки и оформление checkout', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // Регистрируем пользователя
  const regRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bob@example.com', password: 'password123', name: 'Bob' }),
  });
  const { token, user } = await readJson<AuthSession>(regRes);
  assert.equal(user.plan, 'free');

  // Проверяем текущую подписку — по умолчанию free
  const initialSubRes = await fetch(`${server.baseUrl}/api/billing/subscription`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(initialSubRes.status, 200);
  const initialSub = await readJson<{ subscription: Subscription }>(initialSubRes);
  assert.equal(initialSub.subscription.plan, 'free');
  assert.equal(initialSub.subscription.status, 'active');

  // Попытка оформить некорректный план
  const badCheckout = await fetch(`${server.baseUrl}/api/billing/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ planId: 'invalid-nonexistent-plan' }),
  });
  assert.equal(badCheckout.status, 400);

  // Оформляем Plus / GPT Pro
  const checkoutRes = await fetch(`${server.baseUrl}/api/billing/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ planId: 'plus' }),
  });
  assert.equal(checkoutRes.status, 200);
  const checkoutData = await readJson<{ subscription: Subscription; user: { plan: string } }>(
    checkoutRes,
  );
  assert.equal(checkoutData.subscription.plan, 'plus');
  assert.equal(checkoutData.subscription.status, 'active');
  assert.ok(checkoutData.subscription.renewsAt);
  assert.equal(checkoutData.user.plan, 'plus');

  // Проверяем, что /api/auth/me теперь отдаёт обновлённый plan: plus
  const meRes = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meData = await readJson<{ user: { plan: string } }>(meRes);
  assert.equal(meData.user.plan, 'plus');

  // Отменяем подписку
  const cancelRes = await fetch(`${server.baseUrl}/api/billing/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(cancelRes.status, 200);
  const cancelData = await readJson<{ subscription: Subscription; user: { plan: string } }>(
    cancelRes,
  );
  assert.equal(cancelData.subscription.status, 'canceled');
  assert.equal(cancelData.user.plan, 'free');
});
