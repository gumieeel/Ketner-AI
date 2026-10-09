import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  AGENT_DAILY_COST_FACTOR,
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

function fakeProvider(script: Script, calls: AgentProviderRequest[]): AIProvider & AgentCapableProvider {
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
  const gateway = new AgentGateway({
    usageStore: usage,
    registry: new ModelRegistry(),
    providers,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
  });
  return { gateway, usage, calls };
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

const events = (): { list: AgentStreamEvent[]; callbacks: { onEvent: (e: AgentStreamEvent) => void } } => {
  const list: AgentStreamEvent[] = [];
  return { list, callbacks: { onEvent: (e) => list.push(e) } };
};

const asOk = (outcome: unknown): AgentSuccess => {
  const value = outcome as AgentSuccess | AgentFailure;
  assert.equal(value.kind, 'ok', value.kind === 'error' ? `${value.status} ${value.code}: ${value.message}` : '');
  return value as AgentSuccess;
};
const asFail = (outcome: unknown): AgentFailure => {
  const value = outcome as AgentSuccess | AgentFailure;
  assert.equal(value.kind, 'error', 'ожидалась ошибка');
  return value as AgentFailure;
};

/** Расход «вчера»: входит в месячный бюджет, но не в суточный лимит. */
function seed(usage: UsageStore, userId: string, cost: number, modelId = 'ketner-pro', ageMs = 3 * 86_400_000): void {
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
  record.createdAt = new Date(Date.now() - ageMs).toISOString();
}

test('ответ с вызовом функции: события идут клиенту, расход пишется по цене провайдера в api:<ключ>', async () => {
  const { gateway, usage, calls } = setup(async (_r, emit) => {
    emit({ kind: 'reasoning', text: 'думаю' });
    emit({ kind: 'tool_call', index: 0, id: 'c1', name: 'read_file', argumentsDelta: '{"path":"a.ts"}' });
    return okResult({
      content: '',
      toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
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
  assert.deepEqual(sink.list.map((e) => e.kind), ['reasoning', 'tool_call']);
  assert.equal(calls[0].model, 'xiaomi/mimo-v2.6-pro');
  assert.equal(calls[0].tools?.length, 1);

  const [record] = usage.getByUser(req.userId);
  assert.equal(record.conversationId, `api:${req.keyId}`);
  assert.equal(record.actualCost, 0.0123);
  assert.equal(record.cachedTokens, 4000);
  assert.equal(record.status, 'success');
});

test('Free не допускается; неизвестная модель и модель выше тарифа получают понятные отказы без вызова провайдера', async () => {
  const { gateway, calls } = setup(async () => okResult());
  const free = asFail(await gateway.run(request({ userPlan: 'free' }), events().callbacks));
  assert.equal(free.status, 403);
  assert.equal(free.code, 'upgrade_required');

  const unknown = asFail(await gateway.run(request({ model: 'gpt-4o' }), events().callbacks));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.code, 'model_not_found');

  const legacy = asFail(await gateway.run(request({ model: 'gemini-3.8-flash' }), events().callbacks));
  assert.equal(legacy.code, 'model_not_found', 'старые id вне публичного каталога не принимаются');

  const tooHigh = asFail(await gateway.run(request({ model: 'claude-opus-5.5' }), events().callbacks));
  assert.equal(tooHigh.status, 403);
  assert.match(tooHigh.message, /Pro/);
  assert.equal(calls.length, 0);
});

test('auto выбирает Ketner Pro и честно называет это в routing_reason', async () => {
  const { gateway, calls } = setup(async () => okResult());
  const out = asOk(await gateway.run(request({ model: 'auto' }), events().callbacks));
  assert.equal(out.model.id, 'ketner-pro');
  assert.equal(out.requestedModel, 'auto');
  assert.equal(out.routingReason, 'Auto: Ketner Pro');
  assert.equal(calls[0].model, 'xiaomi/mimo-v2.6-pro');
});

test('квота премиум-запросов исчерпана: отвечает Ketner Pro, причина названа, цена по ответившей модели', async () => {
  const { gateway, usage, calls } = setup(async () => okResult({ cost: 0.01 }));
  const req = request({ userPlan: 'pro', model: 'gpt-6.1-sol' });
  seed(usage, req.userId, PLAN_ENTITLEMENTS.pro.premiumBudget + 0.01, 'gpt-6.1-sol');

  const out = asOk(await gateway.run(req, events().callbacks));
  assert.equal(out.model.id, 'ketner-pro');
  assert.equal(out.requestedModel, 'gpt-6.1-sol');
  assert.match(out.routingReason, /Premium quota used up/);
  assert.equal(calls[0].model, 'xiaomi/mimo-v2.6-pro');
  assert.equal(out.budget.premiumAvailable, false);
  assert.equal(usage.getByUser(req.userId)[0].modelId, 'ketner-pro');
});

test('премиум-модель отвечает, пока квота есть', async () => {
  const { gateway, calls } = setup(async () => okResult());
  const out = asOk(await gateway.run(request({ userPlan: 'pro', model: 'gpt-6.1-sol' }), events().callbacks));
  assert.equal(out.model.id, 'gpt-6.1-sol');
  assert.equal(calls[0].model, 'openai/gpt-6.1-sol');
  assert.equal(out.budget.premiumAvailable, true);
});

test('бюджет исчерпан (100%): только лёгкая модель; жёсткий потолок (125%): отказ 429 без вызова провайдера', async () => {
  const { gateway, usage, calls } = setup(async () => okResult());
  const budget = PLAN_ENTITLEMENTS.plus.costBudget;

  const exhausted = request();
  seed(usage, exhausted.userId, budget * 1.05);
  const out = asOk(await gateway.run(exhausted, events().callbacks));
  assert.equal(out.model.id, 'ketner-mini');
  assert.match(out.routingReason, /Budget protection/);
  assert.equal(out.budget.stage === 'exhausted' || out.budget.stage === 'hard_stop', true);

  const callsBefore = calls.length;
  const stopped = request();
  seed(usage, stopped.userId, budget * 1.3);
  const refused = asFail(await gateway.run(stopped, events().callbacks));
  assert.equal(refused.status, 429);
  assert.equal(refused.code, 'insufficient_quota');
  assert.equal(calls.length, callsBefore);
});

test('токенные окна чата для агента не действуют, а суточный лимит расхода втрое выше', async () => {
  const { gateway, usage } = setup(async () => okResult({ cost: 0.001 }));

  // 400k токенов за последний час при чатовом лимите Plus 300k: чат отказал бы.
  const heavy = request();
  usage.recordUsage({
    userId: heavy.userId, conversationId: 'api:old', modelId: 'ketner-pro', provider: 'openrouter',
    inputTokens: 400_000, outputTokens: 1000, estimatedCost: 0.01, latencyMs: 1, status: 'success',
  });
  asOk(await gateway.run(heavy, events().callbacks));

  const dailyCap = PLAN_ENTITLEMENTS.plus.maxDailyCost!;
  const mid = request();
  seed(usage, mid.userId, dailyCap * 1.5, 'ketner-pro', 3_600_000);
  asOk(await gateway.run(mid, events().callbacks));

  const over = request();
  seed(usage, over.userId, dailyCap * AGENT_DAILY_COST_FACTOR + 0.01, 'ketner-pro', 3_600_000);
  const refused = asFail(await gateway.run(over, events().callbacks));
  assert.equal(refused.status, 429);
  assert.equal(refused.code, 'rate_limit_exceeded');
  assert.equal(refused.retryAfterSec, 3600);
});

test('параллельный запрос сверх лимита тарифа отклоняется с Retry-After', async () => {
  const { gateway, usage } = setup(async () => okResult());
  const req = request();
  for (let i = 0; i < PLAN_ENTITLEMENTS.plus.maxConcurrency; i++) usage.acquireConcurrencySlot(req.userId);
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
    assert.equal(usage.getFairUseSnapshot(req.userId).requestsLastDay, 0, 'сбой не списывает лимит');
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
      throw new OpenRouterError(r.model, 400, "This model's maximum context length is 200000 tokens");
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

test('глубина размышлений: потолок по тарифу, в экономном режиме не выше low', () => {
  assert.equal(chooseAgentEffort('high', 'plus', 'normal'), 'medium');
  assert.equal(chooseAgentEffort('high', 'pro', 'normal'), 'medium');
  assert.equal(chooseAgentEffort('high', 'ultra', 'normal'), 'high');
  assert.equal(chooseAgentEffort('high', 'ultra', 'soft'), 'low');
  assert.equal(chooseAgentEffort('minimal', 'plus', 'normal'), 'none');
  assert.equal(chooseAgentEffort('none', 'ultra', 'soft'), 'none');
  assert.equal(chooseAgentEffort('low', 'plus', 'normal'), 'low');
});

test('глубина размышлений доходит до провайдера в формате модели', async () => {
  const { gateway, calls } = setup(async () => okResult());
  await gateway.run(request({ userPlan: 'ultra', model: 'ketner-mini', reasoningEffort: 'high' }), events().callbacks);
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
  providers.setProvider('openrouter', { ...fakeProvider(async () => okResult(), []), isAvailable: () => false });
  const gateway = new AgentGateway({
    usageStore: new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-agent-')), 'usage.json')),
    registry: new ModelRegistry(),
    providers,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
  });
  const refused = asFail(await gateway.run(request(), events().callbacks));
  assert.equal(refused.status, 503);
});
