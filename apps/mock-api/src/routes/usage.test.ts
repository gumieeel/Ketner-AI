import assert from 'node:assert/strict';
import test from 'node:test';
import { exhaust, setBalance } from '../services/credits-fixture.js';
import { TRIAL_CREDITS } from '../services/entitlement.js';
import type { CreditsReport } from '../services/credits.js';
import { startTestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';

async function register(baseUrl: string, email: string) {
  const response = await signupAndVerify(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Credits User' }),
  });
  const body = (await response.json()) as { token: string; user: { id: string } };
  return {
    userId: body.user.id,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` },
  };
}

test('GET /api/usage/credits: без входа — 401', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const response = await fetch(`${server.baseUrl}/api/usage/credits`);
  assert.equal(response.status, 401);
});

test('GET /api/usage/credits: Free получает пробные кредиты один раз, бесплатная модель всегда по карману', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await register(server.baseUrl, 'credits-free@example.com');

  const response = await fetch(`${server.baseUrl}/api/usage/credits`, { headers: user.headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const report = (await response.json()) as CreditsReport;
  assert.equal(report.plan, 'free');
  assert.equal(report.balance, TRIAL_CREDITS);
  assert.equal(report.granted, TRIAL_CREDITS);
  assert.equal(report.trialCredits, TRIAL_CREDITS);
  assert.equal(report.purchased, false);
  assert.equal(report.stage, 'normal');
  assert.equal(report.grants[0]?.kind, 'free');
  assert.ok(report.freeModel?.id);
  assert.ok(report.models.some((model) => model.free && model.affordable));
  assert.ok(
    report.models.some((model) => model.id === 'claude-opus-5.5'),
    'все модели в списке и у Free',
  );

  // Все кредиты потрачены: ступень «кончились», новых пробных кредитов нет.
  exhaust(server.credits, user.userId, 'free');
  const spent = (await (
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers: user.headers })
  ).json()) as CreditsReport;
  assert.equal(spent.balance, 0);
  assert.equal(spent.stage, 'exhausted');
  assert.equal(spent.purchased, false);
  assert.equal(spent.grants.length, 0);
});

test('GET /api/usage/credits: после покупки пакета уровень credits, режим Max дороже обычного, остаток целый', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await register(server.baseUrl, 'credits-buyer@example.com');
  const checkout = await fetch(`${server.baseUrl}/api/billing/checkout`, {
    method: 'POST',
    headers: user.headers,
    body: JSON.stringify({ packId: 'credits-10' }),
  });
  assert.equal(checkout.status, 200);
  setBalance(server.credits, user.userId, 'credits', 1234);

  const get = async (query = '') =>
    (await (
      await fetch(`${server.baseUrl}/api/usage/credits${query}`, { headers: user.headers })
    ).json()) as CreditsReport;
  const standard = await get();
  const max = await get('?mode=max');
  assert.equal(standard.plan, 'credits');
  assert.equal(standard.purchased, true);
  assert.equal(standard.balance, 1234);
  assert.ok(Number.isInteger(standard.balance));
  assert.equal(max.reasoningMode, 'max');
  const opus = (report: CreditsReport) => report.models.find((m) => m.id === 'claude-opus-5.5');
  assert.ok((opus(max)?.requestCredits ?? 0) > (opus(standard)?.requestCredits ?? 0));
  assert.ok((opus(max)?.remaining ?? 0) < (opus(standard)?.remaining ?? 0));
});
