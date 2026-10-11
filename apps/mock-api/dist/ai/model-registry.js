/**
 * Реестр AI моделей — единый источник правды для всех моделей в системе.
 *
 * Модели конфигурируемы: имена, провайдеры, цены — всё меняется без
 * перекомпиляции. По умолчанию загружается набор из DEFAULT_MODELS,
 * который можно расширять через admin API или конфиг-файл.
 */
import { getPlanLimits, planAllowsModel } from '../services/entitlement.js';
import { DAILY_MODEL_LIMITS } from '../services/daily-limits.js';
// ─────────────────────────────────────────────────────────────
// Вспомогательные фабрики
// ─────────────────────────────────────────────────────────────
const now = () => new Date().toISOString();
/**
 * Phase 3: Общий брендовый слой промптов Ketner AI (Brand Protection & Feature Context).
 * Вынесен отдельно от тарифных инструкций для чистоты архитектуры и снижения дублирования.
 */
export const COMMON_BRAND_SYSTEM_LAYER = {
    ru: 'Ты — инженерный ИИ-ассистент Ketner AI. Используй чистое форматирование Markdown. В Ketner AI пользователь может привязать локальную папку или GitHub-репозиторий через кнопку «Привязать папку / репозиторий» над строкой ввода. Если проект привязан, ты имеешь полный доступ к его файлам и коду. Если спрашивают, как привязать проект — объясни, как это сделать через интерфейс Ketner AI. Никогда не говори, что ты не можешь работать с локальной папкой или репозиторием. Никогда не упоминай, что ты создан OpenAI, Anthropic или Google. Ты — разработка Ketner AI.',
    en: 'You are an engineering AI assistant by Ketner AI. Use clean Markdown formatting. In Ketner AI, users can link local folders or GitHub repositories via the "Link folder / repo" button above the composer. If a project is linked, you have full access to its files and code. If asked how to link a project, explain the Ketner AI UI feature. Never claim you cannot work with local folders or repos. Never mention OpenAI, Anthropic, or Google. You are developed by Ketner AI.',
};
/**
 * Phase 3: Различия тарифов в одну строку.
 */
