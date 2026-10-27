import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentGateway } from '../ai/agent-gateway.js';
import { CircuitBreaker } from '../ai/circuit-breaker.js';
import { ModelRegistry } from '../ai/model-registry.js';
import { OpenRouterError } from '../ai/providers/openrouter-provider.js';
import { ProviderManager } from '../ai/providers/provider-factory.js';
import type { AIProvider } from '../ai/gateway-types.js';
import type {
  AgentCapableProvider,
  AgentProviderRequest,
  AgentProviderResult,
  AgentStreamEvent,
} from '../ai/agent/agent-types.js';
import { PLAN_ENTITLEMENTS, TRIAL_CREDITS } from '../services/entitlement.js';
import { CREDIT_PACKS } from '../services/pricing.js';
import { UsageStore } from '../store/usage-store.js';
import type { CreditService } from '../services/credits.js';
import { exhaust, memoryCredits, setBalance } from '../services/credits-fixture.js';
import { readJson, startTestServer, waitFor, type TestServer } from '../testing/server.js';
import type { AuthSession } from '../types.js';

type Script = (
  request: AgentProviderRequest,
  emit: (event: AgentStreamEvent) => void,
  call: number,
) => Promise<AgentProviderResult>;

const result = (over: Partial<AgentProviderResult> = {}): AgentProviderResult => ({
  content: 'готово',
  toolCalls: [],
  finishReason: 'stop',
  usage: { inputTokens: 1200, outputTokens: 80 },
  cost: 0.004,
  ...over,
});

interface Harness {
  server: TestServer;
  calls: AgentProviderRequest[];
  usage: UsageStore;
  /** Кредиты шлюза: тесты выдают и списывают их напрямую. */
  credits: CreditService;
  /** Регистрирует пользователя (по умолчанию — с купленным пакетом кредитов) и выдаёт ему API-ключ. */
  caller: (
    plan?: 'free' | 'credits',
  ) => Promise<{ secret: string; userId: string; token: string; keyId: string }>;
}

let emailCounter = 0;

/** Остаток после покупки самого малого пакета: пакет и пробные кредиты, выданные при первом запросе. */
const START_BALANCE = CREDIT_PACKS[0]!.credits + TRIAL_CREDITS;

