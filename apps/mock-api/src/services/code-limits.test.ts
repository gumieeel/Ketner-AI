import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_LIMITS, getCodeLimits } from './code-limits.js';
import { toUsd } from './credits.js';
import { TRIAL_CREDITS, planCreditsUsd } from './entitlement.js';

test('бюджет запуска агента на Free не больше пробных кредитов, у прежних подписчиков — месячных кредитов тарифа', () => {
  assert.ok(
    CODE_LIMITS.free.maxRunCostUsd <= toUsd(TRIAL_CREDITS),
    `free: запуск $${CODE_LIMITS.free.maxRunCostUsd} > пробных кредитов $${toUsd(TRIAL_CREDITS)}`,
  );
  for (const plan of ['plus', 'pro', 'ultra'] as const) {
    assert.ok(
      CODE_LIMITS[plan].maxRunCostUsd <= planCreditsUsd(plan),
      `${plan}: запуск $${CODE_LIMITS[plan].maxRunCostUsd} > кредитов тарифа $${planCreditsUsd(plan)}`,
    );
  }
});

test('купленные кредиты открывают лимиты уровня Ultra, Free до первой покупки — свои', () => {
  assert.equal(getCodeLimits('credits'), CODE_LIMITS.ultra);
  assert.equal(getCodeLimits('free'), CODE_LIMITS.free);
  assert.equal(getCodeLimits(undefined), CODE_LIMITS.free);
  assert.equal(CODE_LIMITS.free.commands, false, 'команды в песочнице — после покупки');
  assert.equal(CODE_LIMITS.ultra.commands, true);
});

test('Pro и Ultra: бюджета запуска хватает на типичную задачу на GPT-6 Astra', () => {
  // 15 шагов × 20k токенов, половина из кэша, 6k на выходе (medium) / 15k (Max): $1.95 и $2.40 у Astra.
  assert.ok(CODE_LIMITS.pro.maxRunCostUsd >= 1.95);
  assert.ok(CODE_LIMITS.ultra.maxRunCostUsd >= 2.4);
  // Один запуск не съедает больше трети месячных кредитов.
  assert.ok(CODE_LIMITS.pro.maxRunCostUsd <= planCreditsUsd('pro') / 3);
  assert.ok(CODE_LIMITS.ultra.maxRunCostUsd <= planCreditsUsd('ultra') / 3);
});
