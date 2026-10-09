/**
 * Фабрика и менеджер AI провайдеров.
 *
 * Все модели идут через один канал: OpenRouter, один ключ OPENROUTER_API_KEY и один счёт.
 * Прямых ключей OpenAI, Anthropic и Google в проекте нет. Менеджер оставлен как точка
 * внедрения mock-провайдера в тестах и как место, куда можно добавить второй канал.
 */
import { config } from '../../config.js';
import { OpenRouterProvider } from './openrouter-provider.js';
export class ProviderManager {
    providers = new Map();
    constructor() {
        this.initProviders();
    }
    initProviders() {
        this.providers.set('openrouter', new OpenRouterProvider({
            apiKey: config.openRouterApiKey,
            baseUrl: config.openRouterBaseUrl,
        }));
    }
    /** Получить провайдер по типу. */
    get(type) {
        return this.providers.get(type);
    }
    /** Проверить, настроен ли и готов к работе провайдер. */
    isAvailable(type) {
        const provider = this.providers.get(type);
        return provider ? provider.isAvailable() : false;
    }
    /** Получить все зарегистрированные провайдеры. */
    getAll() {
        return Array.from(this.providers.values());
    }
    /** Переопределить или внедрить mock-провайдер (для тестов). */
    setProvider(type, provider) {
        this.providers.set(type, provider);
    }
}
export const providerManager = new ProviderManager();
