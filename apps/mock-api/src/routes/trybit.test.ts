/**
 * Оплата через Trybit (бывший CryptoCloud). Новых счетов нет (пакеты не продаются с 20.11.2026,
 * задача 0b), но счёт, выставленный раньше, ещё может быть оплачен: подписанный postback без
 * префикса INV- и без order_id, перепроверка оплаты через API шлюза и выдача кредитов пакета с бонусом.
 */
import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { setProductSwitchForTests } from '../product-switches.js';

// Пакеты кредитов не продаются (задача 0b): тесты ниже проверяют приём оплаты по прежним счетам.
setProductSwitchForTests('packs', true);

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

function fakeTrybit(paidStatus: string): { calls: GatewayCall[]; restore: () => void } {
  const calls: GatewayCall[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.trybit.com/')) return realFetch(input, init);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, headers: init?.headers as Record<string, string>, body });
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

type TestServer = Awaited<ReturnType<typeof startTestServer>>;

/** Счёт Trybit на пакет, выставленный до 20.11.2026. */
function issuedInvoice(server: TestServer, userId: string, packId: string, amountUsd: number) {
  return server.invoiceStore.createCryptoInvoice(
    userId,
    'free',
    'USDT_TRC20',
    amountUsd,
    'https://pay.trybit.com/INV-ABC12345',
    'INV-ABC12345',
    undefined,
    undefined,
    packId,
  );
}

async function signup(baseUrl: string, email: string): Promise<AuthSession> {
  const response = await signupAndVerify(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Buyer' }),
  });
  return readJson<AuthSession>(response);
}

test('Trybit: подписанный postback по счёту, выставленному раньше, выдаёт кредиты пакета и бонус +15%', async (t) => {
  const gateway = fakeTrybit('paid');
  const server = await startTestServer();
  t.after(async () => {
    gateway.restore();
    await server.close();
  });
  const buyer = await signup(server.baseUrl, 'trybit-buyer@example.com');
  const auth = { Authorization: `Bearer ${buyer.token}` };

  const invoice = issuedInvoice(server, buyer.user.id, 'credits-10', 10);

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
  issuedInvoice(server, buyer.user.id, 'credits-25', 25);

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

test('новых счетов нет: выставление и каталог пакетов отвечают 503, в шлюз ничего не уходит', async (t) => {
  const gateway = fakeTrybit('paid');
  const server = await startTestServer();
  t.after(async () => {
    gateway.restore();
    await server.close();
  });
  const buyer = await signup(server.baseUrl, 'test-vip@example.com');
  for (const body of [{ packId: 'credits-10' }, { packId: 'premium-10' }, { planId: 'plus' }]) {
    const response = await fetch(`${server.baseUrl}/api/billing/crypto/create-invoice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'USDT_TRC20', ...body }),
    });
    assert.equal(response.status, 503, JSON.stringify(body));
    const error = (
      await readJson<{ error: { code: string; details: { feature: string } } }>(response)
    ).error;
    assert.equal(error.code, 'feature_unavailable');
    assert.equal(error.details.feature, 'packs');
  }
  const packs = await fetch(`${server.baseUrl}/api/packs`);
  assert.equal(packs.status, 503);
  const old = await fetch(`${server.baseUrl}/api/billing/crypto-bonus`, {
    headers: { Authorization: `Bearer ${buyer.token}` },
  });
  assert.equal(old.status, 404);
  assert.equal(gateway.calls.length, 0, 'в шлюз ничего не ушло');
});
