import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutoRouter } from './auto-router.js';
import { ContextOptimizer } from './context.js';
import {
  ModelRegistry,
  ECONOMY_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  COMMON_BRAND_SYSTEM_LAYER,
  TIER_SYSTEM_MODIFIERS,
} from './model-registry.js';
import { CostCalculator } from '../services/cost.js';
import { EntitlementService } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
import type { FairUseSnapshot } from './gateway-types.js';
import { resolveAstraEngine, toOpenRouterModelId, classifyPromptComplexity } from './gateway.js';
import { SemanticCache } from './cache.js';
import { computeBaseTokensByCategory } from './tier-pipeline.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';
import { UsageStore } from '../store/usage-store.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { PayloadGuard } from './payload-guard.js';

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
  assert.ok(typeof plusGpt.promptModifier === 'object');
  assert.ok((plusGpt.promptModifier as Record<string, string>).ru.includes('150 токенов'));
  assert.ok((plusGpt.promptModifier as Record<string, string>).en.includes('150 tokens'));

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
  assert.ok(typeof proDouble.promptModifier === 'object');
  assert.ok((proDouble.promptModifier as Record<string, string>).ru.includes('Улучши этот ответ'));
  assert.ok((proDouble.promptModifier as Record<string, string>).en.includes('Improve this answer'));

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

test('OpenRouter routing: адаптивный выбор модели по сложности и поддержка Opus/Sol/Luna', () => {
  const registry = new ModelRegistry();
  const astraModel = registry.get('gpt-6-astra')!;
  const claudeModel = registry.get('claude-fable')!;

  // 1. Лёгкий вопрос -> DeepSeek Chat
  const lightAstra = toOpenRouterModelId(astraModel, 'Привет, как дела?');
  assert.equal(lightAstra, 'deepseek/deepseek-chat');

  // 2. Умеренный вопрос -> OpenAI GPT-6 Luna Pro
  const modAstra = toOpenRouterModelId(astraModel, 'Напиши короткий текст для рассылки клиентам');
  assert.equal(modAstra, 'openai/gpt-6-luna-pro');

  // 3. Сложный вопрос (код / глубокие рассуждения) -> OpenAI GPT-6 Sol Pro
  const hardAstra = toOpenRouterModelId(
    astraModel,
    'Напиши микросервис на TypeScript с реализацией алгоритма Дейкстры для поиска кратчайшего пути в графе',
  );
  assert.equal(hardAstra, 'openai/gpt-6-sol-pro');

  // 4. Claude Fable 5.5:
  // - лёгкий -> DeepSeek Chat
  const claudeLight = toOpenRouterModelId(claudeModel, 'Привет, как дела?');
  assert.equal(claudeLight, 'deepseek/deepseek-chat');

  // - средний -> Claude Haiku 4.5
  const claudeMod = toOpenRouterModelId(claudeModel, 'Напиши короткий слоган для продукта');
  assert.equal(claudeMod, 'anthropic/claude-haiku-4.5');

  // - сложный -> Claude Opus 5.5
  const claudeHard = toOpenRouterModelId(claudeModel, 'Архитектура микросервисов: паттерны саги и транзакций');
  assert.equal(claudeHard, 'anthropic/claude-opus-5.5');

  // 5. Gemini 3.8 Flash:
  const geminiModel = registry.get('gemini-2.5-pro')!;
  assert.equal(toOpenRouterModelId(geminiModel, 'Привет'), 'deepseek/deepseek-chat');
  assert.equal(toOpenRouterModelId(geminiModel, 'Напиши эссе по истории'), 'google/gemini-3.8-flash');

  // 6. Grok 4.7:
  const grokModel = registry.get('grok-4.7')!;
  assert.ok(grokModel);
  assert.equal(toOpenRouterModelId(grokModel, 'Привет'), 'deepseek/deepseek-chat');
  assert.equal(toOpenRouterModelId(grokModel, 'Напиши сложный парсер AST'), 'x-ai/grok-4.7');

  // 7. Проверка resolveAstraEngine
  assert.equal(resolveAstraEngine('Привет').level, 'simple');
  assert.equal(resolveAstraEngine('Код микросервиса').level, 'complex');

  // 8. Context cleanText: устранение лишних пробелов и пустых строк
  const dirty = '  Привет \r\n\r\n\r\n   мир   ';
  assert.equal(ContextOptimizer.cleanText(dirty), 'Привет\n\nмир');
});

