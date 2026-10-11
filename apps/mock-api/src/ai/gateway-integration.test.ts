import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AIGateway } from './gateway.js';
import { ProviderManager } from './providers/provider-factory.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ModelRegistry } from './model-registry.js';
import { OpenRouterError } from './providers/openrouter-provider.js';
import { SemanticCache } from './cache.js';
import { UsageStore } from '../store/usage-store.js';
import { PLAN_ENTITLEMENTS } from '../services/entitlement.js';
import type {
  AIProvider,
  GatewayRequest,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from './gateway-types.js';
import type { PlanId } from '../types.js';

const aiConfig = { thinkingMs: [0, 0], chunkMs: [0, 0], failureRate: 0, random: () => 0.5 } as const;

interface Call {
  model: string;
  messages: ProviderRequestOptions['messages'];
  maxTokens?: number;
  reasoning?: ProviderRequestOptions['reasoning'];
}

/** Управляемый поддельный OpenRouter: сценарий задаётся функцией. */
function fakeOpenRouter(
  script: (options: ProviderRequestOptions, cb: ProviderStreamCallbacks) => Promise<ProviderResponse>,
  calls: Call[],
): AIProvider {
  return {
    type: 'openrouter',
    name: 'FakeOpenRouter',
    isAvailable: () => true,
    async generateText(options) {
      calls.push({ model: options.model, messages: options.messages });
      return { content: 'draft text for the user', usage: { inputTokens: 10, outputTokens: 10 }, finishReason: 'stop' };
    },
    async streamText(options, cb) {
      calls.push({
        model: options.model,
        messages: options.messages,
        maxTokens: options.maxTokens,
        reasoning: options.reasoning,
      });
      return script(options, cb);
    },
  } as AIProvider;
}

function makeGateway(provider: AIProvider, usage: UsageStore): AIGateway {
  const providers = new ProviderManager();
  providers.setProvider('openrouter', provider);
  return new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: usage,
    aiConfig,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    useMockEngine: false,
  });
}

/** Бюджет Plus берётся из тарифа, а не зашит числом: пересчёт цен не должен ломать тесты. */
const PLUS_BUDGET = PLAN_ENTITLEMENTS.plus.costBudget;

function newUsage(): UsageStore {
  return new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-gw-')), 'usage.json'));
}

/** Расход «за прошлые дни»: в месячный бюджет входит, а в суточную квоту — нет. */
function seedMonthlyCost(usage: UsageStore, userId: string, cost: number, modelId = 'ketner-pro'): void {
  const record = usage.recordUsage({
    userId,
    conversationId: 'seed',
    modelId,
    provider: 'openrouter',
    inputTokens: 1,
    outputTokens: 1,
    estimatedCost: cost,
    latencyMs: 1,
    status: 'success',
  });
  record.createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
}

function request(overrides: Partial<GatewayRequest> & { userId: string; userPlan: PlanId }): GatewayRequest {
  return {
    conversationId: `c-${Math.random()}`,
    modelId: 'auto',
    messages: [{ role: 'user', content: `Объясни кратко, чем отличается TCP от UDP ${Math.random()}` }],
    language: 'ru',
    stream: true,
    ...overrides,
  };
}

interface Outcome {
  text: string;
  error?: { code: string; message: string };
  done?: Parameters<Parameters<AIGateway['stream']>[1]['onDone']>[0];
}

function assertNoError(outcome: Outcome): void {
  assert.ok(!outcome.error, outcome.error ? `${outcome.error.code}: ${outcome.error.message}` : '');
}

async function run(gateway: AIGateway, req: GatewayRequest): Promise<Outcome> {
  const outcome: Outcome = { text: '' };
  await gateway.stream(
    req,
    {
      onDelta: (d) => {
        outcome.text += d;
      },
      onDone: (r) => {
        outcome.done = r;
      },
      onError: (e) => {
        outcome.error = e;
      },
    },
    () => false,
  );
  return outcome;
}

