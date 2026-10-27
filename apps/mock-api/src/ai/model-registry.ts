/**
 * Реестр AI моделей — единый источник правды для всех моделей в системе.
 *
 * Модели конфигурируемы: имена, провайдеры, цены — всё меняется без
 * перекомпиляции. По умолчанию загружается набор из DEFAULT_MODELS,
 * который можно расширять через admin API или конфиг-файл.
 */

import type { PlanId, Language, ModelInfo, PlanLimits } from '../types.js';
import type {
  DirectProviderType,
  DirectRoute,
  EffortProfile,
  ModelRegistryEntry,
  AIProviderType,
  ModelCapabilities,
  ModelPricing,
  ModelReasoning,
} from './gateway-types.js';
import { getPlanLimits, planAllowsModel } from '../services/entitlement.js';

// ─────────────────────────────────────────────────────────────
// Вспомогательные фабрики
// ─────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

/**
 * Общий слой промптов Ketner AI: как работать с проектами в интерфейсе и честность о модели.
 * Модель не скрывает своего разработчика: какая именно модель отвечает, добавляет шлюз
 * (ai/model-disclosure.ts → modelIdentityPrompt).
 */
export const COMMON_BRAND_SYSTEM_LAYER: Record<Language, string> = {
  ru: 'Ты — ИИ-ассистент в сервисе Ketner AI. Используй чистое форматирование Markdown. В Ketner AI пользователь может привязать локальную папку или GitHub-репозиторий через кнопку «Привязать папку / репозиторий» над строкой ввода. Если проект привязан, ты имеешь полный доступ к его файлам и коду. Если спрашивают, как привязать проект — объясни, как это сделать через интерфейс Ketner AI. Никогда не говори, что ты не можешь работать с локальной папкой или репозиторием. Ketner AI не обучает собственные модели: ответы дают модели сторонних разработчиков, подключённые к сервису.',
  en: 'You are an AI assistant in the Ketner AI service. Use clean Markdown formatting. In Ketner AI, users can link local folders or GitHub repositories via the "Link folder / repo" button above the composer. If a project is linked, you have full access to its files and code. If asked how to link a project, explain the Ketner AI UI feature. Never claim you cannot work with local folders or repos. Ketner AI does not train its own models: answers come from third-party models connected to the service.',
};

/**
 * Phase 3: Различия тарифов в одну строку.
 */
export const TIER_SYSTEM_MODIFIERS: Record<'economy' | 'default', Record<Language, string>> = {
  economy: {
    ru: 'Отвечай максимально кратко, ёмко и по существу, без лишних вступлений и заключений.',
    en: 'Keep responses concise, direct, and to the point without unnecessary filler or commentary.',
  },
  default: {
    ru: 'Ты — умный, дружелюбный и профессиональный ассистент. Давай глубокие, подробные, хорошо структурированные ответы с пошаговыми рассуждениями.',
    en: 'You are an intelligent, friendly, and professional assistant. Provide deep, detailed, well-structured answers with step-by-step reasoning.',
  },
};

export const ECONOMY_SYSTEM_PROMPT: Record<Language, string> = {
  ru: `${COMMON_BRAND_SYSTEM_LAYER.ru} ${TIER_SYSTEM_MODIFIERS.economy.ru}`,
  en: `${COMMON_BRAND_SYSTEM_LAYER.en} ${TIER_SYSTEM_MODIFIERS.economy.en}`,
};

export const DEFAULT_SYSTEM_PROMPT: Record<Language, string> = {
  ru: `${COMMON_BRAND_SYSTEM_LAYER.ru} ${TIER_SYSTEM_MODIFIERS.default.ru}`,
  en: `${COMMON_BRAND_SYSTEM_LAYER.en} ${TIER_SYSTEM_MODIFIERS.default.en}`,
};

function makeCapabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
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

