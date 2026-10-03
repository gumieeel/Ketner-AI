/**
 * Расширенные типы для production AI Gateway системы.
 *
 * Дополняет основные типы из types.ts, не ломая существующие контракты.
 * Все новые типы используются AI Gateway, Entitlement Service,
 * Usage Accounting и Fair Use Engine.
 */

import type { PlanId, Language, MessageAttachment, WorkspaceContext } from '../types.js';

// ─────────────────────────────────────────────────────────────
// AI Provider & Model Registry
// ─────────────────────────────────────────────────────────────

/** Поддерживаемые AI провайдеры. */
export type AIProviderType = 'openai' | 'anthropic' | 'google' | 'openrouter';

/** Tier модели: определяет стоимость и приоритет. */
export type ModelTier = 'free' | 'standard' | 'premium' | 'flagship';

/** Capability-флаги модели для Auto Mode роутинга. */
export interface ModelCapabilities {
  reasoning: boolean;
  coding: boolean;
  vision: boolean;
  longContext: boolean;
  webSearch: boolean;
  creative: boolean;
  math: boolean;
  translation: boolean;
  research: boolean;
}

/** Ценовая конфигурация модели ($ за 1M токенов). */
export interface ModelPricing {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cachedInputPricePerMillion: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * Полная запись модели в реестре.
 *
 * Отличие от существующего ModelInfo:
 * - добавлен provider и providerModelId (для замены модели без изменения frontend)
 * - pricing и capabilities (для cost accounting и auto-routing)
 * - contextWindow и maxOutputTokens (для context optimization)
 */
export interface ModelRegistryEntry {
  /** Внутренний идентификатор (напр. 'gpt-6-astra'). Совпадает со старым ModelInfo.id. */
  id: string;
  /** Отображаемое имя (напр. 'GPT-6 Astra'). */
  name: string;
  /** AI провайдер. */
  provider: AIProviderType;
  /** Идентификатор модели у провайдера (напр. 'gpt-4o' для OpenAI). */
  providerModelId: string;
  /** Активна ли модель. Неактивные не показываются пользователю. */
  enabled: boolean;
  /** Tier модели. */
  tier: ModelTier;
  /** Capabilities для Auto Mode. */
  capabilities: ModelCapabilities;
  /** Максимальный размер контекста в токенах. */
  contextWindow: number;
  /** Максимальное количество выходных токенов. */
  maxOutputTokens: number;
  /** Ценообразование. */
  pricing: ModelPricing;
  /** Требуемый план (null — доступна всем). */
  requiredPlan: PlanId | null;
  /** Сколько последних сообщений отправлять (обратная совместимость). */
  contextMessages: number;
  /** Является ли модель платной (обратная совместимость). */
  isPro: boolean;
  /** Fallback модель при недоступности. */
  fallbackModelId: string | null;
  /** Системный промпт по умолчанию. */
  defaultSystemPrompt: Record<Language, string>;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
// Entitlements & Plan Configuration
// ─────────────────────────────────────────────────────────────

/** Fair-use уровень: определяет пороги защиты. */
export type FairUseLevel = 0 | 1 | 2 | 3;

/** Права доступа тарифного плана. */
export interface PlanEntitlements {
  /** ID плана. */
  planId: PlanId;
  /** Список доступных моделей (ID). Пустой массив = только бесплатные. */
  allowedModels: string[];
  /** Максимальное количество одновременных AI-запросов. */
  maxConcurrency: number;
  /** Приоритет в очереди (0 — низший, 3 — высший). */
  priority: number;
  /** Уровень fair-use (чем выше — тем мягче ограничения). */
  fairUseLevel: FairUseLevel;
  /** Макс. сообщений в минуту (null = без ограничений). */
  requestsPerMinute: number | null;
  /** Макс. сообщений в час (null = без ограничений). */
  requestsPerHour: number | null;
  /** Макс. сообщений в день (null = без ограничений). */
  requestsPerDay: number | null;
  /** Пользовательский лимит сообщений в день (для /api/meta и UI). */
  userFacingDailyMessages?: number | null;
  /** Макс. токенов в час (null = без ограничений). */
  tokensPerHour: number | null;
  /** Макс. токенов в день (null = без ограничений). */
  tokensPerDay: number | null;
  /** Макс. размер контекста в сообщениях. */
  maxContextMessages: number;
  /** Лимит контекста (синоним maxContextMessages). */
  contextLimit: number;
  /** Максимальное количество токенов в ответе. */
  maxTokens: number;
  /** Разрешён ли streaming. */
  streamingEnabled: boolean;
  /** Макс. estimated cost в день в $ (null = без ограничений). */
  maxDailyCost: number | null;
  /** Месячный бюджет на пользователя в $ (для adaptive cost control). */
  costBudget: number;
}

// ─────────────────────────────────────────────────────────────
// Usage Accounting
// ─────────────────────────────────────────────────────────────

/** Статус учётной записи использования. */
export type UsageStatus = 'success' | 'error' | 'cancelled' | 'rate_limited' | 'concurrency_limited';

/** Источник ответа: реальный провайдер, кэш или шаблонная заглушка. */
export type ResponseSource = 'provider' | 'cache' | 'template';

/** Запись об использовании AI модели. */
export interface UsageRecord {
  id: string;
  userId: string;
  subscriptionId: string | null;
  conversationId: string;
  modelId: string;
  provider: AIProviderType;
  /** Входные токены (оценка или фактическое значение от провайдера). */
  inputTokens: number;
  /** Выходные токены. */
  outputTokens: number;
  /** Кэшированные входные токены (если провайдер поддерживает). */
  cachedTokens: number | null;
  /** Reasoning токены (для моделей с reasoning). */
  reasoningTokens: number | null;
  /** Рассчитанная стоимость в $. */
  estimatedCost: number;
  /** Фактическая стоимость от провайдера (если предоставлена). */
  actualCost: number | null;
  /** Задержка ответа в мс. */
  latencyMs: number;
  /** Статус запроса. */
  status: UsageStatus;
  /** Источник ответа: провайдер, кэш или шаблон. */
  source: ResponseSource;
  createdAt: string;
}

/** Агрегированная статистика использования. */
export interface UsageStats {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  totalActualCost: number;
  averageLatencyMs: number;
}

/** Статистика для Fair-Use анализа в скользящем окне. */
export interface FairUseSnapshot {
  userId: string;
  requestsLastMinute: number;
  requestsLastHour: number;
  requestsLastDay: number;
  tokensLastHour: number;
  tokensLastDay: number;
  estimatedCostLastDay: number;
  estimatedCostLastMonth: number;
  activeConcurrentRequests: number;
}

/** Решение Fair-Use системы. */
export type FairUseDecision =
  | { action: 'allow' }
  | { action: 'throttle'; delayMs: number; reason: string }
  | { action: 'queue'; position: number; reason: string }
  | { action: 'deny'; code: string; reason: string };

// ─────────────────────────────────────────────────────────────
// AI Gateway
// ─────────────────────────────────────────────────────────────

/** Запрос к AI Gateway. */
export interface GatewayRequest {
  userId: string;
  userPlan: PlanId;
  userEmail?: string;
  isVip?: boolean;
  conversationId: string;
  modelId: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachments?: MessageAttachment[];
    workspaceContext?: WorkspaceContext;
  }>;
  attachments?: MessageAttachment[];
  workspaceContext?: WorkspaceContext;
  language: Language;
  stream: boolean;
  /**
   * Ранее сохранённая сводка контекста (Phase 2).
   * Передаётся для стабильного prefix caching: при наличии сводки
   * ContextOptimizer не перегенерирует её заново.
   */
  cachedSummary?: string;
}

/** Результат завершения генерации (расширенный). */
export interface GatewayDoneResult {
  inputTokens: number;
  outputTokens: number;
  selectedModel?: { id: string; name: string };
  routingReason?: string;
  /** Источник ответа: реальный провайдер, кэш или шаблон (Phase 0). */
  source: ResponseSource;
  /** Причина завершения генерации (Phase 2). */
  finishReason: 'stop' | 'length' | 'cancelled' | 'error';
  /** Можно ли продолжить генерацию (Phase 2). */
  canContinue: boolean;
  /** Обновлённая сводка контекста для сохранения в БД (Phase 2). */
  contextSummary?: string;
}

/** Callback'и для стримингового ответа. */
export interface GatewayStreamCallbacks {
  onDelta: (content: string) => void;
  onDone: (result: GatewayDoneResult) => void;
  onError: (error: { code: string; message: string }) => void;
}

/** Результат генерации (без стриминга). */
export interface GatewayResponse {
  content: string;
  modelId: string;
  provider: AIProviderType;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number | null;
    reasoningTokens: number | null;
  };
  latencyMs: number;
  estimatedCost: number;
  actualCost: number | null;
}

