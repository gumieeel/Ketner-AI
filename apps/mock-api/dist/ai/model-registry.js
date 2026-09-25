/**
 * Реестр AI моделей — единый источник правды для всех моделей в системе.
 *
 * Модели конфигурируемы: имена, провайдеры, цены — всё меняется без
 * перекомпиляции. По умолчанию загружается набор из DEFAULT_MODELS,
 * который можно расширять через admin API или конфиг-файл.
 */
// ─────────────────────────────────────────────────────────────
// Вспомогательные фабрики
// ─────────────────────────────────────────────────────────────
const now = () => new Date().toISOString();
const DEFAULT_SYSTEM_PROMPT = {
    ru: 'Ты — умный, дружелюбный и профессиональный инженерный ИИ-ассистент Ketner AI. Отвечай конкретно, по делу, с чистым форматированием Markdown.',
    en: 'You are a smart, friendly, and professional engineering AI assistant by Ketner AI. Give concise, well-formatted Markdown answers.',
};
function makeCapabilities(overrides = {}) {
    return {
        reasoning: false,
        coding: false,
        vision: false,
        longContext: false,
        webSearch: false,
        creative: false,
        math: false,
        translation: false,
        research: false,
        ...overrides,
    };
}
function makePricing(input, output, cached = input * 0.5) {
    return {
        inputPricePerMillion: input,
        outputPricePerMillion: output,
        cachedInputPricePerMillion: cached,
        effectiveFrom: now(),
        effectiveTo: null,
    };
}
// ─────────────────────────────────────────────────────────────
// Стандартный набор моделей
// ─────────────────────────────────────────────────────────────
/**
 * Конфигурируемый набор моделей по умолчанию.
 *
 * Цены указаны в $ за 1M токенов. Они обновляются админом или автоматически.
 * providerModelId — это идентификатор модели у соответствующего провайдера.
 */
