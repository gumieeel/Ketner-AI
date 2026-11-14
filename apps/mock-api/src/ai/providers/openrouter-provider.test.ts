import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouterError, OpenRouterProvider } from './openrouter-provider.js';

type FetchFn = typeof globalThis.fetch;

function sse(chunks: unknown[], opts: { failAfter?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  const lines = chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`);
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller: ReadableStreamDefaultController<Uint8Array>) {
      if (i < lines.length) {
        controller.enqueue(encoder.encode(lines[i++]));
      } else if (opts.failAfter) {
        controller.error(new Error('socket hang up'));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function withFetch<T>(impl: FetchFn, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const delta = (content: string) => ({ choices: [{ delta: { content } }] });

test('стрим возвращает реальную стоимость usage.cost и фактическую модель', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const sent: Array<Record<string, unknown>> = [];
  const result = await withFetch(
    (async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return sse([
        { model: 'deepseek/deepseek-v4.1-flash', ...delta('Привет') },
        delta(', мир'),
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 120, completion_tokens: 8, cost: 0.000042 },
        },
        '[DONE]',
      ]);
    }) as FetchFn,
    () =>
      provider.streamText(
        {
          model: 'deepseek/deepseek-v4.1-flash',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
          maxTokens: 100,
        },
        { onDelta: () => undefined, isCancelled: () => false },
      ),
  );
  assert.equal(result.content, 'Привет, мир');
  assert.equal(result.cost, 0.000042);
  assert.equal(result.model, 'deepseek/deepseek-v4.1-flash');
  assert.equal(result.usage.inputTokens, 120);
  assert.deepEqual(
    sent[0].usage,
    { include: true },
    'учёт стоимости должен запрашиваться у OpenRouter',
  );
});

test('отказ модели (например 404) логируется и поднимается шлюзу: скрытых запасных моделей нет', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
  let calls = 0;
  const requested: string[] = [];
  let failure: unknown;
  try {
    await withFetch(
      (async (_url: unknown, init?: RequestInit) => {
        calls++;
        requested.push(String(JSON.parse(String(init?.body)).model));
        return new Response('{"error":{"message":"No endpoints found for bad/model"}}', {
          status: 404,
        });
      }) as FetchFn,
      () =>
        provider.streamText(
          { model: 'bad/model', messages: [{ role: 'user', content: 'x' }], stream: true },
          { onDelta: () => undefined, isCancelled: () => false },
        ),
    ).catch((err: unknown) => {
      failure = err;
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(calls, 1, 'провайдер не перебирает другие модели сам');
  assert.deepEqual(requested, ['bad/model']);
  assert.ok(failure instanceof OpenRouterError);
  assert.equal((failure as OpenRouterError).status, 404);
  assert.ok(
    warnings.some((w) => w.includes('bad/model') && w.includes('404')),
    'отказ должен попасть в лог',
  );
  assert.ok(!warnings.join('\n').includes('"k"'), 'ключ не должен попадать в лог');
});

test('HTTP 402 (кончились кредиты) громко попадает в лог ошибкой и поднимается со статусом', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args.join(' '));
  let failure: unknown;
  try {
    await withFetch(
      (async () =>
        new Response('{"error":{"message":"Insufficient credits"}}', { status: 402 })) as FetchFn,
      () =>
        provider.generateText({
          model: 'openai/gpt-6-luna',
          messages: [{ role: 'user', content: 'x' }],
          stream: false,
        }),
    ).catch((err: unknown) => {
      failure = err;
    });
  } finally {
    console.error = originalError;
  }
  assert.ok(failure instanceof OpenRouterError);
  assert.equal((failure as OpenRouterError).status, 402);
  assert.ok(
    errors.some((e) => e.includes('кредиты')),
    'нехватка кредитов должна быть заметна в логах',
  );
});

test('размышления и кэш: reasoning_tokens и cached_tokens попадают в учёт, текст размышлений оборачивается в <think>', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const sent: Array<Record<string, unknown>> = [];
  const shown: string[] = [];
  const result = await withFetch(
    (async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return sse([
        { model: 'anthropic/claude-opus-5.5', choices: [{ delta: { reasoning: 'думаю' } }] },
        delta('Ответ'),
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 5000,
            completion_tokens: 300,
            completion_tokens_details: { reasoning_tokens: 200 },
            prompt_tokens_details: { cached_tokens: 4096 },
            cost: 0.0123,
          },
        },
        '[DONE]',
      ]);
    }) as FetchFn,
    () =>
      provider.streamText(
        {
          model: 'anthropic/claude-opus-5.5',
          messages: [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'b' },
            { role: 'user', content: 'c' },
          ],
          stream: true,
          maxTokens: 12288,
          reasoning: { effort: 'medium' },
        },
        { onDelta: (d) => shown.push(d), isCancelled: () => false },
      ),
  );
  assert.equal(result.content, '<think>\nдумаю\n</think>\n\nОтвет');
  assert.equal(shown.join(''), result.content);
  assert.equal(result.usage.reasoningTokens, 200);
  assert.equal(result.usage.cachedTokens, 4096);
  assert.equal(result.cost, 0.0123);
  assert.deepEqual(sent[0].reasoning, { effort: 'medium' });
  const system = (sent[0].messages as Array<{ content: unknown }>)[0].content as Array<{
    cache_control?: unknown;
  }>;
  assert.deepEqual(
    system[0].cache_control,
    { type: 'ephemeral' },
    'Anthropic: системный промпт кэшируется',
  );
});

test('обрыв посреди ответа возвращает уже показанный текст, а не запускает второй ответ другой модели', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  let calls = 0;
  const shown: string[] = [];
  const result = await withFetch(
    (async () => {
      calls++;
      return sse([delta('Начало ответа '), delta('и продолжение')], { failAfter: true });
    }) as FetchFn,
    () =>
      provider.streamText(
        {
          model: 'deepseek/deepseek-v4.1-flash',
          messages: [{ role: 'user', content: 'x' }],
          stream: true,
        },
        { onDelta: (d) => shown.push(d), isCancelled: () => false },
      ),
  );
  assert.equal(
    calls,
    1,
    'вторая модель не должна вызываться после того, как пользователь уже видит ответ',
  );
  assert.equal(result.content, 'Начало ответа и продолжение');
  assert.equal(shown.join(''), result.content);
  assert.equal(result.finishReason, 'error');
});

test('таймаут (abort) посреди ответа отдаёт частичный текст со статусом cancelled', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const controller = new AbortController();
  const result = await withFetch(
    (async () => {
      const encoder = new TextEncoder();
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(c: ReadableStreamDefaultController<Uint8Array>) {
          if (!sent) {
            sent = true;
            c.enqueue(encoder.encode(`data: ${JSON.stringify(delta('часть'))}\n\n`));
          } else {
            const e = new Error('aborted');
            e.name = 'AbortError';
            c.error(e);
          }
        },
      });
      return new Response(body, { status: 200 });
    }) as FetchFn,
    () =>
      provider.streamText(
        {
          model: 'x/y',
          messages: [{ role: 'user', content: 'x' }],
          stream: true,
          signal: controller.signal,
        },
        { onDelta: () => undefined, isCancelled: () => false },
      ),
  );
  assert.equal(result.content, 'часть');
  assert.equal(result.finishReason, 'cancelled');
});

// ── Агентский режим: вызов инструментов ─────────────────────────────────────

const toolDelta = (index: number, part: { id?: string; name?: string; args?: string }) => ({
  choices: [
    {
      delta: {
        tool_calls: [
          {
            index,
            ...(part.id ? { id: part.id, type: 'function' } : {}),
            function: {
              ...(part.name ? { name: part.name } : {}),
              ...(part.args !== undefined ? { arguments: part.args } : {}),
            },
          },
        ],
      },
    },
  ],
});

test('streamAgent собирает вызов функции из частей и отдаёт события по мере прихода', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const events: unknown[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const result = await withFetch(
    (async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return sse([
        { model: 'xiaomi/mimo-v2.6-pro', choices: [{ delta: { reasoning: 'думаю' } }] },
        delta('Смотрю файл. '),
        toolDelta(0, { id: 'call_a', name: 'read_file', args: '' }),
        toolDelta(0, { args: '{"path":' }),
        toolDelta(0, { args: '"src/a.ts"}' }),
        toolDelta(1, { id: 'call_b', name: 'list_dir', args: '{}' }),
        {
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: {
            prompt_tokens: 900,
            completion_tokens: 40,
            cost: 0.0004,
            prompt_tokens_details: { cached_tokens: 600 },
          },
        },
        '[DONE]',
      ]);
    }) as FetchFn,
    () =>
      provider.streamAgent(
        {
          model: 'xiaomi/mimo-v2.6-pro',
          messages: [{ role: 'user', content: 'открой a.ts' }],
          tools: [
            { type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } },
          ],
          toolChoice: 'auto',
          maxTokens: 2048,
        },
        { onEvent: (e) => events.push(e), isCancelled: () => false },
      ),
  );

  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.content, 'Смотрю файл. ');
  assert.deepEqual(
    result.toolCalls.map((c) => [c.id, c.function.name, c.function.arguments]),
    [
      ['call_a', 'read_file', '{"path":"src/a.ts"}'],
      ['call_b', 'list_dir', '{}'],
    ],
  );
  assert.equal(result.cost, 0.0004);
  assert.equal(result.usage.cachedTokens, 600);
  assert.deepEqual(
    (events[0] as { kind: string }).kind,
    'reasoning',
    'размышления идут отдельным событием, а не в тексте',
  );
  assert.ok(events.some((e) => (e as { kind: string }).kind === 'tool_call'));
  assert.deepEqual(sent[0].tools, [
    { type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } },
  ]);
  assert.equal(sent[0].tool_choice, 'auto');
  assert.deepEqual(sent[0].usage, { include: true });
});

test('streamAgent: finish_reason stop с накопленными вызовами считается tool_calls', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const result = await withFetch(
    (async () =>
      sse([
        toolDelta(0, { id: 'c1', name: 'shell', args: '{"command":"ls"}' }),
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      ])) as FetchFn,
    () =>
      provider.streamAgent(
        { model: 'm', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 },
        { onEvent: () => undefined, isCancelled: () => false },
      ),
  );
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.toolCalls[0].function.name, 'shell');
});

test('streamAgent: tools не отправляются без объявленных функций; сообщения tool передаются как есть', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const body = provider.buildAgentBody({
    model: 'deepseek/deepseek-v4.1-flash',
    messages: [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'готово' },
    ],
    toolChoice: 'auto',
    maxTokens: 999_999,
  });
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
  assert.equal(body.max_tokens, 32768);
  const messages = body.messages as Array<Record<string, unknown>>;
  assert.equal(messages[2].role, 'tool');
  assert.equal(messages[2].tool_call_id, 'c1');
  assert.equal(messages[1].content, null);
});

test('streamAgent: параметры генерации OpenAI уходят в тело запроса под своими именами', () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const body = provider.buildAgentBody({
    model: 'deepseek/deepseek-v4.1-flash',
    messages: [{ role: 'user', content: 'x' }],
    maxTokens: 100,
    sampling: {
      topP: 0.8,
      stop: ['END'],
      seed: 3,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      responseFormat: { type: 'json_object' },
    },
  });
  assert.equal(body.top_p, 0.8);
  assert.deepEqual(body.stop, ['END']);
  assert.equal(body.seed, 3);
  assert.equal(body.frequency_penalty, 0.1);
  assert.equal(body.presence_penalty, 0.2);
  assert.deepEqual(body.response_format, { type: 'json_object' });

  const bare = provider.buildAgentBody({
    model: 'deepseek/deepseek-v4.1-flash',
    messages: [{ role: 'user', content: 'x' }],
    maxTokens: 100,
  });
  assert.equal('response_format' in bare, false);
  assert.equal('stop' in bare, false);
});

test('streamAgent: для Anthropic кэшируются system и последний user, сообщения tool не трогаются', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const body = provider.buildAgentBody({
    model: 'anthropic/claude-opus-5.5',
    messages: [
      { role: 'system', content: 'правила' },
      { role: 'user', content: 'первая задача' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'результат' },
    ],
    maxTokens: 1000,
  });
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  const cached = (m: { content: unknown }) =>
    Array.isArray(m.content) &&
    (m.content[0] as { cache_control?: unknown }).cache_control !== undefined;
  assert.ok(cached(messages[0]) && cached(messages[1]));
  assert.equal(messages[3].content, 'результат');
});

test('streamAgent: отказ до первого события поднимается, ошибка внутри потока после начала не теряет ответ', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await assert.rejects(
      withFetch(
        (async () =>
          new Response('{"error":{"message":"no credits"}}', { status: 402 })) as FetchFn,
        () =>
          provider.streamAgent(
            { model: 'm', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 },
            { onEvent: () => undefined, isCancelled: () => false },
          ),
      ),
      (err: unknown) => err instanceof OpenRouterError && err.status === 402,
    );

    const partial = await withFetch(
      (async () =>
        sse([
          delta('начало ответа'),
          { error: { code: 502, message: 'upstream dropped' } },
        ])) as FetchFn,
      () =>
        provider.streamAgent(
          { model: 'm', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 },
          { onEvent: () => undefined, isCancelled: () => false },
        ),
    );
    assert.equal(partial.content, 'начало ответа');
    assert.equal(partial.finishReason, 'error');

    const early = withFetch(
      (async () => sse([{ error: { code: 429, message: 'rate limited' } }])) as FetchFn,
      () =>
        provider.streamAgent(
          { model: 'm', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 },
          { onEvent: () => undefined, isCancelled: () => false },
        ),
    );
    await assert.rejects(
      early,
      (err: unknown) => err instanceof OpenRouterError && err.status === 429,
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('streamAgent: пробелы на границах частей не теряются, даже если поток режется посреди строки и буквы', async () => {
  // Части ответа как у настоящих моделей: пробел в начале или в конце части, отдельная часть из
  // пробела или перевода строки. Поток режется по одному байту: посреди JSON и посреди кириллицы.
  const parts = ['Менеджер', ' ', 'свяжется', ' с', ' вами ', 'завтра.', '\n', 'Хорошего', ' дня!'];
  const encoder = new TextEncoder();
  const bytes = encoder.encode(
    parts.map((part) => `data: ${JSON.stringify(delta(part))}\n\n`).join('') +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  );
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset < bytes.length) controller.enqueue(bytes.slice(offset, (offset += 1)));
      else controller.close();
    },
  });
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const texts: string[] = [];
  const result = await withFetch(
    (async () =>
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as FetchFn,
    () =>
      provider.streamAgent(
        { model: 'm', messages: [{ role: 'user', content: 'Когда?' }], tools: [], maxTokens: 100 },
        {
          onEvent: (event) => {
            if (event.kind === 'content') texts.push(event.text);
          },
          isCancelled: () => false,
        },
      ),
  );
  assert.equal(result.content, parts.join(''));
  assert.deepEqual(texts, parts, 'каждая часть — отдельным событием, без обрезки');
});
