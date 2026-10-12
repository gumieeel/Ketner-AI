/**
 * Расширенные типы для production AI Gateway системы.
 *
 * Дополняет основные типы из types.ts, не ломая существующие контракты.
 * Все новые типы используются AI Gateway, Entitlement Service,
 * Usage Accounting и Fair Use Engine.
 */

import type { PlanId, Language, MessageAttachment, WorkspaceContext } from '../types.js';
export type { PlanId, Language, MessageAttachment, WorkspaceContext };

// ─────────────────────────────────────────────────────────────
// AI Provider & Model Registry
// ─────────────────────────────────────────────────────────────

/**
 * Поддерживаемые AI провайдеры.
 *
 * Все модели идут через единый ключ OpenRouter (OPENROUTER_API_KEY): один счёт, один баланс,
 * одна точка учёта расходов. Прямых ключей OpenAI / Anthropic / Google в проекте нет.
 */
export type AIProviderType = 'openrouter';

/** Tier модели: определяет стоимость и приоритет. */
export type ModelTier = 'free' | 'standard' | 'premium' | 'flagship';

/**
 * Класс стоимости модели — основа экономики тарифов.
 *   lite   — до ~$0.003 за типичный запрос: повседневные вопросы, Free;
 *   work   — ~$0.005: рабочая лошадка (код, анализ) для Plus и выше;
 *   strong — $0.03–0.04: сильные модели, расходуют квоту премиум-запросов;
 *   top    — $0.07–0.10: лучшие модели, расходуют ту же квоту.
 * Классы strong и top считаются «премиум»: их суммарный расход за 30 дней ограничен
 * `premiumBudget` тарифа (см. PlanEntitlements), после чего ответы дают модели класса work.
 */
export type ModelCostClass = 'lite' | 'work' | 'strong' | 'top';

/** Глубина размышлений модели. Размышления оплачиваются как выходные токены. */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Режим размышлений, который выбирает пользователь: standard для всех тарифов, max только на Ultra
 * (модели с профилем размышлений переходят на свою максимальную глубину, см. effortProfile).
 */
export type ReasoningMode = 'standard' | 'max';

/**
 * Фиксированная глубина размышлений модели в режимах standard и max. Для моделей Pro и Ultra
 * глубина не подстраивается под сложность запроса: пользователь платит за конкретный уровень.
 */
export interface EffortProfile {
  standard: ReasoningEffort;
  max: ReasoningEffort;
}

/** Как у модели управляются размышления в OpenRouter (`reasoning` в теле запроса). */
export interface ModelReasoning {
  /** Размышления нельзя отключить (effort 'none' недопустим). */
  mandatory: boolean;
  /** Поддерживаемые значения `reasoning.effort` (пусто — effort не принимается). */
  efforts: ReasoningEffort[];
  /** Модель умеет только включать и выключать размышления (`reasoning.enabled`). */
  toggle?: boolean;
}

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
  /** Класс стоимости: определяет, расходует ли модель квоту премиум-запросов. */
  costClass: ModelCostClass;
  /** Управление размышлениями модели. */
  reasoning: ModelReasoning;
  /** Фиксированная глубина размышлений (модели Pro и Ultra). Без профиля глубина адаптивная. */
  effortProfile?: EffortProfile;
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
  /**
   * Часть месячного бюджета ($ за 30 дней), которую можно потратить на премиум-модели
   * (классы strong и top). Остальное остаётся на повседневные модели, поэтому один
   * тяжёлый день на Opus не оставляет пользователя без ответов до конца месяца.
   */
  premiumBudget: number;
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
  /** Время до первого токена в мс (Time-to-first-token, Phase 4). */
  ttftMs?: number | null;
  /** Статус запроса. */
  status: UsageStatus;
  /** Источник ответа: провайдер, кэш или шаблон. */
  source: ResponseSource;
  /**
   * Вид запроса. Шаги агента (`agent`) тратят бюджет и токены так же, как чат, но не расходуют
   * дневной лимит СООБЩЕНИЙ: один запуск агента — это десятки обращений к модели.
   */
  kind?: 'chat' | 'agent' | 'image';
  /** Идентификатор запуска агента (для подсчёта запусков в сутки). */
  runId?: string;
  /** Номер шага внутри запуска агента (0 — отметка о старте запуска). */
  step?: number;
  /**
   * Сколько единиц суточного лимита модели израсходовал запрос (по умолчанию 1). Запрос в режиме
   * Max у модели с профилем размышлений стоит ~2.4 раза дороже и считается за 2.
   */
  limitUnits?: number;
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

