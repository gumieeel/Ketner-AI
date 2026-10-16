import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatToolDefinition, ChatWireMessage } from '../gateway-types.js';
import {
  mergeReasoningDetails,
  OpenRouterError,
  OpenRouterProvider,
  prepareChatMessages,
} from './openrouter-provider.js';

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

const TOOLS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } },
  },
];

test('streamChat собирает вызовы инструментов из кусков и сообщает стоимость', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const sent: Array<Record<string, unknown>> = [];
  const text: string[] = [];
  const result = await withFetch(
    (async (_url: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return sse([
        { model: 'xiaomi/mimo-v2.6-pro', choices: [{ delta: { content: 'Смотрю файл. ' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '' } }],
              },
            },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"src/' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'a.ts"}' } }] } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.ts"}' } }],
              },
            },
          ],
        },
        {
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0007, prompt_tokens_details: { cached_tokens: 600 } },
        },
        '[DONE]',
      ]);
    }) as FetchFn,
    () =>
      provider.streamChat(
        { model: 'xiaomi/mimo-v2.6-pro', messages: [{ role: 'user', content: 'go' }], tools: TOOLS, maxTokens: 500 },
        { onDelta: (d) => text.push(d), isCancelled: () => false },
      ),
  );

  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.content, 'Смотрю файл. ');
  assert.deepEqual(text, ['Смотрю файл. ']);
  assert.deepEqual(
    result.toolCalls.map((c) => [c.id, c.name, c.arguments]),
    [
      ['call_a', 'read_file', '{"path":"src/a.ts"}'],
      ['call_b', 'read_file', '{"path":"b.ts"}'],
    ],
  );
  assert.equal(result.cost, 0.0007);
  assert.equal(result.usage.cachedTokens, 600);
  assert.equal(result.model, 'xiaomi/mimo-v2.6-pro');
  assert.deepEqual(sent[0].tools, TOOLS);
  assert.equal(sent[0].tool_choice, 'auto');
  assert.deepEqual(sent[0].usage, { include: true });
});

test('streamChat: обычный ответ без инструментов завершается stop', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const result = await withFetch(
    (async () =>
      sse([
        { choices: [{ delta: { content: 'Готово.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
      ])) as FetchFn,
    () =>
      provider.streamChat(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        { onDelta: () => undefined, isCancelled: () => false },
      ),
  );
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.toolCalls.length, 0);
  assert.equal(result.content, 'Готово.');
});

test('streamChat: размышления идут отдельным потоком, а reasoning_details склеиваются по индексу', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const thinking: string[] = [];
  const content: string[] = [];
  const result = await withFetch(
    (async () =>
      sse([
        {
          choices: [
            {
              delta: {
                reasoning: 'Надо ',
                reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'Надо ', format: 'x' }],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                reasoning: 'подумать',
                reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'подумать', signature: 'sig1' }],
              },
            },
          ],
        },
        { choices: [{ delta: { content: 'Ответ' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ])) as FetchFn,
    () =>
      provider.streamChat(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        {
          onDelta: (d) => content.push(d),
          onReasoningDelta: (d) => thinking.push(d),
          isCancelled: () => false,
        },
      ),
  );
  assert.deepEqual(thinking, ['Надо ', 'подумать']);
  assert.deepEqual(content, ['Ответ']);
  assert.equal(result.content, 'Ответ', 'размышления не попадают в текст ответа');
  assert.equal(result.reasoningDetails?.length, 1);
  const detail = result.reasoningDetails?.[0] as Record<string, unknown>;
  assert.equal(detail.text, 'Надо подумать');
  assert.equal(detail.signature, 'sig1');
  assert.equal(detail.format, 'x');
});

test('streamChat: отмена клиентом отбрасывает недособранные вызовы', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  let cancelled = false;
  const result = await withFetch(
    (async () =>
      sse([
        { choices: [{ delta: { content: 'начинаю' } }] },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'write_file', arguments: '{"path":"a' } }] } },
          ],
        },
        { choices: [{ delta: { content: ' ещё' } }] },
      ])) as FetchFn,
    () =>
      provider.streamChat(
        { model: 'm', messages: [{ role: 'user', content: 'x' }], tools: TOOLS },
        {
          onDelta: () => {
            cancelled = true;
          },
          isCancelled: () => cancelled,
        },
      ),
  );
  assert.equal(result.finishReason, 'cancelled');
  assert.equal(result.toolCalls.length, 0, 'вызов с обрезанными аргументами исполнять нельзя');
});

test('streamChat: ошибка внутри потока до первого токена поднимается как OpenRouterError', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  await assert.rejects(
    withFetch(
      (async () => sse([{ error: { code: 429, message: 'rate limited upstream' } }])) as FetchFn,
      () =>
        provider.streamChat(
          { model: 'm', messages: [{ role: 'user', content: 'x' }] },
          { onDelta: () => undefined, isCancelled: () => false },
        ),
    ),
    (error: unknown) => error instanceof OpenRouterError && error.status === 429,
  );
});

test('streamChat: HTTP 404 «модель без поддержки инструментов» поднимается шлюзу со статусом', async () => {
  const provider = new OpenRouterProvider({ apiKey: 'k' });
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await assert.rejects(
      withFetch(
        (async () =>
          new Response('{"error":{"message":"No endpoints found that support tool use"}}', {
            status: 404,
          })) as FetchFn,
        () =>
          provider.streamChat(
            { model: 'm', messages: [{ role: 'user', content: 'x' }], tools: TOOLS },
            { onDelta: () => undefined, isCancelled: () => false },
          ),
      ),
      (error: unknown) => error instanceof OpenRouterError && error.status === 404,
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('prepareChatMessages: роли tool/assistant приводятся к формату OpenAI, reasoning_details возвращаются', () => {
  const messages: ChatWireMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'task' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a"}' }],
      reasoningDetails: [{ type: 'reasoning.text', text: 'думал', index: 0 }],
    },
    { role: 'tool', toolCallId: 'c1', content: 'файл' },
  ];
  const wire = prepareChatMessages('openai/gpt-6.1-sol', messages);
  assert.deepEqual(wire[2], {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }],
    reasoning_details: [{ type: 'reasoning.text', text: 'думал', index: 0 }],
  });
  assert.deepEqual(wire[3], { role: 'tool', tool_call_id: 'c1', content: 'файл' });
  assert.equal(wire[0].content, 'sys', 'для не-Anthropic моделей cache_control не добавляется');
});

test('prepareChatMessages: для Anthropic кэшируются системный промпт и задача, но не результаты инструментов', () => {
  const messages: ChatWireMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'task' },
    { role: 'assistant', content: 'x', toolCalls: [{ id: 'c1', name: 'n', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c1', content: 'out' },
  ];
  const wire = prepareChatMessages('anthropic/claude-opus-5.5', messages);
  const cached = (m: Record<string, unknown>) =>
    Array.isArray(m.content) && (m.content as Array<Record<string, unknown>>)[0].cache_control !== undefined;
  assert.equal(cached(wire[0]), true);
  assert.equal(cached(wire[1]), true);
  assert.equal(cached(wire[3]), false);
});

test('mergeReasoningDetails игнорирует мусор и не падает на не-массиве', () => {
  const target: Array<Record<string, unknown>> = [];
  mergeReasoningDetails(target, 'oops');
  mergeReasoningDetails(target, [null, 5, { type: 'reasoning.summary', index: 2, summary: 'a' }]);
  mergeReasoningDetails(target, [{ type: 'reasoning.summary', index: 2, summary: 'b' }]);
  assert.equal(target.length, 1);
  assert.equal(target[0].summary, 'ab');
});
