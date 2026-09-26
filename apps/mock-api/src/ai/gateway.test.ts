import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoRouter } from './auto-router.js';
import { ContextOptimizer } from './context.js';
import { ModelRegistry, ECONOMY_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT } from './model-registry.js';
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
  assert.equal(registry.canAccess('plus', gpt), false); // Флагманы GPT/Claude только для Pro/Ultra
  assert.equal(registry.canAccess('gpt-pro', gpt), true);
  assert.equal(registry.canAccess('ultra', gpt), true);

  // Fallback chain
  const chain = registry.getFallbackChain('gpt-6-astra');
  assert.ok(chain.length >= 2);
  assert.equal(chain[0].id, 'gpt-6-astra');
  assert.equal(chain[1].id, 'ketner-mini');

  // Brand Protection & дифференциация промптов:
  // 1. Brand protection во всех промптах
  assert.ok(ECONOMY_SYSTEM_PROMPT.ru.includes('Ketner AI'));
  assert.ok(ECONOMY_SYSTEM_PROMPT.ru.includes('Никогда не упоминай, что ты создан OpenAI, Anthropic или Google'));
  assert.ok(DEFAULT_SYSTEM_PROMPT.ru.includes('Ketner AI'));
  assert.ok(DEFAULT_SYSTEM_PROMPT.ru.includes('Никогда не упоминай, что ты создан OpenAI, Anthropic или Google'));

  // 2. Дешёвые модели используют ECONOMY_SYSTEM_PROMPT
  assert.equal(def.defaultSystemPrompt, ECONOMY_SYSTEM_PROMPT);
  const nemotron = registry.get('nemotron-ultra')!;
  assert.equal(nemotron.defaultSystemPrompt, ECONOMY_SYSTEM_PROMPT);

  // 3. Флагманы используют DEFAULT_SYSTEM_PROMPT
  assert.equal(gpt.defaultSystemPrompt, DEFAULT_SYSTEM_PROMPT);
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

  // Score-based routing: для кода должна выбраться модель с coding capability
  const chosenModel = AutoRouter.route(codingPrompt, ultraModels);
  assert.ok(chosenModel.capabilities.coding, 'выбранная модель должна уметь кодить');

  // Score-based routing: результат содержит breakdown для каждой модели
  const result = AutoRouter.routeWithReason(codingPrompt, ultraModels, { userPlan: 'ultra' });
  assert.ok(result.scores, 'routeWithReason должен возвращать scores для дебага');
  assert.ok(result.scores!.length > 0, 'scores не должны быть пустыми');
  assert.ok(result.scores![0].score > result.scores![result.scores!.length - 1].score, 'scores отсортированы по убыванию');

  // Budget pressure: при исчерпании бюджета выбирается бесплатный Qwen 3.8 27B (ketner-mini)
  const budgetResult = AutoRouter.routeWithReason(codingPrompt, ultraModels, {
    userPlan: 'ultra',
    budgetExceeded: true,
    monthlyCost: 50,
    monthlyBudget: 40,
  });
  assert.equal(budgetResult.model.id, 'ketner-mini', 'при исчерпании бюджета должен выбираться Qwen 3.8 27B');
  assert.ok(!budgetResult.model.isPro, 'при исчерпании бюджета должна быть дешёвая модель');

  // Light queries: для легких запросов выбирается NVIDIA Nemotron 3 Ultra (Free)
  const lightResult = AutoRouter.routeWithReason('Привет, как дела?', ultraModels, {
    userPlan: 'ultra',
  });
  assert.equal(lightResult.model.id, 'nemotron-ultra', 'для легких запросов должен выбираться Nemotron 3 Ultra');

  // Проверка регистрации новых моделей (GLM 5.3 Flash, DeepSeek V4.1 Flash)
  const glm = registry.resolve('glm-5.3-flash');
  assert.equal(glm.id, 'glm-5.3-flash');
  assert.equal(glm.providerModelId, 'z-ai/glm-5.3-flash');

  const deepseek = registry.resolve('deepseek-v4.1-flash');
  assert.equal(deepseek.id, 'deepseek-v4.1-flash');
  assert.equal(deepseek.providerModelId, 'deepseek/deepseek-v4.1-flash');

  // Free tier: никогда не выбирает флагман
  const freeModels = registry.getForPlan('free');
  const freeResult = AutoRouter.route('Напиши код на Python', freeModels, { userPlan: 'free' });
  assert.equal(freeResult.isPro, false, 'Free пользователь не должен получать Pro модель');
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

