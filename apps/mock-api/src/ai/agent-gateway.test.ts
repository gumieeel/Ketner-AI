import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  AgentGateway,
  chooseAgentEffort,
  type AgentFailure,
  type AgentRunRequest,
  type AgentSuccess,
} from './agent-gateway.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { ModelRegistry } from './model-registry.js';
import { OpenRouterError } from './providers/openrouter-provider.js';
import { ProviderManager } from './providers/provider-factory.js';
import type { AIProvider } from './gateway-types.js';
import type {
  AgentCapableProvider,
  AgentProviderRequest,
  AgentProviderResult,
  AgentStreamEvent,
} from './agent/agent-types.js';
import { toCredits } from '../services/credits.js';
import { exhaust, memoryCredits, setBalance } from '../services/credits-fixture.js';
import { PLAN_ENTITLEMENTS } from '../services/entitlement.js';
import { UsageStore } from '../store/usage-store.js';
import type { PlanId } from '../types.js';

type Script = (
  request: AgentProviderRequest,
  emit: (event: AgentStreamEvent) => void,
  call: number,
) => Promise<AgentProviderResult>;

const okResult = (over: Partial<AgentProviderResult> = {}): AgentProviderResult => ({
  content: 'готово',
  toolCalls: [],
  finishReason: 'stop',
  usage: { inputTokens: 1000, outputTokens: 100 },
  cost: 0.002,
  ...over,
});

function fakeProvider(
  script: Script,
  calls: AgentProviderRequest[],
): AIProvider & AgentCapableProvider {
  return {
    type: 'openrouter',
    name: 'FakeOpenRouter',
    isAvailable: () => true,
    async generateText() {
      throw new Error('не используется');
    },
    async streamText() {
      throw new Error('не используется');
    },
    async streamAgent(request, hooks) {
      calls.push(request);
      return script(request, (event) => hooks.onEvent(event), calls.length);
    },
  };
}

function setup(script: Script) {
  const calls: AgentProviderRequest[] = [];
  const providers = new ProviderManager();
  providers.setProvider('openrouter', fakeProvider(script, calls));
  const usage = new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-agent-')), 'usage.json'));
  const credits = memoryCredits();
  const gateway = new AgentGateway({
    usageStore: usage,
    registry: new ModelRegistry(),
    providers,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    credits,
  });
  return { gateway, usage, calls, credits };
}

let counter = 0;
function request(over: Partial<AgentRunRequest> = {}): AgentRunRequest {
  counter += 1;
  return {
    userId: `user-${counter}`,
    userPlan: 'plus' as PlanId,
    keyId: `key-${counter}`,
    model: 'ketner-pro',
    messages: [{ role: 'user', content: 'сделай' }],
    reasoningEffort: 'low',
    ...over,
  };
}

const events = (): {
  list: AgentStreamEvent[];
  callbacks: { onEvent: (e: AgentStreamEvent) => void };
} => {
  const list: AgentStreamEvent[] = [];
  return { list, callbacks: { onEvent: (e) => list.push(e) } };
};

const asOk = (outcome: unknown): AgentSuccess => {
  const value = outcome as AgentSuccess | AgentFailure;
  assert.equal(
    value.kind,
    'ok',
    value.kind === 'error' ? `${value.status} ${value.code}: ${value.message}` : '',
  );
  return value as AgentSuccess;
};
const asFail = (outcome: unknown): AgentFailure => {
  const value = outcome as AgentSuccess | AgentFailure;
  assert.equal(value.kind, 'error', 'ожидалась ошибка');
  return value as AgentFailure;
};

test('ответ с вызовом функции: события идут клиенту, расход пишется по цене провайдера в api:<ключ>', async () => {
  const { gateway, usage, calls } = setup(async (_r, emit) => {
    emit({ kind: 'reasoning', text: 'думаю' });
    emit({
      kind: 'tool_call',
      index: 0,
      id: 'c1',
      name: 'read_file',
      argumentsDelta: '{"path":"a.ts"}',
    });
    return okResult({
      content: '',
      toolCalls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
        },
      ],
      finishReason: 'tool_calls',
      cost: 0.0123,
      usage: { inputTokens: 5000, outputTokens: 80, cachedTokens: 4000 },
    });
  });
  const req = request({
    tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
    toolChoice: 'auto',
  });
  const sink = events();
  const out = asOk(await gateway.run(req, sink.callbacks));

  assert.equal(out.finishReason, 'tool_calls');
  assert.equal(out.model.id, 'ketner-pro');
  assert.equal(out.costUsd, 0.0123);
  assert.equal(out.routingReason, 'Explicit user model selection (Ketner Pro)');
  assert.deepEqual(
    sink.list.map((e) => e.kind),
    ['reasoning', 'tool_call'],
  );
  assert.equal(calls[0].model, 'xiaomi/mimo-v2.6-pro');
  assert.equal(calls[0].tools?.length, 1);

  const [record] = usage.getByUser(req.userId);
  assert.equal(record.conversationId, `api:${req.keyId}`);
  assert.equal(record.actualCost, 0.0123);
  assert.equal(record.cachedTokens, 4000);
  assert.equal(record.status, 'success');
});

