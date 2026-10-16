import assert from 'node:assert/strict';
import test from 'node:test';
import { CircuitBreaker } from '../circuit-breaker.js';
import { directRequestCost } from '../engine-pricing.js';
import type {
  AIProvider,
  ChatWireMessage,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from '../gateway-types.js';
import { ModelRegistry } from '../model-registry.js';
import { AnthropicProvider, toAnthropicAgentTurn } from './anthropic-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { OpenRouterError, OpenRouterProvider } from './openrouter-provider.js';
import { RoutedProvider } from './routed-provider.js';

const registry = new ModelRegistry();

/** Поток SSE Anthropic Messages API из списка событий. */
function anthropicSse(events: Array<Record<string, unknown>>): Response {
  const body = events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function messageStart(usage: Record<string, number>): Record<string, unknown> {
  return {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { output_tokens: 1, ...usage },
    },
  };
}

const delta = (index: number, value: Record<string, unknown>) => ({
  type: 'content_block_delta',
  index,
  delta: value,
});

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeFetch(respond: () => Response, calls: Captured[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return respond();
  }) as typeof fetch;
}

test('Anthropic напрямую: размышления потоком в <think>, кэш в usage, effort и точки кэша', async () => {
  const calls: Captured[] = [];
  const provider = new AnthropicProvider({
    apiKey: 'sk-ant-test',
    fetch: fakeFetch(
      () =>
        anthropicSse([
          messageStart({
            input_tokens: 120,
            cache_creation_input_tokens: 300,
            cache_read_input_tokens: 6000,
          }),
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          },
          delta(0, { type: 'thinking_delta', thinking: 'Считаю…' }),
          delta(0, { type: 'signature_delta', signature: 'sig-1' }),
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          delta(1, { type: 'text_delta', text: 'Ответ: ' }),
          delta(1, { type: 'text_delta', text: '42' }),
          { type: 'content_block_stop', index: 1 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 80 },
          },
          { type: 'message_stop' },
        ]),
      calls,
    ),
  });
  assert.equal(provider.isAvailable(), true);
  assert.equal(new AnthropicProvider({ apiKey: '' }).isAvailable(), false, 'без ключа выключен');

  const deltas: string[] = [];
  const result = await provider.streamText(
    {
      model: 'claude-opus-5-5',
      messages: [
        { role: 'system', content: 'Ты Ketner AI' },
        { role: 'user', content: 'Якорь' },
        { role: 'assistant', content: 'Ответ 1' },
        { role: 'user', content: 'Вопрос 2' },
        { role: 'assistant', content: 'Ответ 2' },
        { role: 'user', content: 'Сколько будет 6×7?' },
      ],
      maxTokens: 4096,
      stream: true,
      reasoning: { effort: 'medium' },
      temperature: 0.7,
    },
    { onDelta: (d) => deltas.push(d), isCancelled: () => false },
  );

  assert.equal(deltas.join(''), '<think>\nСчитаю…\n</think>\n\nОтвет: 42');
  assert.equal(result.content, deltas.join(''));
  assert.deepEqual(result.usage, {
    inputTokens: 6420,
    outputTokens: 80,
    cachedTokens: 6000,
    cacheWriteTokens: 300,
  });
  assert.equal(result.via, 'anthropic');
  assert.equal(result.finishReason, 'stop');

  const [call] = calls;
  assert.match(call.url, /\/v1\/messages$/);
  assert.equal(call.headers.get('x-api-key'), 'sk-ant-test');
  assert.ok(call.headers.get('anthropic-version'));
  const body = call.body as {
    model: string;
    stream: boolean;
    thinking: unknown;
    output_config: unknown;
    temperature?: unknown;
    system: Array<{ text: string; cache_control?: unknown }>;
    messages: Array<{ role: string; content: unknown }>;
  };
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.stream, true);
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(body.output_config, { effort: 'medium' });
  assert.equal(body.temperature, undefined, 'Claude 5.5 не принимает temperature');
  assert.deepEqual(body.system, [
    { type: 'text', text: 'Ты Ketner AI', cache_control: { type: 'ephemeral' } },
  ]);
  const cached = body.messages.map((m) => Array.isArray(m.content));
  assert.deepEqual(cached, [true, false, false, true, false], 'якорь и история перед вопросом');
});

