import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ModelRegistry } from '../ai/model-registry.js';
import { typicalRequestCost } from '../ai/engine-pricing.js';
import { UsageStore } from '../store/usage-store.js';
import { readJson, startTestServer } from '../testing/server.js';
import type { AuthSession } from '../types.js';
import { PLAN_ENTITLEMENTS } from './entitlement.js';
import { buildQuotaReport, getPremiumQuota } from './premium-quota.js';

const registry = new ModelRegistry();
const DAY = 24 * 3_600_000;

function newUsage(): UsageStore {
  return new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-quota-')), 'usage.json'));
}

function spend(
  usage: UsageStore,
  userId: string,
  modelId: string,
  cost: number,
  times = 1,
  ageMs = 0,
): void {
  for (let i = 0; i < times; i++) {
    const rec = usage.recordUsage({
      userId,
      conversationId: 'c',
      modelId,
      provider: 'openrouter',
      inputTokens: 7_600,
      outputTokens: 2_000,
      estimatedCost: cost,
      actualCost: cost,
      latencyMs: 1,
      status: 'success',
    });
    rec.createdAt = new Date(Date.now() - ageMs).toISOString();
  }
}

const deps = (usage: UsageStore) => ({ usageStore: usage, registry });

test('квота: топ-модели тарифа, цена запроса по таблице и остаток по квоте и пулу', () => {
  const usage = newUsage();
  const report = buildQuotaReport('u-pro', 'pro', deps(usage));
  assert.equal(report.premium.budgetUsd, PLAN_ENTITLEMENTS.pro.premiumBudget);
  assert.equal(report.premium.warning, false);
  assert.equal(report.budget.stage, 'normal');

  const opus = report.models.find((m) => m.id === 'claude-opus-5.5')!;
  const opusPrice = typicalRequestCost(registry.get('claude-opus-5.5')!, 'medium');
  assert.equal(opus.priceSource, 'estimate');
  assert.equal(opus.requestCostUsd, opusPrice);
  assert.equal(opus.remainingByQuota, Math.floor(PLAN_ENTITLEMENTS.pro.premiumBudget / opusPrice));
  // Квоты хватает на сотню запросов, но за сутки из пула — не больше 8.
  assert.deepEqual(opus.pool, { weekly: 21, perDay: 8, weekRemaining: 21, dayRemaining: 8 });
  assert.equal(opus.remaining, 8);
  assert.equal(opus.limitedBy, null);

  // Рабочие и лёгкие модели квоту не тратят и в отчёт не входят.
  assert.ok(report.models.every((m) => m.id !== 'ketner-pro' && m.id !== 'ketner-mini'));
  // На Plus из топ-моделей только GPT-6.1 Sol, на Free — ничего.
  assert.deepEqual(
    buildQuotaReport('u', 'plus', deps(usage)).models.map((m) => m.id),
    ['gpt-6.1-sol'],
  );
  assert.deepEqual(buildQuotaReport('u', 'free', deps(usage)).models, []);
});

test('квота: предупреждение с 80%, при нуле — что ограничивает и когда вернётся', () => {
  const usage = newUsage();
  const budget = PLAN_ENTITLEMENTS.pro.premiumBudget;
  // 85% квоты потрачено: первая трата 10 дней назад.
  spend(usage, 'u-warn', 'claude-sonnet-5.5', budget * 0.85, 1, 10 * DAY);
  const warn = buildQuotaReport('u-warn', 'pro', deps(usage));
  assert.equal(warn.premium.usedPct, 85);
  assert.equal(warn.premium.warning, true);
  const restoresIn = Date.parse(warn.premium.restoresAt!) - Date.now();
  assert.ok(Math.abs(restoresIn - 20 * DAY) < 60_000, 'трата 10 дней назад выпадет через 20 дней');

  // Квота исчерпана: Opus 0 запросов, ограничивает квота, вернётся, когда выпадет старая трата.
  spend(usage, 'u-warn', 'claude-sonnet-5.5', budget * 0.2, 1, 2 * DAY);
  const empty = buildQuotaReport('u-warn', 'pro', deps(usage));
  const opus = empty.models.find((m) => m.id === 'claude-opus-5.5')!;
  assert.equal(opus.remaining, 0);
  assert.equal(opus.limitedBy, 'quota');
  assert.ok(Math.abs(Date.parse(opus.restoresAt!) - Date.now() - 20 * DAY) < 60_000);
  assert.equal(getPremiumQuota('u-warn', 'pro', deps(usage)).available, false);
});