// ─────────────────────────────────────────────────────────────
// AI Provider Interface
// ─────────────────────────────────────────────────────────────

/** Сообщение для провайдера. */
export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Параметры запроса к провайдеру. */
export interface ProviderRequestOptions {
  model: string;
  messages: ProviderMessage[];
  maxTokens?: number;
  temperature?: number;
  stream: boolean;
  signal?: AbortSignal;
}

/** Callback'и для стримингового ответа провайдера. */
export interface ProviderStreamCallbacks {
  onDelta: (content: string) => void;
  isCancelled: () => boolean;
}

/** Результат запроса к провайдеру. */
export interface ProviderResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  };
  /** Фактическая стоимость от провайдера, если предоставлена. */
  cost?: number;
  finishReason: 'stop' | 'length' | 'cancelled' | 'error';
}

/** Интерфейс адаптера AI провайдера. */
export interface AIProvider {
  /** Уникальный идентификатор провайдера. */
  readonly type: AIProviderType;
  /** Человекочитаемое имя. */
  readonly name: string;
  /** Доступен ли провайдер (есть API ключ и конфигурация). */
  isAvailable(): boolean;
  /** Генерация текста (без стриминга). */
  generateText(options: ProviderRequestOptions): Promise<ProviderResponse>;
  /** Генерация текста с стримингом. */
  streamText(
    options: ProviderRequestOptions,
    callbacks: ProviderStreamCallbacks,
  ): Promise<ProviderResponse>;
}