test('Anthropic напрямую: шаг агента — вызовы инструментов, блоки размышлений туда и обратно', async () => {
  const calls: Captured[] = [];
  const provider = new AnthropicProvider({
    apiKey: 'sk-ant-test',
    fetch: fakeFetch(
      () =>
        anthropicSse([
          messageStart({ input_tokens: 50, cache_read_input_tokens: 0 }),
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          },
          delta(0, { type: 'thinking_delta', thinking: 'Нужен файл' }),
          delta(0, { type: 'signature_delta', signature: 'sig-2' }),
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} },
          },
          delta(1, { type: 'input_json_delta', partial_json: '{"path":' }),
          delta(1, { type: 'input_json_delta', partial_json: '"src/a.ts"}' }),
          { type: 'content_block_stop', index: 1 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: { output_tokens: 30 },
          },
          { type: 'message_stop' },
        ]),
      calls,
    ),
  });

  let activity = 0;
  const reasoning: string[] = [];
  const result = await provider.streamChat(
    {
      model: 'claude-sonnet-5-5',
      messages: [
        { role: 'system', content: 'Ты агент' },
        { role: 'user', content: 'Почини баг' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Прочитать файл',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
      ],
      reasoning: { effort: 'none' },
    },
    {
      onDelta: () => undefined,
      onReasoningDelta: (d) => reasoning.push(d),
      onActivity: () => {
        activity += 1;
      },
      isCancelled: () => false,
    },
  );
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(result.toolCalls, [
    { id: 'toolu_1', name: 'read_file', arguments: '{"path":"src/a.ts"}' },
  ]);
  assert.deepEqual(reasoning, ['Нужен файл']);
  assert.ok(activity > 0, 'сторож простоя видит активность');
  assert.deepEqual(result.reasoningDetails, [
    { type: 'thinking', thinking: 'Нужен файл', signature: 'sig-2' },
  ]);

  const body = calls[0].body as {
    tools: Array<Record<string, unknown>>;
    tool_choice: unknown;
    output_config: unknown;
  };
  assert.equal(body.tools[0].eager_input_streaming, true);
  assert.deepEqual(body.tool_choice, { type: 'auto' }, 'принудительный выбор не отправляем');
  assert.deepEqual(body.output_config, { effort: 'low' }, 'размышления не отключаются');

  // Следующий шаг: блоки размышлений — первыми в сообщении ассистента, без изменений; результаты
  // инструментов — блоками tool_result; точка кэша на последнем сообщении.
  const next: ChatWireMessage[] = [
    { role: 'system', content: 'Ты агент' },
    { role: 'user', content: 'Почини баг' },
    {
      role: 'assistant',
      content: '',
      toolCalls: result.toolCalls,
      reasoningDetails: [
        ...(result.reasoningDetails ?? []),
        { type: 'reasoning.text', text: 'блок OpenRouter' },
      ],
    },
    { role: 'tool', toolCallId: 'toolu_1', content: 'export const a = 1;' },
  ];
  const turn = toAnthropicAgentTurn(next);
  assert.deepEqual(turn.messages[1], {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Нужен файл', signature: 'sig-2' },
      { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'src/a.ts' } },
    ],
  });
  assert.deepEqual(turn.messages[2], {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: 'export const a = 1;',
        cache_control: { type: 'ephemeral' },
      },
    ],
  });
});

test('Anthropic напрямую: вызов, оборванный лимитом ответа, не исполняется', async () => {
  const provider = new AnthropicProvider({
    apiKey: 'sk-ant-test',
    fetch: fakeFetch(
      () =>
        anthropicSse([
          messageStart({ input_tokens: 10 }),
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_2', name: 'write_file', input: {} },
          },
          delta(0, { type: 'input_json_delta', partial_json: '{"path":"a.ts","content":"exp' }),
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'max_tokens', stop_sequence: null },
            usage: { output_tokens: 8192 },
          },
          { type: 'message_stop' },
        ]),
      [],
    ),
  });
  const result = await provider.streamChat(
    { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'Запиши файл' }] },
    { onDelta: () => undefined, isCancelled: () => false },
  );
  assert.equal(result.finishReason, 'length');
  assert.deepEqual(result.toolCalls, []);
});

