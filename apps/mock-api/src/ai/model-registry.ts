/**
 * Реестр AI моделей — единый источник правды для всех моделей в системе.
 *
 * Модели конфигурируемы: имена, провайдеры, цены — всё меняется без
 * перекомпиляции. По умолчанию загружается набор из DEFAULT_MODELS,
 * который можно расширять через admin API или конфиг-файл.
 */

import type { PlanId, Language, ModelInfo, PlanLimits } from '../types.js';
import type { ModelRegistryEntry, AIProviderType, ModelCapabilities, ModelPricing } from './gateway-types.js';
import { getPlanLimits } from '../services/entitlement.js';

// ─────────────────────────────────────────────────────────────
// Вспомогательные фабрики
// ─────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

export const ECONOMY_SYSTEM_PROMPT: Record<Language, string> = {
  ru: 'Ты — инженерный ИИ-ассистент Ketner AI. Отвечай максимально кратко, ёмко и по существу, без лишних вступлений и заключений. Используй чистое форматирование Markdown. Никогда не упоминай, что ты создан OpenAI, Anthropic или Google. Ты — разработка Ketner AI.',
  en: 'You are an engineering AI assistant by Ketner AI. Keep responses concise, direct, and to the point without unnecessary filler or commentary. Use clean Markdown formatting. Never mention or state that you were created by OpenAI, Anthropic, or Google. You are developed by Ketner AI.',
};

