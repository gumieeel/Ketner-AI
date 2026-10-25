import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenRouterProvider } from './openrouter-provider.js';

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

test('отказ первой модели (например 404) логируется и берётся запасная', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
  let calls = 0;
  try {
    const result = await withFetch(
      (async () => {
        calls++;
        if (calls === 1) return new Response('{"error":{"message":"No endpoints found for bad/model"}}', { status: 404 });
        return sse([{ model: 'openai/gpt-4o-mini', ...delta('ok') }, '[DONE]']);
      }) as FetchFn,
      () =>
        provider.streamText(
          { model: 'bad/model', messages: [{ role: 'user', content: 'x' }], stream: true },
          { onDelta: () => undefined, isCancelled: () => false },
        ),
    );
    assert.equal(result.content, 'ok');
    assert.equal(result.model, 'openai/gpt-4o-mini', 'фактическая модель должна быть видна шлюзу');
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((w) => w.includes('bad/model') && w.includes('404')), 'отказ должен попасть в лог');
  assert.ok(!warnings.join('\n').includes('"k"'), 'ключ не должен попадать в лог');
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