async function harness(script: Script): Promise<Harness> {
  const calls: AgentProviderRequest[] = [];
  const provider: AIProvider & AgentCapableProvider = {
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
  const providers = new ProviderManager();
  providers.setProvider('openrouter', provider);
  const usage = new UsageStore(join(mkdtempSync(join(tmpdir(), 'ketner-v1-')), 'usage.json'));
  const credits = memoryCredits();
  const gateway = new AgentGateway({
    usageStore: usage,
    registry: new ModelRegistry(),
    providers,
    circuitBreaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    credits,
  });
  const server = await startTestServer({}, { agentGateway: gateway, usageStore: usage });

  const caller: Harness['caller'] = async (plan = 'credits') => {
    emailCounter += 1;
    const signup = await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `dev${emailCounter}@example.com`,
        password: 'password123',
        name: 'Dev',
      }),
    });
    const { token, user } = await readJson<AuthSession>(signup);
    if (plan !== 'free') {
      const checkout = await fetch(`${server.baseUrl}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packId: CREDIT_PACKS[0]!.id }),
      });
      assert.equal(checkout.status, 200);
      // Шлюз агента считает кредиты в своём журнале: покупка зеркалится туда же, где её видит сайт.
      credits.grantForPack(
        { id: `harness:${user.id}`, userId: user.id, method: 'stars' },
        CREDIT_PACKS[0]!,
      );
    }
    const created = server.apiKeyStore.create(user.id, 'тест');
    return { secret: created.secret, userId: user.id, token, keyId: created.key.id };
  };

  return { server, calls, usage, credits, caller };
}

const post = (h: Harness, secret: string, body: unknown, init: RequestInit = {}) =>
  fetch(`${h.server.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

const get = (h: Harness, secret: string, path: string) =>
  fetch(`${h.server.baseUrl}${path}`, { headers: { Authorization: `Bearer ${secret}` } });

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Читает файл',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
  },
];

interface ErrorBody {
  error: { message: string; type: string; code: string; param: string | null };
}

function sseData(text: string): Array<Record<string, unknown> | '[DONE]'> {
  return text
    .split('\n\n')
    .map((block) => block.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => {
      const payload = line.slice(6);
      return payload === '[DONE]'
        ? ('[DONE]' as const)
        : (JSON.parse(payload) as Record<string, unknown>);
    });
}

test('/api/keys: Free (только пробные кредиты) ключ не создаст, покупатель создаёт, секрет виден один раз, отзыв и лимит 10', async (t) => {
  const h = await harness(async () => result());
  t.after(() => h.server.close());

  const free = await h.caller('free');
  const denied = await fetch(`${h.server.baseUrl}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${free.token}` },
    body: JSON.stringify({ name: 'x' }),
  });
  assert.equal(denied.status, 403);

  const buyer = await h.caller('credits');
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer.token}` };
  const created = await fetch(`${h.server.baseUrl}/api/keys`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'MacBook' }),
  });
  assert.equal(created.status, 201);
  const { key, secret } = await readJson<{
    key: { id: string; name: string; prefix: string };
    secret: string;
  }>(created);
  assert.match(secret, /^ketner_sk_[0-9a-f]{64}$/);
  assert.equal(key.prefix, secret.slice(0, 14));

  const listed = await readJson<{ keys: Array<{ id: string }> }>(
    await fetch(`${h.server.baseUrl}/api/keys`, { headers: auth }),
  );
  assert.ok(listed.keys.some((k) => k.id === key.id));
  assert.equal(JSON.stringify(listed).includes(secret), false, 'секрет в списке не показывается');

  assert.equal(
    (
      await fetch(`${h.server.baseUrl}/api/keys`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({}),
      })
    ).status,
    400,
  );
  assert.equal((await fetch(`${h.server.baseUrl}/api/keys`)).status, 401);

  const revoked = await fetch(`${h.server.baseUrl}/api/keys/${key.id}`, {
    method: 'DELETE',
    headers: auth,
  });
  assert.equal(revoked.status, 200);
  assert.equal(
    (await fetch(`${h.server.baseUrl}/api/keys/${key.id}`, { method: 'DELETE', headers: auth }))
      .status,
    404,
  );
  assert.equal((await get(h, secret, '/v1/models')).status, 401, 'отозванный ключ не работает');

  // У пользователя уже есть один ключ из harness().caller(): добираем до 10 и проверяем 11-й.
  for (let i = 0; i < 9; i++) {
    const r = await fetch(`${h.server.baseUrl}/api/keys`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: `k${i}` }),
    });
    assert.equal(r.status, 201);
  }
  const limited = await fetch(`${h.server.baseUrl}/api/keys`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'лишний' }),
  });
  assert.equal(limited.status, 409);
});

test('/v1: без ключа, с чужим ключом и с токеном сессии вместо ключа — 401 в формате OpenAI', async (t) => {
  const h = await harness(async () => result());
  t.after(() => h.server.close());
  const me = await h.caller('credits');

  const none = await fetch(`${h.server.baseUrl}/v1/models`);
  assert.equal(none.status, 401);
  const body = await readJson<ErrorBody>(none);
  assert.equal(body.error.code, 'invalid_api_key');
  assert.equal(body.error.type, 'authentication_error');

  assert.equal((await get(h, `ketner_sk_${'0'.repeat(64)}`, '/v1/models')).status, 401);
  assert.equal(
    (await get(h, me.token, '/v1/models')).status,
    401,
    'токен сессии сайта не заменяет API-ключ',
  );
  assert.equal((await get(h, me.secret, '/v1/models')).status, 200);
});

test('GET /v1/models: auto и публичные модели; у покупателя кредитов доступны все, у Free — нет', async (t) => {
  const h = await harness(async () => result());
  t.after(() => h.server.close());
  const plus = await h.caller('credits');
  const list = await readJson<{
    object: string;
    data: Array<{ id: string; available: boolean; requires_plan: string; object: string }>;
  }>(await get(h, plus.secret, '/v1/models'));
  assert.equal(list.object, 'list');
  const ids = list.data.map((m) => m.id);
  assert.deepEqual(ids, [
    'auto',
    'ketner-mini',
    'ketner-pro',
    'claude-haiku-5.5',
    'deepseek-v4.1-flash',
    'minimax-m3.1-flash',
    'glm-5.3-flash',
    'qwen3.8-flash',
    'gpt-5.6-luna-pro',
    'qwen3.8-27b',
    'gemini-3.7-flash',
    'gpt-6.1-terra',
    'glm-5.3',
    'qwen3.8-max',
    'kimi-k3.1',
    'gpt-6.1-sol',
    'claude-opus-5.5',
    'claude-sonnet-5.5',
    'gpt-6-astra',
    'grok-4.7',
    'gemini-4-argon',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
  ]);
  const byId = Object.fromEntries(list.data.map((m) => [m.id, m]));
  assert.ok(
    list.data.every((m) => m.available),
    'все модели доступны покупателю кредитов',
  );
  assert.ok(list.data.every((m) => m.requires_plan === 'credits'));
  assert.equal(byId['claude-opus-5.5'].available, true);
  assert.equal(byId['ketner-pro'].object, 'model');

  const free = await h.caller('free');
  const freeList = await readJson<typeof list>(await get(h, free.secret, '/v1/models'));
  assert.ok(
    freeList.data.every((m) => !m.available),
    'до первой покупки API закрыт',
  );
});

test('GET /v1/models/:id: одна модель как в списке, неизвестная — 404 model_not_found', async (t) => {
  const h = await harness(async () => result());
  t.after(() => h.server.close());
  const plus = await h.caller('credits');
  const found = await get(h, plus.secret, '/v1/models/ketner-pro');
  assert.equal(found.status, 200);
  const model = await readJson<{ id: string; object: string; available: boolean }>(found);
  assert.equal(model.id, 'ketner-pro');
  assert.equal(model.object, 'model');
  assert.equal(model.available, true);

  const missing = await get(h, plus.secret, '/v1/models/gpt-2');
  assert.equal(missing.status, 404);
  assert.equal((await readJson<ErrorBody>(missing)).error.code, 'model_not_found');
});

test('/v1 для сторонних приложений: CORS с любого сайта без cookie и X-Request-Id у ответа', async (t) => {
  const h = await harness(async () => result());
  t.after(() => h.server.close());
  const plus = await h.caller('credits');

  const preflight = await fetch(`${h.server.baseUrl}/v1/chat/completions`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://my-app.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,x-stainless-os',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /x-stainless-os/);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);

  const response = await fetch(`${h.server.baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${plus.secret}`, Origin: 'https://my-app.example' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-expose-headers') ?? '', /X-Request-Id/);
  assert.match(response.headers.get('x-request-id') ?? '', /^req_[0-9a-f]{24}$/);

  const site = await fetch(`${h.server.baseUrl}/api/keys`, {
    headers: { Origin: 'https://my-app.example' },
  });
  assert.equal(
    site.headers.get('access-control-allow-origin'),
    null,
    'API сайта с cookie чужим сайтам по-прежнему закрыт',
  );
});

test('параметры генерации OpenAI доходят до провайдера: response_format, stop, seed, top_p', async (t) => {
  const h = await harness(async () => result({ content: '{"ok":true}' }));
  t.after(() => h.server.close());
  const plus = await h.caller('credits');
  const response = await post(h, plus.secret, {
    model: 'ketner-pro',
    messages: [{ role: 'user', content: 'ответь JSON' }],
    response_format: { type: 'json_object' },
    stop: ['\n\n'],
    seed: 7,
    top_p: 0.5,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls[0].sampling, {
    responseFormat: { type: 'json_object' },
    stop: ['\n\n'],
    seed: 7,
    topP: 0.5,
  });
});

test('POST /v1/chat/completions без стриминга: вызов функции, расход и решение маршрутизации', async (t) => {
  const h = await harness(async (_r, emit) => {
    emit({
      kind: 'tool_call',
      index: 0,
      id: 'call_1',
      name: 'read_file',
      argumentsDelta: '{"path":"src/a.ts"}',
    });
    return result({
      content: '',
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' },
        },
      ],
      finishReason: 'tool_calls',
      cost: 0.0123,
    });
  });
  t.after(() => h.server.close());
  const dev = await h.caller('credits');

  const response = await post(h, dev.secret, {
    model: 'ketner-pro',
    messages: [
      { role: 'system', content: 'Ты кодинг-агент' },
      { role: 'user', content: 'открой src/a.ts' },
    ],
    tools: TOOLS,
    tool_choice: 'auto',
  });
  assert.equal(response.status, 200);
  const body = await readJson<{
    id: string;
    object: string;
    model: string;
    choices: Array<{
      message: {
        content: unknown;
        tool_calls: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      finish_reason: string;
    }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    ketner: {
      cost_usd: number;
      requested_model: string;
      routing_reason: string;
      credits: { charged: number; balance: number; stage: string };
    };
  }>(response);

  assert.equal(body.object, 'chat.completion');
  assert.match(body.id, /^chatcmpl-/);
  assert.equal(body.model, 'ketner-pro');
  assert.equal(body.choices[0].finish_reason, 'tool_calls');
  assert.equal(body.choices[0].message.content, null);
  assert.equal(body.choices[0].message.tool_calls[0].function.name, 'read_file');
  assert.deepEqual(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments), {
    path: 'src/a.ts',
  });
  assert.equal(body.usage.total_tokens, 1280);
  assert.equal(body.ketner.cost_usd, 0.0123);
  assert.equal(body.ketner.requested_model, 'ketner-pro');
  assert.equal(body.ketner.credits.stage, 'normal');
  assert.equal(body.ketner.credits.charged, 12.3, '$0.0123 = 12.3 кредита');
  assert.equal(
    body.ketner.credits.balance,
    Math.floor(START_BALANCE - 12.3),
    'остаток показывается целыми кредитами, вниз',
  );

  assert.equal(h.calls[0].model, 'xiaomi/mimo-v2.6-pro');
  assert.deepEqual(h.calls[0].tools, TOOLS);
  const [record] = h.usage.getByUser(dev.userId);
  assert.equal(record.conversationId, `api:${dev.keyId}`);
  assert.equal(record.actualCost, 0.0123);
});

test('круг инструмента: ответ tool возвращается модели, итог приходит текстом', async (t) => {
  const h = await harness(async (request, emit, call) => {
    if (call === 1) {
      emit({
        kind: 'tool_call',
        index: 0,
        id: 'c1',
        name: 'read_file',
        argumentsDelta: '{"path":"a"}',
      });
      return result({
        content: '',
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a"}' },
          },
        ],
        finishReason: 'tool_calls',
      });
    }
    const last = request.messages[request.messages.length - 1];
    assert.equal(last.role, 'tool');
    emit({ kind: 'content', text: 'В файле одна строка.' });
    return result({ content: 'В файле одна строка.' });
  });
  t.after(() => h.server.close());
  const dev = await h.caller('credits');
  const messages: unknown[] = [{ role: 'user', content: 'что в a?' }];

  const first = await readJson<{ choices: Array<{ message: Record<string, unknown> }> }>(
    await post(h, dev.secret, { model: 'ketner-pro', messages, tools: TOOLS }),
  );
  const assistant = first.choices[0].message;
  messages.push(assistant, { role: 'tool', tool_call_id: 'c1', content: 'const a = 1;' });

  const second = await readJson<{
    choices: Array<{ message: { content: string }; finish_reason: string }>;
  }>(await post(h, dev.secret, { model: 'ketner-pro', messages, tools: TOOLS }));
  assert.equal(second.choices[0].finish_reason, 'stop');
  assert.equal(second.choices[0].message.content, 'В файле одна строка.');
  assert.equal(h.calls.length, 2);
  assert.equal(h.usage.getByUser(dev.userId).length, 2, 'каждый шаг — отдельная запись расхода');
});

test('стриминг: роль, размышления, вызов функции по частям, finish_reason, расход, [DONE]', async (t) => {
  const h = await harness(async (_r, emit) => {
    emit({ kind: 'reasoning', text: 'смотрю' });
    emit({ kind: 'content', text: 'Открываю ' });
    emit({ kind: 'tool_call', index: 0, id: 'c9', name: 'read_file', argumentsDelta: '' });
    emit({ kind: 'tool_call', index: 0, argumentsDelta: '{"path":' });
    emit({ kind: 'tool_call', index: 0, argumentsDelta: '"b.ts"}' });
    return result({
      content: 'Открываю ',
      toolCalls: [
        {
          id: 'c9',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"b.ts"}' },
        },
      ],
      finishReason: 'tool_calls',
      cost: 0.02,
    });
  });
  t.after(() => h.server.close());
  const dev = await h.caller('credits');

  const response = await post(h, dev.secret, {
    model: 'ketner-pro',
    stream: true,
    messages: [{ role: 'user', content: 'открой b.ts' }],
    tools: TOOLS,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const chunks = sseData(await response.text());

  assert.equal(chunks[chunks.length - 1], '[DONE]');
  const objects = chunks.filter((c): c is Record<string, unknown> => c !== '[DONE]');
  type Chunk = {
    choices: Array<{ delta: Record<string, unknown>; finish_reason: string | null }>;
    model: string;
    usage?: Record<string, number>;
    ketner?: Record<string, unknown>;
  };
  const typed = objects as unknown as Chunk[];

  assert.equal(typed[0].choices[0].delta.role, 'assistant');
  assert.ok(typed.every((c) => c.model === 'ketner-pro'));
  assert.equal(typed.filter((c) => c.choices[0]?.delta.reasoning_content === 'смотрю').length, 1);
  assert.equal(typed.map((c) => c.choices[0]?.delta.content ?? '').join(''), 'Открываю ');

  let args = '';
  let name = '';
  for (const c of typed) {
    for (const call of (c.choices[0]?.delta.tool_calls as
      Array<{ id?: string; function?: { name?: string; arguments?: string } }> | undefined) ?? []) {
      name ||= call.function?.name ?? '';
      args += call.function?.arguments ?? '';
    }
  }
  assert.equal(name, 'read_file');
  assert.deepEqual(JSON.parse(args), { path: 'b.ts' });

  const finish = typed.find((c) => c.choices[0]?.finish_reason);
  assert.equal(finish?.choices[0].finish_reason, 'tool_calls');
  // Без stream_options.include_usage расход едет в куске с finish_reason, а у каждого куска
  // есть choices[0]: так не падают клиенты, которые читают chunk.choices[0] не глядя.
  assert.equal(finish?.usage?.total_tokens, 1280);
  assert.equal((finish?.ketner as { cost_usd: number }).cost_usd, 0.02);
  assert.ok(typed.every((c) => c.choices.length === 1));
  assert.equal(typed[typed.length - 1], finish);

  const withUsage = await post(h, dev.secret, {
    model: 'ketner-pro',
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: 'user', content: 'открой b.ts' }],
    tools: TOOLS,
  });
  const tailChunks = sseData(await withUsage.text()).filter(
    (c): c is Record<string, unknown> => c !== '[DONE]',
  ) as unknown as Chunk[];
  const tail = tailChunks[tailChunks.length - 1];
  assert.deepEqual(tail.choices, [], 'include_usage: отдельный кусок с расходом, как у OpenAI');
  assert.equal(tail.usage?.total_tokens, 1280);
  assert.equal((tail.ketner as { cost_usd: number }).cost_usd, 0.02);
});

test('отказ до начала ответа остаётся обычным HTTP-статусом даже при stream=true', async (t) => {
  const warn = console.warn;
  console.warn = () => undefined;
  t.after(() => {
    console.warn = warn;
  });
  const h = await harness(async (r) => {
    throw new OpenRouterError(r.model, 500, 'boom');
  });
  t.after(() => h.server.close());
  const dev = await h.caller('credits');

  const response = await post(h, dev.secret, {
    stream: true,
    messages: [{ role: 'user', content: 'x' }],
  });
  assert.equal(response.status, 502);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal((await readJson<ErrorBody>(response)).error.code, 'upstream_error');
});

test('обрыв посреди потока: событие error, затем расход и [DONE], без finish_reason', async (t) => {
  const warn = console.warn;
  console.warn = () => undefined;
  t.after(() => {
    console.warn = warn;
  });
  const h = await harness(async (_r, emit) => {
    emit({ kind: 'content', text: 'начало' });
    throw new Error('socket hang up');
  });
  t.after(() => h.server.close());
  const dev = await h.caller('credits');

  const chunks = sseData(
    await (
      await post(h, dev.secret, { stream: true, messages: [{ role: 'user', content: 'x' }] })
    ).text(),
  );
  const objects = chunks.filter((c): c is Record<string, unknown> => c !== '[DONE]');
  assert.ok(
    objects.some((c) => 'error' in c),
    'клиент узнаёт об обрыве',
  );
  assert.equal(
    objects.some(
      (c) => (c.choices as Array<{ finish_reason: string | null }> | undefined)?.[0]?.finish_reason,
    ),
    false,
  );
  assert.equal(chunks[chunks.length - 1], '[DONE]');
});

test('Free: 403 upgrade_required; неверный JSON, ошибка тела и слишком большое тело', async (t) => {
  const h = await harness(async () => result());
  t.after(() => h.server.close());
  const free = await h.caller('free');
  const denied = await post(h, free.secret, { messages: [{ role: 'user', content: 'x' }] });
  assert.equal(denied.status, 403);
  const deniedBody = await readJson<ErrorBody>(denied);
  assert.equal(deniedBody.error.code, 'upgrade_required');
  assert.equal(deniedBody.error.type, 'permission_error');

  const dev = await h.caller('credits');
  const badJson = await post(h, dev.secret, '{"messages": [');
  assert.equal(badJson.status, 400);
  assert.equal((await readJson<ErrorBody>(badJson)).error.type, 'invalid_request_error');

  const badBody = await post(h, dev.secret, {
    messages: [{ role: 'user', content: 'x' }],
    temperature: 9,
  });
  assert.equal(badBody.status, 400);
  assert.equal((await readJson<ErrorBody>(badBody)).error.param, 'temperature');

  const huge = await post(h, dev.secret, {
    messages: [{ role: 'user', content: 'a'.repeat(9 * 1024 * 1024) }],
  });
  assert.equal(huge.status, 413);
  assert.equal((await readJson<ErrorBody>(huge)).error.code, 'request_too_large');

  const unknown = await get(h, dev.secret, '/v1/nope');
  assert.equal(unknown.status, 404);
  assert.equal((await readJson<ErrorBody>(unknown)).error.code, 'not_found');
  assert.equal(h.calls.length, 0, 'ни один отказ не дошёл до провайдера');
});

test('лимиты: параллельный запрос получает 429 с Retry-After', async (t) => {
  const h = await harness(async () => result());
  t.after(() => h.server.close());

  const busy = await h.caller('credits');
  for (let i = 0; i < PLAN_ENTITLEMENTS.credits.maxConcurrency; i++)
    h.usage.acquireConcurrencySlot(busy.userId);
  const limited = await post(h, busy.secret, { messages: [{ role: 'user', content: 'x' }] });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '5');
  assert.equal((await readJson<ErrorBody>(limited)).error.code, 'rate_limit_exceeded');
});

test('кредиты кончились: отвечает бесплатная модель агента, а не отказ insufficient_quota', async (t) => {
  const h = await harness(async () => result({ cost: 0 }));
  t.after(() => h.server.close());
  const broke = await h.caller('credits');
  exhaust(h.credits, broke.userId, 'credits');

  for (let i = 0; i < 2; i++) {
    const response = await post(h, broke.secret, { messages: [{ role: 'user', content: 'x' }] });
    assert.equal(response.status, 200);
    const body = await readJson<{
      model: string;
      ketner: {
        routing_reason: string;
        credits: { charged: number; balance: number; stage: string };
      };
    }>(response);
    assert.equal(body.model, 'north-mini-code');
    assert.match(body.ketner.routing_reason, /Credits used up/);
    assert.deepEqual(body.ketner.credits, { charged: 0, balance: 0, stage: 'exhausted' });
  }
  assert.equal(h.calls[0].model, 'cohere/north-mini-code:free');
});

test('подмена модели видна клиенту: не хватает кредитов на выбранную — отвечает та, на которую хватает', async (t) => {
  const h = await harness(async () => result());
  t.after(() => h.server.close());
  const dev = await h.caller('credits');
  setBalance(h.credits, dev.userId, 'credits', 20); // GPT-6.1 Sol ≈ 35 кредитов за запрос

  const body = await readJson<{
    model: string;
    ketner: { requested_model: string; routing_reason: string };
  }>(
    await post(h, dev.secret, { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'x' }] }),
  );
  assert.notEqual(body.model, 'gpt-6.1-sol');
  assert.equal(body.ketner.requested_model, 'gpt-6.1-sol');
  assert.match(body.ketner.routing_reason, /Not enough credits for GPT-6\.1 Sol/);
  assert.notEqual(h.calls[0].model, 'openai/gpt-6.1-sol');
});

test('GET /v1/usage: остаток кредитов и число запросов меняются вместе с расходом', async (t) => {
  const h = await harness(async () => result({ cost: 0.5 }));
  t.after(() => h.server.close());
  const dev = await h.caller('credits');

  const before = await readJson<{
    plan: string;
    credits: { balance: number; stage: string; next_expires_at: string | null };
    requests_last_day: number;
  }>(await get(h, dev.secret, '/v1/usage'));
  assert.equal(before.plan, 'credits');
  assert.equal(before.credits.balance, START_BALANCE);
  assert.equal(before.credits.stage, 'normal');
  assert.ok(before.credits.next_expires_at, 'срок кредитов виден');
  assert.equal(before.requests_last_day, 0);
  assert.equal('monthly' in before.credits, false, 'месячной выдачи больше нет');
  assert.equal('period_days' in before, false);

  await post(h, dev.secret, { messages: [{ role: 'user', content: 'x' }] });
  const after = await readJson<typeof before>(await get(h, dev.secret, '/v1/usage'));
  assert.equal(after.credits.balance, START_BALANCE - 500);
  assert.equal(after.requests_last_day, 1);
});

test('клиент оборвал соединение: генерация останавливается, расход помечен cancelled', async (t) => {
  let providerSignal: AbortSignal | undefined;
  const h = await harness(
    (request, emit) =>
      new Promise<AgentProviderResult>((resolve) => {
        providerSignal = request.signal;
        emit({ kind: 'content', text: 'долгий ответ' });
        request.signal?.addEventListener('abort', () =>
          resolve(result({ content: 'долгий ответ', finishReason: 'cancelled', cost: 0.001 })),
        );
      }),
  );
  t.after(() => h.server.close());
  const dev = await h.caller('credits');

  const controller = new AbortController();
  const response = await post(
    h,
    dev.secret,
    { stream: true, messages: [{ role: 'user', content: 'x' }] },
    { signal: controller.signal },
  );
  const reader = response.body!.getReader();
  await reader.read();
  controller.abort();

  const record = await waitFor(async () => {
    const [latest] = h.usage.getByUser(dev.userId);
    return latest ?? null;
  });
  assert.equal(record.status, 'cancelled');
  assert.equal(providerSignal?.aborted, true);
});
