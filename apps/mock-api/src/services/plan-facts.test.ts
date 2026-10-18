import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IMAGE_MODELS, imageDailyLimit } from '../images/models.js';
import { CODE_LIMITS } from './code-limits.js';
import { getModelLimit } from './daily-limits.js';
import { PLAN_ENTITLEMENTS } from './entitlement.js';
import { PLAN_PRICE_USD } from './pricing.js';

/**
 * Сайт показывает лимиты тарифов до оплаты (apps/web/.../plan-facts.json). Если число на сайте
 * разойдётся с тем, что сервер действительно применяет, человек заплатит за одно, а получит другое.
 * Тест держит их одинаковыми.
 */

type Plan = 'free' | 'plus' | 'pro' | 'ultra';

interface PlanFacts {
  priceUsd: number;
  messagesPerDay: number;
  requestsPerMinute: number;
  requestsPerHour: number;
  tokensPerHour: number;
  tokensPerDay: number;
  dailyCostCapUsd: number;
  costBudgetUsd: number;
  concurrency: number;
  maxAnswerTokens: number;
  premiumQuotaUsd: number;
  flagship: { model: string; weeklyPool: number; perDay: number }[];
  imagesPerDay: Record<string, number>;
  codeRunsPerDay: number;
  codeRunBudgetUsd: number;
  api: boolean;
}

const factsPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../web/src/features/billing/plan-facts.json',
);

test('лимиты тарифов на сайте совпадают с сервером', (t) => {
  if (!existsSync(factsPath)) {
    t.skip('исходники сайта недоступны в этом окружении');
    return;
  }
  const facts = JSON.parse(readFileSync(factsPath, 'utf8')) as {
    plans: Record<Plan, PlanFacts>;
  };

  for (const plan of ['free', 'plus', 'pro', 'ultra'] as const) {
    const site = facts.plans[plan];
    const server = PLAN_ENTITLEMENTS[plan];
    assert.equal(site.priceUsd, PLAN_PRICE_USD[plan], `${plan}: цена`);
    assert.equal(site.messagesPerDay, server.requestsPerDay, `${plan}: сообщений в сутки`);
    assert.equal(site.requestsPerMinute, server.requestsPerMinute, `${plan}: запросов в минуту`);
    assert.equal(site.requestsPerHour, server.requestsPerHour, `${plan}: запросов в час`);
    assert.equal(site.tokensPerHour, server.tokensPerHour, `${plan}: токенов в час`);
    assert.equal(site.tokensPerDay, server.tokensPerDay, `${plan}: токенов в сутки`);
    assert.equal(site.dailyCostCapUsd, server.maxDailyCost, `${plan}: потолок расхода в сутки`);
    assert.equal(site.costBudgetUsd, server.costBudget, `${plan}: бюджет расхода на 30 дней`);
    assert.equal(site.concurrency, server.maxConcurrency, `${plan}: параллельных запросов`);
    assert.equal(site.maxAnswerTokens, server.maxTokens, `${plan}: потолок ответа`);
    assert.equal(site.premiumQuotaUsd, server.premiumBudget, `${plan}: квота премиум-моделей`);
    assert.equal(site.codeRunsPerDay, CODE_LIMITS[plan].runsPerDay, `${plan}: запусков Code`);
    assert.equal(site.codeRunBudgetUsd, CODE_LIMITS[plan].maxRunCostUsd, `${plan}: бюджет запуска`);
    assert.equal(site.api, plan !== 'free', `${plan}: API-ключи доступны с Plus`);

    for (const flagship of site.flagship) {
      const limit = getModelLimit(plan, flagship.model);
      assert.ok(limit, `${plan}: у ${flagship.model} нет лимита`);
      assert.equal(flagship.weeklyPool, limit.weeklyPool, `${plan}: ${flagship.model} в неделю`);
      assert.equal(flagship.perDay, limit.dailyCap, `${plan}: ${flagship.model} за сутки`);
    }

    const siteImages = Object.entries(site.imagesPerDay).sort();
    const serverImages = IMAGE_MODELS.map(
      (model) => [model.id, imageDailyLimit(model, plan)] as const,
    )
      .filter(([, limit]) => limit > 0)
      .sort();
    assert.deepEqual(siteImages, serverImages, `${plan}: картинки в сутки`);
  }
});