test('Free (только пробные кредиты) не допускается; неизвестная модель получает понятный отказ без вызова провайдера', async () => {
  const { gateway, calls } = setup(async () => okResult());
  const free = asFail(await gateway.run(request({ userPlan: 'free' }), events().callbacks));
  assert.equal(free.status, 403);
  assert.equal(free.code, 'upgrade_required');

  const unknown = asFail(await gateway.run(request({ model: 'gpt-4o' }), events().callbacks));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.code, 'model_not_found');

  const legacy = asFail(
    await gateway.run(request({ model: 'gemini-3.8-flash' }), events().callbacks),
  );
  assert.equal(legacy.code, 'model_not_found', 'старые id вне публичного каталога не принимаются');
  assert.equal(calls.length, 0);
});

test('покупатель кредитов получает любую публичную модель, Opus тоже: ограничивает только остаток', async () => {
  const { gateway, calls, credits } = setup(async () => okResult({ cost: 0.01 }));
  const req = request({ userPlan: 'credits', model: 'claude-opus-5.5' });
  setBalance(credits, req.userId, 'credits', 5_000);
  const out = asOk(await gateway.run(req, events().callbacks));
  assert.equal(out.model.id, 'claude-opus-5.5');
  assert.equal(calls.length, 1);
});

test('auto выбирает Ketner Pro и честно называет это в routing_reason', async () => {
  const { gateway, calls } = setup(async () => okResult());
  const out = asOk(await gateway.run(request({ model: 'auto' }), events().callbacks));
  assert.equal(out.model.id, 'ketner-pro');
  assert.equal(out.requestedModel, 'auto');
  assert.equal(out.routingReason, 'Auto: Ketner Pro');
  assert.equal(calls[0].model, 'xiaomi/mimo-v2.6-pro');
});

test('не хватает кредитов на премиум-модель: отвечает та, на которую хватает, причина названа', async () => {
  const { gateway, usage, calls, credits } = setup(async () => okResult({ cost: 0.01 }));
  const req = request({ userPlan: 'pro', model: 'gpt-6.1-sol' });
  setBalance(credits, req.userId, 'pro', 20); // типичный запрос GPT-6.1 Sol стоит ≈ 35 кредитов

  const out = asOk(await gateway.run(req, events().callbacks));
  assert.notEqual(out.model.id, 'gpt-6.1-sol');
  assert.equal(out.requestedModel, 'gpt-6.1-sol');
  assert.match(out.routingReason, /Not enough credits for GPT-6\.1 Sol/);
  assert.equal(calls[0].model !== 'openai/gpt-6.1-sol', true);
  assert.equal(usage.getByUser(req.userId)[0].modelId, out.model.id);
  assert.equal(out.credits.stage, 'normal');
  assert.equal(out.credits.charged, 10, 'списано по цене ответа: $0.01 = 10 кредитов');
  assert.equal(out.credits.balance, 10);
});

test('премиум-модель отвечает, пока кредиты есть, и списывает реальную цену запроса', async () => {
  const { gateway, usage, calls, credits } = setup(async () => okResult({ cost: 0.05 }));
  const req = request({ userPlan: 'pro', model: 'gpt-6.1-sol' });
  const out = asOk(await gateway.run(req, events().callbacks));
  assert.equal(out.model.id, 'gpt-6.1-sol');
  assert.equal(calls[0].model, 'openai/gpt-6.1-sol');
  assert.equal(out.credits.stage, 'normal');
  assert.equal(out.credits.charged, 50);
  assert.equal(out.credits.balance, PLAN_ENTITLEMENTS.pro.monthlyCredits - 50);
  assert.equal(usage.getByUser(req.userId)[0].creditsUsd, 0.05);
  assert.equal(toCredits(credits.balance(req.userId, 'pro').remainingUsd), out.credits.balance);
});

