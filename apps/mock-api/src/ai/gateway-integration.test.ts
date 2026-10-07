import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AIGateway } from './gateway.js';
import { ProviderManager } from './providers/provider-factory.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ModelRegistry } from './model-registry.js';
import { SemanticCache } from './cache.js';
import { UsageStore } from '../store/usage-store.js';
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
      calls.push({ model: options.model, messages: options.messages });
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

function newUsage(): UsageStore {
  return new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-gw-')), 'usage.json'));
}

/** Расход «за прошлые дни»: в месячный бюджет входит, а в суточную квоту — нет. */
function seedMonthlyCost(usage: UsageStore, userId: string, cost: number): void {
  const record = usage.recordUsage({
    userId,
    conversationId: 'seed',
    modelId: 'gpt-4o',
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

test('без цены от провайдера «бесплатный» ketner-mini всё равно стоит денег в учёте', async () => {
  const usage = newUsage();
  const gateway = makeGateway(fakeOpenRouter(okStream('ответ'), []), usage);

  const out = await run(gateway, request({ userId: 'u-table', userPlan: 'free', modelId: 'ketner-mini' }));
  assert.equal(out.error, undefined);
  // 1000 вх. × $0.30/M + 200 исх. × $1.20/M = $0.00054
  assert.equal(usage.getFairUseSnapshot('u-table').estimatedCostLastDay, 0.0005);
});

test('жёсткий потолок: при расходе ≥125% бюджета запрос отклоняется до обращения к провайдеру', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('не должно прийти'), calls), usage);
  seedMonthlyCost(usage, 'u-hard', 5.1); // бюджет Plus $4 → 127%

  const out = await run(gateway, request({ userId: 'u-hard', userPlan: 'plus' }));
  assert.equal(out.error?.code, 'fair_use_exceeded');
  assert.equal(calls.length, 0, 'провайдер вызываться не должен');
});

test('бюджет исчерпан (100–125%): явный выбор дорогой модели понижается до дешёвой', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(fakeOpenRouter(okStream('ок'), calls), usage);
  seedMonthlyCost(usage, 'u-ex', 4.2); // 105% бюджета Plus

  const out = await run(gateway, request({ userId: 'u-ex', userPlan: 'plus', modelId: 'gpt-4o' }));
  assert.equal(out.error, undefined);
  assert.match(out.done?.routingReason ?? '', /Budget protection/);
  assert.ok(calls.length === 1);
  assert.ok(!calls[0].model.includes('gpt-4o'), `ушёл запрос на ${calls[0].model}`);
});

test('Plus в режиме Auto: 5% «вспышка» флагмана не падает с ошибкой «нужна подписка Pro»', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const providers = new ProviderManager();
  providers.setProvider('openrouter', fakeOpenRouter(okStream('вспышка'), calls));
  const gateway = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: usage,
    aiConfig: { ...aiConfig, random: () => 0.02 }, // < 0.05 → вспышка
    circuitBreaker: new CircuitBreaker(),
    useMockEngine: false,
  });

  const out = await run(gateway, request({ userId: 'u-burst', userPlan: 'plus', modelId: 'auto' }));
  assert.equal(out.error, undefined, out.error?.message);
  assert.ok(out.text.length > 0);
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

test('двухпроходный режим: стоимость черновика не удваивается, токены обоих проходов идут в квоту', async () => {
  const usage = newUsage();
  const calls: Call[] = [];
  const gateway = makeGateway(
    fakeOpenRouter(okStream('итоговый ответ', { cost: 0.01, usage: { inputTokens: 500, outputTokens: 100 } }), calls),
    usage,
  );
  // Pro + random 0.25 → gpt_improve (черновик + улучшение флагманом), вопрос — не код.
  const providers = new ProviderManager();
  providers.setProvider('openrouter', fakeOpenRouter(okStream('итоговый ответ', { cost: 0.01, usage: { inputTokens: 500, outputTokens: 100 } }), calls));
  const g2 = new AIGateway({
    registry: new ModelRegistry(),
    providers,
    usageStore: usage,
    aiConfig: { ...aiConfig, random: () => 0.25 },
    circuitBreaker: new CircuitBreaker(),
    useMockEngine: false,
  });
  void gateway;
  const out = await run(g2, request({ userId: 'u-two', userPlan: 'pro', modelId: 'auto', messages: [{ role: 'user', content: `Дай короткую справку об инфляции для школьника, без формул (${Math.random()})` }] }));
  assert.equal(out.error, undefined, out.error?.message);
  const snap = usage.getFairUseSnapshot('u-two');
  // улучшающий проход: провайдер сообщил $0.01; черновик (10/10 токенов на дешёвой модели) — копейки
  assert.ok(snap.estimatedCostLastDay >= 0.01 && snap.estimatedCostLastDay < 0.0101, `cost=${snap.estimatedCostLastDay}`);
  assert.equal(snap.tokensLastDay, 500 + 100 + 10 + 10);
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
