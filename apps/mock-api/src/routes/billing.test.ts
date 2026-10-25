import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../config.js';
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


async function signup(baseUrl: string, email: string): Promise<{ token: string; id: string }> {
  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: email.split('@')[0] }),
  });
  const body = await readJson<AuthSession>(res);
  return { token: body.token, id: body.user.id };
}

test('billing (C5): без входа биллинг недоступен, а заголовки X-User-* личность не задают', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const victim = await signup(server.baseUrl, 'c5-victim@example.com');

  for (const [method, path] of [
    ['GET', '/api/billing/subscription'],
    ['POST', '/api/billing/checkout'],
    ['POST', '/api/billing/cancel'],
    ['POST', '/api/billing/crypto/create-invoice'],
    ['POST', '/api/billing/telegram-stars/create-invoice'],
  ] as const) {
    const res = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-User-Id': victim.id },
      body: method === 'POST' ? JSON.stringify({ planId: 'plus' }) : undefined,
    });
    assert.equal(res.status, 401, `${method} ${path} должен требовать вход`);
  }

  // Каталог тарифов остаётся публичным
  const plans = await fetch(`${server.baseUrl}/api/plans`);
  assert.equal(plans.status, 200);
});

test('billing (C5): чужой счёт недоступен ни для статуса, ни для подтверждения', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const owner = await signup(server.baseUrl, 'c5-owner@example.com');
  const stranger = await signup(server.baseUrl, 'c5-stranger@example.com');

  const created = await fetch(`${server.baseUrl}/api/billing/telegram-stars/create-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ planId: 'plus' }),
  });
  assert.equal(created.status, 200);
  const { invoice } = await readJson<{ invoice: { id: string } }>(created);

  const strangerHeaders = { Authorization: `Bearer ${stranger.token}` };
  const status = await fetch(`${server.baseUrl}/api/billing/telegram-stars/status/${invoice.id}`, {
    headers: strangerHeaders,
  });
  assert.equal(status.status, 404);
  const confirm = await fetch(`${server.baseUrl}/api/billing/telegram-stars/confirm/${invoice.id}`, {
    method: 'POST',
    headers: strangerHeaders,
  });
  assert.equal(confirm.status, 404);

  // Владелец своё видит
  const own = await fetch(`${server.baseUrl}/api/billing/telegram-stars/status/${invoice.id}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(own.status, 200);

  // Тариф у постороннего не изменился
  const sub = await fetch(`${server.baseUrl}/api/billing/subscription`, { headers: strangerHeaders });
  const { subscription } = await readJson<{ subscription: Subscription }>(sub);
  assert.equal(subscription.plan, 'free');
});

test('billing (C5): в production заглушки оплаты выключены, тариф без платежа не выдаётся', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await signup(server.baseUrl, 'c5-prod@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` };

  // Счёт Stars создаём заранее (создание счёта не заглушка), затем «включаем production».
  const created = await fetch(`${server.baseUrl}/api/billing/telegram-stars/create-invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ planId: 'pro' }),
  });
  const { invoice } = await readJson<{ invoice: { id: string } }>(created);

  const mutable = config as unknown as { enableMockBilling: boolean };
  const previous = mutable.enableMockBilling;
  mutable.enableMockBilling = false;
  try {
    const checkout = await fetch(`${server.baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'ultra' }),
    });
    assert.equal(checkout.status, 501);

    const stripe = await fetch(`${server.baseUrl}/api/billing/stripe/create-checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'ultra' }),
    });
    assert.ok(stripe.status === 501 || stripe.status === 500);

    const sbpCreate = await fetch(`${server.baseUrl}/api/billing/sbp/create-invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'plus' }),
    });
    assert.equal(sbpCreate.status, 501);

    // Stars: подтверждение до реальной оплаты (successful_payment от Telegram) не проходит.
    const confirm = await fetch(`${server.baseUrl}/api/billing/telegram-stars/confirm/${invoice.id}`, {
      method: 'POST',
      headers,
    });
    assert.equal(confirm.status, 402);
  } finally {
    mutable.enableMockBilling = previous;
  }

  const sub = await fetch(`${server.baseUrl}/api/billing/subscription`, { headers });
  const { subscription } = await readJson<{ subscription: Subscription }>(sub);
  assert.equal(subscription.plan, 'free');
});

test('billing (C7): параллельные подтверждения одного TxID активируют тариф один раз', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await signup(server.baseUrl, 'c7-race@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` };

  const makeInvoice = async (): Promise<string> => {
    const res = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'plus', currency: 'USDT_TRC20' }),
    });
    return (await readJson<{ invoice: { id: string } }>(res)).invoice.id;
  };
  const [first, second] = [await makeInvoice(), await makeInvoice()];
  const hash = `TEST_VALID_RACE_${Date.now()}`;

  const confirm = (invoiceId: string) =>
    fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoiceId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ txHash: hash, mode: 'manual' }),
    });
  const results = await Promise.all([confirm(first), confirm(second)]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 400], 'один запрос проходит, второй — tx_already_used');
});

test('billing (C7): без шлюза и без ENABLE_MANUAL_CRYPTO крипто-счёт не создаётся', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await signup(server.baseUrl, 'c7-prod@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` };

  const mutable = config as unknown as { enableMockBilling: boolean; manualCryptoEnabled: boolean };
  const previous = { ...mutable };
  mutable.enableMockBilling = false;
  mutable.manualCryptoEnabled = false;
  try {
    const create = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'plus', currency: 'USDT_TRC20' }),
    });
    assert.equal(create.status, 501);

    // Ручное подтверждение включено, но валюта не TRC-20: счёт не создаётся
    mutable.manualCryptoEnabled = true;
    const ton = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'plus', currency: 'TON' }),
    });
    assert.equal(ton.status, 400);

    // TRC-20 доступен, а «тестовый» TxID в production — просто неверный формат
    const ok = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'plus', currency: 'USDT_TRC20' }),
    });
    assert.equal(ok.status, 200);
    const { invoice } = await readJson<{ invoice: { id: string } }>(ok);
    const fake = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ txHash: 'TEST_VALID_FREE_PLAN', mode: 'manual' }),
    });
    assert.equal(fake.status, 400);
    const body = await readJson<{ error: { code: string } }>(fake);
    assert.equal(body.error.code, 'invalid_tx_format');
  } finally {
    Object.assign(mutable, previous);
  }

  const sub = await fetch(`${server.baseUrl}/api/billing/subscription`, { headers });
  const { subscription } = await readJson<{ subscription: Subscription }>(sub);
  assert.equal(subscription.plan, 'free');
});
