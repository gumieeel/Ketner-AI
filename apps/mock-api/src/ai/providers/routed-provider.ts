/**
 * Канал к моделям: прямой API вендора, если задан его ключ, иначе (и при сбое) — OpenRouter.
 *
 * Шлюз, агент Ketner Code и /v1 по-прежнему обращаются к провайдеру `openrouter` и передают id
 * модели OpenRouter (`anthropic/claude-opus-5.5`). Маршрутизатор находит у модели в реестре прямой
 * путь (`ModelRegistryEntry.direct`) и, если прямой провайдер настроен и его предохранитель закрыт,
 * отправляет запрос напрямую (`claude-opus-5-5` в Anthropic API). Ошибка до первого фрагмента ответа
 * — сбой прямого пути: предохранитель `anthropic:claude-opus-5-5` считает его (3 подряд — путь
 * закрыт на 30 секунд), а тот же запрос уходит через OpenRouter. После начала ответа повторять
 * нельзя (пользователь получил бы два ответа), поэтому отдаётся то, что пришло.
 *
 * Модель не подменяется: напрямую и через OpenRouter отвечает одна и та же модель вендора. В ответе
 * `via` — канал, который реально ответил (он же пишется в учёт), а `cost` — цена по прайсу прямого
 * API из реестра, если провайдер её не сообщил.
 */

import { isAgentCapable, type AgentCapableProvider } from '../agent/agent-types.js';
import type {
  AIProvider,
  AIProviderType,
  ChatCompletionCallbacks,
  ChatCompletionOptions,
  ChatCompletionResult,
  DirectProviderType,
  DirectRoute,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamCallbacks,
} from '../gateway-types.js';
import type { CircuitBreaker } from '../circuit-breaker.js';
import type { ModelRegistry } from '../model-registry.js';
import { directRequestCost } from '../engine-pricing.js';
import type { OpenRouterProvider } from './openrouter-provider.js';

type DirectProvider = AIProvider & Partial<AgentCapableProvider>;

interface DirectChoice {
  route: DirectRoute;
  provider: DirectProvider;
  breakerKey: string;
}

type WithUsage = {
  usage: ProviderResponse['usage'];
  cost?: number;
  model?: string;
  via?: AIProviderType;
};

export class RoutedProvider implements AIProvider, AgentCapableProvider {
  readonly type: AIProviderType = 'openrouter';
  readonly name = 'OpenRouter + прямые API';

  constructor(
    private readonly openrouter: OpenRouterProvider,
    private readonly direct: Partial<Record<DirectProviderType, DirectProvider>>,
    private readonly registry: ModelRegistry,
    private readonly breaker: CircuitBreaker,
  ) {}

  isAvailable(): boolean {
    return (
      this.openrouter.isAvailable() ||
      Object.values(this.direct).some((provider) => provider?.isAvailable())
    );
  }

  /** Прямые провайдеры с заданным ключом (для админки). */
  configuredDirect(): DirectProviderType[] {
    return (Object.keys(this.direct) as DirectProviderType[]).filter((type) =>
      this.direct[type]?.isAvailable(),
    );
  }

  /** Прямой путь для движка OpenRouter, если он настроен и не закрыт предохранителем. */
  private choose(engineId: string, needsAgent = false): DirectChoice | null {
    const entry = this.registry
      .getAllIncludingDisabled()
      .find((candidate) => candidate.providerModelId === engineId && candidate.direct);
    const route = entry?.direct;
    if (!route) return null;
    const provider = this.direct[route.provider];
    if (!provider || !provider.isAvailable()) return null;
    if (needsAgent && !isAgentCapable(provider)) return null;
    const breakerKey = `${route.provider}:${route.modelId}`;
    if (this.breaker.isOpen(breakerKey)) return null;
    return { route, provider, breakerKey };
  }

