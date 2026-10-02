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
  assert.equal(plans.length, 4);
  assert.equal(plans[0]?.id, 'free');
  assert.equal(plans[1]?.id, 'plus');
  assert.equal(plans[2]?.id, 'pro');
  assert.equal(plans[3]?.id, 'ultra');
  assert.equal(plans[1]?.priceMonthly, 990);
  assert.equal(plans[2]?.priceMonthly, 1990);
  assert.equal(plans[3]?.priceMonthly, 2990);
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

test('billing: верификация крипто-платежей отклоняет фейковые TxID и защищает от replay-атак', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // Регистрируем пользователя
  const regRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'crypto_tester@example.com', password: 'password123', name: 'Crypto Tester' }),
  });
  const { token, user } = await readJson<AuthSession>(regRes);
  assert.equal(user.plan, 'free');

  // Создаём крипто-счёт на тариф Plus
  const createInvRes = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ planId: 'plus', currency: 'USDT_TRC20' }),
  });
  assert.equal(createInvRes.status, 200);
  const { invoice } = await readJson<{ invoice: { id: string; amountUsd: number; address: string } }>(createInvRes);
  assert.ok(invoice.id);
  assert.equal(invoice.amountUsd, 9);
  assert.equal(invoice.address, 'TDyeGqX4ranC94g7RMw6cGsCPvRQ7XAtQP');

  // 1. Попытка подтвердить прямой перевод с фейковым хешем из скриншота (VOXD7G4GPWE3R7KDJX7R)
  const fakeConfirmRes = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ txHash: 'VOXD7G4GPWE3R7KDJX7R', mode: 'manual' }),
  });
  assert.equal(fakeConfirmRes.status, 400);
  const fakeData = await readJson<{ error: { code: string; message: string } }>(fakeConfirmRes);
  assert.equal(fakeData.error.code, 'invalid_tx_format');
  assert.ok(fakeData.error.message.includes('64'));

  // 2. Попытка подтвердить с несуществующим 64-значным хешем (тестовая ошибка)
  const testInvalidRes = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ txHash: 'TEST_INVALID_TX_64CHARS_0000000000000000000000000000000000000000000', mode: 'manual' }),
  });
  assert.equal(testInvalidRes.status, 400);

  // 3. Успешное подтверждение с валидным хешем
  const validTxHash = `TEST_VALID_TX_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const validConfirmRes = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ txHash: validTxHash, mode: 'manual' }),
  });
  assert.equal(validConfirmRes.status, 200);
  const validData = await readJson<{ success: boolean; user: { plan: string }; subscription: Subscription }>(
    validConfirmRes,
  );
  assert.equal(validData.success, true);
  assert.equal(validData.user.plan, 'plus');
  assert.equal(validData.subscription.plan, 'plus');
  assert.equal(validData.subscription.status, 'active');

  // 4. Защита от Replay Attack: попытка повторно использовать тот же TxID в новом счёте
  const secondInvRes = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ planId: 'pro', currency: 'USDT_TRC20' }),
  });
  const { invoice: invoice2 } = await readJson<{ invoice: { id: string } }>(secondInvRes);

  const replayRes = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice2.id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ txHash: validTxHash, mode: 'manual' }),
  });
  assert.equal(replayRes.status, 400);
  const replayData = await readJson<{ error: { code: string; message: string } }>(replayRes);
  assert.equal(replayData.error.code, 'tx_already_used');
  assert.ok(replayData.error.message.includes('уже был использован'));
});

