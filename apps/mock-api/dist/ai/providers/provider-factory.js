/**
 * Фабрика и менеджер AI провайдеров.
 *
 * Создаёт экземпляры адаптеров (OpenAI, Anthropic, Google, OpenRouter),
 * проверяет их доступность и предоставляет единую точку доступа.
 */
import { config } from '../../config.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { GoogleProvider } from './google-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';
export class ProviderManager {
    providers = new Map();
    constructor() {
        this.initProviders();
    }
    initProviders() {
        // OpenAI
        this.providers.set('openai', new OpenAIProvider({
            apiKey: config.openaiApiKey,
            baseUrl: config.openaiBaseUrl,
        }));
        // Anthropic
        this.providers.set('anthropic', new AnthropicProvider({
            apiKey: config.anthropicApiKey,
            baseUrl: config.anthropicBaseUrl,
        }));
        // Google Gemini
        this.providers.set('google', new GoogleProvider({
            apiKey: config.googleApiKey,
            baseUrl: config.googleBaseUrl,
        }));
        // OpenRouter
        this.providers.set('openrouter', new OpenRouterProvider({
            apiKey: config.openRouterApiKey,
            baseUrl: config.openRouterBaseUrl,
            defaultModel: config.openRouterModel,
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