test('Фаза 0 & 1: SemanticCache historyHash изоляция, userScope и фильтры', () => {
  const cache = new SemanticCache();

  // 1. Разные истории дают разный historyHash
  const historyA = [
    { role: 'user', content: 'Как написать быструю сортировку на Python?' },
    { role: 'assistant', content: 'Вот код quicksort...' },
  ];
  const historyB = [
    { role: 'user', content: 'Посоветуй книги по кулинарии' },
    { role: 'assistant', content: 'Вот топ 5 книг...' },
  ];
  const hashA = SemanticCache.computeHistoryHash(historyA, 3);
  const hashB = SemanticCache.computeHistoryHash(historyB, 3);
  assert.notEqual(hashA, hashB, 'Хэши разных историй должны отличаться');

  // 2. «Продолжи» в чате A не отдаёт кэш из чата B
  cache.set(
    'gpt-6-astra',
    'ru',
    'продолжи',
    'Продолжение кода сортировки: def partition()...',
    { inputTokens: 10, outputTokens: 50 },
    {
      userScope: 'user-1',
      historyHash: hashA,
      source: 'provider',
    },
  );

  const hitInChatB = cache.get('gpt-6-astra', 'ru', 'продолжи', 'user-1', hashB);
  assert.equal(hitInChatB, null, 'Кэш из чата A не должен попадать в чат B');

  const hitInChatA = cache.get('gpt-6-astra', 'ru', 'продолжи', 'user-1', hashA);
  assert.ok(hitInChatA, 'Кэш из чата A должен успешно находиться при том же хэше истории');
  assert.equal(hitInChatA?.response, 'Продолжение кода сортировки: def partition()...');

  // 3. Изоляция платных тарифов: пользовательский userScope
  const hitUser2 = cache.get('gpt-6-astra', 'ru', 'продолжи', 'user-2', hashA);
  assert.equal(hitUser2, null, 'Платный кэш другого пользователя изолирован');

  // 4. Фильтры кэширования:
  // Не кэшируем шаблонные ответы (source: template)
  cache.set(
    'gpt-6-astra',
    'ru',
    'что такое рекурсия',
    'Шаблонный ответ заглушка...',
    { inputTokens: 10, outputTokens: 20 },
    {
      userScope: 'shared',
      historyHash: 'none',
      source: 'template',
    },
  );
  assert.equal(cache.get('gpt-6-astra', 'ru', 'что такое рекурсия', 'shared', 'none'), null);

  // Не кэшируем обрезанные по длине ответы (finishReason: length)
  cache.set(
    'gpt-6-astra',
    'ru',
    'напиши длинную поэму',
    'Обрубленный текст...',
    { inputTokens: 10, outputTokens: 200 },
    {
      userScope: 'shared',
      historyHash: 'none',
      source: 'provider',
      finishReason: 'length',
    },
  );
  assert.equal(cache.get('gpt-6-astra', 'ru', 'напиши длинную поэму', 'shared', 'none'), null);

  // Не кэшируем запросы с вложениями
  cache.set(
    'gpt-6-astra',
    'ru',
    'проанализируй этот файл',
    'Анализ файла...',
    { inputTokens: 50, outputTokens: 100 },
    {
      userScope: 'shared',
      historyHash: 'none',
      source: 'provider',
      hasAttachments: true,
    },
  );
  assert.equal(cache.get('gpt-6-astra', 'ru', 'проанализируй этот файл', 'shared', 'none'), null);
});

test('Фаза 1: контекстно-зависимая сложность (classifyPromptComplexity с историей)', () => {
  // Обычное «да» без контекста -> simple
  const plainYes = classifyPromptComplexity('да');
  assert.equal(plainYes.level, 'simple');

  // «да» в контексте сложного технического диалога с кодом -> complex
  const yesInCodeThread = classifyPromptComplexity('да', {
    history: [
      { role: 'user', content: 'Как написать WebSocket сервер на TypeScript?' },
      {
        role: 'assistant',
        content: 'import { WebSocketServer } from "ws";\nconst wss = new WebSocketServer({ port: 8080 });\nwss.on("connection", (ws) => { ... });',
      },
    ],
  });
  assert.equal(yesInCodeThread.level, 'complex', '«да» в техническом диалоге не должно падать на simple');

  // Запрос с вложениями -> всегда complex
  const withAttachments = classifyPromptComplexity('Посмотри', {
    hasAttachments: true,
  });
  assert.equal(withAttachments.level, 'complex');
});