/**
 * Прямой путь к модели через API вендора (если задан его ключ) и цены этого API, $ за 1M токенов:
 * вход / выход / чтение из кэша. Прямые цены равны прайсу вендора (OpenRouter перепродаёт по нему же),
 * экономия прямого пути — комиссия пополнения OpenRouter 5.5%. У Anthropic запись в кэш стоит
 * вход × 1.25 (ai/engine-pricing.ts → directRequestCost).
 */
function direct(
  provider: DirectProviderType,
  modelId: string,
  input: number,
  output: number,
  cached: number,
): DirectRoute {
  return { provider, modelId, pricing: makePricing(input, output, cached) };
}

function makePricing(input: number, output: number, cached: number = input * 0.5): ModelPricing {
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
/** Рабочая лошадка: недорогая сильная модель, на которую Auto отдаёт задачи средней сложности. */
export const WORKHORSE_MODEL_ID = 'ketner-pro';
/**
 * Открытая флагманская модель (GLM-5.3, открытые веса): Auto на Pro и Ultra отдаёт ей задачи средней
 * сложности по коду, математике и логике, сохраняя премиум-модель для сложных.
 */
export const OPEN_FLAGSHIP_MODEL_ID = 'glm-5.3';

/** Модели Pro и Ultra: medium, на Ultra в режиме Max — xhigh. */
const STANDARD_PROFILE: EffortProfile = { standard: 'medium', max: 'xhigh' };
/** Модели, которые всегда работают на xhigh (так и подписаны: «Grok 4.7 xhigh», «GPT-5.6 Terra xhigh»). */
const XHIGH_PROFILE: EffortProfile = { standard: 'xhigh', max: 'xhigh' };

const reasoning = (
  mandatory: boolean,
  efforts: ModelReasoning['efforts'],
  toggle = false,
): ModelReasoning => ({
  mandatory,
  efforts,
  ...(toggle ? { toggle: true } : {}),
});

/**
 * Набор моделей по умолчанию. Основной канал — единый ключ OpenRouter, `providerModelId` — это
 * идентификатор модели в OpenRouter, ровно тот, что уходит в запрос (скрытых подмен нет). У моделей
 * Anthropic, OpenAI и Google есть `direct` — та же модель через прямой API вендора и его цены: путь
 * включается ключом вендора, при сбое запрос идёт через OpenRouter (ai/providers/routed-provider.ts).
 *
 * Цены — реальные цены OpenRouter на 12.10.2026, $ за 1M токенов (вход / выход / чтение из кэша).
 * Оценка качества — Artificial Analysis Intelligence Index из каталога OpenRouter, цена — типичный
 * запрос (7.6k токенов на входе; выход 2k при medium, 7k при xhigh):
 *
 *   ketner-mini        GPT-6 Luna          AA 38    $0.001   повседневные вопросы
 *   ketner-pro         MiMo-V2.6 Pro       AA 46    $0.005   рабочая лошадка, запасная для Pro-моделей
 *   glm-5.3            GLM-5.3             AA 45    $0.019   открытая флагманская: Auto на Pro/Ultra для
 *                                                               задач средней сложности вместо Sol
 *   gpt-6.1-sol        GPT-6.1 Sol         AA 52    $0.035   сильная модель OpenAI (Plus)
 *   claude-sonnet-5.5  Claude Sonnet 5.5   AA 56    $0.035 / $0.085 (medium / xhigh)
 *   claude-opus-5.5    Claude Opus 5.5     AA 58    $0.070 / $0.170
 *   gpt-6-astra        GPT-6 Astra         AA 53    $0.176 / $0.426
 *   grok-4.7           Grok 4.7 xhigh      AA 46    $0.057
 *   gpt-5.6-terra      GPT-5.6 Terra xhigh AA 42    $0.099   модель для кода (AA Coding 77)
 *
 * Цены в кредитах считает services/credits.ts, цепочки запасных моделей — fallbackModelId ниже.
 * Добавлены 27.10.2026: MiniMax M3.1 Flash, включена Gemini 4 Argon, GLM-5.3 Flash, Qwen3.8 Flash и Max, Kimi K3.1 Pro, GPT-6.1 Terra.
 * Не вошли: Claude Fable 5.1 (в 2.5 раза дороже Opus 5.5 при более низком AA), Kimi K3 (вытеснена K3.1),
 * Muse Spark, Nemotron 3 Ultra (хуже и дороже модели ketner-pro), DeepSeek V4 Pro (AA ≈ 36 на текущей
 * версии индекса — ниже Ketner Mini). Из открытых флагманов сильнее только MiMo-V2.6 Pro (это и есть
 * ketner-pro); GLM-5.3 почти вровень с ней (45 против 46) и сильна в коде, но в 4 раза дороже, поэтому
 * Auto берёт её только там, где иначе потратил бы много кредитов на премиум-модель.
 */
const DEFAULT_REGISTRY_ENTRIES: ModelRegistryEntry[] = [
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
    // Лимиты `:free` общие на аккаунт OpenRouter: при отказе отвечает платный Ketner Mini
    // (гостям запасная не берётся, см. gateway: для анонимов цепочка из одной модели).
    fallbackModelId: 'ketner-mini',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // Бесплатная модель агента Ketner Code на Free (cohere/north-mini-code:free, 30B/3B активных,
  // вызов инструментов). Размышления выключаются: так быстрее и не тратится лимит ответа.
  {
    id: 'north-mini-code',
    name: 'North Mini Code (Free)',
    provider: 'openrouter',
    providerModelId: 'cohere/north-mini-code:free',
    enabled: true,
    tier: 'free',
    costClass: 'lite',
    reasoning: reasoning(false, [], true),
    capabilities: makeCapabilities({ coding: true, reasoning: true }),
    contextWindow: 128000,
    maxOutputTokens: 8192,
    pricing: makePricing(0, 0, 0),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: 'ketner-mini',
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
    direct: direct('openai', 'gpt-6-luna', 0.1, 0.5, 0.01),
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
    direct: direct('anthropic', 'claude-haiku-5-5', 0.1, 0.5, 0.01),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
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
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: FLOOR_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // MiniMax M3.1 Flash: быстрая мультимодальная модель, одна из самых используемых в OpenRouter.
  {
    id: 'minimax-m3.1-flash',
    name: 'MiniMax M3.1 Flash',
    provider: 'openrouter',
    providerModelId: 'minimax/minimax-m3.1-flash',
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
    contextWindow: 1048576,
    maxOutputTokens: 16384,
    pricing: makePricing(0.15, 0.6, 0.015),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
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
    requiredPlan: null,
    contextMessages: 60,
    isPro: false,
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
    direct: direct('openai', 'gpt-5.6-luna-pro', 0.2, 1.2, 0.02),
    requiredPlan: null,
    contextMessages: 60,
    isPro: false,
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
    direct: direct('google', 'gemini-3.7-flash', 0.75, 3.75, 0.075),
    requiredPlan: null,
    contextMessages: 60,
    isPro: false,
    fallbackModelId: 'claude-haiku-5.5',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // ── Открытая флагманская модель: Auto отдаёт ей задачи средней сложности по коду, математике и
  // логике вместо премиум-модели (ai/auto-router.ts). Класс work — недорогой в кредитах.
  {
    id: OPEN_FLAGSHIP_MODEL_ID,
    name: 'GLM-5.3',
    provider: 'openrouter',
    providerModelId: 'z-ai/glm-5.3',
    enabled: true,
    tier: 'premium',
    costClass: 'work',
    // GLM умеет только включать и выключать размышления, без уровней effort.
    reasoning: reasoning(false, [], true),
    capabilities: makeCapabilities({
      coding: true,
      reasoning: true,
      math: true,
      translation: true,
      creative: true,
      research: true,
      longContext: true,
    }),
    contextWindow: 200000,
    maxOutputTokens: 16384,
    pricing: makePricing(1.4, 4.4, 0.26),
    requiredPlan: null,
    contextMessages: 60,
    isPro: false,
    fallbackModelId: WORKHORSE_MODEL_ID,
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
    requiredPlan: null,
    contextMessages: 60,
    isPro: false,
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
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: FLOOR_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // GLM-5.3 Flash: мультимодальная модель Z.ai для кода и агентов. Размышления включаются и выключаются,
  // без уровней effort.
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    provider: 'openrouter',
    providerModelId: 'z-ai/glm-5.3-flash',
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
    pricing: makePricing(0.15, 0.5, 0.03),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: FLOOR_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // Qwen3.8 Max (снимок 0902): 2.4T параметров, мультимодальная; цена как у открытой 2.4T A95B.
  {
    id: 'qwen3.8-max',
    name: 'Qwen3.8 Max',
    provider: 'openrouter',
    providerModelId: 'qwen/qwen3.8-max-0902',
    enabled: true,
    tier: 'premium',
    costClass: 'work',
    reasoning: reasoning(false, [], true),
    capabilities: makeCapabilities({
      coding: true,
      reasoning: true,
      vision: true,
      translation: true,
      creative: true,
      longContext: true,
      math: true,
    }),
    contextWindow: 1000000,
    maxOutputTokens: 16384,
    pricing: makePricing(2, 6, 0.25),
    requiredPlan: null,
    contextMessages: 60,
    isPro: false,
    fallbackModelId: WORKHORSE_MODEL_ID,
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
    direct: direct('openai', 'gpt-6-luna-pro', 0.1, 0.5, 0.01),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: FLOOR_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // ── Классы strong и top: премиум, за запрос списывают больше кредитов ──
  // Kimi K3.1 Pro (Moonshot AI): открытая мультимодальная модель с контекстом 1M для долгого кода.
  {
    id: 'kimi-k3.1',
    name: 'Kimi K3.1 Pro',
    provider: 'openrouter',
    providerModelId: 'moonshotai/kimi-k3.1-pro',
    enabled: true,
    tier: 'flagship',
    costClass: 'strong',
    reasoning: reasoning(false, [], true),
    capabilities: makeCapabilities({
      coding: true,
      reasoning: true,
      vision: true,
      translation: true,
      creative: true,
      longContext: true,
      math: true,
      research: true,
    }),
    contextWindow: 1048576,
    maxOutputTokens: 32768,
    pricing: makePricing(2, 10, 0.2),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: WORKHORSE_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // GPT-6.1 Terra: средняя модель серии GPT-6.1, вдвое дешевле GPT-5.6 Terra. Размышления обязательны.
  {
    id: 'gpt-6.1-terra',
    name: 'GPT-6.1 Terra',
    provider: 'openrouter',
    providerModelId: 'openai/gpt-6.1-terra',
    enabled: true,
    tier: 'flagship',
    costClass: 'work',
    reasoning: reasoning(true, ['low', 'medium', 'high', 'xhigh']),
    effortProfile: STANDARD_PROFILE,
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
    maxOutputTokens: 32768,
    pricing: makePricing(1, 5, 0.05),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: WORKHORSE_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
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
    direct: direct('openai', 'gpt-6.1-sol', 2, 10, 0.1),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: 'gpt-6-luna-pro',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // ── Модели Pro и Ultra: фиксированная глубина размышлений (medium, на Ultra в режиме Max — xhigh) ──
  // Запасные идут от дорогой к дешёвой с сохранением качества: Opus → Sonnet → Ketner Pro → Haiku.
  {
    id: 'claude-opus-5.5',
    name: 'Claude Opus 5.5',
    provider: 'openrouter',
    providerModelId: 'anthropic/claude-opus-5.5',
    enabled: true,
    tier: 'flagship',
    costClass: 'top',
    reasoning: reasoning(true, ['low', 'medium', 'high', 'xhigh', 'max']),
    effortProfile: STANDARD_PROFILE,
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
    maxOutputTokens: 32768,
    pricing: makePricing(4, 20, 0.2),
    direct: direct('anthropic', 'claude-opus-5-5', 4, 20, 0.2),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: 'claude-sonnet-5.5',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // AA 56 при цене вдвое ниже Opus: лучший выбор по цене и качеству среди сильных моделей.
  {
    id: 'claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    provider: 'openrouter',
    providerModelId: 'anthropic/claude-sonnet-5.5',
    enabled: true,
    tier: 'flagship',
    costClass: 'strong',
    reasoning: reasoning(true, ['low', 'medium', 'high', 'xhigh', 'max']),
    effortProfile: STANDARD_PROFILE,
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
    maxOutputTokens: 32768,
    pricing: makePricing(2, 10, 0.1),
    direct: direct('anthropic', 'claude-sonnet-5-5', 2, 10, 0.2),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: WORKHORSE_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },

  // Флагман OpenAI; после лимита — GPT-6.1 Sol (в 5 раз дешевле, AA почти тот же), затем GPT-6 Luna Pro.
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    provider: 'openrouter',
    providerModelId: 'openai/gpt-6-astra',
    enabled: true,
    tier: 'flagship',
    costClass: 'top',
    reasoning: reasoning(true, ['low', 'medium', 'high', 'xhigh', 'max']),
    effortProfile: STANDARD_PROFILE,
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
    maxOutputTokens: 32768,
    pricing: makePricing(10, 50, 1),
    direct: direct('openai', 'gpt-6-astra', 10, 50, 1),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: 'gpt-6.1-sol',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // Grok работает всегда на xhigh (так и подписан). После лимита — Ketner Pro: AA почти как у Grok, в 11 раз дешевле.
  {
    id: 'grok-4.7',
    name: 'Grok 4.7 xhigh',
    provider: 'openrouter',
    providerModelId: 'x-ai/grok-4.7',
    enabled: true,
    tier: 'flagship',
    costClass: 'strong',
    reasoning: reasoning(true, ['low', 'medium', 'high', 'xhigh']),
    effortProfile: XHIGH_PROFILE,
    capabilities: makeCapabilities({
      reasoning: true,
      coding: true,
      vision: true,
      math: true,
      creative: true,
      research: true,
    }),
    contextWindow: 500000,
    maxOutputTokens: 32768,
    pricing: makePricing(2, 6, 0.5),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: WORKHORSE_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // Анонсирована 30.09.2026, в OpenRouter с 13.10.2026 (`google/gemini-4-argon`, $2 / $10). Вводная цена
  // может смениться на $4 / $20: сверять с каталогом.
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    provider: 'openrouter',
    providerModelId: 'google/gemini-4-argon',
    enabled: true,
    tier: 'flagship',
    costClass: 'strong',
    reasoning: reasoning(true, ['low', 'medium', 'high', 'xhigh', 'max']),
    effortProfile: STANDARD_PROFILE,
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
    contextWindow: 1048576,
    maxOutputTokens: 32768,
    pricing: makePricing(2, 10, 0.1),
    direct: direct('google', 'gemini-4-argon', 2, 10, 0.1),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: 'gemini-3.8-flash',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    provider: 'openrouter',
    providerModelId: 'openai/gpt-5.6-sol',
    enabled: true,
    tier: 'flagship',
    costClass: 'strong',
    reasoning: reasoning(false, ['none', 'low', 'medium', 'high', 'xhigh', 'max']),
    effortProfile: STANDARD_PROFILE,
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
    maxOutputTokens: 32768,
    pricing: makePricing(2, 10, 0.2),
    direct: direct('openai', 'gpt-5.6-sol', 2, 10, 0.2),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: WORKHORSE_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // Terra — модель OpenAI для кода, всегда на xhigh. После лимита — Gemini 3.8 Flash (почти тот же
  // Coding Index по AA, в 7 раз дешевле), затем Ketner Pro.
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra xhigh',
    provider: 'openrouter',
    providerModelId: 'openai/gpt-5.6-terra',
    enabled: true,
    tier: 'flagship',
    costClass: 'strong',
    reasoning: reasoning(false, ['none', 'low', 'medium', 'high', 'xhigh', 'max']),
    effortProfile: XHIGH_PROFILE,
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
    maxOutputTokens: 32768,
    pricing: makePricing(2, 12, 0.2),
    direct: direct('openai', 'gpt-5.6-terra', 2, 12, 0.2),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: 'gemini-3.8-flash',
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
    tier: 'premium',
    // Запасная модель для Terra и Gemini 4 Argon (в списке выбора не показывается). Цена запроса
    // ≈ $0.013, как у Gemini 3.7 Flash в Plus, поэтому класс work, а не премиум.
    costClass: 'work',
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
    direct: direct('google', 'gemini-3.8-flash', 0.75, 3.75, 0.075),
    requiredPlan: null,
    contextMessages: 120,
    isPro: false,
    fallbackModelId: WORKHORSE_MODEL_ID,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
];

/**
 * Старые идентификаторы моделей → актуальные. Нужны, чтобы сохранённый в браузере выбор модели,
 * старые диалоги и клиенты API не превращались молча в Auto.
 */
export const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'gpt-4o': 'gpt-6.1-sol',
  // Claude Fable 5.1 убрана из каталога (дороже Opus при более низкой оценке): старый выбор ведёт на Opus.
  'claude-fable': 'claude-opus-5.5',
  'claude-fable-5.1': 'claude-opus-5.5',
  'claude-sonnet': 'claude-sonnet-5.5',
  'claude-3.5-sonnet': 'claude-sonnet-5.5',
  'claude-3-haiku': 'claude-haiku-5.5',
  'gemini-2.5-pro': 'gemini-3.8-flash',
  'gemini-pro': 'gemini-3.8-flash',
  'gpt-4o-mini': 'ketner-mini',
  'gemini-2.5-flash': 'ketner-mini',
  nemotron: 'nemotron-ultra',
  'cohere/north-mini-code:free': 'north-mini-code',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'nemotron-ultra',
};

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
  private entries: Map<string, ModelRegistryEntry>;

  constructor(initialEntries?: ModelRegistryEntry[]) {
    this.entries = new Map();
    for (const entry of initialEntries ?? DEFAULT_REGISTRY_ENTRIES) {
      this.entries.set(entry.id, entry);
    }
  }

  /** Получить модель по ID (старые идентификаторы перенаправляются на актуальные). */
  get(modelId: string): ModelRegistryEntry | undefined {
    return this.entries.get(modelId) ?? this.entries.get(LEGACY_MODEL_ALIASES[modelId] ?? '');
  }

  /** Получить модель или модель по умолчанию. */
  resolve(modelId: string | undefined): ModelRegistryEntry {
    if (modelId) {
      const entry = this.get(modelId);
      if (entry && entry.enabled) return entry;
    }
    return this.getDefault();
  }

  /** Модель по умолчанию — ketner-mini (или первая бесплатная). */
  getDefault(): ModelRegistryEntry {
    const mini = this.entries.get(FLOOR_MODEL_ID);
    if (mini && mini.enabled) return mini;
    for (const entry of this.entries.values()) {
      if (entry.enabled && !entry.isPro && entry.id !== 'auto') return entry;
    }
    return this.entries.values().next().value!;
  }

  /** Все активные модели. */
  getAll(): ModelRegistryEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.enabled);
  }

  /** Все модели (включая неактивные — для админа). */
  getAllIncludingDisabled(): ModelRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Модели доступные пользователю с данным планом. */
  getForPlan(userPlan: PlanId): ModelRegistryEntry[] {
    return this.getAll().filter((entry) => this.canAccess(userPlan, entry));
  }

  /** Модели по провайдеру. */
  getByProvider(provider: AIProviderType): ModelRegistryEntry[] {
    return this.getAll().filter((e) => e.provider === provider);
  }

  /** Проверка доступа: по `requiredPlan` модели и рангу тарифа (единое правило в entitlement). */
  canAccess(userPlan: PlanId | undefined, entry: ModelRegistryEntry): boolean {
    return planAllowsModel(userPlan, entry.requiredPlan);
  }

  /**
   * Идентификаторы премиум-моделей (классы strong и top), включая старые id из истории расхода:
   * по ним считается доля расхода на премиум-модели в статистике.
   */
  getPremiumModelIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of this.entries.values()) {
      if (entry.costClass === 'strong' || entry.costClass === 'top') ids.add(entry.id);
    }
    for (const [legacyId, targetId] of Object.entries(LEGACY_MODEL_ALIASES)) {
      if (ids.has(targetId)) ids.add(legacyId);
    }
    return ids;
  }

  /** Идентификатор модели и её старые id: в истории расхода записи могут лежать под любым из них. */
  getIdsWithAliases(modelId: string): string[] {
    const canonical = this.get(modelId)?.id ?? modelId;
    const ids = [canonical];
    for (const [legacyId, targetId] of Object.entries(LEGACY_MODEL_ALIASES)) {
      if (targetId === canonical) ids.push(legacyId);
    }
    return ids;
  }

  /** Добавить или обновить модель. */
  upsert(entry: ModelRegistryEntry): void {
    entry.updatedAt = now();
    this.entries.set(entry.id, entry);
  }

  /** Удалить модель. */
  remove(modelId: string): boolean {
    return this.entries.delete(modelId);
  }

  /** Включить/выключить модель. */
  setEnabled(modelId: string, enabled: boolean): boolean {
    const entry = this.entries.get(modelId);
    if (!entry) return false;
    entry.enabled = enabled;
    entry.updatedAt = now();
    return true;
  }

  /** Обновить ценообразование модели. */
  updatePricing(modelId: string, pricing: ModelPricing): boolean {
    const entry = this.entries.get(modelId);
    if (!entry) return false;
    entry.pricing = pricing;
    entry.updatedAt = now();
    return true;
  }

  /**
   * Цепочка fallback-моделей. Каждая модель встречается один раз: раньше замкнутые ссылки
   * (ketner-mini ↔ gpt-4o-mini) заставляли пробовать одну и ту же модель до пяти раз подряд.
   */
  getFallbackChain(modelId: string, maxDepth = 5): ModelRegistryEntry[] {
    const chain: ModelRegistryEntry[] = [];
    const seen = new Set<string>();
    let current: ModelRegistryEntry | undefined = this.get(modelId);
    while (current && chain.length < maxDepth && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current);
      if (!current.fallbackModelId) break;
      current = this.entries.get(current.fallbackModelId);
    }
    return chain;
  }

  // ────────── Обратная совместимость ──────────

  /** Конвертация в legacy ModelInfo формат (для /api/meta). */
  toLegacyModelInfo(): ModelInfo[] {
    return this.getAll()
      .filter((e) => e.id !== 'auto')
      .map((e) => ({
        id: e.id,
        name: e.isPro ? `${e.name} *` : e.name,
        contextMessages: e.contextMessages,
        isPro: e.isPro,
        requiredPlan: e.requiredPlan ?? undefined,
      }));
  }

  /** Конвертация в legacy PlanLimits (для /api/meta). Единый источник правды — PLAN_ENTITLEMENTS. */
  toLegacyPlanLimits(): Record<PlanId, PlanLimits> {
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
