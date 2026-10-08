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
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 8, cost: 0.000042 } },
        '[DONE]',
      ]);
    }) as FetchFn,
    () =>
      provider.streamText(
        { model: 'deepseek/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }], stream: true, maxTokens: 100 },
        { onDelta: () => undefined, isCancelled: () => false },
      ),
  );
  assert.equal(result.content, 'Привет, мир');
  assert.equal(result.cost, 0.000042);
  assert.equal(result.model, 'deepseek/deepseek-v4.1-flash');
  assert.equal(result.usage.inputTokens, 120);
  assert.deepEqual(sent[0].usage, { include: true }, 'учёт стоимости должен запрашиваться у OpenRouter');
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
        return new Response('{"error":{"message":"No endpoints found for bad/model"}}', { status: 404 });
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
  assert.ok(warnings.some((w) => w.includes('bad/model') && w.includes('404')), 'отказ должен попасть в лог');
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
      (async () => new Response('{"error":{"message":"Insufficient credits"}}', { status: 402 })) as FetchFn,
      () =>
        provider.generateText({ model: 'openai/gpt-6-luna', messages: [{ role: 'user', content: 'x' }], stream: false }),
    ).catch((err: unknown) => {
      failure = err;
    });
  } finally {
    console.error = originalError;
  }
  assert.ok(failure instanceof OpenRouterError);
  assert.equal((failure as OpenRouterError).status, 402);
  assert.ok(errors.some((e) => e.includes('кредиты')), 'нехватка кредитов должна быть заметна в логах');
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
  const system = (sent[0].messages as Array<{ content: unknown }>)[0].content as Array<{ cache_control?: unknown }>;
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral' }, 'Anthropic: системный промпт кэшируется');
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
        { model: 'deepseek/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'x' }], stream: true },
        { onDelta: (d) => shown.push(d), isCancelled: () => false },
      ),
  );
  assert.equal(calls, 1, 'вторая модель не должна вызываться после того, как пользователь уже видит ответ');
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
        { model: 'x/y', messages: [{ role: 'user', content: 'x' }], stream: true, signal: controller.signal },
        { onDelta: () => undefined, isCancelled: () => false },
      ),
  );
  assert.equal(result.content, 'часть');
  assert.equal(result.finishReason, 'cancelled');
});
