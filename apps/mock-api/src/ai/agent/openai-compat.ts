/**
 * Формат OpenAI Chat Completions: разбор запроса и сборка ответов, потоковых кусков и ошибок.
 *
 * Сервер принимает и отдаёт тот же формат, что и OpenAI, поэтому с ним работают CLI `ketner`,
 * Cursor, Continue, Cline и официальные SDK. Здесь нет логики тарифов и моделей, только формат.
 */

import { randomBytes } from 'node:crypto';
import type {
  AgentMessage,
  AgentProviderResult,
  AgentToolCall,
  AgentToolChoice,
  AgentToolDefinition,
} from './agent-types.js';

export const MAX_AGENT_MESSAGES = 4000;
export const MAX_AGENT_TOOLS = 64;
const MAX_MAX_TOKENS = 1_000_000;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export type RequestedReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
const EFFORTS: readonly RequestedReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high'];

export interface ParsedChatRequest {
  model: string;
  messages: AgentMessage[];
  tools?: AgentToolDefinition[];
  toolChoice?: AgentToolChoice;
  stream: boolean;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort: RequestedReasoningEffort;
}

export type ParseResult =
  | { ok: true; value: ParsedChatRequest }
  | { ok: false; message: string; param?: string };

const fail = (message: string, param?: string): ParseResult => ({ ok: false, message, param });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Содержимое сообщения: строка либо массив текстовых частей. Картинки не поддерживаются. */
function readText(content: unknown): { ok: true; text: string } | { ok: false; message: string } {
  if (typeof content === 'string') return { ok: true, text: content };
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
        parts.push(part.text);
      } else {
        return { ok: false, message: 'Поддерживаются только текстовые части {type:"text", text}' };
      }
    }
    return { ok: true, text: parts.join('\n') };
  }
  return { ok: false, message: 'content должен быть строкой или массивом текстовых частей' };
}

function readToolCalls(raw: unknown, index: number): AgentToolCall[] | string {
  if (!Array.isArray(raw)) return `messages[${index}].tool_calls должен быть массивом`;
  const calls: AgentToolCall[] = [];
  for (const call of raw) {
    if (!isRecord(call) || typeof call.id !== 'string' || call.id === '') {
      return `messages[${index}].tool_calls: у каждого вызова нужен id`;
    }
    const fn = call.function;
    if (!isRecord(fn) || typeof fn.name !== 'string' || fn.name === '') {
      return `messages[${index}].tool_calls: у каждого вызова нужен function.name`;
    }
    const args =
      typeof fn.arguments === 'string'
        ? fn.arguments
        : fn.arguments === undefined || fn.arguments === null
          ? '{}'
          : JSON.stringify(fn.arguments);
    calls.push({ id: call.id, type: 'function', function: { name: fn.name, arguments: args } });
  }
  return calls;
}

function readMessages(raw: unknown): { ok: true; messages: AgentMessage[] } | { ok: false; message: string; param: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: 'messages должен содержать хотя бы одно сообщение', param: 'messages' };
  }
  if (raw.length > MAX_AGENT_MESSAGES) {
    return { ok: false, message: `Слишком длинная история: не больше ${MAX_AGENT_MESSAGES} сообщений`, param: 'messages' };
  }

  const messages: AgentMessage[] = [];
  const knownCallIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];
    const param = `messages[${i}]`;
    if (!isRecord(item)) return { ok: false, message: `${param} должен быть объектом`, param };

    const role = item.role === 'developer' ? 'system' : item.role;

    if (role === 'system' || role === 'user') {
      const text = readText(item.content);
      if (!text.ok) return { ok: false, message: `${param}: ${text.message}`, param };
      messages.push({ role, content: text.text });
      continue;
    }

    if (role === 'assistant') {
      let content: string | null = null;
      if (item.content !== null && item.content !== undefined) {
        const text = readText(item.content);
        if (!text.ok) return { ok: false, message: `${param}: ${text.message}`, param };
        content = text.text;
      }
      if (item.tool_calls !== undefined && item.tool_calls !== null) {
        const calls = readToolCalls(item.tool_calls, i);
        if (typeof calls === 'string') return { ok: false, message: calls, param };
        for (const call of calls) knownCallIds.add(call.id);
        messages.push({ role: 'assistant', content, ...(calls.length > 0 ? { tool_calls: calls } : {}) });
      } else {
        messages.push({ role: 'assistant', content: content ?? '' });
      }
      continue;
    }

    if (role === 'tool') {
      if (typeof item.tool_call_id !== 'string' || item.tool_call_id === '') {
        return { ok: false, message: `${param}: у сообщения tool нужен tool_call_id`, param };
      }
      if (!knownCallIds.has(item.tool_call_id)) {
        return {
          ok: false,
          message: `${param}: tool_call_id "${item.tool_call_id}" не найден среди вызовов предыдущих сообщений`,
          param,
        };
      }
      const text = readText(item.content);
      if (!text.ok) return { ok: false, message: `${param}: ${text.message}`, param };
      messages.push({ role: 'tool', tool_call_id: item.tool_call_id, content: text.text });
      continue;
    }

    return { ok: false, message: `${param}: роль должна быть system, user, assistant или tool`, param };
  }

  const last = messages[messages.length - 1];
  if (last.role !== 'user' && last.role !== 'tool') {
    return { ok: false, message: 'Последнее сообщение должно быть от user или tool', param: 'messages' };
  }
  return { ok: true, messages };
}

