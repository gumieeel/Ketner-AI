/**
 * Оплата через Trybit (бывший CryptoCloud): создание счёта, подписанный postback без префикса
 * INV- и без order_id, перепроверка оплаты через API шлюза и выдача кредитов пакета с бонусом.
 */
import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

process.env.TRYBIT_API_KEY = 'trybit-api-key';
process.env.TRYBIT_SHOP_ID = 'shop-42';
process.env.TRYBIT_SECRET_KEY = 'trybit-secret';

const { readJson, startTestServer } = await import('../testing/server.js');
const { TRIAL_CREDITS } = await import('../services/entitlement.js');
const { CREDIT_PACKS, packCryptoBonusCredits } = await import('../services/pricing.js');
type CreditsReport = import('../services/credits.js').CreditsReport;
type AuthSession = import('../types.js').AuthSession;

function sign(payload: Record<string, unknown>, secret = 'trybit-secret'): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = `${part({ typ: 'JWT', alg: 'HS256' })}.${part(payload)}`;
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`;
}

interface GatewayCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeTrybit(
  paidStatus: string,
  createExtra: Record<string, unknown> = {},
): { calls: GatewayCall[]; restore: () => void } {
  const calls: GatewayCall[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.trybit.com/')) return realFetch(input, init);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, headers: init?.headers as Record<string, string>, body });
    if (url.endsWith('/v2/invoice/create')) {
      return Response.json({
        status: 'success',
        result: {
          uuid: 'INV-ABC12345',
          link: 'https://pay.trybit.com/INV-ABC12345',
          status: 'created',
          address: '',
          ...createExtra,
        },
      });
    }
    if (url.endsWith('/v2/invoice/merchant/info')) {
      return Response.json({
        status: 'success',
        result: [{ uuid: 'INV-ABC12345', status: paidStatus }],
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

async function signup(baseUrl: string, email: string): Promise<AuthSession> {
  const response = await signupAndVerify(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Buyer' }),
  });
  return readJson<AuthSession>(response);
}

test('Trybit: счёт создаётся на api.trybit.com, подписанный postback выдаёт кредиты пакета и бонус +15%', async (t) => {
  const gateway = fakeTrybit('paid');
  const server = await startTestServer();
  t.after(async () => {
    gateway.restore();
    await server.close();
  });
  const buyer = await signup(server.baseUrl, 'trybit-buyer@example.com');
  const auth = { Authorization: `Bearer ${buyer.token}` };

  const created = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: 'credits-10', currency: 'USDT_TRC20' }),
  });
  assert.equal(created.status, 200);
  const { invoice } = await readJson<{ invoice: { id: string; cryptoCloudUrl: string } }>(created);
  assert.equal(invoice.cryptoCloudUrl, 'https://pay.trybit.com/INV-ABC12345');

  const create = gateway.calls.find((call) => call.url.endsWith('/v2/invoice/create'))!;
  assert.equal(create.headers.Authorization, 'Token trybit-api-key');
  assert.equal(create.body.shop_id, 'shop-42');
  assert.equal(create.body.currency, 'USD');
  assert.equal(create.body.amount, 10, 'в счёте полная цена пакета без наценки');
  assert.deepEqual(create.body.add_fields, { cryptocurrency: 'USDT_TRC20' });
  assert.equal(typeof create.body.order_id, 'string');

  // Поддельная подпись — отказ, кредиты не выдаются.
  const forged = await fetch(`${server.baseUrl}/api/billing/trybit/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'success',
      invoice_id: 'ABC12345',
      token: sign({ id: 'x' }, 'wrong'),
    }),
  });
  assert.equal(forged.status, 401);

  // Настоящий postback в формате form-urlencoded: invoice_id без INV-, order_id пустой.
  const postback = await fetch(`${server.baseUrl}/api/billing/trybit/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      status: 'success',
      invoice_id: 'ABC12345',
      amount_crypto: '10',
      currency: 'USDT_TRC20',
      order_id: '',
      token: sign({ id: 'ABC12345', exp: Math.floor(Date.now() / 1000) + 300 }),
    }),
  });
  assert.equal(postback.status, 200);
  assert.ok(gateway.calls.some((call) => call.url.endsWith('/v2/invoice/merchant/info')));

  const pack = CREDIT_PACKS[1]!;
  const bonus = packCryptoBonusCredits(pack);
  const report = await readJson<CreditsReport>(
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers: auth }),
  );
  assert.equal(report.plan, 'credits');
  assert.equal(report.purchased, true);
  assert.equal(report.balance, pack.credits + bonus + TRIAL_CREDITS);
  assert.deepEqual(report.grants.map((g) => g.kind).sort(), ['bonus', 'free', 'pack']);
  assert.equal(report.grants.find((g) => g.kind === 'bonus')?.amount, bonus);

  // Повторная доставка postback не дублирует кредиты.
  const repeat = await fetch(`${server.baseUrl}/api/billing/trybit/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      status: 'success',
      invoice_id: 'ABC12345',
      amount_crypto: '10',
      currency: 'USDT_TRC20',
      order_id: '',
      token: sign({ id: 'ABC12345', exp: Math.floor(Date.now() / 1000) + 300 }),
    }),
  });
  assert.equal(repeat.status, 200);
  const again = await readJson<CreditsReport>(
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers: auth }),
  );
  assert.equal(again.balance, report.balance);

  const status = await readJson<{ status: string }>(
    await fetch(`${server.baseUrl}/api/billing/crypto/status/${invoice.id}`, { headers: auth }),
  );
  assert.equal(status.status, 'paid');
});