const okStream = (text: string, extra: Partial<ProviderResponse> = {}) =>
  async (_o: ProviderRequestOptions, cb: ProviderStreamCallbacks): Promise<ProviderResponse> => {
    cb.onDelta(text);
    return { content: text, usage: { inputTokens: 1000, outputTokens: 200 }, finishReason: 'stop', ...extra };
  };

test('в учёт попадает реальная стоимость от провайдера, а не нулевая цена «бесплатной» модели', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ', { cost: 0.0123 }), calls), usage);

  const out = await run(gateway, request({ userId: 'u-cost', userPlan: 'free', modelId: 'ketner-mini' }));
  assert.equal(out.error, undefined);
  assert.equal(usage.getFairUseSnapshot('u-cost').estimatedCostLastDay, 0.0123);
});

test('без цены от провайдера расход считается по таблице реестра, а не нулём', async () => {
  const usage = newUsage();
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ'), []), usage);

  const out = await run(gateway, request({ userId: 'u-table', userPlan: 'plus', modelId: 'ketner-mini' }));
  assertNoError(out);
  // Luna: 1000 вх. × $0.10/M + 200 исх. × $0.50/M = $0.0002
  assert.equal(usage.getFairUseSnapshot('u-table').estimatedCostLastDay, 0.0002);
});

test('жёсткий потолок: при расходе ≥125% бюджета запрос отклоняется до обращения к провайдеру', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('не должно прийти'), calls), usage);
  seedMonthlyCost(usage, 'u-hard', PLUS_BUDGET * 1.27); // 127% бюджета Plus

  const out = await run(gateway, request({ userId: 'u-hard', userPlan: 'plus' }));
  assert.equal(out.error?.code, 'fair_use_exceeded');
  assert.equal(calls.length, 0, 'провайдер вызываться не должен');
});

test('бюджет исчерпан (100–125%): явный выбор сильной модели понижается до самой дешёвой', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);
  seedMonthlyCost(usage, 'u-ex', PLUS_BUDGET * 1.05); // 105% бюджета Plus

  const out = await run(gateway, request({ userId: 'u-ex', userPlan: 'plus', modelId: 'gpt-6.1-sol' }));
  assertNoError(out);
  assert.match(out.done?.routingReason ?? '', /Budget protection/);
  assert.equal(out.done?.selectedModel?.id, 'ketner-mini', 'пользователь видит, какая модель ответила');
  assert.deepEqual(calls.map((c) => c.model), ['openai/gpt-6-luna']);
  assert.ok((calls[0].maxTokens ?? 0) <= 2048, 'при исчерпанном бюджете ответ короткий');
});

test('бюджет на исходе (80–100%): сильная модель заменяется рабочей, рабочая остаётся', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);
  seedMonthlyCost(usage, 'u-soft', PLUS_BUDGET * 0.85); // 85% бюджета Plus

  const strong = await run(gateway, request({ userId: 'u-soft', userPlan: 'plus', modelId: 'gpt-6.1-sol' }));
  assert.equal(strong.done?.selectedModel?.id, 'ketner-pro');
  assert.match(strong.done?.routingReason ?? '', /Budget protection/);

  const work = await run(gateway, request({ userId: 'u-soft', userPlan: 'plus', modelId: 'ketner-pro' }));
  assert.equal(work.done?.selectedModel?.id, 'ketner-pro');
  assert.ok(calls.every((c) => (c.maxTokens ?? 0) <= 4096), 'в экономном режиме ответ не длиннее 4096 токенов');
});

