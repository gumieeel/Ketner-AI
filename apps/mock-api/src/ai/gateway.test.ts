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
import { EntitlementService, planAllowsModel } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
import type { FairUseSnapshot } from './gateway-types.js';
import { applyEconomyRules, classifyPromptComplexity } from './gateway.js';
import { SemanticCache } from './cache.js';
import { chooseReasoningEffort, computeOutputCap, toProviderReasoning } from './reasoning-policy.js';
import { OpenRouterProvider, MAX_COMPLETION_TOKENS, prepareMessages } from './providers/openrouter-provider.js';
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

  const sol = registry.get('gpt-6.1-sol');
  assert.ok(sol);
  assert.equal(sol.provider, 'openrouter');
  assert.equal(sol.isPro, true);
  assert.equal(sol.costClass, 'strong');
  const opus = registry.get('claude-opus-5.5')!;
  assert.equal(opus.costClass, 'top');

  // Проверка доступа: единое правило по рангу тарифа
  assert.equal(registry.canAccess('free', def), true);
  assert.equal(registry.canAccess('free', sol), false);
  assert.equal(registry.canAccess('plus', sol), true);
  assert.equal(registry.canAccess('plus', opus), false);
  assert.equal(registry.canAccess('gpt-pro', opus), true, 'старый тариф gpt-pro равен Pro');
  assert.equal(registry.canAccess('ultra', opus), true);

  // Fallback chain: каждая модель встречается один раз, цепочка заканчивается самой дешёвой
  const chain = registry.getFallbackChain('gpt-6.1-sol');
  assert.deepEqual(
    chain.map((m) => m.id),
    ['gpt-6.1-sol', 'ketner-pro', 'ketner-mini', 'claude-haiku-5.5', 'deepseek-v4.1-flash'],
  );
  for (const entry of registry.getAll()) {
    const ids = registry.getFallbackChain(entry.id, 10).map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, `${entry.id}: в цепочке нет повторов`);
  }

  // Старые идентификаторы из сохранённых диалогов и истории расхода ведут на актуальные модели
  assert.equal(registry.get('gpt-6.1-sol')?.id, 'gpt-6.1-sol');
  assert.equal(registry.get('claude-fable')?.id, 'claude-opus-5.5');
  assert.equal(registry.get('gemini-pro')?.id, 'gemini-3.8-flash');
  assert.equal(registry.get('nemotron-ultra')?.id, 'nemotron-ultra');
  assert.equal(registry.get('nemotron')?.id, 'nemotron-ultra');
  const premiumIds = registry.getPremiumModelIds();
  assert.ok(premiumIds.has('gpt-6.1-sol') && premiumIds.has('gpt-6.1-sol') && premiumIds.has('claude-fable'));
  assert.ok(!premiumIds.has('ketner-pro') && !premiumIds.has('ketner-mini'));

  // Brand Protection & дифференциация промптов:
  // 1. Brand protection во всех промптах
  assert.ok(ECONOMY_SYSTEM_PROMPT.ru.includes('Ketner AI'));
  assert.ok(ECONOMY_SYSTEM_PROMPT.ru.includes('Никогда не упоминай, что ты создан OpenAI, Anthropic или Google'));
  assert.ok(DEFAULT_SYSTEM_PROMPT.ru.includes('Ketner AI'));
  assert.ok(DEFAULT_SYSTEM_PROMPT.ru.includes('Никогда не упоминай, что ты создан OpenAI, Anthropic или Google'));

  // 2. Дешёвые модели используют ECONOMY_SYSTEM_PROMPT
  assert.equal(def.defaultSystemPrompt, ECONOMY_SYSTEM_PROMPT);

  // 3. Флагманы используют DEFAULT_SYSTEM_PROMPT
  assert.equal(sol.defaultSystemPrompt, DEFAULT_SYSTEM_PROMPT);
});

test('AutoRouter: классификация задач', () => {
  const codingPrompt = 'Напиши функцию на TypeScript для сортировки массива объектов по дате';
  assert.equal(AutoRouter.classify(codingPrompt).category, 'coding');

  const mathPrompt = 'Посчитай интеграл от x^2 dx от 0 до 5';
  assert.equal(AutoRouter.classify(mathPrompt).category, 'math');

  const reasoningPrompt = 'Сравни архитектуру микросервисов и монолита: плюсы, минусы и когда что выбирать';
  assert.equal(AutoRouter.classify(reasoningPrompt).category, 'reasoning');

  const registry = new ModelRegistry();
  assert.equal(registry.resolve('deepseek-v4.1-flash').providerModelId, 'deepseek/deepseek-v4.1-flash');
});