test('Trybit: postback без подтверждения оплаты в API шлюза кредиты не выдаёт', async (t) => {
  const gateway = fakeTrybit('created');
  const server = await startTestServer();
  t.after(async () => {
    gateway.restore();
    await server.close();
  });
  const buyer = await signup(server.baseUrl, 'trybit-unpaid@example.com');
  const auth = { Authorization: `Bearer ${buyer.token}` };
  await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: 'credits-25', currency: 'USDT_TRC20' }),
  });

  const postback = await fetch(`${server.baseUrl}/api/billing/cryptocloud/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'success',
      invoice_id: 'ABC12345',
      order_id: null,
      token: sign({ id: 'ABC12345' }),
    }),
  });
  assert.equal(postback.status, 200);
  const report = await readJson<CreditsReport>(
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers: auth }),
  );
  assert.equal(report.purchased, false);
  assert.equal(report.balance, TRIAL_CREDITS);
});

test('Trybit H2H: реквизиты для оплаты на сайте приходят в счёте', async (t) => {
  const gateway = fakeTrybit('created', {
    address: 'TXyzGatewayAddress123',
    amount: 5.42,
    expiry_date: '2026-10-14 15:04:01.555132',
    currency: {
      code: 'USDT',
      fullcode: 'USDT_TRC20',
      network: { code: 'TRC20', fullname: 'Tron' },
    },
  });
  const server = await startTestServer();
  t.after(async () => {
    gateway.restore();
    await server.close();
  });
  const buyer = await signup(server.baseUrl, 'trybit-h2h@example.com');
  const created = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: 'credits-5', currency: 'USDT_TRC20' }),
  });
  const { invoice } = await readJson<{
    invoice: {
      address: string;
      amount: number;
      network: string;
      expiresAt: string;
      gatewayDetails?: boolean;
      qrPayload: string;
    };
  }>(created);
  assert.equal(invoice.gatewayDetails, true);
  assert.equal(invoice.address, 'TXyzGatewayAddress123');
  assert.equal(invoice.amount, 5.42);
  assert.equal(invoice.network, 'Tron · TRC20');
  assert.equal(invoice.expiresAt, '2026-10-14T15:04:01.555Z');
  assert.equal(invoice.qrPayload, 'TXyzGatewayAddress123');
});

test('Trybit без адреса (тестовый режим): остаётся ссылка на страницу оплаты', async (t) => {
  const gateway = fakeTrybit('created');
  const server = await startTestServer();
  t.after(async () => {
    gateway.restore();
    await server.close();
  });
  const buyer = await signup(server.baseUrl, 'trybit-noaddr@example.com');
  const created = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId: 'credits-5', currency: 'USDT_TRC20' }),
  });
  const { invoice } = await readJson<{
    invoice: { gatewayDetails?: boolean; cryptoCloudUrl: string };
  }>(created);
  assert.equal(invoice.gatewayDetails, undefined);
  assert.equal(invoice.cryptoCloudUrl, 'https://pay.trybit.com/INV-ABC12345');
});

test('Trybit: снятые с продажи пакеты и тарифы — счёт не выставляется, в шлюз ничего не уходит', async (t) => {
  const gateway = fakeTrybit('paid');
  const server = await startTestServer();
  t.after(async () => {
    gateway.restore();
    await server.close();
  });
  const buyer = await signup(server.baseUrl, 'test-vip@example.com');
  const create = (body: Record<string, unknown>) =>
    fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'USDT_TRC20', ...body }),
    });

  const oldPack = await create({ packId: 'premium-10' });
  assert.equal(oldPack.status, 400);
  assert.equal((await readJson<{ error: { code: string } }>(oldPack)).error.code, 'invalid_pack');

  const plan = await create({ planId: 'plus' });
  assert.equal(plan.status, 410);
  assert.equal(
    (await readJson<{ error: { code: string } }>(plan)).error.code,
    'subscriptions_discontinued',
  );
  assert.equal(gateway.calls.length, 0, 'в шлюз ничего не ушло');
});

test('бонус за крипту виден в каталоге пакетов, отдельной ручки бонуса больше нет', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const buyer = await signup(server.baseUrl, 'bonus-info@example.com');
  const body = await readJson<{ packs: Array<{ id: string; cryptoBonusCredits: number }> }>(
    await fetch(`${server.baseUrl}/api/packs`),
  );
  assert.deepEqual(
    body.packs.map((p) => [p.id, p.cryptoBonusCredits]),
    CREDIT_PACKS.map((p) => [p.id, packCryptoBonusCredits(p)]),
  );
  const old = await fetch(`${server.baseUrl}/api/billing/crypto-bonus`, {
    headers: { Authorization: `Bearer ${buyer.token}` },
  });
  assert.equal(old.status, 404);
});