test('квота премиум-запросов: пока есть остаток, отвечает выбранная модель, потом — рабочая', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок', { cost: 0.05 }), calls), usage);

  // Plus: квота премиум-запросов (PLAN_ENTITLEMENTS.plus.premiumBudget) за 30 дней
  const first = await run(gateway, request({ userId: 'u-prem', userPlan: 'plus', modelId: 'gpt-6.1-sol' }));
  assertNoError(first);
  assert.equal(first.done?.selectedModel?.id, 'gpt-6.1-sol');
  assert.equal(calls[0].model, 'openai/gpt-6.1-sol');

  seedMonthlyCost(usage, 'u-prem', PLAN_ENTITLEMENTS.plus.premiumBudget + 0.1, 'gpt-6-astra'); // старый id в истории расхода тоже считается
  const second = await run(gateway, request({ userId: 'u-prem', userPlan: 'plus', modelId: 'gpt-6.1-sol' }));
  assertNoError(second);
  assert.equal(second.done?.selectedModel?.id, 'ketner-pro');
  assert.match(second.done?.routingReason ?? '', /Premium quota used up/);
  assert.equal(calls[1].model, 'xiaomi/mimo-v2.6-pro');

  // Расход на рабочую модель квоту премиум-запросов не уменьшает и не блокирует работу
  const third = await run(gateway, request({ userId: 'u-prem', userPlan: 'plus', modelId: 'ketner-pro' }));
  assert.equal(third.done?.selectedModel?.id, 'ketner-pro');
});

test('права доступа проверяются по запрошенной модели до любой замены', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);

  const free = await run(gateway, request({ userId: 'u-free', userPlan: 'free', modelId: 'gpt-6.1-sol' }));
  assert.equal(free.error?.code, 'upgrade_required');
  const plus = await run(gateway, request({ userId: 'u-plus', userPlan: 'plus', modelId: 'claude-opus-5.5' }));
  assert.equal(plus.error?.code, 'upgrade_required');
  assert.match(plus.error?.message ?? '', /Pro/);
  assert.equal(calls.length, 0, 'запрещённая модель не вызывается и не подменяется молча');

  const legacy = await run(gateway, request({ userId: 'u-legacy', userPlan: 'gpt-pro', modelId: 'claude-opus-5.5' }));
  assertNoError(legacy);
});

test('Auto: Free — бесплатная Nemotron, Plus — рабочая модель, премиум-модели Plus Auto не выбирает', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);

  const hard = `Реши уравнение и докажи теорему: интеграл от x^2 dx, пошагово (${Math.random()})`;
  const free = await run(gateway, request({ userId: 'u-a-free', userPlan: 'free', messages: [{ role: 'user', content: hard }] }));
  assert.equal(free.done?.selectedModel?.id, 'nemotron-ultra');
  const plus = await run(gateway, request({ userId: 'u-a-plus', userPlan: 'plus', messages: [{ role: 'user', content: hard }] }));
  assert.equal(plus.done?.selectedModel?.id, 'ketner-pro');
  const pro = await run(gateway, request({ userId: 'u-a-pro', userPlan: 'pro', messages: [{ role: 'user', content: hard }] }));
  assert.equal(pro.done?.selectedModel?.id, 'gpt-6.1-sol', 'Pro: тяжёлая математика уходит на сильную модель');
  assert.deepEqual(calls.at(-1)?.reasoning, { effort: 'high' }, 'математика на сильной модели у Pro — максимальная глубина');
});

