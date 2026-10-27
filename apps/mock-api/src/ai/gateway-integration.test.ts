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
import { exhaust, memoryCredits, setBalance } from '../services/credits-fixture.js';
import type { CreditService } from '../services/credits.js';
import type {
  AIProvider,
  GatewayRequest,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from './gateway-types.js';
import type { PlanId } from '../types.js';

const aiConfig = {
  thinkingMs: [0, 0],
  chunkMs: [0, 0],
  failureRate: 0,
  random: () => 0.5,
} as const;

interface Call {
  model: string;
  messages: ProviderRequestOptions['messages'];
  maxTokens?: number;
  reasoning?: ProviderRequestOptions['reasoning'];
}

/** Управляемый поддельный OpenRouter: сценарий задаётся функцией. */
function fakeOpenRouter(
  script: (
    options: ProviderRequestOptions,
    cb: ProviderStreamCallbacks,
  ) => Promise<ProviderResponse>,
  calls: Call[],
): AIProvider {
  return {
    type: 'openrouter',
    name: 'FakeOpenRouter',
    isAvailable: () => true,
    async generateText(options) {
      calls.push({ model: options.model, messages: options.messages });
      return {
        content: 'draft text for the user',
        usage: { inputTokens: 10, outputTokens: 10 },
        finishReason: 'stop',
      };
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

function makeGateway(
  provider: AIProvider,
  usage: UsageStore,
  credits: CreditService = memoryCredits(),
): AIGateway {
  const providers = new ProviderManager();
  providers.setProvider('openrouter', provider);
  return new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: usage,
    aiConfig,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    useMockEngine: false,
    credits,
  });
}

function newUsage(): UsageStore {
  return new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-gw-')), 'usage.json'));
}

function request(
  overrides: Partial<GatewayRequest> & { userId: string; userPlan: PlanId },
): GatewayRequest {
  return {
    conversationId: `c-${Math.random()}`,
    modelId: 'auto',
    messages: [
      { role: 'user', content: `Объясни кратко, чем отличается TCP от UDP ${Math.random()}` },
    ],
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

const okStream =
  (text: string, extra: Partial<ProviderResponse> = {}) =>
  async (_o: ProviderRequestOptions, cb: ProviderStreamCallbacks): Promise<ProviderResponse> => {
    cb.onDelta(text);
    return {
      content: text,
      usage: { inputTokens: 1000, outputTokens: 200 },
      finishReason: 'stop',
      ...extra,
    };
  };

test('в учёт попадает реальная стоимость от провайдера, а не нулевая цена «бесплатной» модели', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ', { cost: 0.0123 }), calls), usage);

  const out = await run(
    gateway,
    request({ userId: 'u-cost', userPlan: 'free', modelId: 'ketner-mini' }),
  );
  assert.equal(out.error, undefined);
  assert.equal(usage.getFairUseSnapshot('u-cost').estimatedCostLastDay, 0.0123);
});

test('без цены от провайдера расход считается по таблице реестра, а не нулём', async () => {
  const usage = newUsage();
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ'), []), usage);

  const out = await run(
    gateway,
    request({ userId: 'u-table', userPlan: 'plus', modelId: 'ketner-mini' }),
  );
  assertNoError(out);
  // Luna: 1000 вх. × $0.10/M + 200 исх. × $0.50/M = $0.0002
  assert.equal(usage.getFairUseSnapshot('u-table').estimatedCostLastDay, 0.0002);
});

test('кредиты кончились: платный тариф получает бесплатную модель вместо отказа, платные модели не вызываются', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const credits = memoryCredits();
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ'), calls), usage, credits);
  exhaust(credits, 'u-ex', 'plus');

  const out = await run(
    gateway,
    request({ userId: 'u-ex', userPlan: 'plus', modelId: 'gpt-6.1-sol' }),
  );
  assertNoError(out);
  assert.match(out.done?.routingReason ?? '', /Credits used up/);
  assert.equal(
    out.done?.selectedModel?.id,
    'nemotron-ultra',
    'пользователь видит, какая модель ответила',
  );
  assert.deepEqual(
    calls.map((c) => c.model),
    ['nvidia/nemotron-3-ultra-550b-a55b:free'],
  );
  assert.ok((calls[0].maxTokens ?? 0) <= 2048, 'когда кредиты кончились, ответ короткий');
  assert.equal(
    credits.balance('u-ex', 'plus').remainingUsd,
    0,
    'бесплатная модель ничего не списывает',
  );
  assert.equal(usage.getByUser('u-ex')[0].creditsUsd ?? 0, 0);

  // И так сколько угодно раз: без лимита на количество ответов бесплатной модели.
  for (let i = 0; i < 3; i++) {
    const again = await run(gateway, request({ userId: 'u-ex', userPlan: 'plus' }));
    assertNoError(again);
    assert.equal(again.done?.selectedModel?.id, 'nemotron-ultra');
  }
});

test('кредитов мало: выбранная дорогая модель заменяется той, на которую хватает, причина видна', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const credits = memoryCredits();
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage, credits);
  setBalance(credits, 'u-low', 'plus', 10); // типичный запрос GPT-6.1 Sol стоит ≈ 35 кредитов

  const out = await run(
    gateway,
    request({ userId: 'u-low', userPlan: 'plus', modelId: 'gpt-6.1-sol' }),
  );
  assertNoError(out);
  assert.match(out.done?.routingReason ?? '', /Not enough credits for GPT-6\.1 Sol/);
  assert.notEqual(out.done?.selectedModel?.id, 'gpt-6.1-sol');
  assert.ok(!calls.some((c) => c.model === 'openai/gpt-6.1-sol'), 'дорогая модель не вызывалась');
});