export const DEFAULT_SYSTEM_PROMPT: Record<Language, string> = {
  ru: 'Ты — умный, дружелюбный и профессиональный инженерный ИИ-ассистент Ketner AI. Давай глубокие, подробные, хорошо структурированные ответы с пошаговыми рассуждениями и чистым форматированием Markdown. Никогда не упоминай, что ты создан OpenAI, Anthropic или Google. Ты — разработка Ketner AI.',
  en: 'You are an intelligent, friendly, and professional engineering AI assistant by Ketner AI. Provide deep, detailed, well-structured answers with step-by-step reasoning and clean Markdown formatting. Never mention or state that you were created by OpenAI, Anthropic, or Google. You are developed by Ketner AI.',
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

function makePricing(
  input: number,
  output: number,
  cached: number = input * 0.5,
): ModelPricing {
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
const DEFAULT_REGISTRY_ENTRIES: ModelRegistryEntry[] = [
  {
    id: 'auto',
    name: '✨ Best AI (Auto)',
    provider: 'openrouter',
    providerModelId: 'auto',
    enabled: true,
    tier: 'free',
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
    fallbackModelId: 'gpt-4o-mini',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // ── 1. Дешёвые модели (для Free, повседневных запросов и Fallback) ──
  {
    id: 'ketner-mini',
    name: 'Ketner Mini (Qwen 3.8)',
    provider: 'openrouter',
    providerModelId: 'qwen/qwen3.8-27b:free',
    enabled: true,
    tier: 'free',
    capabilities: makeCapabilities({ coding: true, reasoning: true, translation: true, creative: true }),
    contextWindow: 32768,
    maxOutputTokens: 4096,
    pricing: makePricing(0, 0, 0),
    requiredPlan: null,
    contextMessages: 20,
    isPro: false,
    fallbackModelId: null,
    defaultSystemPrompt: ECONOMY_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'nemotron-ultra',
    name: 'Nemotron 3 Ultra',
    provider: 'openrouter',
    providerModelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    enabled: true,
    tier: 'free',
    capabilities: makeCapabilities({ coding: true, reasoning: true, math: true, creative: true, translation: true }),
    contextWindow: 131072,
    maxOutputTokens: 4096,
    pricing: makePricing(0, 0, 0),
    requiredPlan: null,
    contextMessages: 30,
    isPro: false,
    fallbackModelId: 'ketner-mini',
    defaultSystemPrompt: ECONOMY_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'openai',
    providerModelId: 'gpt-4o-mini',
    enabled: true,
    tier: 'free',
    capabilities: makeCapabilities({
      coding: true,
      reasoning: true,
      translation: true,
      creative: true,
    }),
    contextWindow: 128000,
    maxOutputTokens: 4096,
    pricing: makePricing(0.15, 0.6, 0.075),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: 'ketner-mini',
    defaultSystemPrompt: ECONOMY_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    providerModelId: 'gemini-2.5-flash',
    enabled: true,
    tier: 'free',
    capabilities: makeCapabilities({
      coding: true,
      reasoning: true,
      vision: true,
      translation: true,
      longContext: true,
    }),
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    pricing: makePricing(0.15, 0.6, 0.075),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: 'ketner-mini',
    defaultSystemPrompt: ECONOMY_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'anthropic',
    providerModelId: 'claude-3-haiku-20240307',
    enabled: true,
    tier: 'free',
    capabilities: makeCapabilities({
      reasoning: true,
      coding: true,
      translation: true,
      creative: true,
    }),
    contextWindow: 200000,
    maxOutputTokens: 4096,
    pricing: makePricing(0.25, 1.25, 0.125),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: 'ketner-mini',
    defaultSystemPrompt: ECONOMY_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    provider: 'openrouter',
    providerModelId: 'z-ai/glm-5.3-flash',
    enabled: true,
    tier: 'free',
    capabilities: makeCapabilities({
      reasoning: true,
      coding: true,
      translation: true,
      creative: true,
      longContext: true,
    }),
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    pricing: makePricing(0.15, 0.525, 0.05),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: 'nemotron-ultra',
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
    tier: 'free',
    capabilities: makeCapabilities({
      coding: true,
      reasoning: true,
      math: true,
      research: true,
      longContext: true,
      vision: true,
    }),
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    pricing: makePricing(0.15, 0.6, 0.003),
    requiredPlan: null,
    contextMessages: 40,
    isPro: false,
    fallbackModelId: 'ketner-mini',
    defaultSystemPrompt: ECONOMY_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    providerModelId: 'gpt-4o',
    enabled: true,
    tier: 'standard',
    capabilities: makeCapabilities({
      coding: true,
      reasoning: true,
      vision: true,
      creative: true,
      math: true,
      translation: true,
      research: true,
    }),
    contextWindow: 128000,
    maxOutputTokens: 8192,
    pricing: makePricing(2.5, 10, 1.25),
    requiredPlan: 'plus',
    contextMessages: 60,
    isPro: true,
    fallbackModelId: 'gpt-4o-mini',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  // ── 2. Топовые модели (Флагманы — ядро продукта) ──
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
    requiredPlan: 'pro',
    contextMessages: 120,
    isPro: true,
    fallbackModelId: 'ketner-mini',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    providerModelId: 'claude-3-5-sonnet-20241022',
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
    pricing: makePricing(3.0, 15.0, 0.75),
    requiredPlan: 'pro',
    contextMessages: 120,
    isPro: true,
    fallbackModelId: 'claude-3-haiku',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'claude-fable',
    name: 'Claude Fable 5.5',
    provider: 'anthropic',
    providerModelId: 'claude-3-5-sonnet-20241022',
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
    pricing: makePricing(3.0, 15.0, 0.75),
    requiredPlan: 'pro',
    contextMessages: 120,
    isPro: true,
    fallbackModelId: 'claude-3-haiku',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    providerModelId: 'gemini-2.5-pro',
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
    maxOutputTokens: 32768,
    pricing: makePricing(1.25, 10.0, 0.315),
    requiredPlan: 'pro',
    contextMessages: 120,
    isPro: true,
    fallbackModelId: 'gemini-2.5-flash',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 3.8 Pro',
    provider: 'google',
    providerModelId: 'gemini-2.5-pro',
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
    maxOutputTokens: 32768,
    pricing: makePricing(1.25, 10.0, 0.315),
    requiredPlan: 'pro',
    contextMessages: 120,
    isPro: true,
    fallbackModelId: 'gemini-2.5-flash',
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'ketner-pro',
    name: 'Qwen 2.5 Max',
    provider: 'openrouter',
    providerModelId: 'qwen/qwen-2.5-72b-instruct',
    enabled: true,
    tier: 'premium',
    capabilities: makeCapabilities({ coding: true, reasoning: true, math: true }),
    contextWindow: 65536,
    maxOutputTokens: 8192,
    pricing: makePricing(0.4, 1.2, 0.2),
    requiredPlan: 'plus',
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
  private entries: Map<string, ModelRegistryEntry>;

  constructor(initialEntries?: ModelRegistryEntry[]) {
    this.entries = new Map();
    for (const entry of initialEntries ?? DEFAULT_REGISTRY_ENTRIES) {
      this.entries.set(entry.id, entry);
    }
  }

  /** Получить модель по ID. */
  get(modelId: string): ModelRegistryEntry | undefined {
    return this.entries.get(modelId);
  }

  /** Получить модель или модель по умолчанию. */
  resolve(modelId: string | undefined): ModelRegistryEntry {
    if (modelId) {
      const entry = this.entries.get(modelId);
      if (entry && entry.enabled) return entry;
    }
    return this.getDefault();
  }

  /** Модель по умолчанию — ketner-mini (или первая бесплатная). */
  getDefault(): ModelRegistryEntry {
    const mini = this.entries.get('ketner-mini');
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

  /** Проверка доступа: флагманы (GPT-6, Claude 3.5, Gemini Pro) доступны только Pro/Ultra. */
  canAccess(userPlan: PlanId | undefined, entry: ModelRegistryEntry): boolean {
    if (!entry.isPro) return true;
    if (!userPlan || userPlan === 'free') return false;
    if (entry.tier === 'flagship') {
      return (
        userPlan === 'pro' ||
        userPlan === 'ultra' ||
        userPlan === 'gpt-pro' ||
        userPlan === 'claude-pro' ||
        userPlan === 'gemini-pro'
      );
    }
    return true;
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

  /** Получить цепочку fallback-моделей. */
  getFallbackChain(modelId: string, maxDepth = 5): ModelRegistryEntry[] {
    const chain: ModelRegistryEntry[] = [];
    let current: ModelRegistryEntry | undefined = this.entries.get(modelId);
    let depth = 0;
    while (current && depth < maxDepth) {
      chain.push(current);
      if (!current.fallbackModelId || current.fallbackModelId === current.id) break;
      current = this.entries.get(current.fallbackModelId);
      depth++;
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