test('AutoRouter.route: детерминированный выбор модели по тарифу, сложности и квотам', () => {
  const registry = new ModelRegistry();
  const base = { stage: 'normal' as const, premiumAvailable: true };

  // Free: всегда самая дешёвая модель
  for (const level of ['simple', 'moderate', 'complex'] as const) {
    assert.equal(AutoRouter.route({ ...base, plan: 'free', level, category: 'coding' }).modelId, 'ketner-mini');
  }

  // Plus: простое — дешёвая модель, остальное — рабочая; премиум Auto не тратит
  assert.equal(AutoRouter.route({ ...base, plan: 'plus', level: 'simple', category: 'general' }).modelId, 'ketner-mini');
  assert.equal(AutoRouter.route({ ...base, plan: 'plus', level: 'moderate', category: 'general' }).modelId, 'ketner-pro');
  assert.equal(AutoRouter.route({ ...base, plan: 'plus', level: 'complex', category: 'math' }).modelId, 'ketner-pro');

  // Pro и Ultra: тяжёлая математика, логика и код идут на сильную модель, пока есть квота
  for (const plan of ['pro', 'ultra', 'gpt-pro', 'claude-pro']) {
    for (const category of ['math', 'reasoning', 'coding']) {
      assert.equal(AutoRouter.route({ ...base, plan, level: 'complex', category }).modelId, 'gpt-6.1-sol', `${plan}/${category}`);
    }
    assert.equal(AutoRouter.route({ ...base, plan, level: 'complex', category: 'creative' }).modelId, 'ketner-pro');
    assert.equal(
      AutoRouter.route({ ...base, plan, level: 'complex', category: 'math', premiumAvailable: false }).modelId,
      'ketner-pro',
      'квота премиум-запросов исчерпана — рабочая модель',
    );
  }

  // Бюджет на исходе: премиум не берётся, исчерпан — только самая дешёвая
  assert.equal(
    AutoRouter.route({ ...base, plan: 'ultra', level: 'complex', category: 'math', stage: 'soft' }).modelId,
    'ketner-pro',
  );
  for (const stage of ['exhausted', 'hard_stop'] as const) {
    assert.equal(AutoRouter.route({ ...base, plan: 'ultra', level: 'complex', category: 'math', stage }).modelId, 'ketner-mini');
  }

  // Результат всегда доступен по тарифу, а класс top (Opus) Auto не выбирает никогда
  for (const plan of ['free', 'plus', 'pro', 'ultra', 'gpt-pro', 'claude-pro', 'gemini-pro']) {
    for (const level of ['simple', 'moderate', 'complex'] as const) {
      for (const category of ['general', 'coding', 'math', 'reasoning', 'creative']) {
        for (const stage of ['normal', 'soft', 'exhausted'] as const) {
          for (const premiumAvailable of [true, false]) {
            const { modelId } = AutoRouter.route({ plan, level, category, stage, premiumAvailable });
            const model = registry.get(modelId)!;
            assert.ok(planAllowsModel(plan, model.requiredPlan), `${plan} не имеет доступа к ${modelId}`);
            assert.notEqual(model.costClass, 'top');
          }
        }
      }
    }
  }
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

  // VIP email из VIP_EMAILS тестового окружения
  const vipPlan = EntitlementService.resolveEffectivePlan('free', 'test-vip@example.com');
  assert.equal(vipPlan, 'ultra');

  // FairUse: Concurrency Limit
  const busySnapshot: FairUseSnapshot = {
    userId: 'u1',
    requestsLastMinute: 1,
    requestsLastHour: 5,
    requestsLastDay: 6,
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

  // FairUse: суточный лимит сообщений Free (10) и суточная квота токенов
  const dayLimit = FairUseEngine.evaluate({ ...normalSnapshot, requestsLastDay: 10 }, 'free', 'ru');
  assert.equal(dayLimit.action, 'deny');
  const dayTokens = FairUseEngine.evaluate({ ...normalSnapshot, tokensLastDay: 150_000 }, 'free', 'ru');
  assert.equal(dayTokens.action, 'deny');
  if (dayTokens.action === 'deny') {
    assert.equal(dayTokens.code, 'rate_limited');
  }
});

test('Политика размышлений: глубина зависит от сложности, тарифа, бюджета и возможностей модели', () => {
  const effort = (over: Partial<Parameters<typeof chooseReasoningEffort>[0]> = {}) =>
    chooseReasoningEffort({
      level: 'moderate',
      category: 'general',
      plan: 'pro',
      stage: 'normal',
      costClass: 'work',
      ...over,
    });

  assert.equal(effort({ level: 'simple' }), 'none');
  assert.equal(effort({ level: 'moderate' }), 'low');
  assert.equal(effort({ level: 'complex' }), 'medium');

  // high — только когда глубина окупается: математика на премиум-модели у Pro и выше
  assert.equal(effort({ level: 'complex', category: 'math', costClass: 'strong' }), 'high');
  assert.equal(effort({ level: 'complex', category: 'math', costClass: 'strong', plan: 'plus' }), 'medium');
  assert.equal(effort({ level: 'complex', category: 'math', costClass: 'work' }), 'medium');
  assert.equal(effort({ level: 'complex', category: 'coding', costClass: 'strong' }), 'medium', 'код и так на сильной модели');
  assert.equal(effort({ level: 'complex', category: 'reasoning', costClass: 'strong' }), 'medium', '«объясни/почему» — не повод для high');
  assert.equal(effort({ level: 'complex', category: 'general', costClass: 'top', plan: 'ultra' }), 'high');
  assert.equal(effort({ level: 'complex', category: 'general', costClass: 'top', plan: 'pro' }), 'medium');

  // Бюджет на исходе: не глубже low
  assert.equal(effort({ level: 'complex', category: 'math', costClass: 'top', plan: 'ultra', stage: 'soft' }), 'low');
  assert.equal(effort({ level: 'complex', stage: 'exhausted' }), 'low');
  assert.equal(effort({ level: 'simple', stage: 'exhausted' }), 'none');

  // Эскалация по дизлайкам: только простые и обычные запросы и не премиум-модели
  assert.equal(effort({ level: 'simple', escalate: true }), 'low');
  assert.equal(effort({ level: 'moderate', escalate: true }), 'medium');
  assert.equal(effort({ level: 'complex', escalate: true }), 'medium');
  assert.equal(effort({ level: 'simple', costClass: 'strong', escalate: true }), 'none');

  // Приведение к тому, что модель реально принимает
  const registry = new ModelRegistry();
  const luna = registry.get('ketner-mini')!;
  const sol = registry.get('gpt-6.1-sol')!;
  const mimo = registry.get('ketner-pro')!;
  assert.deepEqual(toProviderReasoning(luna.reasoning, 'none'), { effort: 'none' });
  assert.deepEqual(toProviderReasoning(sol.reasoning, 'none'), { effort: 'low' }, 'у Sol размышления нельзя отключить');
  assert.deepEqual(toProviderReasoning(sol.reasoning, 'high'), { effort: 'high' });
  assert.deepEqual(toProviderReasoning(mimo.reasoning, 'none'), { enabled: false });
  assert.deepEqual(toProviderReasoning(mimo.reasoning, 'medium'), { enabled: true });
  assert.equal(toProviderReasoning({ mandatory: false, efforts: [] }, 'low'), undefined, 'управлять нечем — параметр не передаётся');
  for (const entry of registry.getAll().filter((m) => m.id !== 'auto')) {
    for (const wanted of ['none', 'low', 'medium', 'high'] as const) {
      const value = toProviderReasoning(entry.reasoning, wanted);
      if (value && 'effort' in value) {
        assert.ok(entry.reasoning.efforts.includes(value.effort), `${entry.id}: ${value.effort} не поддерживается`);
        if (entry.reasoning.mandatory) assert.notEqual(value.effort, 'none');
      }
    }
  }
});

test('Потолок ответа: тариф, модель, бюджет и простота запроса', () => {
  const cap = (over: Partial<Parameters<typeof computeOutputCap>[0]> = {}) =>
    computeOutputCap({
      planMaxTokens: 12288,
      modelMaxOutputTokens: 16384,
      stage: 'normal',
      level: 'moderate',
      heavyContext: false,
      ...over,
    });

  assert.equal(cap(), 12288);
  assert.equal(cap({ modelMaxOutputTokens: 8192 }), 8192);
  assert.equal(cap({ stage: 'soft' }), 4096);
  assert.equal(cap({ stage: 'exhausted' }), 2048);
  assert.equal(cap({ level: 'simple' }), 2048);
  assert.equal(cap({ level: 'simple', heavyContext: true }), 12288, 'с проектом или файлами ответ может быть большим');
  assert.equal(cap({ planMaxTokens: 512 }), 1024, 'ниже минимума ответ с размышлениями обрывается');
});

test('Правила экономии: премиум-модель заменяется рабочей, когда квота или бюджет на исходе', () => {
  const registry = new ModelRegistry();
  const sol = registry.get('gpt-6.1-sol')!;
  const opus = registry.get('claude-opus-5.5')!;
  const haiku = registry.get('claude-haiku-5.5')!;
  const mimo = registry.get('ketner-pro')!;

  const keep = applyEconomyRules(opus, { stage: 'normal', premiumAvailable: true }, registry);
  assert.equal(keep.model.id, 'claude-opus-5.5');
  assert.equal(keep.reason, null);

  const noQuota = applyEconomyRules(sol, { stage: 'normal', premiumAvailable: false }, registry);
  assert.equal(noQuota.model.id, 'ketner-pro');
  assert.ok(noQuota.reason?.includes('Premium quota'));

  assert.equal(applyEconomyRules(opus, { stage: 'soft', premiumAvailable: true }, registry).model.id, 'ketner-pro');
  assert.equal(applyEconomyRules(mimo, { stage: 'soft', premiumAvailable: false }, registry).model.id, 'ketner-pro');

  // Бюджет исчерпан: всё, кроме лёгких моделей, заменяется на самую дешёвую
  assert.equal(applyEconomyRules(mimo, { stage: 'exhausted', premiumAvailable: true }, registry).model.id, 'ketner-mini');
  assert.equal(applyEconomyRules(opus, { stage: 'hard_stop', premiumAvailable: true }, registry).model.id, 'ketner-mini');
  assert.equal(applyEconomyRules(haiku, { stage: 'exhausted', premiumAvailable: true }, registry).model.id, 'claude-haiku-5.5');
});

test('Реестр: каждая модель уходит в OpenRouter под своим id, без скрытых подмен', () => {
  const registry = new ModelRegistry();
  const expected: Record<string, string> = {
    'ketner-mini': 'openai/gpt-6-luna',
    'claude-haiku-5.5': 'anthropic/claude-haiku-5.5',
    'deepseek-v4.1-flash': 'deepseek/deepseek-v4.1-flash',
    'ketner-pro': 'xiaomi/mimo-v2.6-pro',
    'gpt-6.1-sol': 'openai/gpt-6.1-sol',
    'claude-opus-5.5': 'anthropic/claude-opus-5.5',
    'grok-4.7': 'x-ai/grok-4.7',
    'gemini-3.8-flash': 'google/gemini-3.8-flash',
  };
  for (const [id, engine] of Object.entries(expected)) {
    const entry = registry.get(id)!;
    assert.equal(entry.provider, 'openrouter', id);
    assert.equal(entry.providerModelId, engine, id);
  }

  // Context cleanText: устранение лишних пробелов и пустых строк
  const dirty = '  Привет \r\n\r\n\r\n   мир   ';
  assert.equal(ContextOptimizer.cleanText(dirty), 'Привет\n\nмир');

  // Context post-process compression
  const longText = 'A '.repeat(500); // 1000 chars = 250 tokens
  const compressed = ContextOptimizer.compressText(longText, 50); // max 50 tokens = 200 chars
  assert.ok(compressed.length <= 200);
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
    'gpt-6.1-sol',
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

  const hitInChatB = cache.get('gpt-6.1-sol', 'ru', 'продолжи', 'user-1', hashB);
  assert.equal(hitInChatB, null, 'Кэш из чата A не должен попадать в чат B');

  const hitInChatA = cache.get('gpt-6.1-sol', 'ru', 'продолжи', 'user-1', hashA);
  assert.ok(hitInChatA, 'Кэш из чата A должен успешно находиться при том же хэше истории');
  assert.equal(hitInChatA?.response, 'Продолжение кода сортировки: def partition()...');

  // 3. Изоляция платных тарифов: пользовательский userScope
  const hitUser2 = cache.get('gpt-6.1-sol', 'ru', 'продолжи', 'user-2', hashA);
  assert.equal(hitUser2, null, 'Платный кэш другого пользователя изолирован');

  // 4. Фильтры кэширования:
  // Не кэшируем шаблонные ответы (source: template)
  cache.set(
    'gpt-6.1-sol',
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
  assert.equal(cache.get('gpt-6.1-sol', 'ru', 'что такое рекурсия', 'shared', 'none'), null);

  // Не кэшируем обрезанные по длине ответы (finishReason: length)
  cache.set(
    'gpt-6.1-sol',
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
  assert.equal(cache.get('gpt-6.1-sol', 'ru', 'напиши длинную поэму', 'shared', 'none'), null);

  // Не кэшируем запросы с вложениями
  cache.set(
    'gpt-6.1-sol',
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
  assert.equal(cache.get('gpt-6.1-sol', 'ru', 'проанализируй этот файл', 'shared', 'none'), null);
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

test('Фаза 3: OpenRouter payload — кэш промпта Anthropic, размышления, потолок токенов', () => {
  // 1. Для Anthropic системный промпт и стабильная часть истории получают cache_control
  const history = [
    { role: 'system' as const, content: 'Ты Ketner AI' },
    { role: 'user' as const, content: 'Шаг 1' },
    { role: 'assistant' as const, content: 'Ответ 1' },
    { role: 'user' as const, content: 'Шаг 2' },
  ];
  const wire = prepareMessages('anthropic/claude-opus-5.5', history);
  assert.ok(Array.isArray(wire[0].content), 'системный промпт — массив блоков');
  assert.deepEqual((wire[0].content as Array<{ cache_control?: unknown }>)[0].cache_control, { type: 'ephemeral' });
  // «Ответ 1» стоит перед последним вопросом — это граница кэша
  assert.ok(Array.isArray(wire[2].content), 'чекпоинт истории — массив блоков');
  assert.deepEqual((wire[2].content as Array<{ cache_control?: unknown }>)[0].cache_control, { type: 'ephemeral' });
  assert.equal(wire[1].content, 'Шаг 1');
  assert.equal(wire[3].content, 'Шаг 2');

  // 2. Остальные модели кэшируют сами: сообщения уходят как есть
  for (const model of ['openai/gpt-6.1-sol', 'x-ai/grok-4.7', 'google/gemini-3.8-flash', 'deepseek/deepseek-v4.1-flash']) {
    assert.deepEqual(prepareMessages(model, history), history, model);
  }

  // 3. Тело запроса: ровно та модель, что передали, размышления и usage с ценой
  const provider = new OpenRouterProvider({ apiKey: 'test-openrouter-key' });
  const body = provider.buildBody(
    { model: 'openai/gpt-6.1-sol', messages: history, stream: true, maxTokens: 12288, reasoning: { effort: 'low' } },
    true,
  );
  assert.equal(body.model, 'openai/gpt-6.1-sol');
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.deepEqual(body.usage, { include: true });
  assert.equal(body.max_tokens, 12288);
  assert.equal('models' in body, false, 'запасные модели OpenRouter не подставляются скрытно');

  // 4. Без reasoning параметр не отправляется; потолок токенов ограничен
  const plain = provider.buildBody({ model: 'x-ai/grok-4.7', messages: history, stream: false, maxTokens: 999_999 }, false);
  assert.equal('reasoning' in plain, false);
  assert.equal(plain.max_tokens, MAX_COMPLETION_TOKENS);
  assert.ok(MAX_COMPLETION_TOKENS >= 16384, 'потолок вмещает ответ Ultra вместе с размышлениями');
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
    'gpt-6.1-sol',
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
  const restoredHit = cache2.get('gpt-6.1-sol', 'ru', 'тестовый запрос для диска', 'user-persist', 'hash-1');

  assert.ok(restoredHit, 'Запись должна восстановиться после перезапуска');
  assert.equal(restoredHit?.response, 'ответ из дискового кэша');

  // 3. Очистка удаляет и файл с диска
  cache2.clear();
  assert.equal(cache2.get('gpt-6.1-sol', 'ru', 'тестовый запрос для диска', 'user-persist', 'hash-1'), null);
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
    modelId: 'gpt-6.1-sol',
    provider: 'openrouter',
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
    modelId: 'gpt-6.1-sol',
    provider: 'openrouter',
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
    modelId: 'claude-opus-5.5',
    provider: 'openrouter',
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
  assert.ok(metrics.costByModel.some((m) => m.modelId === 'claude-opus-5.5' && m.cost === 50));
  assert.ok(metrics.costByModel.some((m) => m.modelId === 'gpt-6.1-sol' && m.cost === 0.05));

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
    type: 'text/plain',
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
      type: 'application/zip',
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