test('OpenAI и Gemini напрямую: тело в формате API вендора, usage с кэшем из потока', async () => {
  const calls: Captured[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch(
    () =>
      new Response(
        [
          `data: ${JSON.stringify({ model: 'gpt-6.1-sol', choices: [{ delta: { content: 'Привет' } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
          `data: ${JSON.stringify({
            choices: [],
            usage: {
              prompt_tokens: 9000,
              completion_tokens: 50,
              prompt_tokens_details: { cached_tokens: 8000 },
            },
          })}`,
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { status: 200 },
      ),
    calls,
  );
  try {
    const openai = new OpenAICompatibleProvider({
      type: 'openai',
      name: 'OpenAI API',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
    });
    const result = await openai.streamText(
      {
        model: 'gpt-6.1-sol',
        messages: [
          { role: 'system', content: 'Ты Ketner AI' },
          { role: 'user', content: 'Привет' },
        ],
        maxTokens: 2048,
        stream: true,
        reasoning: { effort: 'xhigh' },
      },
      { onDelta: () => undefined, isCancelled: () => false },
    );
    assert.equal(result.content, 'Привет');
    assert.equal(result.usage.cachedTokens, 8000);
    assert.equal(result.cost, undefined, 'цену считает маршрутизатор по прайсу из реестра');

    const [call] = calls;
    assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(call.headers.get('authorization'), 'Bearer sk-openai');
    assert.equal(call.headers.get('http-referer'), null, 'заголовки OpenRouter не уходят');
    assert.equal(call.body.max_completion_tokens, 2048);
    assert.equal(call.body.max_tokens, undefined);
    assert.equal(call.body.usage, undefined);
    assert.equal(call.body.reasoning, undefined);
    assert.equal(call.body.reasoning_effort, 'xhigh');
    assert.deepEqual(call.body.stream_options, { include_usage: true });

    const gemini = new OpenAICompatibleProvider({
      type: 'google',
      name: 'Gemini API',
      apiKey: 'g-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });
    const body = gemini.buildBody(
      {
        model: 'gemini-3.7-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
        reasoning: { effort: 'none' },
      },
      true,
    );
    assert.equal(body.reasoning_effort, 'low', 'у Gemini размышления не отключаются');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Hi' }], 'без точек кэша OpenRouter');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─────────────── Маршрутизатор: прямой путь → OpenRouter ───────────────

function fakeProvider(
  type: AIProvider['type'],
  script: (
    options: ProviderRequestOptions,
    cb: ProviderStreamCallbacks,
  ) => Promise<ProviderResponse>,
  calls: string[],
): AIProvider {
  return {
    type,
    name: type,
    isAvailable: () => true,
    generateText: (options) => {
      calls.push(`${type}:${options.model}`);
      return script(options, { onDelta: () => undefined, isCancelled: () => false });
    },
    streamText: (options, cb) => {
      calls.push(`${type}:${options.model}`);
      return script(options, cb);
    },
  };
}

const ok =
  (text: string, usage: ProviderResponse['usage'] = { inputTokens: 1000, outputTokens: 100 }) =>
  async (_o: ProviderRequestOptions, cb: ProviderStreamCallbacks): Promise<ProviderResponse> => {
    cb.onDelta(text);
    return { content: text, usage, finishReason: 'stop' };
  };

function routed(
  direct: AIProvider,
  openrouterScript: Parameters<typeof fakeProvider>[1],
  calls: string[],
  breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 }),
) {
  const openrouter = fakeProvider(
    'openrouter',
    openrouterScript,
    calls,
  ) as unknown as OpenRouterProvider;
  return {
    provider: new RoutedProvider(openrouter, { anthropic: direct }, registry, breaker),
    breaker,
  };
}

const ask = (provider: AIProvider, model = 'anthropic/claude-opus-5.5') => {
  const deltas: string[] = [];
  return provider
    .streamText(
      { model, messages: [{ role: 'user', content: 'q' }], stream: true },
      { onDelta: (d) => deltas.push(d), isCancelled: () => false },
    )
    .then((response) => ({ response, deltas }));
};

test('маршрутизатор: с ключом модель вендора идёт напрямую, цена — по прайсу прямого API', async () => {
  const calls: string[] = [];
  const { provider } = routed(
    fakeProvider(
      'anthropic',
      ok('напрямую', {
        inputTokens: 10_000,
        outputTokens: 1_000,
        cachedTokens: 8_000,
        cacheWriteTokens: 1_000,
      }),
      calls,
    ),
    ok('через OpenRouter'),
    calls,
  );
  const { response } = await ask(provider);
  assert.deepEqual(calls, ['anthropic:claude-opus-5-5']);
  assert.equal(response.via, 'anthropic');
  assert.equal(response.model, 'anthropic/claude-opus-5.5', 'та же модель, без подмены');
  const pricing = registry.get('claude-opus-5.5')!.direct!.pricing;
  // 1 000 свежих × $4 + 1 000 записи × $5 + 8 000 из кэша × $0.20 + 1 000 выхода × $20
  assert.equal(response.cost, 0.0306);
  assert.equal(
    response.cost,
    directRequestCost(
      { inputTokens: 10_000, outputTokens: 1_000, cachedTokens: 8_000, cacheWriteTokens: 1_000 },
      pricing,
    ),
  );

  // Модели без прямого пути (и других вендоров) идут через OpenRouter как раньше.
  calls.length = 0;
  await ask(provider, 'xiaomi/mimo-v2.6-pro');
  await ask(provider, 'openai/gpt-6.1-sol');
  assert.deepEqual(calls, ['openrouter:xiaomi/mimo-v2.6-pro', 'openrouter:openai/gpt-6.1-sol']);
});

test('маршрутизатор: сбой прямого API — тот же запрос через OpenRouter, предохранитель закрывает путь', async () => {
  const calls: string[] = [];
  const failing = fakeProvider(
    'anthropic',
    async () => {
      throw new Error('529 overloaded');
    },
    calls,
  );
  const { provider, breaker } = routed(failing, ok('через OpenRouter'), calls);

  const first = await ask(provider);
  assert.equal(first.response.via, undefined, 'ответил OpenRouter');
  assert.deepEqual(first.deltas, ['через OpenRouter']);
  await ask(provider);
  assert.equal(breaker.getStatus('anthropic:claude-opus-5-5').state, 'open');

  calls.length = 0;
  await ask(provider);
  assert.deepEqual(calls, ['openrouter:anthropic/claude-opus-5.5'], 'закрытый путь не пробуется');
});

test('маршрутизатор: оборвалось после начала ответа — второй ответ не дописывается', async () => {
  const calls: string[] = [];
  const { provider } = routed(
    fakeProvider(
      'anthropic',
      async (_o, cb) => {
        cb.onDelta('половина');
        throw new Error('connection reset');
      },
      calls,
    ),
    ok('через OpenRouter'),
    calls,
  );
  await assert.rejects(ask(provider), /connection reset/);
  assert.deepEqual(calls, ['anthropic:claude-opus-5-5']);
});

test('маршрутизатор: без ключа OpenRouter ошибка прямого пути уходит шлюзу (следующая модель)', async () => {
  const calls: string[] = [];
  const openrouter = new OpenRouterProvider({ apiKey: '' });
  const provider = new RoutedProvider(
    openrouter,
    {
      anthropic: fakeProvider(
        'anthropic',
        async () => {
          throw new OpenRouterError('claude-opus-5-5', 500, 'boom');
        },
        calls,
      ),
    },
    registry,
    new CircuitBreaker(),
  );
  assert.equal(provider.isAvailable(), true, 'прямой ключ сам по себе включает канал');
  await assert.rejects(ask(provider), /boom/);
});

test('реестр: у моделей Anthropic, OpenAI и Google есть прямой путь и цены рядом с ценами OpenRouter', () => {
  const expectations: Record<string, [string, string]> = {
    'claude-opus-5.5': ['anthropic', 'claude-opus-5-5'],
    'claude-sonnet-5.5': ['anthropic', 'claude-sonnet-5-5'],
    'claude-haiku-5.5': ['anthropic', 'claude-haiku-5-5'],
    'gpt-6.1-sol': ['openai', 'gpt-6.1-sol'],
    'gpt-6-astra': ['openai', 'gpt-6-astra'],
    'ketner-mini': ['openai', 'gpt-6-luna'],
    'gemini-3.7-flash': ['google', 'gemini-3.7-flash'],
  };
  for (const [id, [provider, modelId]] of Object.entries(expectations)) {
    const entry = registry.get(id)!;
    assert.equal(entry.provider, 'openrouter', `${id}: основной канал прежний`);
    assert.equal(entry.direct?.provider, provider, id);
    assert.equal(entry.direct?.modelId, modelId, id);
    assert.ok(
      entry.direct!.pricing.inputPricePerMillion <= entry.pricing.inputPricePerMillion,
      `${id}: прямой путь не дороже OpenRouter`,
    );
  }
  assert.equal(registry.get('ketner-pro')!.direct, undefined, 'MiMo — только через OpenRouter');
  assert.equal(registry.get('grok-4.7')!.direct, undefined, 'xAI — только через OpenRouter');
});
