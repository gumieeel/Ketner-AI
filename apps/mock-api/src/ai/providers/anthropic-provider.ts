/**
 * Прямой провайдер Anthropic (Messages API через официальный SDK `@anthropic-ai/sdk`).
 *
 * Дополнительный путь к моделям Claude в обход OpenRouter: включается ключом ANTHROPIC_API_KEY,
 * а маршрутизатор (routed-provider.ts) при его сбое отправляет тот же запрос через OpenRouter.
 * Интерфейс тот же, что у OpenRouterProvider: стриминг, вызов инструментов, usage с кэшем.
 *
 * Особенности моделей Claude 5.5 (Opus, Sonnet, Haiku):
 *  - размышления адаптивные (`thinking: {type: 'adaptive'}`), отключить их нельзя: глубину задаёт
 *    `output_config.effort` (low…max). Наш `none` превращается в `low`. Сводка размышлений
 *    (`display: 'summarized'`) показывается в чате так же, как размышления через OpenRouter;
 *  - `temperature` и принудительный `tool_choice` эти модели не принимают — не отправляем;
 *  - блоки размышлений шага агента нужно вернуть в следующем запросе без изменений: они уходят
 *    в `reasoningDetails` и обратно (только блоки `thinking` / `redacted_thinking`);
 *  - кэш промпта — явными точками `cache_control` (до 4): конец системного промпта, якорь и
 *    история перед вопросом, как в ai/providers/openrouter-provider.ts; в цикле агента — системный
 *    промпт и последнее сообщение, чтобы следующий шаг читал всю историю из кэша.
 *
 * Цену запроса считает маршрутизатор по ценам прямого API из реестра: usage включает запись
 * в кэш (`cacheWriteTokens`, ×1.25 к цене входа) и чтение из него (`cachedTokens`).
 */

import Anthropic from '@anthropic-ai/sdk';
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
  ReasoningEffort,
} from '../gateway-types.js';
import { MAX_COMPLETION_TOKENS } from './openrouter-provider.js';

export interface AnthropicProviderConfig {
  apiKey: string;
  baseURL?: string;
  /** Подмена fetch (тесты). */
  fetch?: typeof fetch;
}

type Effort = NonNullable<Anthropic.OutputConfig['effort']>;
type ThinkingBlock = Anthropic.ThinkingBlockParam | Anthropic.RedactedThinkingBlockParam;

const EPHEMERAL = { type: 'ephemeral' } as const;