function readTools(raw: unknown): { ok: true; tools: AgentToolDefinition[] } | { ok: false; message: string; param: string } {
  if (!Array.isArray(raw)) return { ok: false, message: 'tools должен быть массивом', param: 'tools' };
  if (raw.length > MAX_AGENT_TOOLS) {
    return { ok: false, message: `Слишком много инструментов: не больше ${MAX_AGENT_TOOLS}`, param: 'tools' };
  }
  const tools: AgentToolDefinition[] = [];
  const names = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const tool: unknown = raw[i];
    const param = `tools[${i}]`;
    if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function)) {
      return { ok: false, message: `${param}: ожидается {type:"function", function:{...}}`, param };
    }
    const fn = tool.function;
    if (typeof fn.name !== 'string' || !TOOL_NAME.test(fn.name)) {
      return { ok: false, message: `${param}: имя функции — латиница, цифры, _ и -, до 64 символов`, param };
    }
    if (names.has(fn.name)) {
      return { ok: false, message: `${param}: имя функции "${fn.name}" повторяется`, param };
    }
    names.add(fn.name);
    if (fn.description !== undefined && typeof fn.description !== 'string') {
      return { ok: false, message: `${param}: description должен быть строкой`, param };
    }
    if (fn.parameters !== undefined && !isRecord(fn.parameters)) {
      return { ok: false, message: `${param}: parameters должен быть объектом JSON Schema`, param };
    }
    tools.push({
      type: 'function',
      function: {
        name: fn.name,
        ...(typeof fn.description === 'string' ? { description: fn.description } : {}),
        ...(isRecord(fn.parameters) ? { parameters: fn.parameters } : {}),
      },
    });
  }
  return { ok: true, tools };
}