test('глубина размышлений и потолок ответа передаются провайдеру под конкретную модель', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);

  // Приветствие на Luna: размышления отключены, ответ короткий
  await run(gateway, request({ userId: 'u-r1', userPlan: 'plus', modelId: 'ketner-mini', messages: [{ role: 'user', content: 'Привет' }] }));
  assert.deepEqual(calls[0].reasoning, { effort: 'none' });
  assert.ok((calls[0].maxTokens ?? 0) <= 2048);

  // Обычный вопрос на MiMo: модель умеет только включать и выключать размышления
  await run(gateway, request({ userId: 'u-r2', userPlan: 'plus', modelId: 'ketner-pro' }));
  assert.deepEqual(calls[1].reasoning, { enabled: true });

  // Sol: размышления отключить нельзя — минимум low; Opus у Pro — medium
  await run(gateway, request({ userId: 'u-r3', userPlan: 'plus', modelId: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Привет' }] }));
  assert.deepEqual(calls[2].reasoning, { effort: 'low' });
  await run(gateway, request({ userId: 'u-r4', userPlan: 'pro', modelId: 'claude-opus-5.5' }));
  assert.deepEqual(calls[3].reasoning, { effort: 'medium' });
  assert.ok((calls[3].maxTokens ?? 0) > 4096 && (calls[3].maxTokens ?? 0) <= 12288, `maxTokens=${calls[3].maxTokens}`);
});

test('сбой модели: берётся запасная из реестра, расход пишется на ту, что ответила', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const failSol = async (o: ProviderRequestOptions, cb: ProviderStreamCallbacks): Promise<ProviderResponse> => {
    if (o.model === 'openai/gpt-6.1-sol') throw new OpenRouterError(o.model, 503, 'overloaded');
    return okStream('ответ запасной', { cost: 0.004 })(o, cb);
  };
  const gateway = makeGateway(fakeOpenRouter(failSol, calls), usage);

  const out = await run(gateway, request({ userId: 'u-fb', userPlan: 'pro', modelId: 'gpt-6.1-sol' }));
  assertNoError(out);
  assert.deepEqual(calls.map((c) => c.model), ['openai/gpt-6.1-sol', 'openai/gpt-6-luna-pro']);
  assert.equal(out.done?.selectedModel?.id, 'gpt-6-luna-pro');
  assert.match(out.done?.routingReason ?? '', /fallback to GPT-6 Luna Pro/);
  assert.equal(usage.getByUser('u-fb')[0].modelId, 'gpt-6-luna-pro');
  assert.equal(usage.getCostLastMonthByModels('u-fb', ['gpt-6.1-sol']), 0, 'сильная модель квоту не тратит');
});

test('бюджет и квота ограничивают и запасные модели: премиум-модель в запасные не попадает', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const failing = async (o: ProviderRequestOptions): Promise<ProviderResponse> => {
    throw new OpenRouterError(o.model, 500, 'boom');
  };
  const gateway = makeGateway(fakeOpenRouter(failing, calls), usage);
  seedMonthlyCost(usage, 'u-fbq', PLUS_BUDGET * 1.03); // бюджет Plus исчерпан: только лёгкие модели

  const out = await run(gateway, request({ userId: 'u-fbq', userPlan: 'plus', modelId: 'ketner-pro' }));
  assert.equal(out.error?.code, 'provider_error');
  assert.deepEqual(
    calls.map((c) => c.model),
    ['openai/gpt-6-luna', 'anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4.1-flash'],
    'цепочка при исчерпанном бюджете состоит только из лёгких моделей',
  );
  assert.equal(usage.getByUser('u-fbq')[0].status, 'error');
});

test('HTTP 402 от OpenRouter (кончились кредиты): цепочка не перебирается, пользователь получает честную ошибку', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const noCredits = async (o: ProviderRequestOptions): Promise<ProviderResponse> => {
    throw new OpenRouterError(o.model, 402, 'insufficient credits');
  };
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000 });
  const providers = new ProviderManager();
  providers.setProvider('openrouter', fakeOpenRouter(noCredits, calls));
  const gateway = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: usage,
    aiConfig,
    circuitBreaker: breaker,
    useMockEngine: false,
  });

  const out = await run(gateway, request({ userId: 'u-402', userPlan: 'pro', modelId: 'gpt-6.1-sol' }));
  assert.equal(out.error?.code, 'provider_error');
  assert.equal(calls.length, 1, 'остальные модели того же ключа упадут так же');
  assert.equal(breaker.isOpen('openrouter:openai/gpt-6.1-sol'), false, 'модель не виновата — предохранитель не трогаем');
});

test('HTTP 400 при заданных размышлениях: один повтор без параметра, модель та же', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const picky = async (o: ProviderRequestOptions, cb: ProviderStreamCallbacks): Promise<ProviderResponse> => {
    if (o.reasoning) throw new OpenRouterError(o.model, 400, 'unsupported reasoning');
    return okStream('ответ без размышлений')(o, cb);
  };
  const gateway = makeGateway(fakeOpenRouter(picky, calls), usage);

  const out = await run(gateway, request({ userId: 'u-400', userPlan: 'pro', modelId: 'grok-4.7' }));
  assertNoError(out);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].reasoning);
  assert.equal(calls[1].reasoning, undefined);
  assert.equal(calls[1].model, 'x-ai/grok-4.7');
  assert.equal(out.done?.selectedModel?.id, 'grok-4.7');
});

