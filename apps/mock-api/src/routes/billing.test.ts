import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../config.js';
import { TRYBIT_CURRENCIES } from '../billing/trybit-currencies.js';
import { TRIAL_CREDITS } from '../services/entitlement.js';
import { CREDIT_PACKS } from '../services/pricing.js';
import { readJson, startTestServer } from '../testing/server.js';
import type { CreditsReport } from '../services/credits.js';
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

test('billing: каталог пакетов кредитов GET /api/packs — публичный, цены и бонус за крипту', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${server.baseUrl}/api/packs`);
  assert.equal(response.status, 200);
  const body = await readJson<{
    packs: Array<{
      id: string;
      priceUsd: number;
      credits: number;
      stars: number;
      cryptoBonusCredits: number;
      pricePerThousandUsd: number;
      discountPct: number;
    }>;
    trialCredits: number;
    cryptoBonusRate: number;
    validDays: number;
  }>(response);
  assert.deepEqual(
    body.packs.map((p) => [p.id, p.priceUsd, p.credits]),
    CREDIT_PACKS.map((p) => [p.id, p.priceUsd, p.credits]),
  );
  assert.equal(body.trialCredits, TRIAL_CREDITS);
  assert.equal(body.cryptoBonusRate, 0.15);
  assert.equal(body.validDays, 365);
  assert.equal(body.packs[0]?.discountPct, 0);
  assert.ok(
    body.packs.every((p, i) => i === 0 || p.discountPct > body.packs[i - 1]!.discountPct),
    'чем больше пакет, тем выше скидка',
  );
  assert.equal(body.packs[4]?.discountPct, 20, 'пакет $100 — скидка 20% к цене пакета $5');
  assert.ok(body.packs.every((p) => p.stars > 0 && p.cryptoBonusCredits > 0));
});

test('billing: подписок больше нет, оформление пакета кредитов даёт кредиты и открывает полный доступ', async (t) => {
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
  const checkout = (body: unknown) =>
    fetch(`${server.baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
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

  // Подписки сняты с продажи: любой тариф — 410, неизвестный пакет — 400
  for (const planId of ['plus', 'pro', 'ultra']) {
    const res = await checkout({ planId });
    assert.equal(res.status, 410, planId);
    assert.equal(
      (await readJson<{ error: { code: string } }>(res)).error.code,
      'subscriptions_discontinued',
    );
  }
  assert.equal((await checkout({ packId: 'credits-7' })).status, 400);
  assert.equal((await report()).purchased, false, 'ничего не выдано');

  // Оформляем пакет $10
  const pack = CREDIT_PACKS[1]!;
  const checkoutRes = await checkout({ packId: pack.id });
  assert.equal(checkoutRes.status, 200);
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
  const { token } = await signup(server.baseUrl, 'crypto_tester@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const created = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ packId: 'credits-5', currency: 'USDT_TRC20' }),
  });
  assert.equal(created.status, 200);
  const { invoice } = await readJson<{
    invoice: {
      id: string;
      amountUsd: number;
      address: string;
      qrPayload: string;
      cryptoCloudInvoiceId?: string;
    };
  }>(created);
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
    body: JSON.stringify({ packId: 'credits-5' }),
  });
  assert.equal(created.status, 200);
  const { invoice } = await readJson<{ invoice: { id: string } }>(created);

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

  // Счёт Stars создаём заранее (создание счёта не заглушка), затем «включаем production».
  const created = await fetch(`${server.baseUrl}/api/billing/telegram-stars/create-invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ packId: 'credits-10' }),
  });
  const { invoice } = await readJson<{ invoice: { id: string } }>(created);

  const mutable = config as unknown as { enableMockBilling: boolean };
  const previous = mutable.enableMockBilling;
  mutable.enableMockBilling = false;
  try {
    const checkout = await fetch(`${server.baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ packId: 'credits-100' }),
    });
    assert.equal(checkout.status, 501);

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

test('billing (C7): без шлюза Trybit в production крипто-счёт не создаётся ни в какой валюте', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await signup(server.baseUrl, 'c7-prod@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` };

  const mutable = config as unknown as {
    enableMockBilling: boolean;
    cryptoCloudApiKey?: string;
    cryptoCloudShopId?: string;
  };
  const previous = { ...mutable };
  mutable.enableMockBilling = false;
  mutable.cryptoCloudApiKey = '';
  mutable.cryptoCloudShopId = '';
  try {
    for (const currency of ['USDT_TRC20', 'TON', 'BTC']) {
      const create = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ packId: 'credits-5', currency }),
      });
      assert.equal(create.status, 501, currency);
    }
  } finally {
    Object.assign(mutable, previous);
  }

  const report = await readJson<CreditsReport>(
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers }),
  );
  assert.equal(report.purchased, false);
});

test('billing: все валюты и сети Trybit принимаются, незнакомые отклоняются', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { token } = await signup(server.baseUrl, 'currencies@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const create = (currency: unknown) =>
    fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ packId: 'credits-5', currency }),
    });

  assert.equal(TRYBIT_CURRENCIES.length, 38);
  for (const currency of TRYBIT_CURRENCIES)
    assert.equal((await create(currency)).status, 200, currency);
  for (const bad of ['DOGE', 'USDT', '', 'usdt_trc20', 42]) {
    const res = await create(bad);
    assert.equal(res.status, 400, String(bad));
    assert.equal((await readJson<{ error: { code: string } }>(res)).error.code, 'invalid_currency');
  }
});

test('billing: комиссии Trybit из ответа шлюза попадают в счёт', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { token } = await signup(server.baseUrl, 'fees@example.com');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const mutable = config as unknown as { cryptoCloudApiKey?: string; cryptoCloudShopId?: string };
  const previousConfig = { ...mutable };
  const realFetch = globalThis.fetch;
  mutable.cryptoCloudApiKey = 'test-key';
  mutable.cryptoCloudShopId = 'test-shop';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/v2/invoice/create')) {
      return Response.json({
        status: 'success',
        result: {
          uuid: 'INV-FEES1234',
          link: 'https://pay.trybit.com/FEES1234',
          status: 'created',
          address: 'TFeeTestAddress000000000000000000',
          amount: 6.4,
          amount_usd: 6.4,
          fee_usd: 1.4,
          service_fee_usd: 0.17,
          currency: {
            code: 'USDT',
            fullcode: 'USDT_TRC20',
            network: { code: 'TRC20', fullname: 'Tron' },
          },
        },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    Object.assign(mutable, previousConfig);
  });

  const res = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ packId: 'credits-5', currency: 'USDT_TRC20' }),
  });
  assert.equal(res.status, 200);
  const { invoice } = await readJson<{
    invoice: {
      amount: number;
      fees?: { serviceUsd: number; transferUsd: number; payerUsd: number; totalUsd: number };
    };
  }>(res);
  assert.equal(invoice.amount, 6.4);
  assert.deepEqual(invoice.fees, {
    serviceUsd: 0.17,
    transferUsd: 1.4,
    payerUsd: 1.4,
    totalUsd: 6.4,
  });
});