export const TIER_SYSTEM_MODIFIERS = {
    economy: {
        ru: 'Отвечай максимально кратко, ёмко и по существу, без лишних вступлений и заключений.',
        en: 'Keep responses concise, direct, and to the point without unnecessary filler or commentary.',
    },
    default: {
        ru: 'Ты — умный, дружелюбный и профессиональный ассистент. Давай глубокие, подробные, хорошо структурированные ответы с пошаговыми рассуждениями.',
        en: 'You are an intelligent, friendly, and professional assistant. Provide deep, detailed, well-structured answers with step-by-step reasoning.',
    },
};
export const ECONOMY_SYSTEM_PROMPT = {
    ru: `${COMMON_BRAND_SYSTEM_LAYER.ru} ${TIER_SYSTEM_MODIFIERS.economy.ru}`,
    en: `${COMMON_BRAND_SYSTEM_LAYER.en} ${TIER_SYSTEM_MODIFIERS.economy.en}`,
};
export const DEFAULT_SYSTEM_PROMPT = {
    ru: `${COMMON_BRAND_SYSTEM_LAYER.ru} ${TIER_SYSTEM_MODIFIERS.default.ru}`,
    en: `${COMMON_BRAND_SYSTEM_LAYER.en} ${TIER_SYSTEM_MODIFIERS.default.en}`,
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
/** Идентификатор самой дешёвой модели: база для Free, запасной вариант и «пол» при исчерпании бюджета. */
export const FLOOR_MODEL_ID = 'ketner-mini';
/** Рабочая лошадка: на неё переключаются премиум-запросы, когда квота премиум-моделей израсходована. */
export const WORKHORSE_MODEL_ID = 'ketner-pro';
const reasoning = (mandatory, efforts, toggle = false) => ({
    mandatory,
    efforts,
    ...(toggle ? { toggle: true } : {}),
});
/**
 * Набор моделей по умолчанию. Все модели идут через единый ключ OpenRouter, `providerModelId` —
 * это идентификатор модели в OpenRouter, ровно тот, что уходит в запрос (скрытых подмен нет).
 *
 * Цены — реальные цены OpenRouter на 08.10.2026, $ за 1M токенов (вход / выход / чтение из кэша).
 * Оценка качества — Artificial Analysis Intelligence Index при указанном усилии размышлений,
 * цена — типичный запрос (7.6k токенов на входе, 0.7k на выходе, с размышлениями):
 *
 *   ketner-mini  GPT-6 Luna            AA 30–38   $0.001   повседневные вопросы, Free
 *   ketner-pro   MiMo-V2.6 Pro         AA 46      $0.004   код и анализ: качество на уровне Grok 4.7 / Sonnet 5.5
 *                                                          (high) при цене в 7–10 раз ниже
 *   gpt-6.1-sol  GPT-6.1 Sol           AA 48–50   $0.03    сильная модель OpenAI
 *   claude-opus-5.5 Claude Opus 5.5    AA 51–54   $0.07    лучшая модель по соотношению качества и цены у Anthropic
 *
 * Не вошли намеренно: GPT-6 Astra и Claude Fable 5.1 (то же качество, что у Sol и Opus, но в 3–5 раз
 * дороже), Kimi K3, Qwen3.8 Max, Muse Spark, Nemotron 3 Ultra (хуже и дороже модели ketner-pro).
 * Старые id (gpt-6-astra, claude-fable и др.) перенаправляются через LEGACY_MODEL_ALIASES.
 */
const DEFAULT_REGISTRY_ENTRIES = [
    {
        id: 'auto',
        name: '✨ Best AI (Auto)',
        provider: 'openrouter',
        providerModelId: 'auto',
        enabled: true,
        tier: 'free',
        costClass: 'lite',
        reasoning: reasoning(false, []),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            math: true,
            creative: true,
            translation: true,
            research: true,
        }),
        contextWindow: 128000,
        maxOutputTokens: 8192,
        pricing: makePricing(0, 0, 0),
        requiredPlan: null,
        contextMessages: 120,
        isPro: false,
        fallbackModelId: FLOOR_MODEL_ID,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    // ── Бесплатная модель для анонимных пользователей без аккаунта ──
    {
        id: 'nemotron-ultra',
        name: 'Nemotron 3 Ultra (Free)',
        provider: 'openrouter',
        providerModelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        enabled: true,
        tier: 'free',
        costClass: 'lite',
        reasoning: reasoning(true, [], true),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            math: true,
            creative: true,
            translation: true,
        }),
        contextWindow: 131072,
        maxOutputTokens: 4096,
        pricing: makePricing(0, 0, 0),
        requiredPlan: null,
        contextMessages: 40,
        isPro: false,
        fallbackModelId: null,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    // ── Класс lite: повседневные запросы, Free и запасные модели ──
    {
        id: 'ketner-mini',
        name: 'Ketner Mini',
        provider: 'openrouter',
        providerModelId: 'openai/gpt-6-luna',
        enabled: true,
        tier: 'free',
        costClass: 'lite',
        reasoning: reasoning(false, ['none', 'low', 'medium', 'high']),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            vision: true,
            translation: true,
            creative: true,
            longContext: true,
        }),
        contextWindow: 1050000,
        maxOutputTokens: 8192,
        pricing: makePricing(0.1, 0.5, 0.01),
        requiredPlan: null,
        contextMessages: 40,
        isPro: false,
        fallbackModelId: 'claude-haiku-5.5',
        defaultSystemPrompt: ECONOMY_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'claude-haiku-5.5',
        name: 'Claude Haiku 5.5',
        provider: 'openrouter',
        providerModelId: 'anthropic/claude-haiku-5.5',
        enabled: true,
        tier: 'standard',
        costClass: 'lite',
        reasoning: reasoning(false, ['low', 'medium', 'high']),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            vision: true,
            translation: true,
            creative: true,
            longContext: true,
        }),
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        pricing: makePricing(0.1, 0.5, 0.01),
        requiredPlan: 'plus',
        contextMessages: 40,
        isPro: true,
        fallbackModelId: 'deepseek-v4.1-flash',
        defaultSystemPrompt: ECONOMY_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        provider: 'openrouter',
        providerModelId: 'deepseek/deepseek-v4.1-flash',
        enabled: true,
        tier: 'standard',
        costClass: 'lite',
        reasoning: reasoning(false, ['low', 'high']),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            math: true,
            research: true,
            longContext: true,
            vision: true,
        }),
        contextWindow: 1048576,
        maxOutputTokens: 16384,
        pricing: makePricing(0.3, 1.2, 0.006),
        requiredPlan: 'plus',
        contextMessages: 40,
        isPro: true,
        fallbackModelId: FLOOR_MODEL_ID,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    // ── Класс work: рабочая лошадка для Plus и выше ──
    {
        id: WORKHORSE_MODEL_ID,
        name: 'Ketner Pro',
        provider: 'openrouter',
        providerModelId: 'xiaomi/mimo-v2.6-pro',
        enabled: true,
        tier: 'premium',
        costClass: 'work',
        // MiMo умеет только включать и выключать размышления (reasoning.enabled), без уровней effort.
        reasoning: reasoning(false, [], true),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            vision: true,
            math: true,
            translation: true,
            creative: true,
            research: true,
            longContext: true,
        }),
        contextWindow: 1050000,
        maxOutputTokens: 16384,
        pricing: makePricing(0.435, 0.87, 0.004),
        requiredPlan: 'plus',
        contextMessages: 60,
        isPro: true,
        fallbackModelId: 'claude-haiku-5.5',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    // ── Суточные лимиты Plus: модели с лимитом и запасные модели, которые отвечают после него ──
    {
        id: 'gpt-5.6-luna-pro',
        name: 'GPT-5.6 Luna Pro',
        provider: 'openrouter',
        providerModelId: 'openai/gpt-5.6-luna-pro',
        enabled: true,
        tier: 'premium',
        costClass: 'work',
        reasoning: reasoning(false, ['low', 'medium', 'high']),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            vision: true,
            math: true,
            translation: true,
            creative: true,
            research: true,
            longContext: true,
        }),
        contextWindow: 1050000,
        maxOutputTokens: 16384,
        pricing: makePricing(0.2, 1.2, 0.02),
        requiredPlan: 'plus',
        contextMessages: 60,
        isPro: true,
        fallbackModelId: FLOOR_MODEL_ID,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        provider: 'openrouter',
        providerModelId: 'google/gemini-3.7-flash',
        enabled: true,
        tier: 'premium',
        costClass: 'work',
        reasoning: reasoning(true, ['low', 'medium', 'high']),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            vision: true,
            math: true,
            translation: true,
            creative: true,
            research: true,
            longContext: true,
        }),
        contextWindow: 1048576,
        maxOutputTokens: 16384,
        pricing: makePricing(0.75, 3.75, 0.075),
        requiredPlan: 'plus',
        contextMessages: 60,
        isPro: true,
        fallbackModelId: 'claude-haiku-5.5',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'qwen3.8-27b',
        name: 'Qwen3.8 27B',
        provider: 'openrouter',
        providerModelId: 'qwen/qwen3.8-27b',
        enabled: true,
        tier: 'premium',
        costClass: 'work',
        reasoning: reasoning(false, ['low', 'medium']),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            vision: true,
            translation: true,
            creative: true,
            longContext: true,
        }),
        contextWindow: 1000000,
        maxOutputTokens: 16384,
        pricing: makePricing(0.04, 2.3, 0.0198),
        requiredPlan: 'plus',
        contextMessages: 60,
        isPro: true,
        fallbackModelId: 'qwen3.8-flash',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'qwen3.8-flash',
        name: 'Qwen3.8 Flash',
        provider: 'openrouter',
        providerModelId: 'qwen/qwen3.8-flash',
        enabled: true,
        tier: 'standard',
        costClass: 'lite',
        reasoning: reasoning(false, [], true),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            vision: true,
            translation: true,
            creative: true,
            longContext: true,
        }),
        contextWindow: 1000000,
        maxOutputTokens: 16384,
        pricing: makePricing(0.15, 0.47, 0.016),
        requiredPlan: 'plus',
        contextMessages: 40,
        isPro: true,
        fallbackModelId: FLOOR_MODEL_ID,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'gpt-6-luna-pro',
        name: 'GPT-6 Luna Pro',
        provider: 'openrouter',
        providerModelId: 'openai/gpt-6-luna-pro',
        enabled: true,
        tier: 'standard',
        costClass: 'lite',
        reasoning: reasoning(false, ['low', 'medium', 'high']),
        capabilities: makeCapabilities({
            coding: true,
            reasoning: true,
            vision: true,
            math: true,
            translation: true,
            creative: true,
            research: true,
            longContext: true,
        }),
        contextWindow: 1050000,
        maxOutputTokens: 16384,
        pricing: makePricing(0.1, 0.5, 0.01),
        requiredPlan: 'plus',
        contextMessages: 40,
        isPro: true,
        fallbackModelId: FLOOR_MODEL_ID,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    // ── Классы strong и top: премиум, расходуют квоту премиум-запросов тарифа ──
    {
        id: 'gpt-6.1-sol',
        name: 'GPT-6.1 Sol',
        provider: 'openrouter',
        providerModelId: 'openai/gpt-6.1-sol',
        enabled: true,
        tier: 'flagship',
        costClass: 'strong',
        reasoning: reasoning(true, ['low', 'medium', 'high']),
        capabilities: makeCapabilities({
            reasoning: true,
            coding: true,
            vision: true,
            creative: true,
            math: true,
            translation: true,
            research: true,
            longContext: true,
        }),
        contextWindow: 1050000,
        maxOutputTokens: 16384,
        pricing: makePricing(2, 10, 0.1),
        requiredPlan: 'plus',
        contextMessages: 120,
        isPro: true,
        fallbackModelId: 'gpt-6-luna-pro',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'claude-opus-5.5',
        name: 'Claude Opus 5.5',
        provider: 'openrouter',
        providerModelId: 'anthropic/claude-opus-5.5',
        enabled: true,
        tier: 'flagship',
        costClass: 'top',
        reasoning: reasoning(true, ['low', 'medium', 'high']),
        capabilities: makeCapabilities({
            reasoning: true,
            coding: true,
            vision: true,
            creative: true,
            math: true,
            translation: true,
            research: true,
            longContext: true,
        }),
        contextWindow: 1000000,
        maxOutputTokens: 16384,
        pricing: makePricing(4, 20, 0.2),
        requiredPlan: 'pro',
        contextMessages: 120,
        isPro: true,
        fallbackModelId: 'gpt-6.1-sol',
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'grok-4.7',
        name: 'Grok 4.7',
        provider: 'openrouter',
        providerModelId: 'x-ai/grok-4.7',
        enabled: true,
        tier: 'flagship',
        costClass: 'strong',
        reasoning: reasoning(true, ['low', 'medium', 'high']),
        capabilities: makeCapabilities({
            reasoning: true,
            coding: true,
            vision: true,
            math: true,
            creative: true,
            research: true,
        }),
        contextWindow: 500000,
        maxOutputTokens: 16384,
        pricing: makePricing(2, 6, 0.5),
        requiredPlan: 'pro',
        contextMessages: 120,
        isPro: true,
        fallbackModelId: WORKHORSE_MODEL_ID,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
    {
        id: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        provider: 'openrouter',
        providerModelId: 'google/gemini-3.8-flash',
        enabled: true,
        tier: 'flagship',
        // Размышления нельзя отключить, а по данным AA модель многословна: реальная цена запроса
        // близка к GPT-6.1 Sol, поэтому она расходует квоту премиум-запросов.
        costClass: 'strong',
        reasoning: reasoning(true, ['low', 'medium', 'high']),
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
        maxOutputTokens: 16384,
        pricing: makePricing(0.75, 3.75, 0.075),
        requiredPlan: 'pro',
        contextMessages: 120,
        isPro: true,
        fallbackModelId: WORKHORSE_MODEL_ID,
        defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
        createdAt: now(),
        updatedAt: now(),
    },
];
/**
 * Старые идентификаторы моделей → актуальные. Нужны, чтобы сохранённый в браузере выбор модели,
 * старые диалоги и клиенты API не превращались молча в Auto. GPT-6 Astra и Claude Fable 5.1
 * убраны из каталога: по независимым оценкам они не лучше Sol и Opus, но в 3–5 раз дороже.
 */