test('отказы лимитов и сбои провайдера не расходуют сообщения пользователя', async () => {
  const usage = newUsage();
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), []), usage);

  // Free: 10 сообщений в сутки. Расход «два часа назад»: в сутки входит, в час и минуту — нет.
  for (let i = 0; i < 10; i++) {
    const record = usage.recordUsage({
      userId: 'u-lim',
      conversationId: 'seed',
      modelId: 'ketner-mini',
      provider: 'openrouter',
      inputTokens: 10,
      outputTokens: 10,
      estimatedCost: 0.0001,
      latencyMs: 1,
      status: 'success',
    });
    record.createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  }
  for (let i = 0; i < 3; i++) {
    const denied = await run(gateway, request({ userId: 'u-lim', userPlan: 'free', modelId: 'ketner-mini' }));
    assert.equal(denied.error?.code, 'rate_limited');
    // Отказ не продлевает блокировку: счётчик по-прежнему 10, а не растёт с каждой попыткой
    assert.equal(usage.getFairUseSnapshot('u-lim').requestsLastDay, 10);
  }

  // Сбой провайдера: пользователь не получил ответа — сообщение не списывается
  const failing = async (o: ProviderRequestOptions): Promise<ProviderResponse> => {
    throw new OpenRouterError(o.model, 500, 'boom');
  };
  const broken = makeGateway(fakeOpenRouter(failing, []), usage);
  const out = await run(broken, request({ userId: 'u-err', userPlan: 'plus', modelId: 'ketner-mini' }));
  assert.equal(out.error?.code, 'provider_error');
  assert.equal(usage.getFairUseSnapshot('u-err').requestsLastDay, 0);
});

test('ответ оборвался по таймауту посреди потока: пользователь получает показанный текст, вторая модель не вызывается', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const hanging = async (o: ProviderRequestOptions, cb: ProviderStreamCallbacks): Promise<ProviderResponse> => {
    cb.onDelta('Начало ответа');
    await new Promise<void>((resolve) => o.signal?.addEventListener('abort', () => resolve(), { once: true }));
    return { content: 'Начало ответа', usage: { inputTokens: 100, outputTokens: 5 }, finishReason: 'cancelled' };
  };
  const gateway = makeGateway(fakeOpenRouter(hanging, calls), usage);

  const out = await run(
    gateway,
    request({ userId: 'u-stall', userPlan: 'pro', modelId: 'ketner-mini', providerTimeoutMs: 40 }),
  );
  assert.equal(out.error, undefined);
  assert.equal(out.text, 'Начало ответа');
  assert.equal(calls.length, 1, 'после частичного ответа запасная модель не запускается');
  assert.equal(out.done?.finishReason, 'length');
  assert.equal(out.done?.canContinue, true);
});

test('один проход: запрос уходит в одну модель, токены и цена берутся из ответа', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(
    fakeOpenRouter(okStream('итоговый ответ', { cost: 0.01, usage: { inputTokens: 500, outputTokens: 100 } }), calls),
    usage,
  );
  const out = await run(
    gateway,
    request({
      userId: 'u-one',
      userPlan: 'pro',
      modelId: 'auto',
      messages: [{ role: 'user', content: `Дай короткую справку об инфляции для школьника, без формул (${Math.random()})` }],
    }),
  );
  assertNoError(out);
  assert.equal(calls.length, 1, 'никаких черновиков и повторных проходов');
  const snap = usage.getFairUseSnapshot('u-one');
  assert.equal(snap.estimatedCostLastDay, 0.01);
  assert.equal(snap.tokensLastDay, 600);
});

