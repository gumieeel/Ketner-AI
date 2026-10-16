/**
 * Адаптер провайдера OpenRouter — единственный канал ко всем моделям.
 *
 * Один ключ (OPENROUTER_API_KEY), один счёт, единый учёт расходов через `usage.cost`.
 * Адаптер запрашивает ровно ту модель, которую ему передали. Раньше при ошибке он молча перебирал
 * «запасные» модели (gpt-4o-mini, deepseek-chat и др.): пользователь видел одно название, отвечала
 * другая модель, а расход записывался по цене не той модели. Теперь отказ поднимается наверх, а
 * запасную модель выбирает шлюз по цепочке fallback из реестра, с корректным учётом.
 */

import type {
  AgentCapableProvider,
  AgentMessage,
  AgentProviderRequest,
  AgentProviderResult,
  AgentStreamEvent,
  AgentToolCall,
} from '../agent/agent-types.js';
import type {
  AIProvider,
  AIProviderType,
  ChatCompletionCallbacks,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatToolCall,
  ChatWireMessage,
  ProviderMessage,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from '../gateway-types.js';
import { ContextOptimizer } from '../context.js';
import { promptCachePolicy } from '../prompt-cache.js';

export interface OpenRouterProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Верхний предел `max_tokens`. Токены размышлений входят в `max_tokens`, поэтому при высокой
 * глубине размышлений потолок нужен с запасом (иначе ответ обрывается пустым finish_reason=length).
 * Платится только фактически сгенерированное.
 */
export const MAX_COMPLETION_TOKENS = 32768;

/** Отказ OpenRouter: HTTP-статус нужен шлюзу и предохранителю, чтобы отличать 402 от 429 и 5xx. */
export class OpenRouterError extends Error {
  readonly status: number;
  constructor(model: string, status: number, body: string) {
    super(`OpenRouter ${model}: HTTP ${status}${body ? `: ${body}` : ''}`);
    this.name = 'OpenRouterError';
    this.status = status;
  }
}

/**
 * Коротко и без секретов описывает отказ OpenRouter. Статус 402 означает, что на счёте закончились
 * кредиты: тогда не работает ни одна платная модель сразу, и об этом должно быть видно в логах.
 */
async function describeUpstreamFailure(
  model: string,
  response: Response,
): Promise<OpenRouterError> {
  let body = '';
  try {
    body = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    // тело недоступно
  }
  const error = new OpenRouterError(model, response.status, body);
  if (response.status === 402) {
    console.error(
      `[openrouter] ${error.message}. Похоже, на счёте OpenRouter закончились кредиты.`,
    );
  } else {
    console.warn(`[openrouter] ${error.message}`);
  }
  return error;
}

type CacheableContent = Array<{
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}>;

type WireMessage = { role: ProviderMessage['role']; content: string | CacheableContent };

function withCacheBreakpoint(message: ProviderMessage): WireMessage {
  return {
    role: message.role,
    content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }],
  };
}

/**
 * Точки кэша промпта (политика по вендорам — ai/prompt-cache.ts). OpenAI, Grok, DeepSeek кэшируют
 * сами, им точки не нужны. Читать из кэша в 4–10 раз дешевле, чем платить за вход заново, а
 * системный промпт, контекст проекта и начало истории повторяются в каждом сообщении.
 *
 * Anthropic, до трёх точек:
 *   1. конец ведущих системных сообщений (промпт с контекстом проекта и сводка истории);
 *   2. якорь — первое сообщение диалога: префикс «система + якорь» не меняется весь разговор,
 *      поэтому читается из кэша и в тот ход, когда окно истории сдвинулось;
 *   3. сообщение перед последним вопросом — вся история, пока окно не сдвинулось.
 * Короче порога провайдера (4096 токенов у Opus и Haiku) запрос просто не кэшируется, без доплаты.
 *
 * Gemini: OpenRouter использует только последнюю точку, а запись платная (вход + хранение 5 минут),
 * поэтому одна точка и только на длинном префиксе.
 */
