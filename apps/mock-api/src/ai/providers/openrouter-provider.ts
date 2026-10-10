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
async function describeUpstreamFailure(model: string, response: Response): Promise<OpenRouterError> {
  let body = '';
  try {
    body = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    // тело недоступно
  }
  const error = new OpenRouterError(model, response.status, body);
  if (response.status === 402) {
    console.error(`[openrouter] ${error.message}. Похоже, на счёте OpenRouter закончились кредиты.`);
  } else {
    console.warn(`[openrouter] ${error.message}`);
  }
  return error;
}

type CacheableContent = Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;

type WireMessage = { role: ProviderMessage['role']; content: string | CacheableContent };

function withCacheBreakpoint(message: ProviderMessage): WireMessage {
  return {
    role: message.role,
    content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }],
  };
}

/**
 * Явное кэширование промпта нужно только моделям Anthropic: OpenAI, DeepSeek, Grok и Gemini кэшируют
 * автоматически. Читать из кэша в 10 раз дешевле, чем платить за вход заново, а контекст проекта и
 * системный промпт повторяются в каждом сообщении. Две точки кэша: системный промпт (вместе с
 * контекстом проекта) и стабильная часть истории — сообщение перед последним вопросом.
 * Короче порога провайдера (4096 токенов у Opus и Haiku) запрос просто не кэшируется, без доплаты.
 */
export function prepareMessages(model: string, messages: ProviderMessage[]): WireMessage[] {
  const wire: WireMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (!model.startsWith('anthropic/')) {
    return wire;
  }

  const systemIndex = messages.findIndex((m) => m.role === 'system');
  if (systemIndex >= 0 && messages[systemIndex].content) {
    wire[systemIndex] = withCacheBreakpoint(messages[systemIndex]);
  }

  const dialogue = messages
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.role !== 'system');
  if (dialogue.length > 2) {
    const checkpoint = dialogue[dialogue.length - 2];
    if (checkpoint.m.content) {
      wire[checkpoint.index] = withCacheBreakpoint(checkpoint.m);
    }
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
export function mergeReasoningDetails(target: Array<Record<string, unknown>>, chunk: unknown): void {
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

export class OpenRouterProvider implements AIProvider {
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

        let parsed: Record<string, any>;
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
          if (delta.reasoning_details) mergeReasoningDetails(reasoningDetails, delta.reasoning_details);

          if (typeof delta.content === 'string' && delta.content) {
            streamedAny = true;
            content += delta.content;
            callbacks.onDelta(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            streamedAny = true;
            for (const part of delta.tool_calls as Array<Record<string, any>>) {
              const index = typeof part.index === 'number' ? part.index : partialCalls.size;
              let call = partialCalls.get(index);
              if (!call) {
                call = { id: '', name: '', arguments: '' };
                partialCalls.set(index, call);
              }
              if (typeof part.id === 'string' && part.id) call.id = part.id;
              if (typeof part.function?.name === 'string') call.name += part.function.name;
              if (typeof part.function?.arguments === 'string') call.arguments += part.function.arguments;
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
        return { content: '', usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'cancelled' };
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
        cachedTokens: typeof cachedTokens === 'number' && cachedTokens > 0 ? cachedTokens : undefined,
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
          cachedTokens: typeof cachedTokens === 'number' && cachedTokens > 0 ? cachedTokens : undefined,
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
          cachedTokens: typeof cachedTokens === 'number' && cachedTokens > 0 ? cachedTokens : undefined,
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
        return { content: '', usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'cancelled' };
      }
      throw err;
    }
  }
}