test('семантический кэш не смешивает ответы разных проектов (ключ не зависит от проекта — запрос с проектом не кэшируется)', () => {
  const cache = new SemanticCache(100, 60_000);
  cache.set('auto', 'ru', 'проанализируй проект', 'ответ про проект A', { inputTokens: 1, outputTokens: 1 }, {
    userScope: 'shared',
    historyHash: 'h',
    source: 'provider',
    hasAttachments: true,
  });
  assert.equal(cache.get('auto', 'ru', 'проанализируй проект', 'shared', 'h'), null);
});

test('суточный лимит: третий запрос к Sol на Plus уходит в GPT-6 Luna Pro, причина видна пользователю', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ', { cost: 0.02 }), calls), usage);

  for (let i = 0; i < 2; i++) {
    const ok = await run(gateway, request({ userId: 'u-dl', userPlan: 'plus', modelId: 'gpt-6.1-sol' }));
    assertNoError(ok);
    assert.equal(ok.done?.selectedModel?.id, 'gpt-6.1-sol');
  }

  const second = await run(gateway, request({ userId: 'u-dl', userPlan: 'plus', modelId: 'gpt-6.1-sol' }));
  assertNoError(second);
  assert.deepEqual(calls.map((c) => c.model), ['openai/gpt-6.1-sol', 'openai/gpt-6.1-sol', 'openai/gpt-6-luna-pro']);
  assert.equal(second.done?.selectedModel?.id, 'gpt-6-luna-pro');
  assert.match(second.done?.routingReason ?? '', /Daily limit reached for GPT-6\.1 Sol/);
  assert.equal(usage.getByUser('u-dl')[0].modelId, 'gpt-6-luna-pro', 'расход пишется на ту, что ответила');
});

test('суточный лимит не действует на тарифе без лимитов', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ', { cost: 0.02 }), calls), usage);
  for (let i = 0; i < 2; i++) {
    assertNoError(await run(gateway, request({ userId: 'u-dl-pro', userPlan: 'pro', modelId: 'gpt-6.1-sol' })));
  }
  assert.deepEqual(calls.map((c) => c.model), ['openai/gpt-6.1-sol', 'openai/gpt-6.1-sol']);
});

test('Free: Ketner Mini заменяется бесплатной Nemotron, расход ноль, причина видна', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ'), calls), usage);

  const out = await run(gateway, request({ userId: 'u-free-sub', userPlan: 'free', modelId: 'ketner-mini' }));
  assertNoError(out);
  assert.deepEqual(calls.map((c) => c.model), ['nvidia/nemotron-3-ultra-550b-a55b:free']);
  assert.equal(out.done?.selectedModel?.id, 'nemotron-ultra');
  assert.match(out.done?.routingReason ?? '', /Free plan: Nemotron 3 Ultra \(Free\) \(free OpenRouter endpoint\)/);
  assert.equal(usage.getFairUseSnapshot('u-free-sub').estimatedCostLastDay, 0, ':free-эндпоинт ничего не стоит');
});

test('Free: когда бесплатный пул OpenRouter отказывает (429), отвечает платный Ketner Mini', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const rateLimited = async (o: ProviderRequestOptions, cb: ProviderStreamCallbacks): Promise<ProviderResponse> => {
    if (o.model.endsWith(':free')) throw new OpenRouterError(o.model, 429, 'rate limit exceeded');
    return okStream('ответ запасной', { cost: 0.0004 })(o, cb);
  };
  const gateway = makeGateway(fakeOpenRouter(rateLimited, calls), usage);

  const out = await run(gateway, request({ userId: 'u-free-429', userPlan: 'free', modelId: 'ketner-mini' }));
  assertNoError(out);
  assert.equal(calls[0].model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.equal(calls.at(-1)?.model, 'openai/gpt-6-luna');
  assert.equal(out.done?.selectedModel?.id, 'ketner-mini');
  assert.equal(usage.getByUser('u-free-429')[0].modelId, 'ketner-mini', 'расход пишется на ту, что ответила');
});

test('платные тарифы бесплатную замену не получают', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ'), calls), usage);
  const out = await run(gateway, request({ userId: 'u-plus-mini', userPlan: 'plus', modelId: 'ketner-mini' }));
  assertNoError(out);
  assert.equal(calls[0].model, 'openai/gpt-6-luna');
});
