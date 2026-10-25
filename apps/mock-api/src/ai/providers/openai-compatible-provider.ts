/**
 * Прямые провайдеры с API в формате OpenAI Chat Completions: OpenAI (OPENAI_API_KEY) и Gemini
 * (GOOGLE_API_KEY, OpenAI-совместимый эндпоинт Gemini API).
 *
 * Поток, вызовы инструментов и usage приходят в том же формате, что у OpenRouter, поэтому разбор
 * общий (OpenRouterProvider), а отличается только тело запроса:
 *  - нет `usage: {include}` (это расширение OpenRouter) — usage в потоке включает
 *    `stream_options.include_usage`;
 *  - глубина размышлений — `reasoning_effort`, а не объект `reasoning`;
 *  - `max_completion_tokens` вместо `max_tokens` (у OpenAI `max_tokens` для моделей с
 *    размышлениями не принимается);
 *  - `reasoning_details` OpenRouter в сообщениях не отправляются.
 * Цены провайдер не сообщает: стоимость считает маршрутизатор по ценам прямого API из реестра.
 * Кэш у обоих автоматический по префиксу (отдельные точки не нужны), кэшированные токены приходят
 * в `usage.prompt_tokens_details.cached_tokens`.
 */

import type { AgentProviderRequest } from '../agent/agent-types.js';
import type {
  AIProviderType,
  ChatCompletionOptions,
  ProviderRequestOptions,
  ReasoningEffort,
} from '../gateway-types.js';
import { OpenRouterProvider } from './openrouter-provider.js';

export interface OpenAICompatibleConfig {
  type: 'openai' | 'google';
  name: string;
  apiKey: string;
  baseUrl: string;
}

/** Глубина размышлений шлюза → `reasoning_effort` провайдера. */
const EFFORTS: Readonly<Record<'openai' | 'google', Readonly<Record<ReasoningEffort, string>>>> = {
  openai: {
    none: 'none',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'xhigh',
  },
  // Gemini через OpenAI-совместимый API знает low / medium / high; размышления не отключаются.
  google: { none: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' },
};

export class OpenAICompatibleProvider extends OpenRouterProvider {
  override readonly type: AIProviderType;
  override readonly name: string;
  private readonly effortMap: Readonly<Record<ReasoningEffort, string>>;

  constructor(config: OpenAICompatibleConfig) {
    super({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.type = config.type;
    this.name = config.name;
    this.effortMap = EFFORTS[config.type];
  }

  protected override headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  private adapt(
    body: Record<string, unknown>,
    reasoning: ProviderRequestOptions['reasoning'],
  ): Record<string, unknown> {
    const { usage: _usage, reasoning: _reasoning, max_tokens: maxTokens, ...rest } = body;
    const adapted: Record<string, unknown> = { ...rest, max_completion_tokens: maxTokens };
    if (rest.stream) adapted.stream_options = { include_usage: true };
    if (reasoning) {
      if ('effort' in reasoning) adapted.reasoning_effort = this.effortMap[reasoning.effort];
      else if (!reasoning.enabled) adapted.reasoning_effort = this.effortMap.none;
    }
    if (Array.isArray(rest.messages)) {
      adapted.messages = (rest.messages as Array<Record<string, unknown>>).map(
        ({ reasoning_details: _details, ...message }) => message,
      );
    }
    return adapted;
  }

  override buildBody(options: ProviderRequestOptions, stream: boolean): Record<string, unknown> {
    return this.adapt(super.buildBody(options, stream), options.reasoning);
  }

  override buildChatBody(options: ChatCompletionOptions): Record<string, unknown> {
    return this.adapt(super.buildChatBody(options), options.reasoning);
  }

  override buildAgentBody(request: AgentProviderRequest): Record<string, unknown> {
    return this.adapt(super.buildAgentBody(request), request.reasoning);
  }
}