test('на запрос рабочей модели не хватает: отвечает дешёвая модель из цепочки, а когда и на неё нет — бесплатная', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const credits = memoryCredits();
  const gateway = makeGateway(
    fakeOpenRouter(okStream('ок', { cost: 0.0015 }), calls),
    usage,
    credits,
  );
  setBalance(credits, 'u-edge', 'plus', 3); // Ketner Pro ≈ 5 кредитов, Ketner Mini ≈ 1.8

  const first = await run(
    gateway,
    request({ userId: 'u-edge', userPlan: 'plus', modelId: 'ketner-pro' }),
  );
  assert.equal(first.done?.selectedModel?.id, 'claude-haiku-5.5', 'первая запасная Ketner Pro');
  assert.match(first.done?.routingReason ?? '', /Not enough credits for Ketner Pro/);
  assert.equal(usage.getByUser('u-edge')[0].creditsUsd, 0.0015);

  // Осталось 1.5 кредита: на Haiku и Ketner Mini (≈ 1.8) уже не хватает.
  const second = await run(
    gateway,
    request({ userId: 'u-edge', userPlan: 'plus', modelId: 'ketner-pro' }),
  );
  assert.equal(second.done?.selectedModel?.id, 'nemotron-ultra');
});

test('кредиты списываются по реальной цене ответа; когда они кончаются, отвечает бесплатная модель', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const credits = memoryCredits();
  const gateway = makeGateway(
    fakeOpenRouter(okStream('ок', { cost: 0.05 }), calls),
    usage,
    credits,
  );
  setBalance(credits, 'u-prem', 'plus', 100);
  const ask = () =>
    run(gateway, request({ userId: 'u-prem', userPlan: 'plus', modelId: 'gpt-6.1-sol' }));

  const first = await ask();
  assertNoError(first);
  assert.equal(first.done?.selectedModel?.id, 'gpt-6.1-sol');
  assert.equal(calls[0].model, 'openai/gpt-6.1-sol');
  assert.equal(usage.getByUser('u-prem')[0].creditsUsd, 0.05);
  assert.equal(credits.balance('u-prem', 'plus').remainingUsd, 0.05, '100 − 50 = 50 кредитов');

  const second = await ask();
  assert.equal(second.done?.selectedModel?.id, 'gpt-6.1-sol', '50 кредитов ≥ цены запроса (35)');
  assert.equal(credits.balance('u-prem', 'plus').remainingUsd, 0);

  const third = await ask();
  assertNoError(third);
  assert.equal(third.done?.selectedModel?.id, 'nemotron-ultra');
  assert.match(third.done?.routingReason ?? '', /Credits used up/);
  assert.equal(calls[2].model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
});

