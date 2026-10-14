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
  assert.equal(plans[1]?.priceMonthly, 9);
  assert.equal(plans[2]?.priceMonthly, 25);
  assert.equal(plans[3]?.priceMonthly, 49);
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

test('billing: криптовалюта только через Trybit — своих адресов нет, переводы с TxID не принимаются', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { token } = await signup(server.baseUrl, 'crypto_tester@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const created = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ planId: 'plus', currency: 'USDT_TRC20' }),
  });
  assert.equal(created.status, 200);
  const { invoice } = await readJson<{
    invoice: { id: string; amountUsd: number; address: string; qrPayload: string; cryptoCloudInvoiceId?: string };
  }>(created);
  assert.equal(invoice.amountUsd, 9);
  // Счёт выставлен в Trybit; своего кошелька для прямого перевода в нём нет.
  assert.ok(invoice.cryptoCloudInvoiceId);
  assert.equal(invoice.address, '');
  assert.equal(invoice.qrPayload, '');

  for (const body of [{ txHash: `TEST_VALID_TX_${Date.now()}`, mode: 'manual' }, { mode: 'manual' }, { txHash: 'abc' }]) {
    const res = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
    assert.equal((await readJson<{ error: { code: string } }>(res)).error.code, 'manual_transfer_unavailable');
  }

  // Без подтверждения Trybit тариф не включается.
  const unpaid = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice.id}`, { method: 'POST', headers, body: '{}' });
  assert.equal(unpaid.status, 400);
  assert.equal((await readJson<{ error: { code: string } }>(unpaid)).error.code, 'payment_not_received');

  const sub = await fetch(`${server.baseUrl}/api/billing/subscription`, { headers });
  assert.equal((await readJson<{ subscription: Subscription }>(sub)).subscription.plan, 'free');
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

test('billing (C7): без шлюза Trybit в production крипто-счёт не создаётся ни в какой валюте', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await signup(server.baseUrl, 'c7-prod@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` };

  const mutable = config as unknown as { enableMockBilling: boolean; cryptoCloudApiKey?: string; cryptoCloudShopId?: string };
  const previous = { ...mutable };
  mutable.enableMockBilling = false;
  mutable.cryptoCloudApiKey = '';
  mutable.cryptoCloudShopId = '';
  try {
    for (const currency of ['USDT_TRC20', 'TON', 'BTC']) {
      const create = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ planId: 'plus', currency }),
      });
      assert.equal(create.status, 501, currency);
    }
  } finally {
    Object.assign(mutable, previous);
  }

  const sub = await fetch(`${server.baseUrl}/api/billing/subscription`, { headers });
  const { subscription } = await readJson<{ subscription: Subscription }>(sub);
  assert.equal(subscription.plan, 'free');
});