// ─────────────────────────────────────────────────────────────
// Auto Mode
// ─────────────────────────────────────────────────────────────

/** Категория задачи для Auto Mode роутинга. */
export type TaskCategory =
  | 'coding'
  | 'reasoning'
  | 'creative'
  | 'math'
  | 'translation'
  | 'general'
  | 'research'
  | 'vision';

/** Результат классификации задачи. */
export interface TaskClassification {
  category: TaskCategory;
  complexity: 'simple' | 'moderate' | 'complex';
  requiresLongContext: boolean;
  suggestedCapabilities: Partial<ModelCapabilities>;
}

// ─────────────────────────────────────────────────────────────
// Admin & Profitability
// ─────────────────────────────────────────────────────────────

/** Profitability для пользователя. */
export interface UserProfitability {
  userId: string;
  subscriptionRevenue: number;
  aiCost: number;
  contributionMargin: number;
  /** 'profitable' | 'low_margin' | 'loss_making' */
  status: 'profitable' | 'low_margin' | 'loss_making';
  period: { from: string; to: string };
}

/** Статус провайдера для админ-панели. */
export interface ProviderStatus {
  provider: AIProviderType;
  available: boolean;
  averageLatencyMs: number;
  errorRate: number;
  totalRequests: number;
  totalCost: number;
}

// ─────────────────────────────────────────────────────────────
// Error Codes
// ─────────────────────────────────────────────────────────────

/** Стандартизированные коды ошибок AI системы. */
export type AIErrorCode =
  | 'model_unavailable'
  | 'rate_limited'
  | 'subscription_required'
  | 'model_not_allowed'
  | 'concurrency_limit'
  | 'provider_error'
  | 'context_too_large'
  | 'content_rejected'
  | 'payment_required'
  | 'fair_use_exceeded'
  | 'upgrade_required'
  | 'internal_error'
  | 'upstream_error';

// ─────────────────────────────────────────────────────────────
// Webhook Events
// ─────────────────────────────────────────────────────────────

/** Типы webhook-событий от платёжного провайдера. */
export type WebhookEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.deleted'
  | 'invoice.paid'
  | 'invoice.payment_failed';

/** Webhook-событие. */
export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  data: Record<string, unknown>;
  createdAt: string;
  /** Идемпотентный ключ для предотвращения повторной обработки. */
  idempotencyKey: string;
}