test('модели открыты на любом уровне: Free с пробными кредитами и подписчики получают запрошенную модель', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);

  for (const [userId, userPlan, modelId] of [
    ['u-free', 'free', 'gpt-6.1-sol'],
    ['u-plus', 'plus', 'claude-opus-5.5'],
    ['u-credits', 'credits', 'claude-opus-5.5'],
    ['u-legacy', 'gpt-pro', 'claude-opus-5.5'],
  ] as const) {
    const result = await run(gateway, request({ userId, userPlan, modelId }));
    assertNoError(result);
  }
  assert.equal(calls.length, 4, 'каждая модель вызвана, подмены по тарифу нет');
});

test('Auto: Free — бесплатная Nemotron, Plus — рабочая модель, премиум-модели Plus Auto не выбирает', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);

  const hard = `Реши уравнение и докажи теорему: интеграл от x^2 dx, пошагово (${Math.random()})`;
  const free = await run(
    gateway,
    request({ userId: 'u-a-free', userPlan: 'free', messages: [{ role: 'user', content: hard }] }),
  );
  assert.equal(free.done?.selectedModel?.id, 'nemotron-ultra');
  const plus = await run(
    gateway,
    request({ userId: 'u-a-plus', userPlan: 'plus', messages: [{ role: 'user', content: hard }] }),
  );
  assert.equal(plus.done?.selectedModel?.id, 'ketner-pro');
  const pro = await run(
    gateway,
    request({ userId: 'u-a-pro', userPlan: 'pro', messages: [{ role: 'user', content: hard }] }),
  );
  assert.equal(
    pro.done?.selectedModel?.id,
    'gpt-6.1-sol',
    'Pro: тяжёлая математика уходит на сильную модель',
  );
  assert.deepEqual(
    calls.at(-1)?.reasoning,
    { effort: 'high' },
    'математика на сильной модели у Pro — максимальная глубина',
  );
});

test('Auto на Pro: средняя задача по коду — открытая GLM-5.3 дешевле премиум-модели, сложная — GPT-6.1 Sol', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок', { cost: 0.02 }), calls), usage);

  const medium = await run(
    gateway,
    request({
      userId: 'u-a-open',
      userPlan: 'pro',
      messages: [
        { role: 'user', content: `Напиши функцию debounce на TypeScript (${Math.random()})` },
      ],
    }),
  );
  assertNoError(medium);
  assert.equal(medium.done?.selectedModel?.id, 'glm-5.3', 'подмена видна в selectedModel');
  assert.match(medium.done?.routingReason ?? '', /open flagship model \(credits saved\)/);
  assert.equal(calls.at(-1)?.model, 'z-ai/glm-5.3');
  assert.equal(usage.getByUser('u-a-open')[0].creditsUsd, 0.02, 'списано по цене ответа GLM');

  // Короткое «продолжи» в той же задаче остаётся на той же модели
  const followUp = await run(
    gateway,
    request({
      userId: 'u-a-open',
      userPlan: 'pro',
      messages: [
        { role: 'user', content: 'Найди race condition в очереди задач на Go' },
        {
          role: 'assistant',
          content: 'Проблема в том, что воркеры читают общий срез без мьютекса…',
        },
        { role: 'user', content: `продолжи (${Math.random()})` },
      ],
    }),
  );
  assertNoError(followUp);
  assert.equal(followUp.done?.selectedModel?.id, 'gpt-6.1-sol');
  assert.match(followUp.done?.routingReason ?? '', /hard reasoning task, strong model/);
  assert.equal(usage.getByUser('u-a-open')[0].modelId, 'gpt-6.1-sol');
});

test('глубина размышлений и потолок ответа передаются провайдеру под конкретную модель', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);

  // Приветствие на Luna: размышления отключены, ответ короткий
  await run(
    gateway,
    request({
      userId: 'u-r1',
      userPlan: 'plus',
      modelId: 'ketner-mini',
      messages: [{ role: 'user', content: 'Привет' }],
    }),
  );
  assert.deepEqual(calls[0].reasoning, { effort: 'none' });
  assert.ok((calls[0].maxTokens ?? 0) <= 2048);

  // Обычный вопрос на MiMo: модель умеет только включать и выключать размышления
  await run(gateway, request({ userId: 'u-r2', userPlan: 'plus', modelId: 'ketner-pro' }));
  assert.deepEqual(calls[1].reasoning, { enabled: true });

  // Sol: размышления отключить нельзя — минимум low; Opus у Pro — medium
  await run(
    gateway,
    request({
      userId: 'u-r3',
      userPlan: 'plus',
      modelId: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'Привет' }],
    }),
  );
  assert.deepEqual(calls[2].reasoning, { effort: 'low' });
  await run(gateway, request({ userId: 'u-r4', userPlan: 'pro', modelId: 'claude-opus-5.5' }));
  assert.deepEqual(calls[3].reasoning, { effort: 'medium' });
  assert.ok(
    (calls[3].maxTokens ?? 0) > 4096 && (calls[3].maxTokens ?? 0) <= 12288,
    `maxTokens=${calls[3].maxTokens}`,
  );
});