test('Фаза 2: ContextOptimizer — диалог из 30 сообщений, сводка и якорь', () => {
  // Генерируем историю из 30 сообщений
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let i = 1; i <= 30; i++) {
    messages.push({
      role: i % 2 === 1 ? 'user' : 'assistant',
      content: i === 1 ? 'Начало диалога: обсуждаем архитектуру финтех-сервиса' : `Сообщение номер ${i} с техническими деталями`,
    });
  }

  let capturedSummary: string | undefined;
  const optimized = ContextOptimizer.optimize(messages, {
    maxMessages: 20,
    systemPrompt: 'Ты Ketner AI',
    language: 'ru',
    onSummaryGenerated: (s) => {
      capturedSummary = s;
    },
  });

  // 1. Системный промпт
  assert.equal(optimized[0].role, 'system');
  assert.equal(optimized[0].content, 'Ты Ketner AI');

  // 2. Сводка старых сообщений присутствует
  assert.equal(optimized[1].role, 'system');
  assert.ok(optimized[1].content.includes('Краткий контекст беседы'));
  assert.ok(capturedSummary, 'onSummaryGenerated должен быть вызван');

  // 3. Первое сообщение (якорь темы) присутствует
  assert.equal(optimized[2].role, 'user');
  assert.ok(optimized[2].content.includes('Начало диалога: обсуждаем архитектуру'));

  // 4. Последнее сообщение совпадает с последним из истории
  assert.equal(optimized[optimized.length - 1].content, messages[messages.length - 1].content);

  // 5. Токенизация кириллицы: кириллица дает больше токенов на символ (~2.5 символа на токен vs 4 для латиницы)
  const cyrillicText = 'Привет мир! Это подробный текст на русском языке для токенизатора.'.repeat(5);
  const latinText = 'Hello world! This is a detailed prompt in English language for tokenizer.'.repeat(5);
  const cyrTokens = ContextOptimizer.estimateTokens(cyrillicText);
  const latTokens = ContextOptimizer.estimateTokens(latinText);
  assert.ok(cyrTokens > latTokens, 'Кириллический текст должен оцениваться с более плотным коэффициентом токенов');
});

test('Фаза 2: computeBaseTokensByCategory — базовые токены по классам задач', () => {
  assert.equal(computeBaseTokensByCategory('coding'), 2500);
  assert.equal(computeBaseTokensByCategory('reasoning'), 2500);
  assert.equal(computeBaseTokensByCategory('math'), 3000);
  assert.equal(computeBaseTokensByCategory('research'), 3000);
  assert.equal(computeBaseTokensByCategory('creative'), 1500);
  assert.equal(computeBaseTokensByCategory('translation'), 1500);
  assert.equal(computeBaseTokensByCategory('general'), 300);
});

test('Фаза 3: Anthropic prompt caching payload & headers', () => {
  const provider = new AnthropicProvider({ apiKey: 'test-anthropic-key' });

  // 1. Проверка заголовка prompt caching
  const headers = (provider as any).getHeaders();
  assert.equal(headers['anthropic-beta'], 'prompt-caching-2024-07-31');

  // 2. Системный промпт оборачивается в блок с cache_control: ephemeral
  const payloadWithSystem = (provider as any).buildPayload(
    {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Привет' }],
      systemPrompt: 'Ты Ketner AI',
    },
    false,
  );
  assert.ok(Array.isArray(payloadWithSystem.system), 'system должен быть массивом блоков');
  assert.deepEqual(payloadWithSystem.system[0].cache_control, { type: 'ephemeral' });

  // 3. Стабильная часть истории получает cache_control: ephemeral
  const payloadWithHistory = (provider as any).buildPayload(
    {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        { role: 'user', content: 'Шаг 1' },
        { role: 'assistant', content: 'Ответ 1' },
        { role: 'user', content: 'Шаг 2' },
      ],
      systemPrompt: 'Системный промпт',
    },
    false,
  );
  // Сообщение с индексом 1 (assistant 'Ответ 1' перед последним запросом) должно иметь cache_control
  const checkpoint = payloadWithHistory.messages[1];
  assert.ok(Array.isArray(checkpoint.content), 'Чекпоинт истории должен быть массивом контента');
  assert.deepEqual(checkpoint.content[0].cache_control, { type: 'ephemeral' });
});

