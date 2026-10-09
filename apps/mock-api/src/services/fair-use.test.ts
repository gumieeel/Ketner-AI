import assert from 'node:assert/strict';
import test from 'node:test';
import { FairUseEngine } from './fair-use.js';
import { PLAN_ENTITLEMENTS } from './entitlement.js';
import type { FairUseSnapshot } from '../ai/gateway-types.js';

const snapshot = (over: Partial<FairUseSnapshot> = {}): FairUseSnapshot => ({
  userId: 'u',
  requestsLastMinute: 0,
  requestsLastHour: 0,
  requestsLastDay: 0,
  tokensLastHour: 0,
  tokensLastDay: 0,
  estimatedCostLastDay: 0,
  estimatedCostLastMonth: 0,
  activeConcurrentRequests: 0,
  ...over,
});

test('чат: часовой лимит токенов отклоняет запрос (контрольный случай для агента)', () => {
  const decision = FairUseEngine.evaluate(
    snapshot({ tokensLastHour: PLAN_ENTITLEMENTS.plus.tokensPerHour! + 1 }),
    'plus',
  );
  assert.equal(decision.action, 'deny');
});

test('агент: токенные окна пропускаются, остальные лимиты действуют', () => {
  const heavy = snapshot({
    tokensLastHour: PLAN_ENTITLEMENTS.plus.tokensPerHour! * 3,
    tokensLastDay: PLAN_ENTITLEMENTS.plus.tokensPerDay! * 3,
  });
  assert.equal(FairUseEngine.evaluate(heavy, 'plus', 'ru', { skipTokenWindows: true }).action, 'allow');

  const hourly = snapshot({ requestsLastHour: PLAN_ENTITLEMENTS.plus.requestsPerHour! });
  assert.equal(FairUseEngine.evaluate(hourly, 'plus', 'ru', { skipTokenWindows: true }).action, 'deny');

  const busy = snapshot({ activeConcurrentRequests: PLAN_ENTITLEMENTS.plus.maxConcurrency });
  assert.equal(FairUseEngine.evaluate(busy, 'plus', 'ru', { skipTokenWindows: true }).action, 'deny');
});

test('суточный лимит расхода умножается на коэффициент агента', () => {
  const cap = PLAN_ENTITLEMENTS.plus.maxDailyCost!;
  const between = snapshot({ estimatedCostLastDay: cap * 2 });
  assert.equal(FairUseEngine.evaluate(between, 'plus').action, 'deny');
  assert.equal(FairUseEngine.evaluate(between, 'plus', 'ru', { dailyCostFactor: 3 }).action, 'allow');
  const over = snapshot({ estimatedCostLastDay: cap * 3 });
  assert.equal(FairUseEngine.evaluate(over, 'plus', 'ru', { dailyCostFactor: 3 }).action, 'deny');
});