test('сбой модели: берётся запасная из реестра, расход пишется на ту, что ответила', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const failSol = async (
    o: ProviderRequestOptions,
    cb: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> => {
    if (o.model === 'openai/gpt-6.1-sol') throw new OpenRouterError(o.model, 503, 'overloaded');
    return okStream('ответ запасной', { cost: 0.004 })(o, cb);
  };
  const gateway = makeGateway(fakeOpenRouter(failSol, calls), usage);

  const out = await run(
    gateway,
    request({ userId: 'u-fb', userPlan: 'pro', modelId: 'gpt-6.1-sol' }),
  );
  assertNoError(out);
  assert.deepEqual(
    calls.map((c) => c.model),
    ['openai/gpt-6.1-sol', 'openai/gpt-6-luna-pro'],
  );
  assert.equal(out.done?.selectedModel?.id, 'gpt-6-luna-pro');
  assert.match(out.done?.routingReason ?? '', /fallback to GPT-6 Luna Pro/);
  assert.equal(usage.getByUser('u-fb')[0].modelId, 'gpt-6-luna-pro');
  assert.equal(usage.getByUser('u-fb')[0].creditsUsd, 0.004, 'списано по цене ответившей модели');
});

test('кредиты ограничивают и запасные модели: платная модель, на которую не хватает, в цепочку не попадает', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const failing = async (o: ProviderRequestOptions): Promise<ProviderResponse> => {
    throw new OpenRouterError(o.model, 500, 'boom');
  };
  const credits = memoryCredits();
  const gateway = makeGateway(fakeOpenRouter(failing, calls), usage, credits);
  setBalance(credits, 'u-fbq', 'plus', 3); // хватает на Haiku и Ketner Mini (≈ 1.8), на DeepSeek (≈ 4.7) нет

  const out = await run(
    gateway,
    request({ userId: 'u-fbq', userPlan: 'plus', modelId: 'ketner-pro' }),
  );
  assert.equal(out.error?.code, 'provider_error');
  assert.deepEqual(
    calls.map((c) => c.model),
    ['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna'],
    'в цепочке только модели по карману',
  );
  assert.equal(usage.getByUser('u-fbq')[0].status, 'error');

  // Кредитов нет совсем: платные запасные не вызываются, расход ограничен нулём.
  const none = await run(gateway, request({ userId: 'u-fbq0', userPlan: 'free', modelId: 'auto' }));
  assert.equal(none.error?.code, 'provider_error');
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
    credits: memoryCredits(),
  });

  const out = await run(
    gateway,
    request({ userId: 'u-402', userPlan: 'pro', modelId: 'gpt-6.1-sol' }),
  );
  assert.equal(out.error?.code, 'provider_error');
  assert.equal(calls.length, 1, 'остальные модели того же ключа упадут так же');
  assert.equal(
    breaker.isOpen('openrouter:openai/gpt-6.1-sol'),
    false,
    'модель не виновата — предохранитель не трогаем',
  );
});