/** Phase 4: Метрики по источникам ответа (провайдер, кэш, шаблоны). */
export interface SourceMetrics {
  cost: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/** Phase 4: Метрики по моделям. */
export interface ModelMetric {
  modelId: string;
  cost: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  averageLatencyMs: number;
}

/** Phase 4: Распределение расходов по тарифам. */
export interface PlanCostMetric {
  plan: string;
  totalCost: number;
  usersCount: number;
  requests: number;
  totalTokens: number;
  averageCostPerUser: number;
}

/** Phase 4: Разбивка задержек и TTFT. */
export interface LatencyBreakdown {
  averageLatencyMs: number;
  p95LatencyMs: number;
  averageTtftMs: number | null;
  p95TtftMs: number | null;
}

/** Phase 4: Предупреждение об отрицательной маржинальности. */
export interface MetricAlert {
  type: 'negative_margin';
  userId: string;
  userEmail: string;
  plan: string;
  contributionMargin: number;
  aiCost: number;
  subscriptionRevenue: number;
  message: string;
}

/** Phase 4: Комплексные метрики шлюза для дашборда администратора (/api/admin/metrics). */
export interface GatewayMetrics {
  totalRequests: number;
  totalCost: number;
  cacheHitRatePct: number;
  cacheHits: number;
  costBySource: {
    provider: SourceMetrics;
    cache: SourceMetrics;
    template: SourceMetrics;
  };
  costByModel: ModelMetric[];
  costByPlan: PlanCostMetric[];
  latency: LatencyBreakdown;
  alerts: MetricAlert[];
  hasNegativeMarginAlert: boolean;
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
  isAnonymous?: boolean;
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
  /** Сигнал отмены от клиента (Phase 5). */
  signal?: AbortSignal;
  /** Таймаут на вызов провайдера в мс (Phase 5, по умолчанию 25_000). */
  providerTimeoutMs?: number;
  /** Режим размышлений пользователя: max действует только на Ultra. */
  reasoningMode?: ReasoningMode;
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
  /** Режим размышлений, который реально действовал (max только на Ultra). */
  reasoningMode?: ReasoningMode;
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
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream: boolean;
  signal?: AbortSignal;
  /**
   * Уже приведённое к возможностям модели значение размышлений: `reasoning.effort`
   * либо `reasoning.enabled` для моделей, которые умеют только включать и выключать.
   */
  reasoning?: { effort: ReasoningEffort } | { enabled: boolean };
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
  /** Фактическая стоимость от провайдера в USD, если предоставлена. */
  cost?: number;
  /** Модель, которая реально ответила (провайдер мог переключиться на запасную). */
  model?: string;
  finishReason: 'stop' | 'length' | 'cancelled' | 'error';
}

// ─────────────────────────────────────────────────────────────
// Tool calling (агентный режим)
// ─────────────────────────────────────────────────────────────

/** Описание инструмента в формате function calling (совместимо с OpenAI и OpenRouter). */
export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON Schema параметров. */
    parameters: Record<string, unknown>;
  };
}

/** Вызов инструмента, собранный из потока. `arguments` — JSON-строка, как её прислала модель. */
export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Сообщение диалога с инструментами. Роль `tool` несёт результат вызова, `assistant` может нести
 * сами вызовы и непрозрачные `reasoningDetails`, которые провайдер просит вернуть без изменений
 * (иначе модели с размышлениями теряют цепочку рассуждений между шагами).
 */
export type ChatWireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ChatToolCall[];
      reasoningDetails?: unknown[];
    }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatCompletionOptions {
  model: string;
  messages: ChatWireMessage[];
  tools?: ChatToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  reasoning?: ProviderRequestOptions['reasoning'];
}

export interface ChatCompletionCallbacks {
  /** Текст ответа модели (без размышлений). */
  onDelta: (content: string) => void;
  /** Размышления модели, если провайдер их отдаёт. */
  onReasoningDelta?: (content: string) => void;
  /** Любой полученный фрагмент потока (в том числе части аргументов инструмента): для сторожа простоя. */
  onActivity?: () => void;
  isCancelled: () => boolean;
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: ChatToolCall[];
  /** Непрозрачные данные размышлений: вернуть в следующем запросе вместе с сообщением ассистента. */
  reasoningDetails?: unknown[];
  usage: ProviderResponse['usage'];
  cost?: number;
  model?: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'cancelled' | 'error';
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
  /** Один шаг диалога с инструментами (стриминг). Нужен агентному режиму. */
  streamChat?(
    options: ChatCompletionOptions,
    callbacks: ChatCompletionCallbacks,
  ): Promise<ChatCompletionResult>;
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
  | 'payload_too_large'
  | 'provider_timeout'
  | 'circuit_breaker_open'
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