  private finish<T extends WithUsage>(result: T, choice: DirectChoice, engineId: string): T {
    return {
      ...result,
      // Отвечала та же модель, что запрошена: id OpenRouter, чтобы шлюз не принял это за подмену.
      model: engineId,
      via: choice.route.provider,
      cost: result.cost ?? directRequestCost(result.usage, choice.route.pricing),
    };
  }

  /**
   * Сначала прямой путь; ошибка до первого фрагмента — сбой пути и повтор через OpenRouter. Без
   * ключа OpenRouter повторять некуда: ошибка уходит шлюзу, и он берёт следующую модель цепочки.
   */
  private async withFallback<T extends WithUsage>(
    engineId: string,
    choice: DirectChoice | null,
    viaDirect: (choice: DirectChoice, markStreamed: () => void) => Promise<T>,
    viaOpenRouter: () => Promise<T>,
  ): Promise<T> {
    if (!choice) return viaOpenRouter();
    let streamed = false;
    try {
      const result = await viaDirect(choice, () => {
        streamed = true;
      });
      this.breaker.recordSuccess(choice.breakerKey);
      return this.finish(result, choice, engineId);
    } catch (error) {
      this.breaker.recordFailure(choice.breakerKey, error);
      if (streamed || !this.openrouter.isAvailable()) throw error;
      console.warn(
        `[routed-provider] прямой API ${choice.route.provider} (${choice.route.modelId}) не ответил, повтор через OpenRouter:`,
        error instanceof Error ? error.message : error,
      );
      return viaOpenRouter();
    }
  }

  generateText(options: ProviderRequestOptions): Promise<ProviderResponse> {
    return this.withFallback(
      options.model,
      this.choose(options.model),
      (choice) => choice.provider.generateText({ ...options, model: choice.route.modelId }),
      () => this.openrouter.generateText(options),
    );
  }

  streamText(
    options: ProviderRequestOptions,
    callbacks: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> {
    return this.withFallback(
      options.model,
      this.choose(options.model),
      (choice, markStreamed) =>
        choice.provider.streamText(
          { ...options, model: choice.route.modelId },
          {
            ...callbacks,
            onDelta: (delta) => {
              markStreamed();
              callbacks.onDelta(delta);
            },
          },
        ),
      () => this.openrouter.streamText(options, callbacks),
    );
  }

  streamChat(
    options: ChatCompletionOptions,
    callbacks: ChatCompletionCallbacks,
  ): Promise<ChatCompletionResult> {
    const choice = this.choose(options.model);
    return this.withFallback(
      options.model,
      choice?.provider.streamChat ? choice : null,
      (direct, markStreamed) =>
        direct.provider.streamChat!(
          { ...options, model: direct.route.modelId },
          {
            ...callbacks,
            onDelta: (delta) => {
              markStreamed();
              callbacks.onDelta(delta);
            },
            onReasoningDelta: (delta) => {
              markStreamed();
              callbacks.onReasoningDelta?.(delta);
            },
          },
        ),
      () => this.openrouter.streamChat(options, callbacks),
    );
  }

  /**
   * API агентов (/v1, формат OpenAI). Напрямую — только провайдеры с тем же форматом (OpenAI,
   * Gemini): у Claude в цикле инструментов блоки размышлений нужно возвращать без изменений, а
   * клиенты /v1 их не хранят, поэтому Claude здесь идёт через OpenRouter.
   */
  streamAgent(
    request: Parameters<AgentCapableProvider['streamAgent']>[0],
    hooks: Parameters<AgentCapableProvider['streamAgent']>[1],
  ): ReturnType<AgentCapableProvider['streamAgent']> {
    return this.withFallback(
      request.model,
      this.choose(request.model, true),
      (direct, markStreamed) =>
        direct.provider.streamAgent!(
          { ...request, model: direct.route.modelId },
          {
            ...hooks,
            onEvent: (event) => {
              markStreamed();
              hooks.onEvent(event);
            },
          },
        ),
      () => this.openrouter.streamAgent(request, hooks),
    );
  }
}