test('HTTP 400 при заданных размышлениях: один повтор без параметра, модель та же', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const picky = async (
    o: ProviderRequestOptions,
    cb: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> => {
    if (o.reasoning) throw new OpenRouterError(o.model, 400, 'unsupported reasoning');
    return okStream('ответ без размышлений')(o, cb);
  };
  const gateway = makeGateway(fakeOpenRouter(picky, calls), usage);

  const out = await run(
    gateway,
    request({ userId: 'u-400', userPlan: 'pro', modelId: 'grok-4.7' }),
  );
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
    const denied = await run(
      gateway,
      request({ userId: 'u-lim', userPlan: 'free', modelId: 'ketner-mini' }),
    );
    assert.equal(denied.error?.code, 'rate_limited');
    // Отказ не продлевает блокировку: счётчик по-прежнему 10, а не растёт с каждой попыткой
    assert.equal(usage.getFairUseSnapshot('u-lim').requestsLastDay, 10);
  }

  // Сбой провайдера: пользователь не получил ответа — сообщение не списывается
  const failing = async (o: ProviderRequestOptions): Promise<ProviderResponse> => {
    throw new OpenRouterError(o.model, 500, 'boom');
  };
  const broken = makeGateway(fakeOpenRouter(failing, []), usage);
  const out = await run(
    broken,
    request({ userId: 'u-err', userPlan: 'plus', modelId: 'ketner-mini' }),
  );
  assert.equal(out.error?.code, 'provider_error');
  assert.equal(usage.getFairUseSnapshot('u-err').requestsLastDay, 0);
});

test('ответ оборвался по таймауту посреди потока: пользователь получает показанный текст, вторая модель не вызывается', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const hanging = async (
    o: ProviderRequestOptions,
    cb: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> => {
    cb.onDelta('Начало ответа');
    await new Promise<void>((resolve) =>
      o.signal?.addEventListener('abort', () => resolve(), { once: true }),
    );
    return {
      content: 'Начало ответа',
      usage: { inputTokens: 100, outputTokens: 5 },
      finishReason: 'cancelled',
    };
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
    fakeOpenRouter(
      okStream('итоговый ответ', { cost: 0.01, usage: { inputTokens: 500, outputTokens: 100 } }),
      calls,
    ),
    usage,
  );
  const out = await run(
    gateway,
    request({
      userId: 'u-one',
      userPlan: 'pro',
      modelId: 'auto',
      messages: [
        {
          role: 'user',
          content: `Дай короткую справку об инфляции для школьника, без формул (${Math.random()})`,
        },
      ],
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
  cache.set(
    'auto',
    'ru',
    'проанализируй проект',
    'ответ про проект A',
    { inputTokens: 1, outputTokens: 1 },
    {
      userScope: 'shared',
      historyHash: 'h',
      source: 'provider',
      hasAttachments: true,
    },
  );
  assert.equal(cache.get('auto', 'ru', 'проанализируй проект', 'shared', 'h'), null);
});

test('Free: Ketner Mini заменяется бесплатной Nemotron, расход ноль, причина видна', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ'), calls), usage);

  const out = await run(
    gateway,
    request({ userId: 'u-free-sub', userPlan: 'free', modelId: 'ketner-mini' }),
  );
  assertNoError(out);
  assert.deepEqual(
    calls.map((c) => c.model),
    ['nvidia/nemotron-3-ultra-550b-a55b:free'],
  );
  assert.equal(out.done?.selectedModel?.id, 'nemotron-ultra');
  assert.match(
    out.done?.routingReason ?? '',
    /Free plan: Nemotron 3 Ultra \(Free\) \(free OpenRouter endpoint\)/,
  );
  assert.equal(
    usage.getFairUseSnapshot('u-free-sub').estimatedCostLastDay,
    0,
    ':free-эндпоинт ничего не стоит',
  );
});

test('Free: когда бесплатный пул OpenRouter отказывает (429), отвечает платный Ketner Mini', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const rateLimited = async (
    o: ProviderRequestOptions,
    cb: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> => {
    if (o.model.endsWith(':free')) throw new OpenRouterError(o.model, 429, 'rate limit exceeded');
    return okStream('ответ запасной', { cost: 0.0004 })(o, cb);
  };
  const gateway = makeGateway(fakeOpenRouter(rateLimited, calls), usage);

  const out = await run(
    gateway,
    request({ userId: 'u-free-429', userPlan: 'free', modelId: 'ketner-mini' }),
  );
  assertNoError(out);
  assert.equal(calls[0].model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.equal(calls.at(-1)?.model, 'openai/gpt-6-luna');
  assert.equal(out.done?.selectedModel?.id, 'ketner-mini');
  assert.equal(
    usage.getByUser('u-free-429')[0].modelId,
    'ketner-mini',
    'расход пишется на ту, что ответила',
  );
});

test('платные тарифы бесплатную замену не получают', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ'), calls), usage);
  const out = await run(
    gateway,
    request({ userId: 'u-plus-mini', userPlan: 'plus', modelId: 'ketner-mini' }),
  );
  assertNoError(out);
  assert.equal(calls[0].model, 'openai/gpt-6-luna');
});

// ── Pro и Ultra: фиксированная глубина размышлений, режим Max и цепочки по кредитам ──

test('Pro: модели Pro размышляют на medium, Grok и Terra всегда на xhigh', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);

  const greet = [{ role: 'user' as const, content: 'Привет' }];
  assertNoError(
    await run(
      gateway,
      request({ userId: 'u-pp1', userPlan: 'pro', modelId: 'claude-opus-5.5', messages: greet }),
    ),
  );
  assert.equal(calls[0].model, 'anthropic/claude-opus-5.5');
  assert.deepEqual(
    calls[0].reasoning,
    { effort: 'medium' },
    'даже на приветствие — medium, а не адаптивная глубина',
  );
  assertNoError(
    await run(gateway, request({ userId: 'u-pp1', userPlan: 'pro', modelId: 'grok-4.7' })),
  );
  assert.deepEqual(calls[1].reasoning, { effort: 'xhigh' });
  assertNoError(
    await run(gateway, request({ userId: 'u-pp1', userPlan: 'pro', modelId: 'gpt-5.6-terra' })),
  );
  assert.equal(calls[2].model, 'openai/gpt-5.6-terra');
  assert.deepEqual(calls[2].reasoning, { effort: 'xhigh' });
  assertNoError(
    await run(gateway, request({ userId: 'u-pp1', userPlan: 'pro', modelId: 'gpt-5.6-sol' })),
  );
  assert.deepEqual(calls[3].reasoning, { effort: 'medium' });
});