/** Глубина размышлений шлюза → effort Claude. Размышления у Claude 5.5 не отключаются. */
const EFFORT_BY_REASONING: Readonly<Record<ReasoningEffort, Effort>> = {
  none: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

function reasoningParams(reasoning: ProviderRequestOptions['reasoning']): {
  thinking: Anthropic.ThinkingConfigAdaptive;
  output_config?: Anthropic.OutputConfig;
} {
  const thinking = { type: 'adaptive', display: 'summarized' } as const;
  if (!reasoning) return { thinking };
  const effort =
    'effort' in reasoning
      ? EFFORT_BY_REASONING[reasoning.effort]
      : reasoning.enabled
        ? 'medium'
        : 'low';
  return { thinking, output_config: { effort } };
}

function textBlock(text: string, cache = false): Anthropic.TextBlockParam {
  return cache ? { type: 'text', text, cache_control: EPHEMERAL } : { type: 'text', text };
}

/** Блоки размышлений Claude из `reasoningDetails` (блоки OpenRouter сюда не попадают). */
function thinkingBlocksOf(details: unknown[] | undefined): ThinkingBlock[] {
  return (details ?? []).filter(
    (item): item is ThinkingBlock =>
      Boolean(item) &&
      typeof item === 'object' &&
      ((item as { type?: unknown }).type === 'thinking' ||
        (item as { type?: unknown }).type === 'redacted_thinking'),
  );
}

/** Последний блок сообщения получает точку кэша. */
function withCacheOnLastBlock(message: Anthropic.MessageParam): Anthropic.MessageParam {
  const blocks: Anthropic.ContentBlockParam[] =
    typeof message.content === 'string' ? [textBlock(message.content)] : [...message.content];
  const last = blocks.at(-1);
  if (last && (last.type === 'text' || last.type === 'tool_result')) {
    blocks[blocks.length - 1] = { ...last, cache_control: EPHEMERAL };
  }
  return { ...message, content: blocks };
}

/**
 * Модели Claude 5.5 не принимают последнее сообщение ассистента (prefill) и требуют, чтобы диалог
 * начинался с пользователя.
 */
function normalizeTurns(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const result = [...messages];
  if (result[0]?.role !== 'user') result.unshift({ role: 'user', content: '…' });
  if (result.at(-1)?.role === 'assistant') result.push({ role: 'user', content: 'Continue.' });
  return result;
}

/**
 * Запрос чата: ведущие системные сообщения → `system`, остальное — диалог. Точки кэша — как у
 * OpenRouter для Claude: конец системного промпта, якорь (первое сообщение) и сообщение перед
 * последним вопросом.
 */
export function toAnthropicChat(messages: ProviderMessage[]): {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
} {
  let index = 0;
  const systemTexts: string[] = [];
  while (index < messages.length && messages[index].role === 'system') {
    if (messages[index].content) systemTexts.push(messages[index].content);
    index += 1;
  }
  const dialogue = messages
    .slice(index)
    .map((m): Anthropic.MessageParam =>
      m.role === 'system'
        ? { role: 'user', content: `[System note] ${m.content}` }
        : { role: m.role, content: m.content },
    );
  const breakpoints = new Set<number>();
  if (dialogue.length >= 4) breakpoints.add(0);
  if (dialogue.length > 2) breakpoints.add(dialogue.length - 2);
  const cached = dialogue.map((m, i) =>
    breakpoints.has(i) && typeof m.content === 'string' && m.content ? withCacheOnLastBlock(m) : m,
  );
  return {
    system: systemTexts.map((text, i) => textBlock(text, i === systemTexts.length - 1)),
    messages: normalizeTurns(cached),
  };
}

/**
 * Шаг агента: сообщения инструментов → `tool_result`, вызовы → `tool_use`, размышления прошлого
 * шага — первыми в сообщении ассистента. Точки кэша: системный промпт и последнее сообщение.
 */
export function toAnthropicAgentTurn(messages: ChatWireMessage[]): {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
} {
  const systemTexts: string[] = [];
  const turns: Anthropic.MessageParam[] = [];
  const pushUserBlocks = (blocks: Anthropic.ContentBlockParam[]): void => {
    const last = turns.at(-1);
    if (last?.role === 'user' && Array.isArray(last.content)) {
      last.content = [...last.content, ...blocks];
    } else {
      turns.push({ role: 'user', content: blocks });
    }
  };

  for (const message of messages) {
    if (message.role === 'system') {
      if (turns.length === 0) systemTexts.push(message.content);
      else pushUserBlocks([textBlock(`[System note] ${message.content}`)]);
      continue;
    }
    if (message.role === 'user') {
      pushUserBlocks([textBlock(message.content || '…')]);
      continue;
    }
    if (message.role === 'tool') {
      pushUserBlocks([
        { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content },
      ]);
      continue;
    }
    const blocks: Anthropic.ContentBlockParam[] = [...thinkingBlocksOf(message.reasoningDetails)];
    if (message.content) blocks.push(textBlock(message.content));
    for (const call of message.toolCalls ?? []) {
      let input: unknown;
      try {
        input = JSON.parse(call.arguments || '{}');
      } catch {
        input = {};
      }
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
    }
    if (blocks.length > 0) turns.push({ role: 'assistant', content: blocks });
  }

  const normalized = normalizeTurns(turns);
  const lastIndex = normalized.length - 1;
  return {
    system: systemTexts.map((text, i) => textBlock(text, i === systemTexts.length - 1)),
    messages: normalized.map((m, i) => (i === lastIndex ? withCacheOnLastBlock(m) : m)),
  };
}

function usageOf(message: Anthropic.Message): ProviderResponse['usage'] & {
  cacheWriteTokens?: number;
} {
  const usage = message.usage;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    // В Messages API input_tokens — только некэшированная часть входа после последней точки кэша.
    inputTokens: usage.input_tokens + cacheRead + cacheWrite,
    outputTokens: usage.output_tokens,
    ...(cacheRead > 0 ? { cachedTokens: cacheRead } : {}),
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    ...(usage.output_tokens_details?.thinking_tokens
      ? { reasoningTokens: usage.output_tokens_details.thinking_tokens }
      : {}),
  };
}