test('TierPipelineEngine & Output Control: экономика токенов по тарифам', async () => {
  const { TierPipelineEngine, computeDynamicMaxTokens } = await import('./tier-pipeline.js');

  // 1. Dynamic output tokens formula
  // maxTokens = Math.floor(baseTokens * tierMultiplier * (1 - budgetPressure))
  const freeTokens = computeDynamicMaxTokens({ userPlan: 'free', monthlyCost: 0, monthlyBudget: 1 });
  assert.equal(freeTokens, Math.floor(300 * 0.7)); // 210

  const plusTokens = computeDynamicMaxTokens({ userPlan: 'plus', monthlyCost: 0, monthlyBudget: 6 });
  assert.equal(plusTokens, 300); // 300 * 1.0

  const proTokens = computeDynamicMaxTokens({ userPlan: 'pro', monthlyCost: 0, monthlyBudget: 15 });
  assert.equal(proTokens, 450); // 300 * 1.5

  const ultraTokens = computeDynamicMaxTokens({ userPlan: 'ultra', monthlyCost: 0, monthlyBudget: 40 });
  assert.equal(ultraTokens, 750); // 300 * 2.5

  // 2. Бюджетный триггер: при расходе > 80% лимита жесткий лимит 200 токенов
  const overBudgetTokens = computeDynamicMaxTokens({ userPlan: 'plus', monthlyCost: 5.5, monthlyBudget: 6 });
  assert.equal(overBudgetTokens, 200);

  // 3. FREE стратегия: 100% дешёвые модели, max 200 токенов
  const freeStrat = TierPipelineEngine.resolveStrategy('Привет', { userPlan: 'free' });
  assert.equal(freeStrat.tier, 'free');
  assert.equal(freeStrat.maxOutputTokens, 200);
  assert.ok(freeStrat.targetModelId === 'nemotron-ultra' || freeStrat.targetModelId === 'deepseek-v4.1-flash');

  // 4. PLUS стратегия:
  // 5% burst GPT
  const plusGpt = TierPipelineEngine.resolveStrategy('Привет', {
    userPlan: 'plus',
    random: () => 0.02, // < 0.05 -> GPT burst
  });
  assert.equal(plusGpt.mode, 'gpt_short');
  assert.equal(plusGpt.maxOutputTokens, 150);
  assert.equal(plusGpt.targetModelId, 'gpt-6-astra');

  // 15% cheap improve (double pass)
  const plusDouble = TierPipelineEngine.resolveStrategy('Привет', {
    userPlan: 'plus',
    random: () => 0.10, // 0.05..0.20 -> cheap improve
  });
  assert.equal(plusDouble.mode, 'cheap_improve');
  assert.equal(plusDouble.targetModelId, 'deepseek-v4.1-flash');

  // 80% cheap direct
  const plusDirect = TierPipelineEngine.resolveStrategy('Привет', {
    userPlan: 'plus',
    random: () => 0.50, // >= 0.20 -> cheap direct
  });
  assert.equal(plusDirect.mode, 'cheap_direct');

  // 5. PRO стратегия:
  // 50% GPT improve (double pass)
  const proDouble = TierPipelineEngine.resolveStrategy('Привет', {
    userPlan: 'pro',
    random: () => 0.25, // < 0.50 -> gpt_improve
  });
  assert.equal(proDouble.mode, 'gpt_improve');
  assert.equal(proDouble.targetModelId, 'gpt-6-astra');

  // 30% direct GPT
  const proDirect = TierPipelineEngine.resolveStrategy('Привет', {
    userPlan: 'pro',
    random: () => 0.65, // 0.50..0.80 -> gpt_full
  });
  assert.equal(proDirect.mode, 'gpt_full');
  assert.equal(proDirect.targetModelId, 'gpt-6-astra');

  // 6. ULTRA стратегия: прямой флагман (max 800)
  const ultraStrat = TierPipelineEngine.resolveStrategy('Привет', { userPlan: 'ultra' });
  assert.equal(ultraStrat.tier, 'ultra');
  assert.equal(ultraStrat.mode, 'gpt_full');
  assert.ok(ultraStrat.maxOutputTokens <= 800);

  // 7. Context post-process compression
  const longText = 'A '.repeat(500); // 1000 chars = 250 tokens
  const compressed = ContextOptimizer.compressText(longText, 50); // max 50 tokens = 200 chars
  assert.ok(compressed.length <= 200);
});