export function parseChatRequest(body: unknown): ParseResult {
  if (!isRecord(body)) return fail('Тело запроса должно быть объектом JSON');

  const model = body.model === undefined || body.model === null ? 'auto' : body.model;
  if (typeof model !== 'string' || model.trim() === '') return fail('model должен быть непустой строкой', 'model');

  if (body.n !== undefined && body.n !== 1) return fail('Поддерживается только n = 1', 'n');

  const messages = readMessages(body.messages);
  if (!messages.ok) return fail(messages.message, messages.param);

  let tools: AgentToolDefinition[] | undefined;
  if (body.tools !== undefined && body.tools !== null) {
    const parsed = readTools(body.tools);
    if (!parsed.ok) return fail(parsed.message, parsed.param);
    tools = parsed.tools.length > 0 ? parsed.tools : undefined;
  }

  let toolChoice: AgentToolChoice | undefined;
  const choice = body.tool_choice;
  if (tools && choice !== undefined && choice !== null) {
    if (choice === 'auto' || choice === 'none' || choice === 'required') {
      toolChoice = choice;
    } else if (isRecord(choice) && choice.type === 'function' && isRecord(choice.function) && typeof choice.function.name === 'string') {
      const name = choice.function.name;
      if (!tools.some((t) => t.function.name === name)) {
        return fail(`tool_choice ссылается на неизвестную функцию "${name}"`, 'tool_choice');
      }
      toolChoice = { type: 'function', function: { name } };
    } else {
      return fail('tool_choice: auto, none, required или {type:"function", function:{name}}', 'tool_choice');
    }
  }

  if (body.stream !== undefined && typeof body.stream !== 'boolean') return fail('stream должен быть true или false', 'stream');

  const rawMax = body.max_completion_tokens ?? body.max_tokens;
  let maxTokens: number | undefined;
  if (rawMax !== undefined && rawMax !== null) {
    if (typeof rawMax !== 'number' || !Number.isInteger(rawMax) || rawMax < 1 || rawMax > MAX_MAX_TOKENS) {
      return fail(`max_tokens: целое число от 1 до ${MAX_MAX_TOKENS}`, 'max_tokens');
    }
    maxTokens = rawMax;
  }

  let temperature: number | undefined;
  if (body.temperature !== undefined && body.temperature !== null) {
    if (typeof body.temperature !== 'number' || !(body.temperature >= 0 && body.temperature <= 2)) {
      return fail('temperature: число от 0 до 2', 'temperature');
    }
    temperature = body.temperature;
  }

  let reasoningEffort: RequestedReasoningEffort = 'low';
  if (body.reasoning_effort !== undefined && body.reasoning_effort !== null) {
    if (!EFFORTS.includes(body.reasoning_effort as RequestedReasoningEffort)) {
      return fail('reasoning_effort: none, minimal, low, medium или high', 'reasoning_effort');
    }
    reasoningEffort = body.reasoning_effort as RequestedReasoningEffort;
  }

  return {
    ok: true,
    value: {
      model: model.trim(),
      messages: messages.messages,
      tools,
      toolChoice,
      stream: body.stream === true,
      maxTokens,
      temperature,
      reasoningEffort,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Ответы
// ─────────────────────────────────────────────────────────────

export interface KetnerExtension {
  cost_usd: number;
  requested_model: string;
  routing_reason: string;
  budget: { stage: string; used_pct: number; premium_available: boolean };
}

export type OpenAiFinishReason = 'stop' | 'length' | 'tool_calls';

export function newCompletionId(): string {
  return `chatcmpl-${randomBytes(12).toString('hex')}`;
}

/**
 * Причина завершения в терминах OpenAI. Отмена отдельной причины не имеет. Оборванный ответ
 * (`error`) отдаётся как `length`: он неполон, и клиент не должен принять его за законченный.
 */
export function toOpenAiFinishReason(reason: AgentProviderResult['finishReason']): OpenAiFinishReason {
  if (reason === 'length' || reason === 'error') return 'length';
  if (reason === 'tool_calls') return 'tool_calls';
  return 'stop';
}

export function toOpenAiUsage(usage: AgentProviderResult['usage']): Record<string, unknown> {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    ...(usage.cachedTokens !== undefined ? { prompt_tokens_details: { cached_tokens: usage.cachedTokens } } : {}),
    ...(usage.reasoningTokens !== undefined
      ? { completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } }
      : {}),
  };
}

export function buildCompletionResponse(input: {
  id: string;
  created: number;
  model: string;
  content: string;
  toolCalls: AgentToolCall[];
  finishReason: OpenAiFinishReason;
  usage: AgentProviderResult['usage'];
  ketner: KetnerExtension;
}): Record<string, unknown> {
  return {
    id: input.id,
    object: 'chat.completion',
    created: input.created,
    model: input.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: input.content === '' && input.toolCalls.length > 0 ? null : input.content,
          ...(input.toolCalls.length > 0 ? { tool_calls: input.toolCalls } : {}),
        },
        finish_reason: input.finishReason,
      },
    ],
    usage: toOpenAiUsage(input.usage),
    ketner: input.ketner,
  };
}

export type ChunkDelta = {
  role?: 'assistant';
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
};

export function buildChunk(input: {
  id: string;
  created: number;
  model: string;
  delta: ChunkDelta;
  finishReason?: OpenAiFinishReason | null;
}): Record<string, unknown> {
  return {
    id: input.id,
    object: 'chat.completion.chunk',
    created: input.created,
    model: input.model,
    choices: [{ index: 0, delta: input.delta, finish_reason: input.finishReason ?? null }],
  };
}

/** Последний кусок перед `[DONE]`: расход и решение маршрутизации. */
export function buildUsageChunk(input: {
  id: string;
  created: number;
  model: string;
  usage: AgentProviderResult['usage'];
  ketner: KetnerExtension;
}): Record<string, unknown> {
  return {
    id: input.id,
    object: 'chat.completion.chunk',
    created: input.created,
    model: input.model,
    choices: [],
    usage: toOpenAiUsage(input.usage),
    ketner: input.ketner,
  };
}

const ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'invalid_request_error',
  429: 'rate_limit_error',
};

export function openAiErrorType(status: number, code: string): string {
  if (code === 'insufficient_quota') return 'insufficient_quota';
  if (ERROR_TYPES[status]) return ERROR_TYPES[status];
  return status >= 500 ? 'server_error' : 'invalid_request_error';
}

export function buildErrorBody(
  status: number,
  code: string,
  message: string,
  param?: string,
): { error: { message: string; type: string; code: string; param: string | null } } {
  return { error: { message, type: openAiErrorType(status, code), code, param: param ?? null } };
}