export function prepareMessages(model: string, messages: ProviderMessage[]): WireMessage[] {
  const wire: WireMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const policy = promptCachePolicy(model);
  if (policy.mode !== 'explicit' && policy.mode !== 'explicit-last') {
    return wire;
  }

  const leadingSystemEnd = (() => {
    let end = -1;
    while (end + 1 < messages.length && messages[end + 1].role === 'system') end += 1;
    return end;
  })();
  const dialogue = messages
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.role !== 'system');
  const checkpoint = dialogue.length > 2 ? dialogue[dialogue.length - 2].index : -1;

  if (policy.mode === 'explicit-last') {
    const index = checkpoint >= 0 ? checkpoint : leadingSystemEnd;
    const prefixTokens = messages
      .slice(0, index + 1)
      .reduce((sum, m) => sum + ContextOptimizer.estimateTokens(m.content), 0);
    if (index >= 0 && messages[index].content && prefixTokens >= policy.minTokens) {
      wire[index] = withCacheBreakpoint(messages[index]);
    }
    return wire;
  }

  const breakpoints = new Set<number>();
  if (leadingSystemEnd >= 0) breakpoints.add(leadingSystemEnd);
  // Якорь имеет смысл, только если он не совпадает с точкой истории.
  if (dialogue.length >= 4) breakpoints.add(dialogue[0].index);
  if (checkpoint >= 0) breakpoints.add(checkpoint);
  for (const index of breakpoints) {
    if (messages[index].content) wire[index] = withCacheBreakpoint(messages[index]);
  }
  return wire;
}

// ─────────────────────────────────────────────────────────────
// Диалог с инструментами (агентный режим)
// ─────────────────────────────────────────────────────────────

type WireToolMessage = Record<string, unknown>;

/**
 * Приводит сообщения агента к формату chat/completions. Кэш-точки Anthropic ставятся на системный
 * промпт и на первое сообщение пользователя (задачу запуска): оба неизменны на протяжении всего
 * запуска, поэтому читаются из кэша на каждом шаге. Остальные провайдеры кэшируют сами.
 */
export function prepareChatMessages(model: string, messages: ChatWireMessage[]): WireToolMessage[] {
  const cacheable = model.startsWith('anthropic/');
  const lastUserIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  })();

  return messages.map((message, index): WireToolMessage => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant') {
      const wire: WireToolMessage = { role: 'assistant', content: message.content || null };
      if (message.toolCalls && message.toolCalls.length > 0) {
        wire.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments || '{}' },
        }));
      }
      if (message.reasoningDetails && message.reasoningDetails.length > 0) {
        wire.reasoning_details = message.reasoningDetails;
      }
      return wire;
    }
    if (cacheable && message.content && (message.role === 'system' || index === lastUserIndex)) {
      return {
        role: message.role,
        content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }],
      };
    }
    return { role: message.role, content: message.content };
  });
}

/**
 * Кусок `reasoning_details` из потока: у каждого есть `index` блока и тип. Куски одного блока нужно
 * склеить (текст и резюме дописываются, подпись берётся последняя), иначе провайдер отвергнет
 * или проигнорирует их при возврате на следующем шаге.
 */
export function mergeReasoningDetails(
  target: Array<Record<string, unknown>>,
  chunk: unknown,
): void {
  if (!Array.isArray(chunk)) return;
  for (const raw of chunk) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const index = typeof item.index === 'number' ? item.index : target.length;
    const existing = target.find((entry) => entry.index === index && entry.type === item.type);
    if (!existing) {
      target.push({ ...item, index });
      continue;
    }
    for (const key of ['text', 'summary', 'data'] as const) {
      if (typeof item[key] === 'string') {
        existing[key] = `${typeof existing[key] === 'string' ? existing[key] : ''}${item[key]}`;
      }
    }
    for (const [key, value] of Object.entries(item)) {
      if (key === 'text' || key === 'summary' || key === 'data' || key === 'index') continue;
      if (value !== undefined && value !== null) existing[key] = value;
    }
  }
}