export const LEGACY_MODEL_ALIASES = {
    'gpt-6-astra': 'gpt-6.1-sol',
    'gpt-4o': 'gpt-6.1-sol',
    'claude-fable': 'claude-opus-5.5',
    'claude-3.5-sonnet': 'claude-opus-5.5',
    'claude-3-haiku': 'claude-haiku-5.5',
    'gemini-2.5-pro': 'gemini-3.8-flash',
    'gemini-pro': 'gemini-3.8-flash',
    'gpt-4o-mini': 'ketner-mini',
    'gemini-2.5-flash': 'ketner-mini',
    'glm-5.3-flash': 'ketner-mini',
    'nemotron': 'nemotron-ultra',
    'nvidia/nemotron-3-ultra-550b-a55b:free': 'nemotron-ultra',
};
/** Суточные лимиты модели по тарифам для /api/meta (пустой объект, если лимитов нет). */
export function dailyLimitsOf(modelId) {
    const limits = {};
    for (const [plan, byModel] of Object.entries(DAILY_MODEL_LIMITS)) {
        if (modelId in byModel)
            limits[plan] = byModel[modelId];
    }
    return Object.keys(limits).length > 0 ? { dailyLimits: limits } : {};
}
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
    /** Получить модель по ID (старые идентификаторы перенаправляются на актуальные). */
    get(modelId) {
        return this.entries.get(modelId) ?? this.entries.get(LEGACY_MODEL_ALIASES[modelId] ?? '');
    }
    /** Получить модель или модель по умолчанию. */
    resolve(modelId) {
        if (modelId) {
            const entry = this.get(modelId);
            if (entry && entry.enabled)
                return entry;
        }
        return this.getDefault();
    }
    /** Модель по умолчанию — ketner-mini (или первая бесплатная). */
    getDefault() {
        const mini = this.entries.get(FLOOR_MODEL_ID);
        if (mini && mini.enabled)
            return mini;
        for (const entry of this.entries.values()) {
            if (entry.enabled && !entry.isPro && entry.id !== 'auto')
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
    /** Проверка доступа: по `requiredPlan` модели и рангу тарифа (единое правило в entitlement). */
    canAccess(userPlan, entry) {
        return planAllowsModel(userPlan, entry.requiredPlan);
    }
    /**
     * Идентификаторы премиум-моделей (классы strong и top), включая старые id из истории расхода:
     * по ним считается, сколько квоты премиум-запросов пользователь уже потратил за 30 дней.
     */
    getPremiumModelIds() {
        const ids = new Set();
        for (const entry of this.entries.values()) {
            if (entry.costClass === 'strong' || entry.costClass === 'top')
                ids.add(entry.id);
        }
        for (const [legacyId, targetId] of Object.entries(LEGACY_MODEL_ALIASES)) {
            if (ids.has(targetId))
                ids.add(legacyId);
        }
        return ids;
    }
    /** Идентификатор модели и её старые id: в истории расхода записи могут лежать под любым из них. */
    getIdsWithAliases(modelId) {
        const canonical = this.get(modelId)?.id ?? modelId;
        const ids = [canonical];
        for (const [legacyId, targetId] of Object.entries(LEGACY_MODEL_ALIASES)) {
            if (targetId === canonical)
                ids.push(legacyId);
        }
        return ids;
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
    /**
     * Цепочка fallback-моделей. Каждая модель встречается один раз: раньше замкнутые ссылки
     * (ketner-mini ↔ gpt-4o-mini) заставляли пробовать одну и ту же модель до пяти раз подряд.
     */
    getFallbackChain(modelId, maxDepth = 5) {
        const chain = [];
        const seen = new Set();
        let current = this.get(modelId);
        while (current && chain.length < maxDepth && !seen.has(current.id)) {
            seen.add(current.id);
            chain.push(current);
            if (!current.fallbackModelId)
                break;
            current = this.entries.get(current.fallbackModelId);
        }
        return chain;
    }
    // ────────── Обратная совместимость ──────────
    /** Конвертация в legacy ModelInfo формат (для /api/meta). */
    toLegacyModelInfo() {
        return this.getAll()
            .filter((e) => e.id !== 'auto')
            .map((e) => ({
            id: e.id,
            name: e.isPro ? `${e.name} *` : e.name,
            contextMessages: e.contextMessages,
            isPro: e.isPro,
            requiredPlan: e.requiredPlan ?? undefined,
            ...dailyLimitsOf(e.id),
        }));
    }
    /** Конвертация в legacy PlanLimits (для /api/meta). Единый источник правды — PLAN_ENTITLEMENTS. */
    toLegacyPlanLimits() {
        return getPlanLimits();
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