test('квота: пул модели исчерпан за сутки — 0 запросов и время возврата суточной доли', () => {
  const usage = newUsage();
  spend(usage, 'u-pool', 'claude-opus-5.5', 0.07, 8, 5 * 3_600_000);
  const opus = buildQuotaReport('u-pool', 'pro', deps(usage)).models.find(
    (m) => m.id === 'claude-opus-5.5',
  )!;
  assert.equal(opus.remaining, 0);
  assert.equal(opus.limitedBy, 'day');
  assert.ok(Math.abs(Date.parse(opus.restoresAt!) - Date.now() - 19 * 3_600_000) < 60_000);
});

test('квота: на 80% месячного бюджета премиум-модели заменяются, остаток 0 до возврата бюджета', () => {
  const usage = newUsage();
  spend(usage, 'u-soft', 'ketner-pro', PLAN_ENTITLEMENTS.pro.costBudget * 0.85, 1, 3 * DAY);
  const report = buildQuotaReport('u-soft', 'pro', deps(usage));
  assert.equal(report.budget.stage, 'soft');
  for (const model of report.models) {
    assert.equal(model.remaining, 0, model.id);
    assert.equal(model.limitedBy, 'budget', model.id);
    assert.ok(model.restoresAt, model.id);
  }
});

test('квота: режим Max на Ultra — цена xhigh и запрос за 2 единицы пула', () => {
  const usage = newUsage();
  const report = buildQuotaReport('u-max', 'ultra', deps(usage), 'max');
  assert.equal(report.reasoningMode, 'max');
  const opus = report.models.find((m) => m.id === 'claude-opus-5.5')!;
  assert.equal(opus.requestCostUsd, typicalRequestCost(registry.get('claude-opus-5.5')!, 'xhigh'));
  assert.deepEqual(opus.pool, { weekly: 24, perDay: 9, weekRemaining: 24, dayRemaining: 9 });
  // На Pro режима Max нет: отчёт считается для обычного режима.
  assert.equal(buildQuotaReport('u-max', 'pro', deps(usage), 'max').reasoningMode, 'standard');
});

test('квота: средняя фактическая цена запроса заменяет оценку, когда данных достаточно', () => {
  const usage = newUsage();
  for (let i = 0; i < 20; i++) spend(usage, `other-${i}`, 'claude-sonnet-5.5', 0.05);
  const sonnet = buildQuotaReport('u-obs', 'pro', deps(usage)).models.find(
    (m) => m.id === 'claude-sonnet-5.5',
  )!;
  assert.equal(sonnet.priceSource, 'observed');
  assert.equal(sonnet.requestCostUsd, 0.05);
  assert.equal(sonnet.remainingByQuota, Math.floor(PLAN_ENTITLEMENTS.pro.premiumBudget / 0.05));
});

test('GET /api/usage/quota: только со входом; тариф из сессии, Ultra (VIP) видит топ-модели', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  assert.equal((await fetch(`${server.baseUrl}/api/usage/quota`)).status, 401);

  const signup = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test-vip@example.com', password: 'password123', name: 'V' }),
  });
  const session = await readJson<AuthSession>(signup);
  spend(server.usageStore, session.user.id, 'claude-opus-5.5', 0.07, 3);

  const res = await fetch(`${server.baseUrl}/api/usage/quota?mode=max`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await readJson<{
    plan: string;
    reasoningMode: string;
    premium: { spentUsd: number; warning: boolean };
    models: Array<{ id: string; remaining: number }>;
  }>(res);
  assert.equal(body.plan, 'ultra');
  assert.equal(body.reasoningMode, 'max');
  assert.equal(body.premium.spentUsd, 0.21);
  assert.ok(body.models.some((m) => m.id === 'claude-opus-5.5' && m.remaining > 0));
});