const isAbort = (error: unknown): boolean =>
  error instanceof Anthropic.APIUserAbortError || (error as Error)?.name === 'AbortError';

export class AnthropicProvider implements AIProvider {
  readonly type: AIProviderType = 'anthropic';
  readonly name = 'Anthropic API';
  private readonly client: Anthropic | null;

  constructor(config: AnthropicProviderConfig) {
    const apiKey = config.apiKey.trim();
    this.client = apiKey
      ? new Anthropic({
          apiKey,
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
          ...(config.fetch ? { fetch: config.fetch } : {}),
          // Повторять самому незачем: при сбое запрос сразу уходит через OpenRouter.
          maxRetries: 0,
        })
      : null;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  private requireClient(): Anthropic {
    if (!this.client) throw new Error('ANTHROPIC_API_KEY не задан');
    return this.client;
  }

  /** Параметры запроса чата. Отдельным методом, чтобы тесты видели реальный payload. */
  buildParams(options: ProviderRequestOptions): Anthropic.MessageCreateParamsNonStreaming {
    const { system, messages } = toAnthropicChat(options.messages);
    return {
      model: options.model,
      max_tokens: Math.min(options.maxTokens ?? 4096, MAX_COMPLETION_TOKENS),
      ...(system.length > 0 ? { system } : {}),
      messages,
      ...reasoningParams(options.reasoning),
    };
  }

  /** Параметры шага агента с инструментами. */
  buildChatParams(options: ChatCompletionOptions): Anthropic.MessageCreateParamsNonStreaming {
    const { system, messages } = toAnthropicAgentTurn(options.messages);
    const tools: Anthropic.Tool[] | undefined = options.tools?.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: {
        type: 'object',
        ...(tool.function.parameters ?? {}),
      } as Anthropic.Tool.InputSchema,
      // Аргументы (например, содержимое файла) идут потоком: иначе сторож простоя видел бы
      // минуты тишины, пока API копит большой вызов целиком.
      eager_input_streaming: true,
    }));
    return {
      model: options.model,
      max_tokens: Math.min(options.maxTokens ?? 8192, MAX_COMPLETION_TOKENS),
      ...(system.length > 0 ? { system } : {}),
      messages,
      ...(tools && tools.length > 0 ? { tools, tool_choice: { type: 'auto' } } : {}),
      ...reasoningParams(options.reasoning),
    };
  }

  async generateText(options: ProviderRequestOptions): Promise<ProviderResponse> {
    try {
      const message = await this.requireClient().messages.create(this.buildParams(options), {
        signal: options.signal,
      });
      const thinking = message.content
        .map((block) => (block.type === 'thinking' ? block.thinking : ''))
        .join('');
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      return {
        content: thinking ? `<think>\n${thinking}\n</think>\n\n${text}` : text,
        usage: usageOf(message),
        model: message.model,
        via: this.type,
        finishReason: message.stop_reason === 'max_tokens' ? 'length' : 'stop',
      };
    } catch (error) {
      if (isAbort(error)) {
        return {
          content: '',
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: 'cancelled',
        };
      }
      throw error;
    }
  }

  async streamText(
    options: ProviderRequestOptions,
    callbacks: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> {
    if (callbacks.isCancelled()) {
      return { content: '', usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'cancelled' };
    }
    let content = '';
    let insideThinking = false;
    const emit = (text: string): void => {
      content += text;
      callbacks.onDelta(text);
    };
    const closeThinking = (): void => {
      if (insideThinking) {
        insideThinking = false;
        emit('\n</think>\n\n');
      }
    };
    const partial = (reason: 'cancelled' | 'error'): ProviderResponse => {
      closeThinking();
      return {
        content,
        usage: { inputTokens: 0, outputTokens: Math.ceil(content.length / 4) },
        model: options.model,
        via: this.type,
        finishReason: reason,
      };
    };

    const stream = this.requireClient().messages.stream(this.buildParams(options), {
      signal: options.signal,
    });
    try {
      for await (const event of stream) {
        if (callbacks.isCancelled()) {
          stream.abort();
          return partial('cancelled');
        }
        if (event.type !== 'content_block_delta') continue;
        if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
          if (!insideThinking) {
            insideThinking = true;
            emit('<think>\n');
          }
          emit(event.delta.thinking);
        } else if (event.delta.type === 'text_delta' && event.delta.text) {
          closeThinking();
          emit(event.delta.text);
        }
      }
      closeThinking();
      const message = await stream.finalMessage();
      // Отказ модели по правилам безопасности — это ответ модели, а не сбой канала: шлюз увидит
      // пустой ответ и возьмёт следующую модель цепочки (видимо для пользователя).
      const finishReason =
        message.stop_reason === 'max_tokens' ||
        message.stop_reason === 'model_context_window_exceeded'
          ? 'length'
          : message.stop_reason === 'refusal'
            ? 'error'
            : 'stop';
      return {
        content,
        usage: usageOf(message),
        model: message.model,
        via: this.type,
        finishReason,
      };
    } catch (error) {
      if (isAbort(error) || callbacks.isCancelled()) return partial('cancelled');
      // Обрыв после того, как пользователь уже что-то получил: отдаём полученное.
      if (content) return partial('error');
      throw error;
    }
  }

  async streamChat(
    options: ChatCompletionOptions,
    callbacks: ChatCompletionCallbacks,
  ): Promise<ChatCompletionResult> {
    const empty = (reason: 'cancelled' | 'error', content = ''): ChatCompletionResult => ({
      content,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: Math.ceil(content.length / 4) },
      model: options.model,
      via: this.type,
      finishReason: reason,
    });
    if (callbacks.isCancelled()) return empty('cancelled');

    let content = '';
    let streamedAny = false;
    const stream = this.requireClient().messages.stream(this.buildChatParams(options), {
      signal: options.signal,
    });
    try {
      for await (const event of stream) {
        if (callbacks.isCancelled()) {
          stream.abort();
          return empty('cancelled', content);
        }
        callbacks.onActivity?.();
        if (event.type !== 'content_block_delta') continue;
        if (event.delta.type === 'text_delta' && event.delta.text) {
          streamedAny = true;
          content += event.delta.text;
          callbacks.onDelta(event.delta.text);
        } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
          streamedAny = true;
          callbacks.onReasoningDelta?.(event.delta.thinking);
        } else if (event.delta.type === 'input_json_delta') {
          streamedAny = true;
        }
      }
      const message = await stream.finalMessage();
      const thinking = message.content.filter(
        (block): block is Anthropic.ThinkingBlock | Anthropic.RedactedThinkingBlock =>
          block.type === 'thinking' || block.type === 'redacted_thinking',
      );
      // Вызов, оборванный лимитом ответа или отказом, исполнять нельзя: аргументы могут быть
      // обрезаны (с потоковой передачей аргументов API их не проверяет).
      const truncated =
        message.stop_reason === 'max_tokens' ||
        message.stop_reason === 'model_context_window_exceeded' ||
        message.stop_reason === 'refusal';
      const toolCalls: ChatToolCall[] = truncated
        ? []
        : message.content.flatMap((block) =>
            block.type === 'tool_use'
              ? [{ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }]
              : [],
          );
      return {
        content,
        toolCalls,
        reasoningDetails: thinking.length > 0 ? thinking : undefined,
        usage: usageOf(message),
        model: message.model,
        via: this.type,
        finishReason:
          message.stop_reason === 'refusal'
            ? 'error'
            : truncated
              ? 'length'
              : toolCalls.length > 0
                ? 'tool_calls'
                : 'stop',
      };
    } catch (error) {
      if (isAbort(error) || callbacks.isCancelled()) return empty('cancelled', content);
      if (streamedAny) return empty('error', content);
      throw error;
    }
  }
}
