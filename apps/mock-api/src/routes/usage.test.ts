import assert from 'node:assert/strict';
import test from 'node:test';
import { exhaust, setBalance } from '../services/credits-fixture.js';
import { PLAN_ENTITLEMENTS } from '../services/entitlement.js';
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

test('GET /api/usage/credits: Free получает месячный грант, бесплатная модель всегда по карману', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await register(server.baseUrl, 'credits-free@example.com');

  const response = await fetch(`${server.baseUrl}/api/usage/credits`, { headers: user.headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const report = (await response.json()) as CreditsReport;
  assert.equal(report.plan, 'free');
  assert.equal(report.balance, PLAN_ENTITLEMENTS.free.monthlyCredits);
  assert.equal(report.monthly, PLAN_ENTITLEMENTS.free.monthlyCredits);
  assert.equal(report.stage, 'normal');
  assert.equal(report.grants[0]?.kind, 'free');
  assert.ok(report.refreshAt, 'у Free известна дата следующего гранта');
  assert.ok(report.freeModel?.id);
  assert.ok(report.models.some((model) => model.free && model.affordable));

  // Все кредиты потрачены: ступень «кончились», а дата новых кредитов остаётся.
  exhaust(server.credits, user.userId, 'free');
  const spent = (await (
    await fetch(`${server.baseUrl}/api/usage/credits`, { headers: user.headers })
  ).json()) as CreditsReport;
  assert.equal(spent.balance, 0);
  assert.equal(spent.stage, 'exhausted');
  assert.ok(spent.refreshAt);
});

test('GET /api/usage/credits: режим Max на Ultra дороже обычного, остаток в кредитах целый', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const user = await register(server.baseUrl, 'credits-ultra@example.com');
  const checkout = await fetch(`${server.baseUrl}/api/billing/checkout`, {
    method: 'POST',
    headers: user.headers,
    body: JSON.stringify({ planId: 'ultra' }),
  });
  assert.equal(checkout.status, 200);
  setBalance(server.credits, user.userId, 'ultra', 1234);

  const get = async (query = '') =>
    (await (
      await fetch(`${server.baseUrl}/api/usage/credits${query}`, { headers: user.headers })
    ).json()) as CreditsReport;
  const standard = await get();
  const max = await get('?mode=max');
  assert.equal(standard.plan, 'ultra');
  assert.equal(standard.balance, 1234);
  assert.ok(Number.isInteger(standard.balance));
  assert.equal(standard.monthly, PLAN_ENTITLEMENTS.ultra.monthlyCredits);
  assert.equal(max.reasoningMode, 'max');
  const opus = (report: CreditsReport) => report.models.find((m) => m.id === 'claude-opus-5.5');
  assert.ok((opus(max)?.requestCredits ?? 0) > (opus(standard)?.requestCredits ?? 0));
  assert.ok((opus(max)?.remaining ?? 0) < (opus(standard)?.remaining ?? 0));
});