test('Фаза 3: Системные промпты — общий слой бренда и однострочные модификаторы', () => {
  // 1. Общий слой бренда защищает имя Ketner AI и скрывает внешние бренды
  assert.ok(COMMON_BRAND_SYSTEM_LAYER.ru.includes('Ketner AI'));
  assert.ok(COMMON_BRAND_SYSTEM_LAYER.ru.includes('Никогда не упоминай, что ты создан OpenAI, Anthropic или Google'));
  assert.ok(COMMON_BRAND_SYSTEM_LAYER.en.includes('Never mention OpenAI, Anthropic, or Google'));

  // 2. Тарифные модификаторы лаконичны (одна строка)
  assert.ok(TIER_SYSTEM_MODIFIERS.economy.ru.includes('максимально кратко'));
  assert.ok(TIER_SYSTEM_MODIFIERS.default.ru.includes('глубокие, подробные'));

  // 3. Тарифные промпты скомпонованы без потерь
  assert.ok(ECONOMY_SYSTEM_PROMPT.ru.includes(COMMON_BRAND_SYSTEM_LAYER.ru));
  assert.ok(ECONOMY_SYSTEM_PROMPT.ru.includes(TIER_SYSTEM_MODIFIERS.economy.ru));
  assert.ok(DEFAULT_SYSTEM_PROMPT.ru.includes(COMMON_BRAND_SYSTEM_LAYER.ru));
  assert.ok(DEFAULT_SYSTEM_PROMPT.ru.includes(TIER_SYSTEM_MODIFIERS.default.ru));
});

test('Фаза 3: Персистентный SemanticCache переживает перезапуск инстанса', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ketner-cache-test-'));
  const cacheFile = join(tempDir, 'cache.json');

  // 1. Создаем первый экземпляр кэша и сохраняем запись
  const cache1 = new SemanticCache(5000, 24 * 60 * 60 * 1000, cacheFile);
  cache1.set(
    'gpt-6-astra',
    'ru',
    'тестовый запрос для диска',
    'ответ из дискового кэша',
    { inputTokens: 10, outputTokens: 20 },
    {
      userScope: 'user-persist',
      historyHash: 'hash-1',
      source: 'provider',
    },
  );

  // 2. Создаем второй экземпляр, имитируя перезапуск сервера
  const cache2 = new SemanticCache(5000, 24 * 60 * 60 * 1000, cacheFile);
  const restoredHit = cache2.get('gpt-6-astra', 'ru', 'тестовый запрос для диска', 'user-persist', 'hash-1');

  assert.ok(restoredHit, 'Запись должна восстановиться после перезапуска');
  assert.equal(restoredHit?.response, 'ответ из дискового кэша');

  // 3. Очистка удаляет и файл с диска
  cache2.clear();
  assert.equal(cache2.get('gpt-6-astra', 'ru', 'тестовый запрос для диска', 'user-persist', 'hash-1'), null);
});

test('Фаза 3: Пересчёт эмпирического costBudget по реальным данным usage-store', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ketner-usage-budget-'));
  const usageFile = join(tempDir, 'usage.json');
  const store = new UsageStore(usageFile);

  // Записываем несколько расходов для пользователей тарифа plus
  store.recordUsage({
    userId: 'user-plus-1',
    conversationId: 'c1',
    modelId: 'deepseek-v4.1-flash',
    provider: 'openrouter',
    inputTokens: 1000,
    outputTokens: 500,
    estimatedCost: 0.05,
    latencyMs: 120,
    status: 'success',
  });

  store.recordUsage({
    userId: 'user-plus-2',
    conversationId: 'c2',
    modelId: 'deepseek-v4.1-flash',
    provider: 'openrouter',
    inputTokens: 2000,
    outputTokens: 1000,
    estimatedCost: 0.15,
    latencyMs: 200,
    status: 'success',
  });

  const empirical = store.getEmpiricalPlanBudget([
    { userId: 'user-plus-1', plan: 'plus' },
    { userId: 'user-plus-2', plan: 'plus' },
  ]);

  assert.ok(empirical.plus);
  assert.equal(empirical.plus.userCount, 2);
  assert.ok(empirical.plus.avgMonthlyCost > 0);
  assert.ok(empirical.plus.recommendedCostBudget >= empirical.plus.avgMonthlyCost);

  // Проверяем динамическое обновление бюджета тарифа
  const initialBudget = EntitlementService.getEntitlements('plus').costBudget;
  EntitlementService.updatePlanCostBudget('plus', empirical.plus.recommendedCostBudget);
  assert.equal(EntitlementService.getEntitlements('plus').costBudget, empirical.plus.recommendedCostBudget);

  // Восстанавливаем исходный бюджет
  EntitlementService.updatePlanCostBudget('plus', initialBudget);
});

