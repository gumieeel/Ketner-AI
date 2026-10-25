import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IMAGE_MODELS, imageDailyLimit } from '../images/models.js';
import { CODE_LIMITS } from './code-limits.js';
import { modelRegistry } from '../ai/model-registry.js';
import { typicalRequestCredits } from './credits.js';
import { cryptoBonusCredits, PLAN_ENTITLEMENTS } from './entitlement.js';
import { PLAN_PRICE_USD } from './pricing.js';

/**
 * Сайт показывает лимиты тарифов до оплаты (apps/web/.../plan-facts.json). Если число на сайте
 * разойдётся с тем, что сервер действительно применяет, человек заплатит за одно, а получит другое.
 * Тест держит их одинаковыми, включая примеры «на сколько запросов хватит кредитов».
 */

type Plan = 'free' | 'plus' | 'pro' | 'ultra';

interface PlanFacts {
  priceUsd: number;
  messagesPerDay: number;
  requestsPerMinute: number;
  requestsPerHour: number;
  tokensPerHour: number;
  tokensPerDay: number;
  monthlyCredits: number;
  cryptoBonusCredits: number;
  examples: { model: string; name: string; requestCredits: number; requests: number }[];
  concurrency: number;
  maxAnswerTokens: number;
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
    assert.equal(site.monthlyCredits, server.monthlyCredits, `${plan}: кредитов в месяц`);
    assert.equal(site.cryptoBonusCredits, cryptoBonusCredits(plan), `${plan}: бонус за крипту`);
    assert.equal(site.concurrency, server.maxConcurrency, `${plan}: параллельных запросов`);
    assert.equal(site.maxAnswerTokens, server.maxTokens, `${plan}: потолок ответа`);
    assert.equal(site.codeRunsPerDay, CODE_LIMITS[plan].runsPerDay, `${plan}: запусков Code`);
    assert.equal(site.codeRunBudgetUsd, CODE_LIMITS[plan].maxRunCostUsd, `${plan}: бюджет запуска`);
    assert.equal(site.api, plan !== 'free', `${plan}: API-ключи доступны с Plus`);

    for (const example of site.examples) {
      const model = modelRegistry.get(example.model);
      assert.ok(model, `${plan}: нет модели ${example.model}`);
      const price = typicalRequestCredits(model, 'standard');
      assert.equal(example.name, model.name, `${plan}: название ${example.model}`);
      assert.equal(example.requestCredits, price, `${plan}: цена запроса ${example.model}`);
      assert.equal(
        example.requests,
        Math.floor(server.monthlyCredits / price),
        `${plan}: запросов ${example.model} на месячные кредиты`,
      );
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