test('режим Max: xhigh на любом уровне доступа, стандартный режим — medium', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);

  const ultraMax = await run(
    gateway,
    request({
      userId: 'u-um',
      userPlan: 'ultra',
      modelId: 'claude-sonnet-5.5',
      reasoningMode: 'max',
    }),
  );
  assertNoError(ultraMax);
  assert.deepEqual(calls[0].reasoning, { effort: 'xhigh' });
  assert.equal(ultraMax.done?.reasoningMode, 'max');
  assert.match(ultraMax.done?.routingReason ?? '', /Max mode: xhigh reasoning/);
  assert.ok((calls[0].maxTokens ?? 0) > 2048, 'xhigh не обрезается коротким потолком ответа');

  const ultraStd = await run(
    gateway,
    request({ userId: 'u-um', userPlan: 'ultra', modelId: 'claude-sonnet-5.5' }),
  );
  assertNoError(ultraStd);
  assert.deepEqual(calls[1].reasoning, { effort: 'medium' });
  assert.equal(ultraStd.done?.reasoningMode, 'standard');

  // Max открыт и тем, кто с пробными кредитами, и покупателям кредитов, и прежним подписчикам Pro.
  for (const [i, plan] of (['pro', 'credits', 'free'] as const).entries()) {
    const max = await run(
      gateway,
      request({
        userId: `u-max-${plan}`,
        userPlan: plan,
        modelId: 'claude-sonnet-5.5',
        reasoningMode: 'max',
      }),
    );
    assertNoError(max);
    assert.deepEqual(calls[2 + i].reasoning, { effort: 'xhigh' }, `Max на ${plan} действует`);
    assert.equal(max.done?.reasoningMode, 'max');
    assert.match(max.done?.routingReason ?? '', /Max mode/);
  }
});

test('кредитов хватает не на всё: Opus → Sonnet → Ketner Pro по мере того, как кредиты убывают', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const credits = memoryCredits();
  const gateway = makeGateway(
    fakeOpenRouter(okStream('ок', { cost: 0.001 }), calls),
    usage,
    credits,
  );
  const ask = (balance: number) => {
    setBalance(credits, 'u-chain', 'pro', balance);
    return run(
      gateway,
      request({ userId: 'u-chain', userPlan: 'pro', modelId: 'claude-opus-5.5' }),
    );
  };

  // Opus ≈ 70 кредитов, Sonnet ≈ 35, Ketner Pro ≈ 5
  assert.equal((await ask(500)).done?.selectedModel?.id, 'claude-opus-5.5');
  assert.equal((await ask(50)).done?.selectedModel?.id, 'claude-sonnet-5.5');
  const low = await ask(20);
  assert.equal(low.done?.selectedModel?.id, 'ketner-pro');
  assert.match(low.done?.routingReason ?? '', /Not enough credits for Claude Opus 5\.5/);
  assert.equal((await ask(0)).done?.selectedModel?.id, 'nemotron-ultra');
});

