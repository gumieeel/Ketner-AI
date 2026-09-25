import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoRouter } from './auto-router.js';
import { ContextOptimizer } from './context.js';
import { ModelRegistry } from './model-registry.js';
import { CostCalculator } from '../services/cost.js';
import { EntitlementService } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
import type { FairUseSnapshot } from './gateway-types.js';

test('ModelRegistry: получение, разрешение и проверка доступа', () => {
  const registry = new ModelRegistry();

  const def = registry.getDefault();
  assert.equal(def.id, 'ketner-mini');
  assert.equal(def.isPro, false);

  const resolved = registry.resolve('unknown-model-xyz');
  assert.equal(resolved.id, 'ketner-mini');

  const gpt = registry.get('gpt-6-astra');
  assert.ok(gpt);
  assert.equal(gpt.provider, 'openai');
  assert.equal(gpt.isPro, true);

  // Проверка доступа
  assert.equal(registry.canAccess('free', def), true);
  assert.equal(registry.canAccess('free', gpt), false);
  assert.equal(registry.canAccess('gpt-pro', gpt), true);
  assert.equal(registry.canAccess('ultra', gpt), true);

  // Fallback chain
  const chain = registry.getFallbackChain('gpt-6-astra');
  assert.ok(chain.length >= 2);
  assert.equal(chain[0].id, 'gpt-6-astra');
  assert.equal(chain[1].id, 'ketner-mini');
});

test('AutoRouter: классификация задач и выбор подходящей модели', () => {
  const codingPrompt = 'Напиши функцию на TypeScript для сортировки массива объектов по дате';
  const cRes = AutoRouter.classify(codingPrompt);
  assert.equal(cRes.category, 'coding');

  const mathPrompt = 'Посчитай интеграл от x^2 dx от 0 до 5';
  const mRes = AutoRouter.classify(mathPrompt);
  assert.equal(mRes.category, 'math');

  const reasoningPrompt = 'Сравни архитектуру микросервисов и монолита: плюсы, минусы и когда что выбирать';
  const rRes = AutoRouter.classify(reasoningPrompt);
  assert.equal(rRes.category, 'reasoning');

  const registry = new ModelRegistry();
  const ultraModels = registry.getForPlan('ultra');
  const chosenModel = AutoRouter.route(codingPrompt, ultraModels);
  assert.ok(chosenModel.capabilities.coding, 'выбранная модель должна уметь кодить');
});

test('ContextOptimizer: оценка токенов и скользящее окно истории', () => {
  const text = 'Hello world, this is a test prompt';
  const tokens = ContextOptimizer.estimateTokens(text);
  assert.ok(tokens > 0);

  const messages = [
    { role: 'user' as const, content: 'msg 1' },
    { role: 'assistant' as const, content: 'msg 2' },
    { role: 'user' as const, content: 'msg 3' },
    { role: 'assistant' as const, content: 'msg 4' },
    { role: 'user' as const, content: 'msg 5' },
  ];

  const optimized = ContextOptimizer.optimize(messages, {
    maxMessages: 3,
    systemPrompt: 'You are helpful AI',
  });

  assert.equal(optimized[0].role, 'system');
  assert.equal(optimized[0].content, 'You are helpful AI');
  // Должны остаться системный + 3 последних сообщения
  assert.equal(optimized.length, 4);
  assert.equal(optimized[1].content, 'msg 3');
  assert.equal(optimized[3].content, 'msg 5');
});

test('CostCalculator: корректный расчёт стоимости токенов', () => {
  const pricing = {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    cachedInputPricePerMillion: 1.25,
    effectiveFrom: new Date().toISOString(),
    effectiveTo: null,
  };

  // 1,000 входных токенов (из них 200 кэшированных) и 500 выходных токенов
  const result = CostCalculator.calculate(
    {
      inputTokens: 1000,
      cachedTokens: 200,
      outputTokens: 500,
    },
    pricing,
  );

  // 800 non-cached * 2.5 / 1M = 0.002
  // 200 cached * 1.25 / 1M = 0.00025
  // 500 output * 10 / 1M = 0.005
  // total = 0.00725
  assert.equal(result.inputCost, 0.002);
  assert.equal(result.cachedInputCost, 0.00025);
  assert.equal(result.outputCost, 0.005);
  assert.equal(result.totalCost, 0.00725);
});

test('EntitlementService & FairUseEngine: лимиты и защита от злоупотреблений', () => {
  const freeLimits = EntitlementService.getEntitlements('free');
  assert.equal(freeLimits.maxConcurrency, 1);
  assert.equal(freeLimits.requestsPerMinute, 5);

  const ultraLimits = EntitlementService.getEntitlements('ultra');
  assert.equal(ultraLimits.maxConcurrency, 8);

  // VIP email artemsinyakov09@gmail.com
  const vipPlan = EntitlementService.resolveEffectivePlan('free', 'artemsinyakov09@gmail.com');
  assert.equal(vipPlan, 'ultra');

  // FairUse: Concurrency Limit
  const busySnapshot: FairUseSnapshot = {
    userId: 'u1',
    requestsLastMinute: 1,
    requestsLastHour: 5,
    requestsLastDay: 10,
    tokensLastHour: 5000,
    tokensLastDay: 10000,
    estimatedCostLastDay: 0.01,
    estimatedCostLastMonth: 0.1,
    activeConcurrentRequests: 1, // для free лимит 1
  };

  const decision1 = FairUseEngine.evaluate(busySnapshot, 'free', 'ru');
  assert.equal(decision1.action, 'deny');
  if (decision1.action === 'deny') {
    assert.equal(decision1.code, 'concurrency_limit');
  }

  // FairUse: Rate Limit RPM
  const rpmSnapshot: FairUseSnapshot = {
    ...busySnapshot,
    activeConcurrentRequests: 0,
    requestsLastMinute: 10, // превышает 5 RPM
  };
  const decision2 = FairUseEngine.evaluate(rpmSnapshot, 'free', 'ru');
  assert.equal(decision2.action, 'throttle');

  // FairUse: Разрешённый запрос
  const normalSnapshot: FairUseSnapshot = {
    ...busySnapshot,
    activeConcurrentRequests: 0,
    requestsLastMinute: 1,
  };
  const decision3 = FairUseEngine.evaluate(normalSnapshot, 'free', 'ru');
  assert.equal(decision3.action, 'allow');
});