test('кредиты кончились: отвечает бесплатная модель агента, ничего не списывается и отказа нет', async () => {
  const { gateway, usage, calls, credits } = setup(async () => okResult({ cost: 0 }));
  const req = request();
  exhaust(credits, req.userId, 'plus');

  for (let i = 0; i < 3; i += 1) {
    const out = asOk(await gateway.run({ ...req }, events().callbacks));
    assert.equal(out.model.id, 'north-mini-code');
    assert.match(out.routingReason, /Credits used up/);
    assert.equal(out.credits.stage, 'exhausted');
    assert.equal(out.credits.charged, 0);
    assert.equal(out.credits.balance, 0);
  }
  assert.equal(calls[0].model, 'cohere/north-mini-code:free');
  assert.equal(usage.getByUser(req.userId)[0].creditsUsd ?? 0, 0);
});

test('токенные окна чата для агента не действуют: расход кредитов — единственный предел', async () => {
  const { gateway, usage } = setup(async () => okResult({ cost: 0.001 }));

  // 400k токенов за последний час при чатовом лимите Plus 300k: чат отказал бы.
  const heavy = request();
  usage.recordUsage({
    userId: heavy.userId,
    conversationId: 'api:old',
    modelId: 'ketner-pro',
    provider: 'openrouter',
    inputTokens: 400_000,
    outputTokens: 1000,
    estimatedCost: 0.01,
    latencyMs: 1,
    status: 'success',
  });
  asOk(await gateway.run(heavy, events().callbacks));
});

test('параллельный запрос сверх лимита тарифа отклоняется с Retry-After', async () => {
  const { gateway, usage } = setup(async () => okResult());
  const req = request();
  for (let i = 0; i < PLAN_ENTITLEMENTS.plus.maxConcurrency; i++)
    usage.acquireConcurrencySlot(req.userId);
  const refused = asFail(await gateway.run(req, events().callbacks));
  assert.equal(refused.status, 429);
  assert.equal(refused.retryAfterSec, 5);
});

test('сбой до первого фрагмента: отвечает запасная модель, в routing_reason указан fallback', async () => {
  const { gateway, calls } = setup(async (r, _emit, call) => {
    if (call === 1) throw new OpenRouterError(r.model, 503, 'busy');
    return okResult();
  });
  const out = asOk(await gateway.run(request(), events().callbacks));
  assert.equal(calls.length, 2);
  assert.equal(out.model.id, 'claude-haiku-5.5');
  assert.match(out.routingReason, /fallback to Claude Haiku 5\.5/);
});

test('после первого фрагмента запасная модель не включается: ответ остаётся частичным, с finish_reason error', async () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const { gateway, calls } = setup(async (_r, emit) => {
      emit({ kind: 'content', text: 'начало ' });
      throw new Error('socket hang up');
    });
    const sink = events();
    const out = asOk(await gateway.run(request(), sink.callbacks));
    assert.equal(calls.length, 1);
    assert.equal(out.finishReason, 'error');
    assert.equal(out.content, 'начало ');
    assert.deepEqual(sink.list, [{ kind: 'content', text: 'начало ' }]);
  } finally {
    console.warn = warn;
  }
});

test('HTTP 402 от OpenRouter: цепочка не перебирается, клиент получает 503 provider_unavailable', async () => {
  const err = console.error;
  console.error = () => undefined;
  try {
    const { gateway, calls, usage } = setup(async (r) => {
      throw new OpenRouterError(r.model, 402, 'no credits');
    });
    const req = request();
    const refused = asFail(await gateway.run(req, events().callbacks));
    assert.equal(calls.length, 1);
    assert.equal(refused.status, 503);
    assert.equal(refused.code, 'provider_unavailable');
    assert.equal(usage.getByUser(req.userId)[0].status, 'error');
    assert.equal(
      usage.getFairUseSnapshot(req.userId).requestsLastDay,
      0,
      'сбой не списывает лимит',
    );
  } finally {
    console.error = err;
  }
});

test('все модели цепочки упали: 502 upstream_error', async () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const { gateway } = setup(async (r) => {
      throw new OpenRouterError(r.model, 500, 'boom');
    });
    const refused = asFail(await gateway.run(request(), events().callbacks));
    assert.equal(refused.status, 502);
    assert.equal(refused.code, 'upstream_error');
  } finally {
    console.warn = warn;
  }
});