test('режим Max дороже в кредитах: Opus в Max при 100 кредитах не по карману, обычный запрос — по карману', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const credits = memoryCredits();
  const gateway = makeGateway(
    fakeOpenRouter(okStream('ок', { cost: 0.002 }), calls),
    usage,
    credits,
  );
  const ask = (mode?: 'max') => {
    setBalance(credits, 'u-maxu', 'ultra', 100);
    return run(
      gateway,
      request({
        userId: 'u-maxu',
        userPlan: 'ultra',
        modelId: 'claude-opus-5.5',
        ...(mode ? { reasoningMode: mode } : {}),
      }),
    );
  };

  // Opus: ≈ 70 кредитов обычный запрос и ≈ 170 в Max; Sonnet в Max ≈ 85.
  assert.equal((await ask()).done?.selectedModel?.id, 'claude-opus-5.5');
  const max = await ask('max');
  assert.equal(max.done?.selectedModel?.id, 'claude-sonnet-5.5');
  assert.equal(max.done?.reasoningMode, 'max');
});

test('GPT-6 Astra при нехватке кредитов → GPT-6.1 Sol, Terra → Gemini 3.8 Flash', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const credits = memoryCredits();
  const gateway = makeGateway(
    fakeOpenRouter(okStream('ок', { cost: 0.001 }), calls),
    usage,
    credits,
  );
  setBalance(credits, 'u-ast', 'pro', 100); // Astra ≈ 176 кредитов, Sol ≈ 35
  const astra = await run(
    gateway,
    request({ userId: 'u-ast', userPlan: 'pro', modelId: 'gpt-6-astra' }),
  );
  assert.equal(astra.done?.selectedModel?.id, 'gpt-6.1-sol');

  setBalance(credits, 'u-ter', 'pro', 50); // Terra ≈ 99 кредитов, Gemini 3.8 Flash ≈ 13
  const terra = await run(
    gateway,
    request({ userId: 'u-ter', userPlan: 'pro', modelId: 'gpt-5.6-terra' }),
  );
  assert.equal(terra.done?.selectedModel?.id, 'gemini-3.8-flash');
});

test('без ключа OpenRouter вне production чат отвечает шаблоном (demo), а не ошибкой', async () => {
  const offline = {
    ...fakeOpenRouter(okStream('не должно вызываться'), []),
    isAvailable: () => false,
  };
  const providers = new ProviderManager();
  providers.setProvider('openrouter', offline);
  // Задержки как у локального dev-сервера: эвристика «нулевые задержки = тест» здесь не срабатывает.
  const gateway = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: newUsage(),
    aiConfig: { thinkingMs: [1, 1], chunkMs: [1, 1], failureRate: 0, random: () => 0.5 },
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    credits: memoryCredits(),
  });

  const outcome = await run(gateway, request({ userId: 'dev-no-key', userPlan: 'free' }));

  assert.equal(outcome.error, undefined);
  assert.ok(outcome.text.length > 0, 'шаблонный ответ пришёл потоком');
  assert.equal(outcome.done?.source, 'template');
});

test('провайдер настроен, но упал — честная ошибка, а не подмена шаблоном', async () => {
  const providers = new ProviderManager();
  providers.setProvider(
    'openrouter',
    fakeOpenRouter(async () => {
      throw new OpenRouterError('ketner-pro', 500, 'boom');
    }, []),
  );
  const gateway = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: newUsage(),
    aiConfig: { thinkingMs: [1, 1], chunkMs: [1, 1], failureRate: 0, random: () => 0.5 },
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    credits: memoryCredits(),
  });

  const outcome = await run(gateway, request({ userId: 'dev-with-key', userPlan: 'free' }));

  assert.equal(outcome.error?.code, 'provider_error');
  assert.equal(outcome.done, undefined);
});
