import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompletionResponse,
  buildErrorBody,
  parseChatRequest,
  toOpenAiFinishReason,
  toOpenAiUsage,
  type ParsedChatRequest,
} from './openai-compat.js';

const user = (content: unknown) => ({ role: 'user', content });

function parse(body: Record<string, unknown>): ParsedChatRequest {
  const result = parseChatRequest(body);
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.value;
}

function rejection(body: unknown): { message: string; param?: string } {
  const result = parseChatRequest(body);
  assert.equal(result.ok, false);
  return result as { ok: false; message: string; param?: string };
}

test('минимальный запрос: модель auto, глубина размышлений low, без стриминга', () => {
  const value = parse({ messages: [user('привет')] });
  assert.equal(value.model, 'auto');
  assert.equal(value.reasoningEffort, 'low');
  assert.equal(value.stream, false);
  assert.deepEqual(value.messages, [{ role: 'user', content: 'привет' }]);
});

test('content-массив из текстовых частей склеивается, картинки отклоняются', () => {
  const value = parse({ messages: [user([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])] });
  assert.equal((value.messages[0] as { content: string }).content, 'a\nb');
  const bad = rejection({ messages: [user([{ type: 'image_url', image_url: { url: 'x' } }])] });
  assert.equal(bad.param, 'messages[0]');
});

test('developer приравнивается к system', () => {
  const value = parse({ messages: [{ role: 'developer', content: 'правила' }, user('x')] });
  assert.equal(value.messages[0].role, 'system');
});

test('полный круг вызова функции: assistant с tool_calls и ответ tool', () => {
  const value = parse({
    messages: [
      user('прочитай a.ts'),
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'const a = 1;' },
    ],
    tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
    tool_choice: { type: 'function', function: { name: 'read_file' } },
    stream: true,
    max_completion_tokens: 2000,
    temperature: 0.2,
    reasoning_effort: 'high',
  });
  assert.equal(value.messages.length, 3);
  assert.equal(value.stream, true);
  assert.equal(value.maxTokens, 2000);
  assert.equal(value.reasoningEffort, 'high');
  assert.deepEqual(value.toolChoice, { type: 'function', function: { name: 'read_file' } });
});

test('аргументы вызова объектом превращаются в JSON-строку', () => {
  const value = parse({
    messages: [
      user('x'),
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: { a: 1 } } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ],
  });
  const assistant = value.messages[1] as { tool_calls: Array<{ function: { arguments: string } }> };
  assert.equal(assistant.tool_calls[0].function.arguments, '{"a":1}');
});

test('tool_call_id без предшествующего вызова и последнее сообщение assistant отклоняются', () => {
  assert.match(
    rejection({ messages: [user('x'), { role: 'tool', tool_call_id: 'nope', content: 'r' }] }).message,
    /не найден/,
  );
  assert.match(
    rejection({ messages: [user('x'), { role: 'assistant', content: 'ответ' }] }).message,
    /Последнее сообщение/,
  );
});

test('проверка инструментов: имя, повтор, число, tool_choice на неизвестную функцию', () => {
  const fn = (name: string) => ({ type: 'function', function: { name } });
  assert.equal(rejection({ messages: [user('x')], tools: [fn('плохое имя')] }).param, 'tools[0]');
  assert.match(rejection({ messages: [user('x')], tools: [fn('a'), fn('a')] }).message, /повторяется/);
  const many = Array.from({ length: 65 }, (_, i) => fn(`f${i}`));
  assert.match(rejection({ messages: [user('x')], tools: many }).message, /не больше 64/);
  assert.equal(
    rejection({ messages: [user('x')], tools: [fn('a')], tool_choice: { type: 'function', function: { name: 'b' } } }).param,
    'tool_choice',
  );
});

test('tool_choice без tools игнорируется, пустой tools убирается', () => {
  const value = parse({ messages: [user('x')], tool_choice: 'required', tools: [] });
  assert.equal(value.tools, undefined);
  assert.equal(value.toolChoice, undefined);
});

test('числовые поля: границы temperature, max_tokens, n и reasoning_effort', () => {
  assert.equal(rejection({ messages: [user('x')], temperature: 3 }).param, 'temperature');
  assert.equal(rejection({ messages: [user('x')], max_tokens: 0 }).param, 'max_tokens');
  assert.equal(rejection({ messages: [user('x')], max_tokens: 1.5 }).param, 'max_tokens');
  assert.equal(rejection({ messages: [user('x')], n: 2 }).param, 'n');
  assert.equal(rejection({ messages: [user('x')], reasoning_effort: 'extreme' }).param, 'reasoning_effort');
  assert.equal(rejection({ messages: [user('x')], stream: 'yes' }).param, 'stream');
  assert.equal(rejection({ messages: [] }).param, 'messages');
  assert.equal(rejection('строка').param, undefined);
});

test('ответ без стриминга: пустой текст с вызовами превращается в content: null', () => {
  const body = buildCompletionResponse({
    id: 'chatcmpl-1',
    created: 1,
    model: 'ketner-pro',
    content: '',
    toolCalls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
    finishReason: 'tool_calls',
    usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 4, reasoningTokens: 2 },
    ketner: { cost_usd: 0.001, requested_model: 'auto', routing_reason: 'r', budget: { stage: 'normal', used_pct: 1, premium_available: true } },
  });
  const choice = (body.choices as Array<{ message: { content: unknown; tool_calls: unknown[] }; finish_reason: string }>)[0];
  assert.equal(choice.message.content, null);
  assert.equal(choice.message.tool_calls.length, 1);
  assert.equal(choice.finish_reason, 'tool_calls');
  assert.deepEqual(body.usage, {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    prompt_tokens_details: { cached_tokens: 4 },
    completion_tokens_details: { reasoning_tokens: 2 },
  });
});

test('причины завершения и тела ошибок', () => {
  assert.equal(toOpenAiFinishReason('cancelled'), 'stop');
  assert.equal(toOpenAiFinishReason('error'), 'length', 'оборванный ответ неполон');
  assert.equal(toOpenAiFinishReason('length'), 'length');
  assert.equal(toOpenAiUsage({ inputTokens: 1, outputTokens: 2 }).total_tokens, 3);
  assert.deepEqual(buildErrorBody(429, 'insufficient_quota', 'm'), {
    error: { message: 'm', type: 'insufficient_quota', code: 'insufficient_quota', param: null },
  });
  assert.equal(buildErrorBody(401, 'invalid_api_key', 'm').error.type, 'authentication_error');
  assert.equal(buildErrorBody(502, 'upstream_error', 'm').error.type, 'server_error');
});
