import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_LIMITS } from './code-limits.js';
import { PLAN_ENTITLEMENTS } from './entitlement.js';

test('бюджет запуска агента не выше дневного потолка тарифа: иначе запуск обрывался бы раньше лимита', () => {
  for (const plan of ['free', 'plus', 'pro', 'ultra'] as const) {
    const daily = PLAN_ENTITLEMENTS[plan].maxDailyCost ?? Infinity;
    assert.ok(CODE_LIMITS[plan].maxRunCostUsd <= daily, `${plan}: запуск $${CODE_LIMITS[plan].maxRunCostUsd} > дневной потолок $${daily}`);
  }
});

test('Pro и Ultra: бюджета запуска хватает на типичную задачу на Fable 5.1 / GPT-6 Astra', () => {
  // 15 шагов × 20k токенов, половина из кэша, 6k на выходе (medium) / 15k (Max): $1.95 и $2.40 у Astra.
  assert.ok(CODE_LIMITS.pro.maxRunCostUsd >= 1.95);
  assert.ok(CODE_LIMITS.ultra.maxRunCostUsd >= 2.4);
  // Один запуск не съедает больше трети месячного бюджета.
  assert.ok(CODE_LIMITS.pro.maxRunCostUsd <= PLAN_ENTITLEMENTS.pro.costBudget / 3);
  assert.ok(CODE_LIMITS.ultra.maxRunCostUsd <= PLAN_ENTITLEMENTS.ultra.costBudget / 3);
});