const DEFAULT_REGISTRY_ENTRIES = [
    {
        id: 'ketner-mini',
        name: 'Qwen 2.5 Coder',
        provider: 'openrouter',
        providerModelId: 'qwen/qwen3.8-27b:free',
        enabled: true,
        tier: 'free',
        capabilities: makeCapabilities({ coding: true, translation: true }),
        contextWindow: 32768,
        maxOutputTokens: 4096,
        pricing: makePricing(0, 0, 0),
        requiredPlan: null,
        contextMessages: 20,
        isPro: false,
        fallbackModelId: null,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'gpt-6-astra',
        name: 'GPT-6 Astra',
        provider: 'openai',
        providerModelId: 'gpt-4o',
        enabled: true,
        tier: 'flagship',
        capabilities: makeCapabilities({
            reasoning: true,
            coding: true,
            vision: true,
            creative: true,
            math: true,
            translation: true,
            research: true,
        }),
        contextWindow: 128000,
        maxOutputTokens: 16384,
        pricing: makePricing(2.5, 10, 1.25),
        requiredPlan: 'gpt-pro',
        contextMessages: 120,
        isPro: true,
        fallbackModelId: 'ketner-mini',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'claude-fable',
        name: 'Claude Fable 5.5',
        provider: 'anthropic',
        providerModelId: 'claude-sonnet-4-20250514',
        enabled: true,
        tier: 'flagship',
        capabilities: makeCapabilities({
            reasoning: true,
            coding: true,
            creative: true,
            translation: true,
            research: true,
            longContext: true,
        }),
        contextWindow: 200000,
        maxOutputTokens: 16384,
        pricing: makePricing(3, 15, 0.3),
        requiredPlan: 'claude-pro',
        contextMessages: 120,
        isPro: true,
        fallbackModelId: 'ketner-mini',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'gemini-pro',
        name: 'Gemini 3.8 Pro',
        provider: 'google',
        providerModelId: 'gemini-2.5-pro-preview-06-05',
        enabled: true,
        tier: 'flagship',
        capabilities: makeCapabilities({
            reasoning: true,
            coding: true,
            vision: true,
            longContext: true,
            math: true,
            translation: true,
            research: true,
        }),
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        pricing: makePricing(1.25, 10, 0.315),
        requiredPlan: 'gemini-pro',
        contextMessages: 120,
        isPro: true,
        fallbackModelId: 'ketner-mini',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'ketner-pro',
        name: 'Qwen 2.5 Max',
        provider: 'openrouter',
        providerModelId: 'qwen/qwen3.8-27b:free',
        enabled: true,
        tier: 'premium',
        capabilities: makeCapabilities({ coding: true, reasoning: true, math: true }),
        contextWindow: 65536,
        maxOutputTokens: 8192,
        pricing: makePricing(0.5, 2, 0.25),
        requiredPlan: 'ultra',
        contextMessages: 60,
        isPro: true,
        fallbackModelId: 'ketner-mini',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
];
// ─────────────────────────────────────────────────────────────
// Model Registry
// ─────────────────────────────────────────────────────────────
/**
 * Реестр моделей — управляет каталогом AI моделей.
 *
 * Поддерживает CRUD-операции, фильтрацию по плану и провайдеру,
 * а также конвертацию в legacy ModelInfo формат для обратной совместимости.
 */
export class ModelRegistry {
    entries;
    constructor(initialEntries) {
        this.entries = new Map();
        for (const entry of initialEntries ?? DEFAULT_REGISTRY_ENTRIES) {
            this.entries.set(entry.id, entry);
        }
    }
    /** Получить модель по ID. */
    get(modelId) {
        return this.entries.get(modelId);
    }
    /** Получить модель или модель по умолчанию. */
    resolve(modelId) {
        if (modelId) {
            const entry = this.entries.get(modelId);
            if (entry && entry.enabled)
                return entry;
        }
        return this.getDefault();
    }
    /** Модель по умолчанию — первая бесплатная. */
    getDefault() {
        for (const entry of this.entries.values()) {
            if (entry.enabled && !entry.isPro)
                return entry;
        }
        return this.entries.values().next().value;
    }
    /** Все активные модели. */
    getAll() {
        return Array.from(this.entries.values()).filter((e) => e.enabled);
    }
    /** Все модели (включая неактивные — для админа). */
    getAllIncludingDisabled() {
        return Array.from(this.entries.values());
    }
    /** Модели доступные пользователю с данным планом. */
    getForPlan(userPlan) {
        return this.getAll().filter((entry) => this.canAccess(userPlan, entry));
    }
    /** Модели по провайдеру. */
    getByProvider(provider) {
        return this.getAll().filter((e) => e.provider === provider);
    }
    /** Проверка доступа (обратная совместимость с canAccessModel). */
    canAccess(userPlan, entry) {
        if (!entry.isPro)
            return true;
        if (!userPlan || userPlan === 'free')
            return false;
        if (userPlan === 'ultra')
            return true;
        if (entry.requiredPlan && userPlan === entry.requiredPlan)
            return true;
        if (entry.id === 'ketner-pro' && (userPlan === 'plus' || userPlan === 'pro'))
            return true;
        return false;
    }
    /** Добавить или обновить модель. */
    upsert(entry) {
        entry.updatedAt = now();
        this.entries.set(entry.id, entry);
    }
    /** Удалить модель. */
    remove(modelId) {
        return this.entries.delete(modelId);
    }
    /** Включить/выключить модель. */
    setEnabled(modelId, enabled) {
        const entry = this.entries.get(modelId);
        if (!entry)
            return false;
        entry.enabled = enabled;
        entry.updatedAt = now();
        return true;
    }
    /** Обновить ценообразование модели. */
    updatePricing(modelId, pricing) {
        const entry = this.entries.get(modelId);
        if (!entry)
            return false;
        entry.pricing = pricing;
        entry.updatedAt = now();
        return true;
    }
    /** Получить цепочку fallback-моделей. */
    getFallbackChain(modelId, maxDepth = 5) {
        const chain = [];
        let current = this.entries.get(modelId);
        let depth = 0;
        while (current && depth < maxDepth) {
            chain.push(current);
            if (!current.fallbackModelId || current.fallbackModelId === current.id)
                break;
            current = this.entries.get(current.fallbackModelId);
            depth++;
        }
        return chain;
    }
    // ────────── Обратная совместимость ──────────
    /** Конвертация в legacy ModelInfo формат (для /api/meta). */
    toLegacyModelInfo() {
        return this.getAll().map((e) => ({
            id: e.id,
            name: e.isPro ? `${e.name} *` : e.name,
            contextMessages: e.contextMessages,
            isPro: e.isPro,
            requiredPlan: e.requiredPlan ?? undefined,
        }));
    }
    /** Конвертация в legacy PlanLimits (для /api/meta). */
    toLegacyPlanLimits() {
        return {
            free: { messagesPerDay: 10, contextMessages: 20 },
            'gpt-pro': { messagesPerDay: null, contextMessages: 120 },
            'claude-pro': { messagesPerDay: null, contextMessages: 120 },
            'gemini-pro': { messagesPerDay: null, contextMessages: 120 },
            ultra: { messagesPerDay: null, contextMessages: 500 },
            plus: { messagesPerDay: null, contextMessages: 60 },
            pro: { messagesPerDay: null, contextMessages: 120 },
        };
    }
    /** Legacy ModelCatalog (для /api/meta). */
    toLegacyCatalog() {
        return {
            models: this.toLegacyModelInfo(),
            defaultModelId: this.getDefault().id,
            limits: this.toLegacyPlanLimits(),
        };
    }
}
// ─────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────
/** Глобальный singleton реестра моделей. */
export const modelRegistry = new ModelRegistry();
