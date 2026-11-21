import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../config.js';
import { TRIAL_CREDITS } from '../services/entitlement.js';
import { CREDIT_PACKS } from '../services/pricing.js';
import { readJson, startTestServer } from '../testing/server.js';
import type { CreditsReport } from '../services/credits.js';
import type { AuthSession, PlanItem, Subscription } from '../types.js';
import { setProductSwitchForTests } from '../product-switches.js';

// Пакеты кредитов не продаются (задача 0b): тесты ниже проверяют спящий код покупки.
setProductSwitchForTests('packs', true);

// Закрытые возможности (product-switches.ts): здесь проверяется их спящий код.
setProductSwitchForTests('stars', true);

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

test('billing: пакеты не продаются — каталог пакетов и выставление счетов отвечают 503', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { token } = await signup(server.baseUrl, 'closed-packs@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  for (const [method, path, feature] of [
    ['GET', '/api/packs', 'packs'],
    ['POST', '/api/billing/checkout', 'packs'],
    ['POST', '/api/billing/crypto/create-invoice', 'packs'],
    ['POST', '/api/billing/telegram-stars/create-invoice', 'stars'],
  ] as const) {
    // И без входа, и со входом: ответ до проверки входа.
    for (const auth of [{}, headers]) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method,
        headers: auth,
        body: method === 'POST' ? JSON.stringify({ packId: 'credits-10' }) : undefined,
      });
      assert.equal(response.status, 503, `${method} ${path}`);
      const error = (
        await readJson<{ error: { code: string; details: { feature: string } } }>(response)
      ).error;
      assert.equal(error.code, 'feature_unavailable');
      assert.equal(error.details.feature, feature);
    }
  }
});

test('billing: пакет, купленный раньше, даёт кредиты и открывает полный доступ, подписка не меняется', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // Регистрируем пользователя
  const regRes = await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bob@example.com', password: 'password123', name: 'Bob' }),
  });
  const { token, user } = await readJson<AuthSession>(regRes);
  assert.equal(user.plan, 'free');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const report = async () =>
    readJson<CreditsReport>(await fetch(`${server.baseUrl}/api/usage/credits`, { headers }));

  // Проверяем текущую подписку — по умолчанию free
  const initialSubRes = await fetch(`${server.baseUrl}/api/billing/subscription`, { headers });
  assert.equal(initialSubRes.status, 200);
  const initialSub = await readJson<{ subscription: Subscription }>(initialSubRes);
  assert.equal(initialSub.subscription.plan, 'free');
  assert.equal(initialSub.subscription.status, 'active');
  const before = await report();
  assert.equal(before.purchased, false);
  assert.equal(before.balance, TRIAL_CREDITS);

  // Пакет $10, купленный до 20.11.2026
  const pack = CREDIT_PACKS[1]!;
  server.grantPack(user.id, pack.id);
  const after = await report();
  assert.equal(after.plan, 'credits', 'купленные кредиты открывают полный доступ');
  assert.equal(after.purchased, true);
  assert.equal(after.balance, pack.credits + TRIAL_CREDITS);
  assert.ok(after.grants.some((g) => g.kind === 'pack' && g.amount === pack.credits));

  // Подписка при этом остаётся бесплатной: тариф не покупался
  const sub = await fetch(`${server.baseUrl}/api/billing/subscription`, { headers });
  assert.equal((await readJson<{ subscription: Subscription }>(sub)).subscription.plan, 'free');
});