test('Фаза 4: UsageStore.getGatewayMetrics — полная аналитика, TTFT, источники и алерт отрицательной маржи', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ketner-metrics-test-'));
  const usageFile = join(tempDir, 'usage.json');
  const store = new UsageStore(usageFile);

  // 1. Записываем запросы из разных источников (provider, cache, template)
  // Провайдерный запрос
  store.recordUsage({
    userId: 'user-paid',
    conversationId: 'c1',
    modelId: 'gpt-6-astra',
    provider: 'openai',
    inputTokens: 1000,
    outputTokens: 500,
    estimatedCost: 0.05,
    latencyMs: 1200,
    ttftMs: 350,
    status: 'success',
    source: 'provider',
  });

  // Запрос из кэша (стоимость 0, быстрый TTFT)
  store.recordUsage({
    userId: 'user-paid',
    conversationId: 'c1',
    modelId: 'gpt-6-astra',
    provider: 'openai',
    inputTokens: 1000,
    outputTokens: 500,
    cachedTokens: 1000,
    estimatedCost: 0,
    latencyMs: 20,
    ttftMs: 5,
    status: 'success',
    source: 'cache',
  });

  // Шаблонный запрос
  store.recordUsage({
    userId: 'user-free',
    conversationId: 'c2',
    modelId: 'ketner-mini',
    provider: 'openrouter',
    inputTokens: 200,
    outputTokens: 100,
    estimatedCost: 0,
    latencyMs: 50,
    ttftMs: 15,
    status: 'success',
    source: 'template',
  });

  // Запрос пользователя с превышением маржи (расход $50 при выручке тарифа plus ~$10.4)
  store.recordUsage({
    userId: 'user-loss-maker',
    conversationId: 'c3',
    modelId: 'claude-3.5-sonnet',
    provider: 'anthropic',
    inputTokens: 100000,
    outputTokens: 50000,
    estimatedCost: 50.0,
    latencyMs: 2500,
    ttftMs: 600,
    status: 'success',
    source: 'provider',
  });

  const users = [
    { id: 'user-paid', email: 'paid@example.com', plan: 'pro' },
    { id: 'user-free', email: 'free@example.com', plan: 'free' },
    { id: 'user-loss-maker', email: 'loss@example.com', plan: 'plus' },
  ];

  const planPricesUsd = {
    free: 0,
    plus: 10.42,
    pro: 20.95,
    ultra: 31.47,
  };

  const metrics = store.getGatewayMetrics({
    users,
    planPricesUsd,
  });

  // Проверка общих счетчиков
  assert.equal(metrics.totalRequests, 4);
  assert.equal(metrics.totalCost, 50.05);

  // Проверка источников
  assert.equal(metrics.costBySource.provider.requests, 2);
  assert.equal(metrics.costBySource.provider.cost, 50.05);
  assert.equal(metrics.costBySource.cache.requests, 1);
  assert.equal(metrics.costBySource.cache.cost, 0);
  assert.equal(metrics.costBySource.template.requests, 1);

  // Cache hit rate: 1 из 4 = 25%
  assert.equal(metrics.cacheHits, 1);
  assert.equal(metrics.cacheHitRatePct, 25.0);

  // Проверка моделей
  assert.ok(metrics.costByModel.some((m) => m.modelId === 'claude-3.5-sonnet' && m.cost === 50));
  assert.ok(metrics.costByModel.some((m) => m.modelId === 'gpt-6-astra' && m.cost === 0.05));

  // Проверка тарифов
  assert.ok(metrics.costByPlan.some((p) => p.plan === 'plus' && p.totalCost === 50));
  assert.ok(metrics.costByPlan.some((p) => p.plan === 'pro' && p.totalCost === 0.05));

  // Проверка TTFT и задержек
  assert.ok(typeof metrics.latency.averageLatencyMs === 'number');
  assert.ok(typeof metrics.latency.averageTtftMs === 'number');
  assert.ok(metrics.latency.averageTtftMs! > 0);

  // Проверка алерта отрицательной маржинальности
  assert.equal(metrics.hasNegativeMarginAlert, true);
  assert.equal(metrics.alerts.length, 1);
  assert.equal(metrics.alerts[0].userId, 'user-loss-maker');
  assert.equal(metrics.alerts[0].plan, 'plus');
  assert.ok(metrics.alerts[0].contributionMargin < 0);
  assert.ok(metrics.alerts[0].message.includes('Отрицательная маржинальность'));
});

