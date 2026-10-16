/**
 * Фабрика и менеджер AI провайдеров.
 *
 * Основной канал — OpenRouter: один ключ OPENROUTER_API_KEY и один счёт на все модели. Прямые API
 * вендоров (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY) — дополнительный путь, по умолчанию
 * выключенный: с ключом модели вендора идут напрямую, а при сбое — через OpenRouter. Маршрутизатор
 * зарегистрирован под типом `openrouter`, поэтому шлюзу и агентам ничего не нужно знать о прямых
 * путях (ai/providers/routed-provider.ts). Менеджер — точка внедрения mock-провайдера в тестах.
 */

import { config } from '../../config.js';
import type { AIProvider, AIProviderType, DirectProviderType } from '../gateway-types.js';
import { defaultCircuitBreaker } from '../circuit-breaker.js';
import { modelRegistry } from '../model-registry.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
import { RoutedProvider } from './routed-provider.js';

/** Прямые провайдеры по ключам из окружения (без ключа провайдер недоступен). */
export function createDirectProviders(): Record<DirectProviderType, AIProvider> {
  return {
    anthropic: new AnthropicProvider({ apiKey: config.anthropicApiKey }),
    openai: new OpenAICompatibleProvider({
      type: 'openai',
      name: 'OpenAI API',
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
    }),
    google: new OpenAICompatibleProvider({
      type: 'google',
      name: 'Gemini API',
      apiKey: config.googleApiKey,
      baseUrl: config.googleBaseUrl,
    }),
  };
}

export class ProviderManager {
  private providers: Map<AIProviderType, AIProvider> = new Map();

  constructor() {
    this.initProviders();
  }

  private initProviders(): void {
    const direct = createDirectProviders();
    for (const [type, provider] of Object.entries(direct) as [DirectProviderType, AIProvider][]) {
      if (provider.isAvailable()) this.providers.set(type, provider);
    }
    this.providers.set(
      'openrouter',
      new RoutedProvider(
        new OpenRouterProvider({
          apiKey: config.openRouterApiKey,
          baseUrl: config.openRouterBaseUrl,
        }),
        direct,
        modelRegistry,
        defaultCircuitBreaker,
      ),
    );
  }

  /** Получить провайдер по типу. */
  get(type: AIProviderType): AIProvider | undefined {
    return this.providers.get(type);
  }

  /** Проверить, настроен ли и готов к работе провайдер. */
  isAvailable(type: AIProviderType): boolean {
    const provider = this.providers.get(type);
    return provider ? provider.isAvailable() : false;
  }

  /** Получить все зарегистрированные провайдеры. */
  getAll(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /** Переопределить или внедрить mock-провайдер (для тестов). */
  setProvider(type: AIProviderType, provider: AIProvider): void {
    this.providers.set(type, provider);
  }
}

export const providerManager = new ProviderManager();