test('billing: криптовалюта только через Trybit — своих адресов нет, переводы с TxID не принимаются', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { token, id } = await signup(server.baseUrl, 'crypto_tester@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Счёт, выставленный до 20.11.2026 (новых счетов нет).
  const invoice = server.invoiceStore.createCryptoInvoice(
    id,
    'free',
    'USDT_TRC20',
    5,
    'https://pay.trybit.example/INV-T1',
    'INV-T1',
    undefined,
    undefined,
    'credits-5',
  );
  assert.equal(invoice.amountUsd, 5);
  // Счёт выставлен в Trybit; своего кошелька для прямого перевода в нём нет.
  assert.ok(invoice.cryptoCloudInvoiceId);
  assert.equal(invoice.address, '');
  assert.equal(invoice.qrPayload, '');

  for (const body of [
    { txHash: `TEST_VALID_TX_${Date.now()}`, mode: 'manual' },
    { mode: 'manual' },
    { txHash: 'abc' },
  ]) {
    const res = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice.id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
    assert.equal(
      (await readJson<{ error: { code: string } }>(res)).error.code,
      'manual_transfer_unavailable',
    );
  }

  // Без подтверждения Trybit кредиты не выдаются.
  const unpaid = await fetch(`${server.baseUrl}/api/billing/crypto/confirm/${invoice.id}`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(unpaid.status, 400);
  assert.equal(
    (await readJson<{ error: { code: string } }>(unpaid)).error.code,
    'payment_not_received',
  );

  const report = await readJson<CreditsReport>(
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers }),
  );
  assert.equal(report.purchased, false);
  assert.equal(report.granted, TRIAL_CREDITS);
});

async function signup(baseUrl: string, email: string): Promise<{ token: string; id: string }> {
  const res = await signupAndVerify(baseUrl, {
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
    ['POST', '/api/billing/cancel'],
    ['GET', '/api/billing/crypto/status/x'],
    ['GET', '/api/billing/telegram-stars/status/x'],
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

  const invoice = server.invoiceStore.createTelegramStarsInvoice(
    owner.id,
    'free',
    495,
    260,
    'ketner_test_bot',
    'credits-5',
  );

  const strangerHeaders = { Authorization: `Bearer ${stranger.token}` };
  const status = await fetch(`${server.baseUrl}/api/billing/telegram-stars/status/${invoice.id}`, {
    headers: strangerHeaders,
  });
  assert.equal(status.status, 404);
  const confirm = await fetch(
    `${server.baseUrl}/api/billing/telegram-stars/confirm/${invoice.id}`,
    {
      method: 'POST',
      headers: strangerHeaders,
    },
  );
  assert.equal(confirm.status, 404);

  // Владелец своё видит
  const own = await fetch(`${server.baseUrl}/api/billing/telegram-stars/status/${invoice.id}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(own.status, 200);

  // У постороннего кредитов не прибавилось
  const report = await readJson<CreditsReport>(
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers: strangerHeaders }),
  );
  assert.equal(report.purchased, false);
  assert.equal(report.granted, TRIAL_CREDITS);
});

test('billing (C5): в production заглушки оплаты выключены, кредиты без платежа не выдаются', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await signup(server.baseUrl, 'c5-prod@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` };

  // Счёт Stars, выставленный до 20.11.2026; затем «включаем production».
  const invoice = server.invoiceStore.createTelegramStarsInvoice(
    user.id,
    'free',
    990,
    510,
    'ketner_test_bot',
    'credits-10',
  );

  const mutable = config as unknown as { enableMockBilling: boolean };
  const previous = mutable.enableMockBilling;
  mutable.enableMockBilling = false;
  try {
    const checkout = await fetch(`${server.baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ packId: 'credits-100' }),
    });
    assert.equal(checkout.status, 503, 'оформления без оплаты больше нет');

    const stripe = await fetch(`${server.baseUrl}/api/billing/stripe/create-checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'ultra' }),
    });
    assert.equal(stripe.status, 410, 'оплата картой снята вместе с подписками');

    const sbpCreate = await fetch(`${server.baseUrl}/api/billing/sbp/create-invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: 'plus' }),
    });
    assert.equal(sbpCreate.status, 410, 'СБП снята вместе с подписками');

    // Stars: подтверждение до реальной оплаты (successful_payment от Telegram) не проходит.
    const confirm = await fetch(
      `${server.baseUrl}/api/billing/telegram-stars/confirm/${invoice.id}`,
      {
        method: 'POST',
        headers,
      },
    );
    assert.equal(confirm.status, 402);
  } finally {
    mutable.enableMockBilling = previous;
  }

  const report = await readJson<CreditsReport>(
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers }),
  );
  assert.equal(report.purchased, false);
  assert.equal(report.granted, TRIAL_CREDITS);
});