interface PartialToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Фрагмент вызова инструмента в потоке OpenRouter: поля приходят частями. */
interface StreamToolCallPart {
  index?: unknown;
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/**
 * Один SSE-чанк OpenRouter (формат OpenAI). Поля, которые приходят из сети, проверяются через
 * typeof на месте; счётчики токенов по контракту API — числа.
 */
interface StreamChunk {
  error?: { code?: unknown; message?: unknown };
  model?: unknown;
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
      reasoning_details?: unknown;
      tool_calls?: unknown;
    };
    finish_reason?: unknown;
  }>;
  usage?: {
    cost?: unknown;
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: unknown };
    prompt_tokens_details?: { cached_tokens?: unknown };
    native_tokens_cached?: unknown;
  };
}

type AgentWireMessage =
  | { role: 'system' | 'user'; content: string | CacheableContent }
  | Exclude<AgentMessage, { role: 'system' | 'user' }>;

/**
 * Сообщения агентского запроса. Явное кэширование нужно только моделям Anthropic: системный промпт
 * (в нём описание инструментов и правила работы) и последнее сообщение пользователя не меняются
 * от шага к шагу, а читать их из кэша в 10 раз дешевле. Остальные модели кэшируют сами.
 * Точку кэша не ставим на сообщения роли tool: OpenRouter документирует `cache_control` только для
 * текстовых блоков system и user.
 */
export function prepareAgentMessages(model: string, messages: AgentMessage[]): AgentWireMessage[] {
  if (!model.startsWith('anthropic/')) return messages;
  const lastUser = messages.reduce((found, m, i) => (m.role === 'user' ? i : found), -1);
  return messages.map((m, i) => {
    if (
      (m.role === 'system' || i === lastUser) &&
      (m.role === 'system' || m.role === 'user') &&
      m.content
    ) {
      return {
        role: m.role,
        content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }],
      } as AgentWireMessage;
    }
    return m;
  });
}

export class OpenRouterProvider implements AIProvider, AgentCapableProvider {
  readonly type: AIProviderType = 'openrouter';
  readonly name = 'OpenRouter';

  private apiKey: string;
  private baseUrl: string;