test('HTTP 400 с размышлениями: один повтор без параметра; переполнение окна даёт context_length_exceeded', async () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const first = setup(async (r, _e, call) => {
      if (call === 1) throw new OpenRouterError(r.model, 400, 'unsupported reasoning');
      return okResult();
    });
    asOk(await first.gateway.run(request({ model: 'ketner-mini' }), events().callbacks));
    assert.equal(first.calls.length, 2);
    assert.ok(first.calls[0].reasoning);
    assert.equal(first.calls[1].reasoning, undefined);

    const overflow = setup(async (r) => {
      throw new OpenRouterError(
        r.model,
        400,
        "This model's maximum context length is 200000 tokens",
      );
    });
    const refused = asFail(await overflow.gateway.run(request(), events().callbacks));
    assert.equal(refused.status, 400);
    assert.equal(refused.code, 'context_length_exceeded');
  } finally {
    console.warn = warn;
  }
});

test('огромная история не уходит провайдеру: 400 context_length_exceeded', async () => {
  const { gateway, calls } = setup(async () => okResult());
  const huge = 'a'.repeat(4_400_000); // ≈1.1M токенов при окне Ketner Pro 1.05M
  const refused = asFail(
    await gateway.run(request({ messages: [{ role: 'user', content: huge }] }), events().callbacks),
  );
  assert.equal(refused.status, 400);
  assert.equal(refused.code, 'context_length_exceeded');
  assert.equal(calls.length, 0);
});

test('потолок ответа задаёт тариф (вдвое выше чатового), запрос клиента его не поднимает', async () => {
  const { gateway, calls } = setup(async () => okResult());
  await gateway.run(request({ maxTokens: 999_999 }), events().callbacks);
  await gateway.run(request({ maxTokens: 500 }), events().callbacks);
  const cap = Math.min(PLAN_ENTITLEMENTS.plus.maxTokens * 2, 16384);
  assert.equal(calls[0].maxTokens, cap);
  assert.equal(calls[1].maxTokens, 500);
});

test('глубина размышлений: потолок по тарифу, когда кредиты кончились, не выше low', () => {
  assert.equal(chooseAgentEffort('high', 'plus', 'normal'), 'medium');
  assert.equal(chooseAgentEffort('high', 'pro', 'normal'), 'medium');
  assert.equal(chooseAgentEffort('high', 'ultra', 'normal'), 'high');
  assert.equal(chooseAgentEffort('high', 'ultra', 'exhausted'), 'low');
  assert.equal(chooseAgentEffort('minimal', 'plus', 'normal'), 'none');
  assert.equal(chooseAgentEffort('none', 'ultra', 'exhausted'), 'none');
  assert.equal(chooseAgentEffort('low', 'plus', 'normal'), 'low');
});

test('глубина размышлений доходит до провайдера в формате модели', async () => {
  const { gateway, calls } = setup(async () => okResult());
  await gateway.run(
    request({ userPlan: 'ultra', model: 'ketner-mini', reasoningEffort: 'high' }),
    events().callbacks,
  );
  assert.deepEqual(calls[0].reasoning, { effort: 'high' });
  // Ketner Pro умеет только включать и выключать размышления.
  await gateway.run(request({ model: 'ketner-pro', reasoningEffort: 'low' }), events().callbacks);
  assert.deepEqual(calls[1].reasoning, { enabled: true });
  await gateway.run(request({ model: 'ketner-pro', reasoningEffort: 'none' }), events().callbacks);
  assert.deepEqual(calls[2].reasoning, { enabled: false });
});

test('отмена клиентом: запрос заканчивается, расход помечен cancelled', async () => {
  const controller = new AbortController();
  const { gateway, usage } = setup(async (_r, emit) => {
    emit({ kind: 'content', text: 'часть' });
    controller.abort();
    return okResult({ content: 'часть', finishReason: 'cancelled', cost: 0.0005 });
  });
  const req = request({ signal: controller.signal });
  const out = asOk(await gateway.run(req, events().callbacks));
  assert.equal(out.finishReason, 'cancelled');
  assert.equal(usage.getByUser(req.userId)[0].status, 'cancelled');
});

test('провайдер не настроен: честный 503, а не выдуманный ответ', async () => {
  const providers = new ProviderManager();
  providers.setProvider('openrouter', {
    ...fakeProvider(async () => okResult(), []),
    isAvailable: () => false,
  });
  const gateway = new AgentGateway({
    usageStore: new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-agent-')), 'usage.json')),
    registry: new ModelRegistry(),
    providers,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
  });
  const refused = asFail(await gateway.run(request(), events().callbacks));
  assert.equal(refused.status, 503);
});
