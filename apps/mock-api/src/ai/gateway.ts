/**
 * AI Gateway — центральный шлюз оркестрации AI-запросов Ketner AI.
 *
 * Объединяет:
 * - Model Registry (каталог моделей)
 * - Provider Manager (адаптеры OpenAI, Anthropic, Google, OpenRouter)
 * - Entitlement Service (проверка прав и тарифов)
 * - Fair Use Engine (защита от злоупотреблений, rate limits, concurrency)
 * - Context Optimizer (оптимизация контекста)
 * - Usage Accounting & Cost Calculator (учёт токенов и себестоимости)
 * - Fallback & Failover (автоматическое переключение при сбоях провайдеров)
 */

import { ERROR_MESSAGES, pickAnswer } from './answers.js';
import { semanticCache, SemanticCache } from './cache.js';
import { ContextOptimizer } from './context.js';
import type {
  AIProvider,
  GatewayRequest,
  GatewayStreamCallbacks,
  ModelRegistryEntry,
  ProviderRequestOptions,
  ProviderResponse,
} from './gateway-types.js';
import type { WatchdogLimits } from './stream-watchdog.js';
import {
  modelRegistry,
  type ModelRegistry,
  ECONOMY_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from './model-registry.js';
import { providerManager, type ProviderManager } from './providers/provider-factory.js';
import { delay, streamText } from './stream.js';
import { isProduction, type AiConfig } from '../config.js';
import { EntitlementService } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
import { AutoRouter } from './auto-router.js';
import type { UsageStore } from '../store/usage-store.js';
import { feedbackStore as defaultFeedbackStore, type FeedbackStore } from '../store/index.js';
import {
  TierPipelineEngine,
  computeDynamicMaxTokens,
  type PipelineStrategy,
} from './tier-pipeline.js';
import { CircuitBreaker, defaultCircuitBreaker } from './circuit-breaker.js';
import { computeRequestCost } from './engine-pricing.js';
import { createStreamWatchdog, DEFAULT_WATCHDOG_LIMITS } from './stream-watchdog.js';
import { evaluateBudget } from '../services/budget-policy.js';
import { PayloadGuard } from './payload-guard.js';
import {
  buildAttachmentsBlock,
  buildWorkspaceContextBlock,
  workspaceBudgetChars,
} from './workspace-context.js';

export interface ComplexityContext {
  history?: Array<{ role: string; content: string }>;
  hasAttachments?: boolean;
  hasWorkspace?: boolean;
}

export interface EngineResolution {
  modelId: string;
  engineName: string;
  level: 'simple' | 'moderate' | 'complex';
}

export type AstraEngineResolution = EngineResolution;

export function classifyPromptComplexity(
  prompt?: string,
  context?: ComplexityContext,
): {
  level: 'simple' | 'moderate' | 'complex';
  category: string;
} {
  if (!prompt || !prompt.trim()) {
    return { level: 'complex', category: 'general' };
  }

  // Если есть вложения или проект — задача сразу переходит в категорию сложных
  if (context?.hasAttachments || context?.hasWorkspace) {
    return { level: 'complex', category: 'coding' };
  }

  const classification = AutoRouter.classify(prompt);
  const trimmed = prompt.trim();

  // Проверка истории: если в недавней истории был сложный контекст (код, длинные ответы, рассуждения),
  // то короткая реплика («да», «продолжи», «ок») не должна сбрасывать сложность на deepseek
  const historyIsComplex = Boolean(
    context?.history &&
      context.history.length > 0 &&
      context.history.slice(-4).some((m) => {
        const text = m.content || '';
        return (
          text.length > 250 ||
          /```|function|class|interface|import|export|select|def |const |let |error|exception/i.test(
            text,
          )
        );
      }),
  );

  const hasCodeOrTechnicalSyntax =
    /```|<pre>|SELECT\s+[\s\S]*?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]*?SET|CREATE\s+TABLE|function\s*\(|def\s+\w+\(|class\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|import\s+[\s\S]*?from|export\s+(default|const|class)|interface\s+\w+/i.test(
      trimmed,
    );

  // 1. "Прям лёгкие вопросы": приветствия, благодарности, подтверждения, короткие реплики
  const isGreetingOrChitChat =
    /^(привет|хай|здравствуй|добр(ое|ый|ый день|ое утро|ый вечер)|hello|hi|hey|как дела|кто ты|что ты умеешь|спасибо|благодарю|ок|ok|ясно|понятно)[\s!?,.]*$/i.test(
      trimmed,
    );

  const isTrivialGeneral =
    trimmed.length < 50 &&
    classification.complexity === 'simple' &&
    classification.category === 'general' &&
    !/(напиши|составь|придумай|объясни|расскажи|переведи|write|explain|translate|код|функци)/i.test(trimmed);

  if ((isGreetingOrChitChat || isTrivialGeneral) && !historyIsComplex && !hasCodeOrTechnicalSyntax) {
    return { level: 'simple', category: classification.category };
  }

  // 2. Сложные задачи: глубокий код, математика, архитектура, системный дизайн, длинные формулировки (>500 символов)
  const isComplex =
    classification.complexity === 'complex' ||
    classification.category === 'coding' ||
    classification.category === 'math' ||
    classification.category === 'reasoning' ||
    classification.category === 'research' ||
    hasCodeOrTechnicalSyntax ||
    trimmed.length > 500 ||
    historyIsComplex;

  if (isComplex) {
    return { level: 'complex', category: hasCodeOrTechnicalSyntax ? 'coding' : classification.category };
  }

  // 3. Умеренные / стандартные задачи
  return { level: 'moderate', category: classification.category };
}

/**
 * Интеллектуальный роутер движков OpenRouter для флагманских Pro-моделей:
 * 1. GPT-6 Astra:
 *    - лёгкие: deepseek/deepseek-chat
 *    - средние: openai/gpt-6-luna-pro
 *    - сложные: openai/gpt-6-sol-pro
 * 2. Claude Fable (5.1 / 5.5):
 *    - лёгкие: deepseek/deepseek-chat
 *    - средние: anthropic/claude-haiku-4.5
 *    - сложные: anthropic/claude-opus-5.5
 * 3. Gemini 3.8 Flash (ранее gemini-2.5-pro / gemini-pro):
 *    - лёгкие: deepseek/deepseek-chat
 *    - средние и сложные: google/gemini-3.8-flash
 * 4. Grok 4.7:
 *    - лёгкие: deepseek/deepseek-chat
 *    - средние и сложные: x-ai/grok-4.7
 */
export function resolveEngineForModel(
  modelId: string,
  prompt?: string,
  context?: ComplexityContext,
  feedbackStore?: FeedbackStore,
): EngineResolution {
  const { level } = classifyPromptComplexity(prompt, context);
  const shouldEscalate = feedbackStore?.shouldEscalateFromLightModel(modelId, level) ?? false;

  // 1. GPT-6 Astra
  if (modelId === 'gpt-6-astra') {
    if (level === 'simple') {
      if (shouldEscalate) {
        return {
          modelId: 'openai/gpt-6-luna-pro',
          engineName: 'OpenAI: GPT-6 Luna Pro (Escalated from Light)',
          level,
        };
      }
      return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek Chat (Light Fast)', level };
    }
    if (level === 'moderate') {
      return { modelId: 'openai/gpt-6-luna-pro', engineName: 'OpenAI: GPT-6 Luna Pro', level };
    }
    return { modelId: 'openai/gpt-6-sol-pro', engineName: 'OpenAI: GPT-6 Sol Pro', level };
  }

  // 2. Claude Fable (5.1 / 5.5)
  if (modelId === 'claude-fable' || modelId === 'claude-3.5-sonnet') {
    if (level === 'simple') {
      if (shouldEscalate) {
        return {
          modelId: 'anthropic/claude-haiku-4.5',
          engineName: 'Anthropic: Claude Haiku 4.5 (Escalated from Light)',
          level,
        };
      }
      return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek Chat (Light Fast)', level };
    }
    if (level === 'moderate') {
      return { modelId: 'anthropic/claude-haiku-4.5', engineName: 'Anthropic: Claude Haiku 4.5', level };
    }
    return { modelId: 'anthropic/claude-opus-5.5', engineName: 'Anthropic: Claude Opus 5.5', level };
  }

  // 3. Gemini 3.8 Flash
  if (
    modelId === 'gemini-2.5-pro' ||
    modelId === 'gemini-pro' ||
    modelId === 'gemini-3.8-flash'
  ) {
    if (level === 'simple') {
      if (shouldEscalate) {
        return {
          modelId: 'google/gemini-3.8-flash',
          engineName: 'Google: Gemini 3.8 Flash (Escalated from Light)',
          level,
        };
      }
      return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek Chat (Light Fast)', level };
    }
    return { modelId: 'google/gemini-3.8-flash', engineName: 'Google: Gemini 3.8 Flash', level };
  }

  // 4. Grok 4.7
  if (modelId === 'grok-4.7' || modelId === 'grok') {
    if (level === 'simple') {
      if (shouldEscalate) {
        return {
          modelId: 'x-ai/grok-4.7',
          engineName: 'SpaceXAI: Grok 4.7 (Escalated from Light)',
          level,
        };
      }
      return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek Chat (Light Fast)', level };
    }
    return { modelId: 'x-ai/grok-4.7', engineName: 'SpaceXAI: Grok 4.7', level };
  }

  // Прочие модели:
  if (modelId === 'gpt-4o-mini') {
    return { modelId: 'openai/gpt-4o-mini', engineName: 'OpenAI: GPT-4o mini', level };
  }
  if (modelId === 'gpt-4o') {
    return { modelId: 'openai/gpt-4o', engineName: 'OpenAI: GPT-4o', level };
  }
  if (modelId === 'deepseek-v4.1-flash') {
    return { modelId: 'deepseek/deepseek-chat', engineName: 'DeepSeek V4.1 Flash', level };
  }
  if (modelId === 'gemini-2.5-flash') {
    return { modelId: 'google/gemini-2.5-flash', engineName: 'Google: Gemini 2.5 Flash', level };
  }
  if (modelId === 'claude-3-haiku') {
    return { modelId: 'anthropic/claude-haiku-4.5', engineName: 'Anthropic: Claude Haiku 4.5', level };
  }

  return { modelId, engineName: modelId, level };
}

export function resolveAstraEngine(
  prompt?: string,
  context?: ComplexityContext,
  feedbackStore?: FeedbackStore,
): AstraEngineResolution {
  return resolveEngineForModel('gpt-6-astra', prompt, context, feedbackStore);
}

export function toOpenRouterModelId(
  model: ModelRegistryEntry,
  prompt?: string,
  context?: ComplexityContext,
  feedbackStore?: FeedbackStore,
): string {
  const resolution = resolveEngineForModel(model.id, prompt, context, feedbackStore);
  if (resolution.modelId !== model.id) {
    return resolution.modelId;
  }
  if (model.provider === 'openai') return `openai/${model.providerModelId}`;
  if (model.provider === 'anthropic') return `anthropic/${model.providerModelId}`;
  if (model.provider === 'google') return `google/${model.providerModelId}`;
  return model.providerModelId;
}

const JCUKEN_MAP: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
  a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
  z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё',
  Q: 'Й', W: 'Ц', E: 'У', R: 'К', T: 'Е', Y: 'Н', U: 'Г', I: 'Ш', O: 'Щ', P: 'З', '{': 'Х', '}': 'Ъ',
  A: 'Ф', S: 'Ы', D: 'В', F: 'А', G: 'П', H: 'Р', J: 'О', K: 'Л', L: 'Д', ':': 'Ж', '"': 'Э',
  Z: 'Я', X: 'Ч', C: 'С', V: 'М', B: 'И', N: 'Т', M: 'Ь', '<': 'Б', '>': 'Ю', '~': 'Ё',
};

export function convertLayoutIfInverted(input: string): string {
  if (!input || input.trim().length === 0) return input;
  const hasLatin = /[a-zA-Z]/.test(input);
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(input);
  if (!hasLatin || hasCyrillic) return input;

  const converted = input
    .split('')
    .map((ch) => JCUKEN_MAP[ch] ?? ch)
    .join('');

  const ruPatterns = /(анализ|репозитор|проект|файл|сдела|помог|напиш|объясн|ошибк|папк|ветк|функц|компонент|скрипт|привет|как|что|где|почему)/i;
  if (ruPatterns.test(converted)) {
    return converted;
  }
  return input;
}

export interface AIGatewayDeps {
  registry?: ModelRegistry;
  providers?: ProviderManager;
  usageStore: UsageStore;
  aiConfig: AiConfig;
  circuitBreaker?: CircuitBreaker;
  feedbackStore?: FeedbackStore;
  /**
   * Принудительно включить (true) или выключить (false) шаблонный движок-заглушку.
   * По умолчанию определяется окружением. В production игнорируется: заглушка там невозможна.
   */
  useMockEngine?: boolean;
}

export class AIGateway {
  private registry: ModelRegistry;
  private providers: ProviderManager;
  private usageStore: UsageStore;
  private aiConfig: AiConfig;
  private circuitBreaker: CircuitBreaker;
  private feedbackStore: FeedbackStore;
  private useMockEngine?: boolean;

  constructor(deps: AIGatewayDeps) {
    this.useMockEngine = deps.useMockEngine;
    this.registry = deps.registry ?? modelRegistry;
    this.providers = deps.providers ?? providerManager;
    this.usageStore = deps.usageStore;
    this.aiConfig = deps.aiConfig;
    this.circuitBreaker = deps.circuitBreaker ?? defaultCircuitBreaker;
    this.feedbackStore = deps.feedbackStore ?? defaultFeedbackStore;
  }

  /**
   * Один проход стриминга со сторожем: сроки на первый токен, простой и общую длительность
   * вместо единого таймера, обрывавшего любой длинный ответ.
   */
  private async streamWithWatchdog(
    provider: AIProvider,
    options: Pick<ProviderRequestOptions, 'model' | 'messages' | 'maxTokens'>,
    hooks: {
      onDelta: (delta: string) => void;
      isCancelled: () => boolean;
      clientSignal: AbortSignal;
      providerTimeoutMs?: number;
    },
  ): Promise<{ response: ProviderResponse; timedOut: boolean }> {
    const attempt = new AbortController();
    const limits: WatchdogLimits = {
      ...DEFAULT_WATCHDOG_LIMITS,
      ...(hooks.providerTimeoutMs
        ? {
            firstTokenMs: hooks.providerTimeoutMs,
            idleMs: hooks.providerTimeoutMs,
            totalMs: Math.max(hooks.providerTimeoutMs, DEFAULT_WATCHDOG_LIMITS.totalMs),
          }
        : {}),
    };
    const watchdog = createStreamWatchdog(limits, (reason) => {
      attempt.abort(new Error(`Timeout (${reason}) у провайдера ${provider.type}`));
    });

    const onClientAbort = (): void => attempt.abort();
    if (hooks.clientSignal.aborted) {
      attempt.abort();
    } else {
      hooks.clientSignal.addEventListener('abort', onClientAbort, { once: true });
    }

    try {
      const response = await provider.streamText(
        { ...options, stream: true, signal: attempt.signal },
        {
          onDelta: (delta) => {
            watchdog.touch();
            hooks.onDelta(delta);
          },
          isCancelled: () => hooks.isCancelled() || attempt.signal.aborted,
        },
      );
      return { response, timedOut: watchdog.reason !== null };
    } finally {
      watchdog.stop();
      hooks.clientSignal.removeEventListener('abort', onClientAbort);
    }
  }

  /** Расхождение запрошенного и фактического движка — это почти всегда неверный ID модели. */
  private readonly reportedMismatches = new Set<string>();
  private noteEngineMismatch(requested: string, actual: string | undefined): void {
    if (!actual || actual === requested) return;
    const family = (id: string): string => id.split(':')[0].toLowerCase();
    if (family(actual).startsWith(family(requested)) || family(requested).startsWith(family(actual))) return;
    const key = `${requested}->${actual}`;
    if (this.reportedMismatches.has(key)) return;
    this.reportedMismatches.add(key);
    console.warn(
      `[ai-gateway] Запрошен движок ${requested}, ответил ${actual}. Проверьте ID модели в реестре.`,
    );
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  getFeedbackStore(): FeedbackStore {
    return this.feedbackStore;
  }

  /**
   * Стриминговая генерация ответа через AI Gateway.
   */
  async stream(
    req: GatewayRequest,
    callbacks: GatewayStreamCallbacks,
    isCancelled: () => boolean,
  ): Promise<void> {
    const startTime = Date.now();
    const activeUserId = req.userId;
    const language = req.language;

    // 0. Payload Guard (Phase 5: валидация размера сообщений и вложений)
    const guardResult = PayloadGuard.validate(req.messages, {
      language,
      attachments: req.attachments,
      workspace: req.workspaceContext ?? req.messages[req.messages.length - 1]?.workspaceContext,
    });
    if (!guardResult.valid) {
      callbacks.onError({
        code: (guardResult.code as any) ?? 'payload_too_large',
        message: guardResult.message ?? ERROR_MESSAGES[language],
      });
      return;
    }

    const clientAbortController = new AbortController();
    if (req.signal) {
      if (req.signal.aborted) {
        clientAbortController.abort();
      } else {
        req.signal.addEventListener('abort', () => clientAbortController.abort(), { once: true });
      }
    }
    const combinedIsCancelled = () => isCancelled() || clientAbortController.signal.aborted;

    // 1. Определение эффективного плана и лимитов
    // Примечание: req.userPlan предварительно резолвится с учётом VIP-элевации (isVipUser -> 'ultra')
    // upstream в chat.ts перед вызовом gateway.stream().
    // EntitlementService.resolveEffectivePlan повторно валидирует план, учитывая переданные
    // req.userEmail и req.isVip, и обеспечивает надёжный fallback на 'free'.
    const effectivePlan = EntitlementService.resolveEffectivePlan(
      req.userPlan,
      req.userEmail,
      req.isVip,
    );
    const entitlements = EntitlementService.getEntitlements(effectivePlan);
    const snapshot = this.usageStore.getFairUseSnapshot(activeUserId);

    // Месячный бюджет себестоимости: soft (80%) → exhausted (100%, только дешёвые движки) →
    // hard_stop (125%, запросы отклоняются). Без потолка «безлимит» мог уйти в убыток.
    const budget = evaluateBudget(snapshot.estimatedCostLastMonth, entitlements.costBudget);
    const isBudgetExceeded = budget.stage === 'exhausted' || budget.stage === 'hard_stop';

    if (budget.stage === 'hard_stop') {
      this.usageStore.recordUsage({
        userId: activeUserId,
        conversationId: req.conversationId,
        modelId: req.modelId,
        provider: 'openrouter',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        latencyMs: Date.now() - startTime,
        status: 'rate_limited',
        source: 'provider',
      });
      callbacks.onError({
        code: 'fair_use_exceeded',
        message:
          language === 'en'
            ? 'Your plan resource quota for this period is used up. It renews gradually; you can upgrade your plan for a higher quota.'
            : 'Ресурсная квота вашего тарифа на этот период исчерпана. Она восстанавливается постепенно; для большей квоты можно повысить тариф.',
      });
      return;
    }

    // 2. Резолвинг модели и выбор стратегии исполнения (Token Economics & Tier Pipelines)
    let targetModel: ModelRegistryEntry;
    let routingReason: string;
    let pipelineStrategy: PipelineStrategy | null = null;
    const rawPrompt =
      [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const decodedPrompt = convertLayoutIfInverted(rawPrompt);
    const prompt = decodedPrompt;

    // Проект берётся только из ПОСЛЕДНЕГО сообщения: клиент прикладывает его к каждой реплике, пока
    // проект привязан. Раньше брался и более ранний «метаданный» контекст, и после отвязки проекта
    // модель продолжала считать, что у неё есть полный доступ к нулевому набору файлов.
    const lastMessage = req.messages[req.messages.length - 1];
    const activeWorkspace = req.workspaceContext ?? lastMessage?.workspaceContext;
    const activeAttachments =
      req.attachments ??
      lastMessage?.attachments ??
      req.messages
        .slice(-8)
        .reverse()
        .find((m) => m.attachments && m.attachments.length > 0)?.attachments;

    const complexityContext: ComplexityContext = {
      history: req.messages.slice(0, -1),
      hasAttachments: Boolean(activeAttachments && activeAttachments.length > 0),
      hasWorkspace: Boolean(activeWorkspace),
    };

    if (req.modelId === 'auto') {
      pipelineStrategy = TierPipelineEngine.resolveStrategy(prompt, {
        userPlan: effectivePlan,
        monthlyCost: snapshot.estimatedCostLastMonth,
        monthlyBudget: entitlements.costBudget,
        random: this.aiConfig.random,
        registry: this.registry,
      });

      targetModel = this.registry.resolve(pipelineStrategy.targetModelId);
      routingReason = pipelineStrategy.reason;
    } else {
      const resolved = this.registry.resolve(req.modelId);
      if (isBudgetExceeded && resolved.tier !== 'free') {
        targetModel = this.registry.resolve('ketner-mini');
        routingReason = `Budget protection: dynamically routed to ${targetModel.name} for fair usage`;
      } else {
        targetModel = resolved;
        const resolution = resolveEngineForModel(targetModel.id, prompt, complexityContext, this.feedbackStore);
        if (
          [
            'gpt-6-astra',
            'claude-fable',
            'claude-3.5-sonnet',
            'gemini-2.5-pro',
            'gemini-pro',
            'gemini-3.8-flash',
            'grok-4.7',
          ].includes(targetModel.id)
        ) {
          routingReason = `${targetModel.name}: ${resolution.level} query routed to ${resolution.engineName}`;
        } else {
          routingReason = `Explicit user model selection (${targetModel.name})`;
        }
      }
    }

    // 3. Проверка прав доступа (Entitlement Check)
    // Разовая «вспышка» флагмана для Plus выбирается самим сервером (см. TierPipelineEngine) и
    // сознательно выходит за рамки тарифа; без этого исключения 5% запросов Auto у Plus
    // падали бы с ошибкой «нужна подписка Pro».
    const accessCheck =
      pipelineStrategy?.mode === 'gpt_short'
        ? { allowed: true as const }
        : EntitlementService.checkModelAccess(targetModel, effectivePlan);
    if (!accessCheck.allowed) {
      const msg =
        language === 'en'
          ? `Access to ${targetModel.name} requires an active subscription (${accessCheck.requiredPlan} or Ultra). Please upgrade your plan.`
          : `Для доступа к модели ${targetModel.name} требуется подписка (${accessCheck.requiredPlan} или Ultra). Пожалуйста, улучшите ваш тариф.`;

      callbacks.onError({
        code: 'upgrade_required',
        message: msg,
      });
      return;
    }

    // 4. Проверка Fair Use и захват concurrency слота
    const decision = FairUseEngine.evaluate(snapshot, effectivePlan, language);

    if (decision.action === 'deny') {
      this.usageStore.recordUsage({
        userId: activeUserId,
        conversationId: req.conversationId,
        modelId: targetModel.id,
        provider: targetModel.provider,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        latencyMs: Date.now() - startTime,
        status: decision.code === 'concurrency_limit' ? 'concurrency_limited' : 'rate_limited',
        source: 'provider',
      });

      callbacks.onError({
        code: decision.code,
        message: decision.reason,
      });
      return;
    }

    if (decision.action === 'throttle') {
      await delay(decision.delayMs);
    }

    const releaseSlot = this.usageStore.acquireConcurrencySlot(activeUserId);

    try {
      // 5. Оптимизация контекста
      const maxContextMessages = Math.min(
        targetModel.contextMessages,
        entitlements.maxContextMessages,
        entitlements.contextLimit,
      );

      // Дифференциация системных промптов по тарифам и Brand Protection:
      // Free / Plus -> ECONOMY_SYSTEM_PROMPT (максимально краткие ответы)
      // Pro / Ultra -> DEFAULT_SYSTEM_PROMPT (глубокие ответы с рассуждениями)
      const isEconomyTier = effectivePlan === 'free' || effectivePlan === 'plus';
      const promptMap = isEconomyTier
        ? ECONOMY_SYSTEM_PROMPT
        : (targetModel.defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT);
      const baseSystemPrompt = promptMap[language];
      const systemPrompt = isBudgetExceeded
        ? `${baseSystemPrompt} ${language === 'en' ? 'Keep responses concise and direct.' : 'Отвечай максимально кратко и по существу.'}`
        : baseSystemPrompt;

      // Бюджет проекта зависит от тарифа, окна и цены модели: большой контекст на дорогой модели —
      // главный источник убытка в безлимите.
      const workspaceChars = workspaceBudgetChars(
        effectivePlan,
        targetModel.contextWindow,
        targetModel.pricing.inputPricePerMillion,
      );

      let effectiveSystemPrompt = systemPrompt;
      if (activeWorkspace) {
        const { block, stats } = buildWorkspaceContextBlock(activeWorkspace, {
          language,
          query: prompt,
          maxContentChars: workspaceChars,
        });
        effectiveSystemPrompt += block;
        if (stats.filesWithContent === 0 && stats.filesListed > 0) {
          console.warn(
            `[ai-gateway] Проект «${activeWorkspace.name}»: ${stats.filesListed} файлов в списке, но ни у одного нет содержимого`,
          );
        }
      }
      if (activeAttachments && activeAttachments.length > 0) {
        effectiveSystemPrompt += buildAttachmentsBlock(
          activeAttachments,
          language,
          Math.floor(workspaceChars / 2),
        );
      }

      let generatedSummary: string | undefined;
      const optimizedMessages = ContextOptimizer.optimize(
        req.messages.map((m, idx) => ({
          role: m.role as 'user' | 'assistant',
          content:
            idx === req.messages.length - 1 && m.role === 'user' && decodedPrompt !== rawPrompt
              ? decodedPrompt
              : m.content,
        })),
        {
          maxMessages: maxContextMessages,
          maxTokens: targetModel.contextWindow,
          systemPrompt: effectiveSystemPrompt,
          language,
          existingSummary: req.cachedSummary,
          onSummaryGenerated: (summary) => {
            generatedSummary = summary;
          },
        },
      );

      // 5.1. Проверка семантического кэша (Semantic & Query Caching)
      const userScope = effectivePlan === 'free' ? 'shared' : activeUserId;
      const historyHash = SemanticCache.computeHistoryHash(req.messages, 3);
      const hasAttachments = Boolean(activeAttachments && activeAttachments.length > 0);
      // Ответ зависит от файлов проекта и вложений, а ключ кэша — только от текста вопроса:
      // с проектом/вложениями кэш не читаем и не пишем (иначе чужой или устаревший ответ).
      const cacheable = !hasAttachments && !activeWorkspace;

      const cachedHit = cacheable
        ? semanticCache.get(targetModel.id, language, prompt, userScope, historyHash)
        : null;

      if (cachedHit && !isCancelled()) {
        let cacheTtft: number | null = null;
        await streamText(cachedHit.response, {
          thinkingMs: [5, 10],
          chunkMs: [5, 10],
          random: this.aiConfig.random,
          isCancelled,
          onDelta: (delta) => {
            if (cacheTtft === null) {
              cacheTtft = Date.now() - startTime;
            }
            callbacks.onDelta(delta);
          },
        });

        const latencyMs = Date.now() - startTime;
        this.usageStore.recordUsage({
          userId: activeUserId,
          conversationId: req.conversationId,
          modelId: targetModel.id,
          provider: targetModel.provider,
          inputTokens: cachedHit.inputTokens,
          outputTokens: cachedHit.outputTokens,
          cachedTokens: cachedHit.inputTokens,
          estimatedCost: 0,
          actualCost: 0,
          latencyMs,
          ttftMs: cacheTtft,
          status: 'success',
          source: 'cache',
        });

        if (!isCancelled()) {
          callbacks.onDone({
            inputTokens: cachedHit.inputTokens,
            outputTokens: cachedHit.outputTokens,
            selectedModel: { id: targetModel.id, name: targetModel.name },
            routingReason: `${routingReason} (Semantic Cache Hit)`,
            source: 'cache',
            finishReason: 'stop',
            canContinue: false,
          });
        }
        return;
      }

      // 6. Попытка генерации через провайдер с поддержкой Failover
      const modelsToTry = this.registry.getFallbackChain(targetModel.id);
      let success = false;
      let streamedResponse: ProviderResponse | null = null;
      let usedModel = targetModel;
      let doublePassCost = 0;
      let firstTokenMs: number | null = null;

      const hasWorkspaceOrAttachments = Boolean(
        activeWorkspace ||
        (activeAttachments && activeAttachments.length > 0)
      );

      const dynamicMaxTokens = computeDynamicMaxTokens({
        userPlan: effectivePlan,
        monthlyCost: snapshot.estimatedCostLastMonth,
        monthlyBudget: entitlements.costBudget,
        baseTokens: hasWorkspaceOrAttachments
          ? Math.max(entitlements.maxTokens, 4096)
          : (pipelineStrategy?.maxOutputTokens ?? 1024),
      });

      // Если режим gpt_short — инструктируем модель отвечать кратко (<150 токенов)
      if (pipelineStrategy?.mode === 'gpt_short' && pipelineStrategy.promptModifier) {
        const lastMsg = optimizedMessages[optimizedMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          const modText =
            typeof pipelineStrategy.promptModifier === 'string'
              ? pipelineStrategy.promptModifier
              : pipelineStrategy.promptModifier[language];
          lastMsg.content = `${modText}${lastMsg.content}`;
        }
      }

      // Шаблонные ответы-заглушки разрешены только вне production. В production любая из этих
      // настроек не может подменить реальную модель выдуманным ответом.
      const isTestEnv =
        !isProduction &&
        (this.useMockEngine ??
          (process.env.NODE_ENV === 'test' ||
            this.aiConfig.failureRate > 0 ||
            (this.aiConfig.thinkingMs[0] === 0 &&
              this.aiConfig.thinkingMs[1] === 0 &&
              this.aiConfig.chunkMs[0] === 0 &&
              this.aiConfig.chunkMs[1] === 0)));

      let usedEngineId: string | undefined;
      // Токены черновика считаются отдельно: они входят в квоту токенов, но их стоимость
      // записывается по цене модели-черновика, а не удваивается ценой улучшающей модели.
      let extraInputTokens = 0;
      let extraOutputTokens = 0;
      let watchdogTimedOut = false;

      // 6.0. Двухпроходный пайплайн улучшения (Double Pass Enhancer: cheap draft -> GPT/cheap refine).
      // Для кода он отключён: инструкция «сделай лаконичнее» ломает рабочий код, а второй проход
      // удваивает задержку и стоимость без выигрыша в качестве.
      const taskInfo = classifyPromptComplexity(prompt, complexityContext);
      if (
        pipelineStrategy &&
        !activeWorkspace &&
        !activeAttachments?.length &&
        taskInfo.category !== 'coding' &&
        (pipelineStrategy.mode === 'gpt_improve' || pipelineStrategy.mode === 'cheap_improve') &&
        !isTestEnv
      ) {
        const draftModel = this.registry.resolve(pipelineStrategy.draftModelId ?? 'deepseek-v4.1-flash');
        const enhancerModel = this.registry.resolve(pipelineStrategy.enhancerModelId ?? targetModel.id);
        let draftProvider = this.providers.get(draftModel.provider);
        let draftModelId = draftModel.providerModelId;
        if (!draftProvider || !draftProvider.isAvailable()) {
          const openRouterProvider = this.providers.get('openrouter');
          if (openRouterProvider?.isAvailable()) {
            draftProvider = openRouterProvider;
            draftModelId = toOpenRouterModelId(draftModel, prompt, complexityContext);
          }
        }

        let enhancerProvider = this.providers.get(enhancerModel.provider);
        let enhancerModelId = enhancerModel.providerModelId;
        if (!enhancerProvider || !enhancerProvider.isAvailable()) {
          const openRouterProvider = this.providers.get('openrouter');
          if (openRouterProvider?.isAvailable()) {
            enhancerProvider = openRouterProvider;
            enhancerModelId = toOpenRouterModelId(enhancerModel, prompt, complexityContext, this.feedbackStore);
          }
        }

        if (draftProvider?.isAvailable() && enhancerProvider?.isAvailable()) {
          try {
            // Шаг 1: быстрый черновик от дешёвой модели (с собственным таймаутом: раньше
            // зависший провайдер держал запрос и слот параллелизма бесконечно)
            const draftController = new AbortController();
            const draftTimer = setTimeout(() => draftController.abort(), 20_000);
            const abortDraft = (): void => draftController.abort();
            clientAbortController.signal.addEventListener('abort', abortDraft, { once: true });
            let draftRes: ProviderResponse;
            try {
              draftRes = await draftProvider.generateText({
                model: draftModelId,
                messages: optimizedMessages,
                stream: false,
                maxTokens: Math.min(draftModel.maxOutputTokens, 1500),
                signal: draftController.signal,
              });
            } finally {
              clearTimeout(draftTimer);
              clientAbortController.signal.removeEventListener('abort', abortDraft);
            }

            if (draftRes.content && !isCancelled()) {
              // Шаг 2: стриминг отполированного ответа. Во втором проходе передаём и вопрос
              // пользователя, и черновик.
              const modText =
                pipelineStrategy.promptModifier
                  ? typeof pipelineStrategy.promptModifier === 'string'
                    ? pipelineStrategy.promptModifier
                    : pipelineStrategy.promptModifier[language]
                  : (language === 'ru'
                      ? 'Улучши этот ответ. Сделай его более чётким, структурированным и лаконичным:\n\n'
                      : 'Improve this answer. Make it clearer, structured and concise:\n\n');

              const enhanceInstruction =
                language === 'ru'
                  ? `Вопрос пользователя:\n${prompt}\n\nЧерновой ответ:\n${draftRes.content}\n\nИнструкция:\n${modText}`
                  : `User query:\n${prompt}\n\nDraft answer:\n${draftRes.content}\n\nInstruction:\n${modText}`;

              usedModel = enhancerModel;
              usedEngineId = enhancerModelId;
              const pass = await this.streamWithWatchdog(
                enhancerProvider,
                {
                  model: enhancerModelId,
                  messages: [
                    ...optimizedMessages.slice(0, -1),
                    { role: 'user', content: enhanceInstruction },
                  ],
                  maxTokens: Math.max(Math.min(enhancerModel.maxOutputTokens, entitlements.maxTokens), 2048),
                },
                {
                  onDelta: (delta) => {
                    if (firstTokenMs === null) {
                      firstTokenMs = Date.now() - startTime;
                    }
                    callbacks.onDelta(delta);
                  },
                  isCancelled,
                  clientSignal: clientAbortController.signal,
                  providerTimeoutMs: req.providerTimeoutMs,
                },
              );
              streamedResponse = pass.response;
              watchdogTimedOut = pass.timedOut;

              if (streamedResponse && streamedResponse.content.length > 0) {
                extraInputTokens = draftRes.usage.inputTokens;
                extraOutputTokens = draftRes.usage.outputTokens;
                doublePassCost = computeRequestCost({
                  model: draftModel,
                  engineId: draftModelId,
                  tokens: draftRes.usage,
                  providerCost: draftRes.cost,
                }).usd;
                success = true;
              }
            }
          } catch (err) {
            console.warn('[ai-gateway] Double-pass failed, falling back to direct stream:', err);
          }
        }
      }

      // 6.1. Прямой стриминг модели (если double-pass не применялся или не удался)
      if (!isTestEnv && !success) {
        for (const candidateModel of modelsToTry) {
          if (combinedIsCancelled()) break;

          let provider = this.providers.get(candidateModel.provider);
          let modelToRequest = candidateModel.providerModelId;

          if (!provider || !provider.isAvailable()) {
            const openRouterProvider = this.providers.get('openrouter');
            if (openRouterProvider && openRouterProvider.isAvailable()) {
              provider = openRouterProvider;
              modelToRequest = toOpenRouterModelId(candidateModel, prompt, complexityContext, this.feedbackStore);
            } else {
              continue;
            }
          }

          const activeProviderType = provider.type;
          // Предохранитель ведётся по паре «провайдер + движок»: раньше один лимитирующий 429
          // от бесплатной модели OpenRouter отключал на 30 с все остальные модели OpenRouter.
          const breakerKey = `${activeProviderType}:${modelToRequest}`;

          // Phase 5: Проверка Circuit Breaker
          if (this.circuitBreaker.isOpen(breakerKey)) {
            console.warn(
              `[ai-gateway] Circuit breaker OPEN для ${breakerKey}, быстрый переход к следующему fallback`,
            );
            continue;
          }

          try {
            usedModel = candidateModel;
            usedEngineId = modelToRequest;
            // Лимит выходных токенов:
            // 1. При привязанном проекте или сложной задаче (код, рассуждения) отдаём полный объём модели и тарифа.
            // 2. Рассуждающие модели тратят до 1500 токенов только на <think>, поэтому лимит не может быть меньше 4096.
            // 3. dynamicMaxTokens применяется ТОЛЬКО при жёстком превышении бюджета (isBudgetExceeded) на простых запросах.
            let maxTokensToUse: number;
            if (hasWorkspaceOrAttachments || candidateModel.capabilities.reasoning || candidateModel.capabilities.coding) {
              maxTokensToUse = Math.min(candidateModel.maxOutputTokens, entitlements.maxTokens);
            } else if (isBudgetExceeded) {
              maxTokensToUse = dynamicMaxTokens;
            } else {
              maxTokensToUse = Math.min(candidateModel.maxOutputTokens, entitlements.maxTokens);
            }
            maxTokensToUse = Math.max(maxTokensToUse, 2048);

            const pass = await this.streamWithWatchdog(
              provider,
              {
                model: modelToRequest,
                messages: optimizedMessages,
                maxTokens: Math.min(candidateModel.maxOutputTokens, maxTokensToUse),
              },
              {
                onDelta: (delta) => {
                  if (firstTokenMs === null) {
                    firstTokenMs = Date.now() - startTime;
                  }
                  callbacks.onDelta(delta);
                },
                isCancelled: combinedIsCancelled,
                clientSignal: clientAbortController.signal,
                providerTimeoutMs: req.providerTimeoutMs,
              },
            );
            streamedResponse = pass.response;
            watchdogTimedOut = pass.timedOut;

            if (streamedResponse && streamedResponse.content.length > 0) {
              if (pass.timedOut) {
                // Ответ дошёл частично и оборвался по таймауту: пользователю он показан, но
                // провайдер считается нестабильным.
                this.circuitBreaker.recordFailure(breakerKey, new Error('Stream stalled'));
              } else {
                this.circuitBreaker.recordSuccess(breakerKey);
              }
              this.noteEngineMismatch(modelToRequest, streamedResponse.model);
              success = true;
              break;
            } else if (!pass.timedOut && combinedIsCancelled()) {
              break;
            } else {
              this.circuitBreaker.recordFailure(breakerKey, new Error('Empty response from provider'));
            }
          } catch (providerError) {
            this.circuitBreaker.recordFailure(breakerKey, providerError);
            console.warn(
              `[ai-gateway] Провайдер ${activeProviderType} (модель ${candidateModel.name}) вернул ошибку:`,
              providerError,
            );
          }
        }
      }

      let fallbackContent = '';
      let responseSource: 'provider' | 'cache' | 'template' = 'provider';

      if (!success && !isCancelled()) {
        if (!isTestEnv) {
          // Phase 1: если все провайдеры упали в проде — честная ошибка, не списываем лимиты
          callbacks.onError({
            code: 'provider_error',
            message: ERROR_MESSAGES[language],
          });
          this.usageStore.recordUsage({
            userId: activeUserId,
            conversationId: req.conversationId,
            modelId: targetModel.id,
            provider: targetModel.provider,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCost: 0,
            latencyMs: Date.now() - startTime,
            status: 'error',
            source: 'provider',
          });
          return;
        }

        // В test / dev режиме используем шаблонный генератор
        responseSource = 'template';
        const effectiveModelName =
          req.modelId && req.modelId !== 'auto'
            ? (targetModel?.name ?? 'DeepSeek V4.1 Flash')
            : 'DeepSeek V4.1 Flash';
        const templateAnswer = pickAnswer(
          prompt,
          language,
          this.aiConfig.random,
          effectiveModelName,
          activeAttachments ?? req.attachments,
          (activeWorkspace ?? req.workspaceContext) as any,
        );
        await streamText(templateAnswer, {
          thinkingMs: this.aiConfig.thinkingMs,
          chunkMs: this.aiConfig.chunkMs,
          random: this.aiConfig.random,
          isCancelled,
          onDelta: (delta) => {
            if (firstTokenMs === null) {
              firstTokenMs = Date.now() - startTime;
            }
            fallbackContent += delta;
            callbacks.onDelta(delta);
          },
        });

        streamedResponse = {
          content: fallbackContent,
          usage: {
            inputTokens: ContextOptimizer.estimateTokens(prompt),
            outputTokens: ContextOptimizer.estimateTokens(fallbackContent),
          },
          finishReason: isCancelled() ? 'cancelled' : 'stop',
        };
        success = true;
      }

      // 8. Подсчёт токенов, стоимости и запись в UsageStore
      const latencyMs = Date.now() - startTime;
      const passInputTokens =
        streamedResponse?.usage.inputTokens ?? ContextOptimizer.estimateTokens(prompt);
      const passOutputTokens =
        streamedResponse?.usage.outputTokens ??
        ContextOptimizer.estimateTokens(streamedResponse?.content ?? '');
      // В квоту токенов входят оба прохода (черновик + улучшение), в стоимость — каждый по своей цене.
      const inputTokens = passInputTokens + extraInputTokens;
      const outputTokens = passOutputTokens + extraOutputTokens;

      // Цена приоритетно берётся из ответа провайдера (usage.cost), иначе — из таблицы с
      // консервативной оценкой «бесплатных» движков, которые на деле платные.
      const passCost = computeRequestCost({
        model: usedModel,
        engineId: usedEngineId,
        tokens: {
          inputTokens: passInputTokens,
          outputTokens: passOutputTokens,
          cachedTokens: streamedResponse?.usage.cachedTokens,
          reasoningTokens: streamedResponse?.usage.reasoningTokens,
        },
        providerCost: responseSource === 'provider' ? streamedResponse?.cost : undefined,
      });
      const totalEstimatedCost = Number((passCost.usd + doublePassCost).toFixed(6));

      // Остановка сторожем по таймауту — это обрыв, а не выбор пользователя: ответ можно продолжить.
      let finishReason: 'stop' | 'length' | 'cancelled' | 'error' =
        streamedResponse?.finishReason ?? (isCancelled() ? 'cancelled' : 'stop');
      if (watchdogTimedOut && !isCancelled() && finishReason !== 'stop') {
        finishReason = 'length';
      }
      const canContinue = finishReason === 'length';

      this.usageStore.recordUsage({
        userId: activeUserId,
        conversationId: req.conversationId,
        modelId: usedModel.id,
        provider: usedModel.provider,
        inputTokens,
        outputTokens,
        cachedTokens: streamedResponse?.usage.cachedTokens,
        reasoningTokens: streamedResponse?.usage.reasoningTokens,
        estimatedCost: totalEstimatedCost,
        actualCost:
          typeof streamedResponse?.cost === 'number' ? Number((streamedResponse.cost + doublePassCost).toFixed(6)) : null,
        latencyMs,
        ttftMs: firstTokenMs,
        status: isCancelled() ? 'cancelled' : 'success',
        source: responseSource,
      });

      if (!isCancelled()) {
        if (streamedResponse?.content && cacheable && finishReason === 'stop') {
          semanticCache.set(
            targetModel.id,
            language,
            prompt,
            streamedResponse.content,
            {
              inputTokens,
              outputTokens,
            },
            {
              userScope,
              historyHash,
              source: responseSource,
              finishReason,
              hasAttachments: !cacheable,
            },
          );
        }
        callbacks.onDone({
          inputTokens,
          outputTokens,
          selectedModel: { id: usedModel.id, name: usedModel.name },
          routingReason,
          source: responseSource,
          finishReason,
          canContinue,
          contextSummary: generatedSummary,
        });
      }
    } catch (error) {
      console.error('[ai-gateway] Критическая ошибка генерации:', error);
      callbacks.onError({
        code: 'internal_error',
        message: ERROR_MESSAGES[language],
      });
    } finally {
      releaseSlot();
    }
  }
}
