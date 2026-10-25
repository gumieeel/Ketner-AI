import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_LIMITS } from './code-limits.js';
import { planCreditsUsd } from './entitlement.js';

test('бюджет запуска агента не больше месячных кредитов тарифа: один запуск не может их превысить', () => {
  for (const plan of ['free', 'plus', 'pro', 'ultra'] as const) {
    assert.ok(
      CODE_LIMITS[plan].maxRunCostUsd <= planCreditsUsd(plan),
      `${plan}: запуск $${CODE_LIMITS[plan].maxRunCostUsd} > кредитов тарифа $${planCreditsUsd(plan)}`,
    );
  }
});

test('Pro и Ultra: бюджета запуска хватает на типичную задачу на GPT-6 Astra', () => {
  // 15 шагов × 20k токенов, половина из кэша, 6k на выходе (medium) / 15k (Max): $1.95 и $2.40 у Astra.
  assert.ok(CODE_LIMITS.pro.maxRunCostUsd >= 1.95);
  assert.ok(CODE_LIMITS.ultra.maxRunCostUsd >= 2.4);
  // Один запуск не съедает больше трети месячных кредитов.
  assert.ok(CODE_LIMITS.pro.maxRunCostUsd <= planCreditsUsd('pro') / 3);
  assert.ok(CODE_LIMITS.ultra.maxRunCostUsd <= planCreditsUsd('ultra') / 3);
});