  constructor(config: OpenRouterProviderConfig) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ketner.ai',
      'X-Title': 'Ketner AI',
    };
  }

  /** Тело запроса. Экспортируется через метод, чтобы тесты проверяли реальный payload. */
  buildBody(options: ProviderRequestOptions, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: prepareMessages(options.model, options.messages),
      stream,
      max_tokens: Math.min(options.maxTokens ?? 4096, MAX_COMPLETION_TOKENS),
      usage: { include: true },
    };
    if (options.reasoning) {
      body.reasoning = options.reasoning;
    }
    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    return body;
  }

  /** Тело запроса шага с инструментами. Отдельно от buildBody, чтобы тесты видели реальный payload. */
  buildChatBody(options: ChatCompletionOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: prepareChatMessages(options.model, options.messages),
      stream: true,
      max_tokens: Math.min(options.maxTokens ?? 8192, MAX_COMPLETION_TOKENS),
      usage: { include: true },
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = 'auto';
    }
    if (options.reasoning) body.reasoning = options.reasoning;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    return body;
  }

  /**
   * Один шаг агента: потоковый ответ модели с возможными вызовами инструментов.
   *
   * Вызовы приходят кусками (`delta.tool_calls[i]`: имя в первом куске, аргументы по частям),
   * размышления — отдельным потоком, а `reasoning_details` собираются целиком, чтобы вернуть их
   * провайдеру на следующем шаге. Недособранные вызовы при обрыве отбрасываются: исполнять
   * инструмент с обрезанными аргументами нельзя.
   */
  async streamChat(
    options: ChatCompletionOptions,
    callbacks: ChatCompletionCallbacks,
  ): Promise<ChatCompletionResult> {
    const targetModel = options.model;
    const empty = (reason: 'cancelled' | 'error'): ChatCompletionResult => ({
      content: '',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: reason,
    });

    if (callbacks.isCancelled()) return empty('cancelled');

    let content = '';
    let streamedAny = false;
    let promptTokens = 0;
    let completionTokens = 0;
    let reasoningTokens: number | undefined;
    let cachedTokens: number | undefined;
    let costUsd: number | undefined;
    let actualModel: string | undefined;
    let finish: string | undefined;
    const partialCalls = new Map<number, PartialToolCall>();
    const reasoningDetails: Array<Record<string, unknown>> = [];

    const collectToolCalls = (): ChatToolCall[] =>
      [...partialCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call)
        .filter((call) => call.name.length > 0)
        .map((call, order) => ({
          id: call.id || `call_${order}_${Date.now().toString(36)}`,
          name: call.name,
          arguments: call.arguments,
        }));

    const snapshot = (reason: ChatCompletionResult['finishReason']): ChatCompletionResult => ({
      content,
      toolCalls: reason === 'cancelled' || reason === 'error' ? [] : collectToolCalls(),
      reasoningDetails: reasoningDetails.length > 0 ? reasoningDetails : undefined,
      usage: {
        inputTokens: promptTokens,
        outputTokens: completionTokens || Math.ceil(content.length / 4),
        cachedTokens: cachedTokens && cachedTokens > 0 ? cachedTokens : undefined,
        reasoningTokens,
      },
      cost: costUsd,
      model: actualModel ?? targetModel,
      finishReason: reason,
    });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildChatBody(options)),
        signal: options.signal,
      });

      if (!response.ok || !response.body) {
        throw await describeUpstreamFailure(targetModel, response);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const handleLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') return;

        let parsed: StreamChunk;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          return;
        }

        if (parsed.error) {
          const status = Number(parsed.error.code);
          throw new OpenRouterError(
            targetModel,
            Number.isFinite(status) && status >= 400 ? status : 502,
            String(parsed.error.message ?? 'upstream stream error').slice(0, 300),
          );
        }

        if (typeof parsed.model === 'string') actualModel = parsed.model;
        callbacks.onActivity?.();
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;

        if (delta) {
          const reasoningDelta = delta.reasoning ?? delta.reasoning_content ?? '';
          if (typeof reasoningDelta === 'string' && reasoningDelta) {
            streamedAny = true;
            callbacks.onReasoningDelta?.(reasoningDelta);
          }
          if (delta.reasoning_details)
            mergeReasoningDetails(reasoningDetails, delta.reasoning_details);

          if (typeof delta.content === 'string' && delta.content) {
            streamedAny = true;
            content += delta.content;
            callbacks.onDelta(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            streamedAny = true;
            for (const part of delta.tool_calls as StreamToolCallPart[]) {
              const index = typeof part.index === 'number' ? part.index : partialCalls.size;
              let call = partialCalls.get(index);
              if (!call) {
                call = { id: '', name: '', arguments: '' };
                partialCalls.set(index, call);
              }
              if (typeof part.id === 'string' && part.id) call.id = part.id;
              if (typeof part.function?.name === 'string') call.name += part.function.name;
              if (typeof part.function?.arguments === 'string')
                call.arguments += part.function.arguments;
            }
          }
        }

        if (choice?.finish_reason) finish = String(choice.finish_reason);

        const usage = parsed.usage;
        if (usage) {
          if (typeof usage.cost === 'number') costUsd = usage.cost;
          promptTokens = usage.prompt_tokens ?? promptTokens;
          completionTokens = usage.completion_tokens ?? completionTokens;
          const rTokens = usage.completion_tokens_details?.reasoning_tokens;
          if (typeof rTokens === 'number') reasoningTokens = rTokens;
          const cTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.native_tokens_cached;
          if (typeof cTokens === 'number') cachedTokens = cTokens;
        }
      };

      while (true) {
        if (callbacks.isCancelled()) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          return snapshot('cancelled');
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      }
      if (buffer) handleLine(buffer);

      const toolCalls = collectToolCalls();
      let reason: ChatCompletionResult['finishReason'] = 'stop';
      if (toolCalls.length > 0) reason = 'tool_calls';
      else if (finish === 'length') reason = 'length';
      return snapshot(reason);
    } catch (err: unknown) {
      const aborted = (err as Error)?.name === 'AbortError' || callbacks.isCancelled();
      if (aborted) return snapshot('cancelled');
      // Обрыв после того, как пользователь уже что-то получил: отдаём полученное, не повторяя запрос.
      if (streamedAny && !(err instanceof OpenRouterError)) return snapshot('error');
      throw err;
    }
  }

  async generateText(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const targetModel = options.model;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(options, false)),
        signal: options.signal,
      });
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        return {
          content: '',
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'cancelled',
        };
      }
      throw err;
    }

    if (!response.ok) {
      throw await describeUpstreamFailure(targetModel, response);
    }

    const json = (await response.json()) as {
      model?: string;
      choices?: Array<{
        message: { content?: string; reasoning?: string; reasoning_content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
        prompt_tokens_details?: { cached_tokens?: number };
        native_tokens_cached?: number;
        cost?: number;
      };
    };

    const msg = json.choices?.[0]?.message;
    let content = msg?.content ?? '';
    const reasoningText = msg?.reasoning ?? msg?.reasoning_content;
    if (reasoningText && !content.includes('<think>')) {
      content = `<think>\n${reasoningText}\n</think>\n\n${content}`;
    }
    const cachedTokens =
      json.usage?.prompt_tokens_details?.cached_tokens ?? json.usage?.native_tokens_cached;
    const reasoningTokens = json.usage?.completion_tokens_details?.reasoning_tokens;
    return {
      content,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? Math.ceil(content.length / 4),
        outputTokens: json.usage?.completion_tokens ?? Math.ceil(content.length / 4),
        cachedTokens:
          typeof cachedTokens === 'number' && cachedTokens > 0 ? cachedTokens : undefined,
        reasoningTokens: typeof reasoningTokens === 'number' ? reasoningTokens : undefined,
      },
      cost: typeof json.usage?.cost === 'number' ? json.usage.cost : undefined,
      model: json.model ?? targetModel,
      finishReason: json.choices?.[0]?.finish_reason === 'length' ? 'length' : 'stop',
    };
  }

  async streamText(
    options: ProviderRequestOptions,
    callbacks: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> {
    const targetModel = options.model;

    if (callbacks.isCancelled()) {
      return { content: '', usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'cancelled' };
    }

    // Состояние попытки живёт снаружи try: при обрыве посреди ответа то, что уже ушло
    // пользователю, возвращается как есть, а не дописывается вторым ответом другой модели.
    let accumulatedContent = '';
    let streamedAny = false;
    let insideReasoning = false;
    let promptTokens = 0;
    let completionTokens = 0;
    let reasoningTokens: number | null = null;
    let cachedTokens: number | null = null;
    let costUsd: number | undefined;
    let actualModel: string | undefined;

    const partialResponse = (reason: 'cancelled' | 'error'): ProviderResponse => {
      if (insideReasoning) {
        insideReasoning = false;
        callbacks.onDelta('\n</think>\n\n');
        accumulatedContent += '\n</think>\n\n';
      }
      return {
        content: accumulatedContent,
        usage: {
          inputTokens: promptTokens || 0,
          outputTokens: completionTokens || Math.ceil(accumulatedContent.length / 4),
          cachedTokens:
            typeof cachedTokens === 'number' && cachedTokens > 0 ? cachedTokens : undefined,
          reasoningTokens: reasoningTokens ?? undefined,
        },
        cost: costUsd,
        model: actualModel ?? targetModel,
        finishReason: reason,
      };
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(options, true)),
        signal: options.signal,
      });

      if (!response.ok || !response.body) {
        throw await describeUpstreamFailure(targetModel, response);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finishReason: 'stop' | 'length' | 'cancelled' | 'error' = 'stop';

      while (true) {
        if (callbacks.isCancelled()) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          finishReason = 'cancelled';
          break;
        }

        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            const reasoningDelta =
              parsed.choices?.[0]?.delta?.reasoning ??
              parsed.choices?.[0]?.delta?.reasoning_content ??
              '';
            const contentDelta = parsed.choices?.[0]?.delta?.content ?? '';

            if (reasoningDelta) {
              if (!insideReasoning) {
                insideReasoning = true;
                callbacks.onDelta('<think>\n');
                accumulatedContent += '<think>\n';
              }
              streamedAny = true;
              accumulatedContent += reasoningDelta;
              callbacks.onDelta(reasoningDelta);
            }

            if (contentDelta) {
              if (insideReasoning) {
                insideReasoning = false;
                callbacks.onDelta('\n</think>\n\n');
                accumulatedContent += '\n</think>\n\n';
              }
              streamedAny = true;
              accumulatedContent += contentDelta;
              callbacks.onDelta(contentDelta);
            }

            if (parsed.choices?.[0]?.finish_reason === 'length') {
              finishReason = 'length';
            }

            if (typeof parsed.model === 'string') {
              actualModel = parsed.model;
            }

            if (parsed.usage) {
              if (typeof parsed.usage.cost === 'number') {
                costUsd = parsed.usage.cost;
              }
              promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
              completionTokens = parsed.usage.completion_tokens ?? completionTokens;
              const rTokens =
                parsed.usage.completion_tokens_details?.reasoning_tokens ??
                parsed.usage.completionTokensDetails?.reasoningTokens;
              if (typeof rTokens === 'number') {
                reasoningTokens = rTokens;
              }
              const cTokens =
                parsed.usage.prompt_tokens_details?.cached_tokens ??
                parsed.usage.native_tokens_cached;
              if (typeof cTokens === 'number') {
                cachedTokens = cTokens;
              }
            }
          } catch {
            // ignore parsing errors
          }
        }
      }

      if (insideReasoning) {
        insideReasoning = false;
        callbacks.onDelta('\n</think>\n\n');
        accumulatedContent += '\n</think>\n\n';
      }

      if (completionTokens === 0 && streamedAny) {
        completionTokens = Math.ceil(accumulatedContent.length / 4);
      }
      return {
        content: accumulatedContent,
        usage: {
          inputTokens: promptTokens,
          outputTokens: completionTokens,
          cachedTokens:
            typeof cachedTokens === 'number' && cachedTokens > 0 ? cachedTokens : undefined,
          reasoningTokens: reasoningTokens ?? undefined,
        },
        cost: costUsd,
        model: actualModel ?? targetModel,
        finishReason,
      };
    } catch (err: unknown) {
      const aborted = (err as Error)?.name === 'AbortError' || callbacks.isCancelled();
      if (streamedAny) {
        return partialResponse(aborted ? 'cancelled' : 'error');
      }
      if (aborted) {
        return {
          content: '',
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'cancelled',
        };
      }
      throw err;
    }
  }

  /** Тело агентского запроса (с инструментами). Отдельный метод, чтобы тесты проверяли payload. */
  buildAgentBody(request: AgentProviderRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: prepareAgentMessages(request.model, request.messages),
      stream: true,
      max_tokens: Math.min(request.maxTokens, MAX_COMPLETION_TOKENS),
      usage: { include: true },
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
    }
    if (request.reasoning) body.reasoning = request.reasoning;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    return body;
  }

  /**
   * Стриминг с вызовом функций для API агентов (/v1). В отличие от `streamText`, размышления модели не вклеиваются в текст
   * ответа, а приходят отдельными событиями, а вызовы функций собираются из частей по индексу.
   */
  async streamAgent(
    request: AgentProviderRequest,
    hooks: { onEvent: (event: AgentStreamEvent) => void; isCancelled: () => boolean },
  ): Promise<AgentProviderResult> {
    const targetModel = request.model;
    const empty = (finishReason: 'cancelled' | 'error'): AgentProviderResult => ({
      content: '',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason,
    });
    if (hooks.isCancelled()) return empty('cancelled');

    let content = '';
    let emitted = false;
    let promptTokens = 0;
    let completionTokens = 0;
    let reasoningTokens: number | undefined;
    let cachedTokens: number | undefined;
    let costUsd: number | undefined;
    let actualModel: string | undefined;
    let finishReason: AgentProviderResult['finishReason'] = 'stop';
    const calls = new Map<number, AgentToolCall>();

    const snapshot = (reason: AgentProviderResult['finishReason']): AgentProviderResult => {
      const toolCalls = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call)
        .filter((call) => call.function.name);
      return {
        content,
        toolCalls,
        finishReason: reason === 'stop' && toolCalls.length > 0 ? 'tool_calls' : reason,
        usage: {
          inputTokens: promptTokens,
          outputTokens:
            completionTokens ||
            Math.ceil(
              (content.length + toolCalls.reduce((n, c) => n + c.function.arguments.length, 0)) / 4,
            ),
          cachedTokens: cachedTokens && cachedTokens > 0 ? cachedTokens : undefined,
          reasoningTokens,
        },
        cost: costUsd,
        model: actualModel ?? targetModel,
      };
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildAgentBody(request)),
        signal: request.signal,
      });
      if (!response.ok || !response.body) {
        throw await describeUpstreamFailure(targetModel, response);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const handle = (dataStr: string): void => {
        let parsed: StreamChunk;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          return;
        }
        if (parsed.error) {
          const status = Number(parsed.error.code);
          const message = String(parsed.error.message ?? 'upstream error');
          if (!emitted) {
            throw new OpenRouterError(
              targetModel,
              Number.isInteger(status) && status >= 400 ? status : 502,
              message,
            );
          }
          finishReason = 'error';
          return;
        }
        if (typeof parsed.model === 'string') actualModel = parsed.model;
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        if (delta) {
          const reasoning = delta.reasoning ?? delta.reasoning_content;
          if (typeof reasoning === 'string' && reasoning) {
            emitted = true;
            hooks.onEvent({ kind: 'reasoning', text: reasoning });
          }
          if (typeof delta.content === 'string' && delta.content) {
            emitted = true;
            content += delta.content;
            hooks.onEvent({ kind: 'content', text: delta.content });
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const part of delta.tool_calls as StreamToolCallPart[]) {
              const index =
                typeof part.index === 'number' && Number.isInteger(part.index) ? part.index : 0;
              const current = calls.get(index) ?? {
                id: '',
                type: 'function' as const,
                function: { name: '', arguments: '' },
              };
              if (typeof part.id === 'string' && part.id) current.id = part.id;
              if (typeof part.function?.name === 'string')
                current.function.name += part.function.name;
              const args =
                typeof part.function?.arguments === 'string' ? part.function.arguments : '';
              current.function.arguments += args;
              if (!current.id)
                current.id = `call_${index}_${Math.random().toString(36).slice(2, 10)}`;
              calls.set(index, current);
              emitted = true;
              hooks.onEvent({
                kind: 'tool_call',
                index,
                id: typeof part.id === 'string' && part.id ? part.id : undefined,
                name:
                  typeof part.function?.name === 'string' && part.function.name
                    ? part.function.name
                    : undefined,
                argumentsDelta: args || undefined,
              });
            }
          }
        }
        const reason = choice?.finish_reason;
        if (reason === 'length') finishReason = 'length';
        else if (reason === 'tool_calls') finishReason = 'tool_calls';
        else if (reason === 'error') finishReason = 'error';

        const usage = parsed.usage;
        if (usage) {
          if (typeof usage.cost === 'number') costUsd = usage.cost;
          promptTokens = usage.prompt_tokens ?? promptTokens;
          completionTokens = usage.completion_tokens ?? completionTokens;
          const r = usage.completion_tokens_details?.reasoning_tokens;
          if (typeof r === 'number') reasoningTokens = r;
          const c = usage.prompt_tokens_details?.cached_tokens ?? usage.native_tokens_cached;
          if (typeof c === 'number') cachedTokens = c;
        }
      };

      while (true) {
        if (hooks.isCancelled()) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          return snapshot('cancelled');
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data && data !== '[DONE]') handle(data);
        }
      }
      const tail = buffer.trim();
      if (tail.startsWith('data:')) {
        const data = tail.slice(5).trim();
        if (data && data !== '[DONE]') handle(data);
      }
      return snapshot(finishReason);
    } catch (err: unknown) {
      if (err instanceof OpenRouterError) throw err;
      const aborted = (err as Error)?.name === 'AbortError' || hooks.isCancelled();
      if (emitted) return snapshot(aborted ? 'cancelled' : 'error');
      if (aborted) return empty('cancelled');
      throw err;
    }
  }
}