test('Фаза 5: CircuitBreaker — 3 сбоя открывают предохранитель, кулдаун переводит в half-open, успех сбрасывает', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 50 });

  // 1. Изначально закрыт (готов к работе)
  assert.equal(cb.isOpen('openai'), false);
  assert.equal(cb.getStatus('openai').state, 'closed');

  // 2. Первый и второй сбои не открывают предохранитель
  cb.recordFailure('openai', new Error('Net error 1'));
  assert.equal(cb.isOpen('openai'), false);
  cb.recordFailure('openai', new Error('Net error 2'));
  assert.equal(cb.isOpen('openai'), false);

  // 3. Третий сбой подряд открывает предохранитель (OPEN)
  cb.recordFailure('openai', new Error('Net error 3'));
  assert.equal(cb.isOpen('openai'), true);
  assert.equal(cb.getStatus('openai').state, 'open');

  // 4. По истечении кулдауна (50 мс) переходит в half-open
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(cb.isOpen('openai'), false); // Разрешает 1 пробный запрос
  assert.equal(cb.getStatus('openai').state, 'half-open');

  // 5. Успешный ответ восстанавливает статус closed
  cb.recordSuccess('openai');
  assert.equal(cb.isOpen('openai'), false);
  assert.equal(cb.getStatus('openai').state, 'closed');
  assert.equal(cb.getStatus('openai').consecutiveFailures, 0);

  // 6. Метод reset() очищает все провайдеры
  cb.recordFailure('anthropic', new Error('Err'));
  cb.reset();
  assert.equal(cb.getStatus('anthropic').consecutiveFailures, 0);
});

test('Фаза 5: PayloadGuard — защита от гигантских сообщений, суммарного payload и вложений', () => {
  // 1. Нормальные сообщения проходят валидацию
  const normalResult = PayloadGuard.validate([
    { role: 'user', content: 'Привет! Напиши простой код на TypeScript.' },
  ]);
  assert.equal(normalResult.valid, true);

  // 2. Слишком длинное отдельное сообщение (> maxMessageChars)
  const hugeMsgResult = PayloadGuard.validate(
    [{ role: 'user', content: 'A'.repeat(120_000) }],
    { limits: { maxMessageChars: 100_000 } },
  );
  assert.equal(hugeMsgResult.valid, false);
  assert.equal(hugeMsgResult.code, 'message_too_large');

  // 3. Суммарный контекст слишком велик (> maxTotalChars)
  const hugePayloadResult = PayloadGuard.validate(
    [
      { role: 'user', content: 'A'.repeat(60_000) },
      { role: 'assistant', content: 'B'.repeat(60_000) },
    ],
    { limits: { maxTotalChars: 100_000, maxMessageChars: 70_000 } },
  );
  assert.equal(hugePayloadResult.valid, false);
  assert.equal(hugePayloadResult.code, 'payload_too_large');

  // 4. Слишком много вложений (> maxAttachmentsCount)
  const tooManyAttachments = Array.from({ length: 12 }, (_, i) => ({
    id: `att-${i}`,
    name: `file-${i}.txt`,
    category: 'code' as const,
    size: 100,
  }));
  const attCountResult = PayloadGuard.validate(
    [{ role: 'user', content: 'Посмотри файлы' }],
    { attachments: tooManyAttachments, limits: { maxAttachmentsCount: 10 } },
  );
  assert.equal(attCountResult.valid, false);
  assert.equal(attCountResult.code, 'too_many_attachments');

  // 5. Вложение превышает лимит размера (> maxAttachmentBytes)
  const hugeAttachment = [
    {
      id: 'big-file',
      name: 'big.zip',
      category: 'code' as const,
      size: 25 * 1024 * 1024, // 25 MB
    },
  ];
  const attSizeResult = PayloadGuard.validate(
    [{ role: 'user', content: 'Вот архив' }],
    { attachments: hugeAttachment, limits: { maxAttachmentBytes: 20 * 1024 * 1024 } },
  );
  assert.equal(attSizeResult.valid, false);
  assert.equal(attSizeResult.code, 'attachment_too_large');
});
