/**
 * Шлюз агента: ответы с вызовом инструментов для клиентов программирования (CLI `ketner`, IDE).
 *
 * Это отдельный от чата путь через те же правила экономики: тариф, месячный бюджет, квота
 * премиум-запросов, предохранитель по модели, учёт расходов по фактической цене OpenRouter.
 * Отличия от чата продиктованы работой агента:
 *  - историю ведёт клиент (сжимает контекст сам), сервер её не обрезает и не пересказывает;
 *  - в запросе нет проекта и вложений, инструменты объявляет клиент, исполняет тоже клиент;
 *  - кэш ответов не используется: ответ зависит от результатов инструментов;
 *  - запасная модель берётся только до первого отправленного клиенту фрагмента: иначе в
 *    ответе склеились бы два разных ответа;
 *  - лимит токенов в час и в сутки не применяется, суточный лимит расхода втрое выше чатового.
 *
 * Заглушек нет: без настроенного ключа OpenRouter клиент получает 503, а не выдуманный ответ.
 */

import { ContextOptimizer } from './context.js';
import type { ModelRegistryEntry, PlanId, ReasoningEffort } from './gateway-types.js';
import { applyEconomyRules, isAllowedFallbackModel, type EconomyState } from './gateway.js';
import { modelRegistry, type ModelRegistry, WORKHORSE_MODEL_ID } from './model-registry.js';
import { PUBLIC_MODEL_IDS } from './models.js';
import { providerManager, type ProviderManager } from './providers/provider-factory.js';
import { OpenRouterError } from './providers/openrouter-provider.js';
import { CircuitBreaker, defaultCircuitBreaker } from './circuit-breaker.js';
import { computeRequestCost } from './engine-pricing.js';
import { computeOutputCap, isPremiumClass, toProviderReasoning } from './reasoning-policy.js';
import { createStreamWatchdog, type WatchdogLimits } from './stream-watchdog.js';
import { delay } from './stream.js';
import {
  isAgentCapable,
  type AgentCapableProvider,
  type AgentMessage,
  type AgentProviderResult,
  type AgentStreamEvent,
  type AgentToolCall,
  type AgentToolChoice,
  type AgentToolDefinition,
} from './agent/agent-types.js';
import type { RequestedReasoningEffort } from './agent/openai-compat.js';
import { evaluateBudget, type BudgetStage } from '../services/budget-policy.js';
import { getPremiumQuota, settlePremiumCost } from '../services/premium-quota.js';
import type { PremiumCreditSource } from '../store/premium-credit-store.js';
import { EntitlementService, planRank } from '../services/entitlement.js';
import { FairUseEngine } from '../services/fair-use.js';
import type { UsageStore } from '../store/usage-store.js';

/** Минимальный тариф для API агента: на Free дорогой цикл из десятков запросов не окупается. */
export const AGENT_MIN_PLAN: PlanId = 'plus';
/** Модель агента по умолчанию (`auto`): рабочая лошадка с лучшим качеством кода на доллар. */
export const AGENT_DEFAULT_MODEL_ID = WORKHORSE_MODEL_ID;
/** Потолок ответа агента относительно чатового: целые файлы не помещаются в чатовый потолок. */
export const AGENT_OUTPUT_FACTOR = 2;
/** Суточный лимит расхода агента относительно чатового. */
export const AGENT_DAILY_COST_FACTOR = 3;

/** Сроки сторожа для агента: размышления и большие файлы дольше, чем реплика чата. */
export const AGENT_WATCHDOG_LIMITS: WatchdogLimits = {
  firstTokenMs: 60_000,
  idleMs: 60_000,
  totalMs: 300_000,
};

export interface AgentRunRequest {
  userId: string;
  userPlan: PlanId;
  userEmail?: string;
  isVip?: boolean;
  /** Идентификатор API-ключа: расход пишется в «диалог» `api:<keyId>`. */
  keyId: string;
  /** Публичный id модели или `auto`. */
  model: string;
  messages: AgentMessage[];
  tools?: AgentToolDefinition[];
  toolChoice?: AgentToolChoice;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort: RequestedReasoningEffort;
  signal?: AbortSignal;
  watchdog?: Partial<WatchdogLimits>;
}

export interface AgentModelRef {
  id: string;
  name: string;
}

export interface AgentRunCallbacks {
  /** Фрагмент ответа; `info.model` — модель, которая отвечает (после подстановок и запасных). */
  onEvent(event: AgentStreamEvent, info: { model: AgentModelRef }): void;
}

export interface AgentFailure {
  kind: 'error';
  status: number;
  code: string;
  message: string;
  retryAfterSec?: number;
}

export interface AgentSuccess {
  kind: 'ok';
  content: string;
  toolCalls: AgentToolCall[];
  finishReason: AgentProviderResult['finishReason'];
  model: AgentModelRef;
  requestedModel: string;
  routingReason: string;
  usage: AgentProviderResult['usage'];
  costUsd: number;
  budget: { stage: BudgetStage; usedPct: number; premiumAvailable: boolean };
}

export type AgentOutcome = AgentSuccess | AgentFailure;

export interface AgentGatewayDeps {
  usageStore: UsageStore;
  registry?: ModelRegistry;
  providers?: ProviderManager;
  circuitBreaker?: CircuitBreaker;
  /** Кредиты докупленных пакетов; по умолчанию — общий журнал платежей. */
  premiumCredits?: PremiumCreditSource;
}

const fail = (
  status: number,
  code: string,
  message: string,
  retryAfterSec?: number,
): AgentFailure => ({
  kind: 'error',
  status,
  code,
  message,
  ...(retryAfterSec ? { retryAfterSec } : {}),
});

/** Уровни, которые агентский API принимает от клиента (xhigh и max — только для чата в режиме Max). */
type AgentEffort = Exclude<ReasoningEffort, 'xhigh' | 'max'>;
const EFFORT_INDEX: Record<AgentEffort, number> = { none: 0, low: 1, medium: 2, high: 3 };
const EFFORT_BY_INDEX: AgentEffort[] = ['none', 'low', 'medium', 'high'];

/**
 * Глубина размышлений агента. Клиент просит уровень, сервер ограничивает его тарифом и бюджетом:
 * high стоит в 2.5–3.3 раза дороже low, поэтому он только у Ultra; на подходе бюджета к пределу
 * (soft и выше) глубина не выше low.
 */
export function chooseAgentEffort(
  requested: RequestedReasoningEffort,
  plan: string,
  stage: BudgetStage,
): AgentEffort {
  const wanted: AgentEffort = requested === 'minimal' ? 'none' : requested;
  let index = EFFORT_INDEX[wanted];
  index = Math.min(index, planRank(plan) >= planRank('ultra') ? 3 : 2);
  if (stage !== 'normal') index = Math.min(index, 1);
  return EFFORT_BY_INDEX[index];
}

/** Грубая оценка размера запроса в токенах: история, инструменты и вызовы функций. */
export function estimateAgentPromptTokens(
  messages: AgentMessage[],
  tools: AgentToolDefinition[] | undefined,
): number {
  let total = 0;
  for (const message of messages) {
    total += 4;
    if (typeof message.content === 'string')
      total += ContextOptimizer.estimateTokens(message.content);
    if (message.role === 'assistant' && message.tool_calls) {
      for (const call of message.tool_calls) {
        total += ContextOptimizer.estimateTokens(call.function.name + call.function.arguments) + 4;
      }
    }
  }
  if (tools && tools.length > 0) {
    total += ContextOptimizer.estimateTokens(JSON.stringify(tools));
  }
  return total;
}

/** Переполнение окна контекста у OpenRouter приходит как HTTP 400 с понятным текстом. */
function isContextOverflow(error: OpenRouterError): boolean {
  return (
    error.status === 400 && /context|too many tokens|maximum.*tokens|too long/i.test(error.message)
  );
}

/** Собирает ответ из событий: нужен, если провайдер оборвался уже после первого фрагмента. */
class EventAccumulator {
  content = '';
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();

  add(event: AgentStreamEvent): void {
    if (event.kind === 'content') {
      this.content += event.text;
    } else if (event.kind === 'tool_call') {
      const current = this.calls.get(event.index) ?? { id: '', name: '', args: '' };
      if (event.id) current.id = event.id;
      if (event.name) current.name = event.name;
      if (event.argumentsDelta) current.args += event.argumentsDelta;
      this.calls.set(event.index, current);
    }
  }

  get toolCalls(): AgentToolCall[] {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        id: call.id || `call_${index}`,
        type: 'function' as const,
        function: { name: call.name, arguments: call.args || '{}' },
      }));
  }

  get isEmpty(): boolean {
    return this.content === '' && this.calls.size === 0;
  }
}

export class AgentGateway {
  private readonly usageStore: UsageStore;
  private readonly registry: ModelRegistry;
  private readonly providers: ProviderManager;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly premiumCredits?: PremiumCreditSource;

  constructor(deps: AgentGatewayDeps) {
    this.premiumCredits = deps.premiumCredits;
    this.usageStore = deps.usageStore;
    this.registry = deps.registry ?? modelRegistry;
    this.providers = deps.providers ?? providerManager;
    this.circuitBreaker = deps.circuitBreaker ?? defaultCircuitBreaker;
  }

  private quotaDeps() {
    return { usageStore: this.usageStore, registry: this.registry, credits: this.premiumCredits };
  }

  /** Публичные модели каталога для агента (без `auto`). */
  listPublicModels(): ModelRegistryEntry[] {
    return PUBLIC_MODEL_IDS.flatMap((id) => {
      const entry = this.registry.get(id);
      return entry && entry.enabled ? [entry] : [];
    });
  }

  /** Каталог для `GET /v1/models`: `auto` и публичные модели с доступностью на тарифе. */
  describeModels(plan: string): Array<{
    id: string;
    name: string;
    context_window: number;
    max_output_tokens: number;
    cost_class: string;
    requires_plan: string;
    available: boolean;
  }> {
    const minRank = planRank(AGENT_MIN_PLAN);
    const toItem = (entry: ModelRegistryEntry, id: string, name: string) => {
      const needed = planRank(entry.requiredPlan) > minRank ? entry.requiredPlan! : AGENT_MIN_PLAN;
      return {
        id,
        name,
        context_window: entry.contextWindow,
        max_output_tokens: entry.maxOutputTokens,
        cost_class: entry.costClass,
        requires_plan: needed,
        available: planRank(plan) >= planRank(needed),
      };
    };
    const workhorse = this.registry.resolve(AGENT_DEFAULT_MODEL_ID);
    return [
      toItem(workhorse, 'auto', 'Auto'),
      ...this.listPublicModels().map((entry) => toItem(entry, entry.id, entry.name)),
    ];
  }

  /** Сводка для `GET /v1/usage`: бюджет, квота премиум-запросов и число запросов за сутки. */
  summarizeUsage(userId: string, plan: PlanId) {
    const entitlements = EntitlementService.getEntitlements(plan);
    const snapshot = this.usageStore.getFairUseSnapshot(userId);
    const budget = evaluateBudget(snapshot.estimatedCostLastMonth, entitlements.costBudget);
    const premium = getPremiumQuota(userId, plan, this.quotaDeps());
    const round = (value: number): number => Math.round(value * 10_000) / 10_000;
    return {
      plan,
      budget: {
        limit_usd: entitlements.costBudget,
        used_usd: round(snapshot.estimatedCostLastMonth),
        used_pct: Math.round(budget.ratio * 1000) / 10,
        stage: budget.stage,
      },
      premium: {
        limit_usd: premium.budgetUsd,
        used_usd: round(premium.spentUsd),
        available: premium.available,
      },
      requests_last_day: snapshot.requestsLastDay,
      window: 'rolling_30_days' as const,
    };
  }

  private recordRefused(
    req: AgentRunRequest,
    modelId: string,
    status: 'rate_limited' | 'concurrency_limited',
    startTime: number,
  ): void {
    this.usageStore.recordUsage({
      userId: req.userId,
      conversationId: `api:${req.keyId}`,
      modelId,
      provider: 'openrouter',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      latencyMs: Date.now() - startTime,
      status,
      source: 'provider',
    });
  }

  async run(req: AgentRunRequest, callbacks: AgentRunCallbacks): Promise<AgentOutcome> {
    const startTime = Date.now();
    const conversationId = `api:${req.keyId}`;
    const isCancelled = (): boolean => Boolean(req.signal?.aborted);

    // 1. Тариф. API агента открыт с Plus.
    const plan = EntitlementService.resolveEffectivePlan(req.userPlan, req.userEmail, req.isVip);
    if (planRank(plan) < planRank(AGENT_MIN_PLAN)) {
      return fail(
        403,
        'upgrade_required',
        'API для программирования доступен с тарифа Plus. Повысьте тариф в личном кабинете.',
      );
    }
    const entitlements = EntitlementService.getEntitlements(plan);

    // 2. Бюджет: тот же месячный бюджет себестоимости, что и в чате.
    const snapshot = this.usageStore.getFairUseSnapshot(req.userId);
    const budget = evaluateBudget(snapshot.estimatedCostLastMonth, entitlements.costBudget);
    const stage = budget.stage;
    if (stage === 'hard_stop') {
      this.recordRefused(req, req.model, 'rate_limited', startTime);
      return fail(
        429,
        'insufficient_quota',
        'Ресурсная квота тарифа на этот период исчерпана. Она восстанавливается постепенно; для большей квоты повысьте тариф.',
      );
    }

    const premium = getPremiumQuota(req.userId, plan, this.quotaDeps());
    const economyState: EconomyState = {
      stage,
      premiumAvailable: premium.baseAvailable,
      creditsAvailable: premium.creditsUsd > 0,
    };

    // 3. Модель: только публичный каталог; права проверяются по запрошенной модели до замен.
    let requested: ModelRegistryEntry;
    if (req.model === 'auto') {
      requested = this.registry.resolve(AGENT_DEFAULT_MODEL_ID);
    } else {
      const found = PUBLIC_MODEL_IDS.includes(req.model) ? this.registry.get(req.model) : undefined;
      if (!found || !found.enabled) {
        return fail(
          404,
          'model_not_found',
          `Модель "${req.model}" не найдена. Список моделей: GET /v1/models`,
        );
      }
      requested = found;
      const access = EntitlementService.checkModelAccess(requested, plan);
      if (!access.allowed) {
        return fail(
          403,
          'upgrade_required',
          `Модель ${requested.name} требует тарифа ${access.requiredPlan} или выше.`,
        );
      }
    }
    const economy = applyEconomyRules(requested, economyState, this.registry);
    const target = economy.model;
    const routingReason =
      economy.reason ??
      (req.model === 'auto'
        ? `Auto: ${requested.name}`
        : `Explicit user model selection (${requested.name})`);

    // 4. Размер запроса: окно контекста у моделей цепочки разное, лишние отсеиваются.
    const promptTokens = estimateAgentPromptTokens(req.messages, req.tools);
    const chain = this.registry
      .getFallbackChain(target.id)
      .filter((m, index) => index === 0 || isAllowedFallbackModel(m, plan, economyState));
    const candidates = chain.filter((m) => promptTokens < m.contextWindow);
    if (candidates.length === 0) {
      return fail(
        400,
        'context_length_exceeded',
        `История не помещается в окно модели (~${promptTokens} токенов при окне ${target.contextWindow}). Сожмите контекст.`,
      );
    }

    // 5. Лимиты запросов и расхода (токенные окна чата для агента не действуют).
    const decision = FairUseEngine.evaluate(snapshot, plan, 'ru', {
      skipTokenWindows: true,
      dailyCostFactor: AGENT_DAILY_COST_FACTOR,
    });
    if (decision.action === 'deny') {
      const isConcurrency = decision.code === 'concurrency_limit';
      this.recordRefused(
        req,
        target.id,
        isConcurrency ? 'concurrency_limited' : 'rate_limited',
        startTime,
      );
      const retryAfter = isConcurrency ? 5 : decision.code === 'fair_use_exceeded' ? 3600 : 300;
      return fail(429, 'rate_limit_exceeded', decision.reason, retryAfter);
    }
    if (decision.action === 'throttle') {
      await delay(decision.delayMs);
    }

    const releaseSlot = this.usageStore.acquireConcurrencySlot(req.userId);
    try {
      return await this.execute(req, callbacks, {
        plan,
        fundedByCredits: Boolean(economy.fundedByCredits),
        entitlements,
        stage,
        economyState,
        requested,
        target,
        candidates,
        routingReason,
        conversationId,
        startTime,
        isCancelled,
      });
    } catch (error) {
      console.error('[agent-gateway] Критическая ошибка:', error);
      return fail(500, 'internal_error', 'Внутренняя ошибка сервера. Повторите запрос.');
    } finally {
      releaseSlot();
    }
  }

  private async execute(
    req: AgentRunRequest,
    callbacks: AgentRunCallbacks,
    ctx: {
      plan: PlanId;
      fundedByCredits: boolean;
      entitlements: ReturnType<typeof EntitlementService.getEntitlements>;
      stage: BudgetStage;
      economyState: EconomyState;
      requested: ModelRegistryEntry;
      target: ModelRegistryEntry;
      candidates: ModelRegistryEntry[];
      routingReason: string;
      conversationId: string;
      startTime: number;
      isCancelled: () => boolean;
    },
  ): Promise<AgentOutcome> {
    const { stage, target, isCancelled } = ctx;
    const accumulator = new EventAccumulator();
    let emitted = false;
    let firstEventMs: number | null = null;
    let usedModel = target;
    let usedEngineId: string | undefined;
    let result: AgentProviderResult | null = null;
    let timedOut = false;
    let authFailure = false;
    let lastError: unknown;
    let anyProviderTried = false;

    for (const candidate of ctx.candidates) {
      if (isCancelled()) break;

      const provider = this.providers.get(candidate.provider);
      if (!provider || !provider.isAvailable() || !isAgentCapable(provider)) continue;

      const engineId = candidate.providerModelId;
      const breakerKey = `${provider.type}:${engineId}`;
      if (this.circuitBreaker.isOpen(breakerKey)) {
        console.warn(
          `[agent-gateway] Circuit breaker OPEN для ${breakerKey}, переходим к запасной модели`,
        );
        continue;
      }

      anyProviderTried = true;
      const effort = chooseAgentEffort(req.reasoningEffort, ctx.plan, stage);
      const reasoning = toProviderReasoning(candidate.reasoning, effort);
      const serverCap = computeOutputCap({
        planMaxTokens: ctx.entitlements.maxTokens * AGENT_OUTPUT_FACTOR,
        modelMaxOutputTokens: candidate.maxOutputTokens,
        stage,
        level: 'complex',
        heavyContext: true,
      });
      const maxTokens = Math.min(req.maxTokens ?? serverCap, serverCap);
      const modelRef: AgentModelRef = { id: candidate.id, name: candidate.name };

      const runPass = (withReasoning: typeof reasoning) =>
        this.streamWithWatchdog(
          provider,
          req,
          {
            model: engineId,
            messages: req.messages,
            tools: req.tools,
            toolChoice: req.toolChoice,
            maxTokens,
            temperature: req.temperature,
            reasoning: withReasoning,
          },
          {
            onEvent: (event) => {
              if (firstEventMs === null) firstEventMs = Date.now() - ctx.startTime;
              emitted = true;
              accumulator.add(event);
              callbacks.onEvent(event, { model: modelRef });
            },
            isCancelled,
          },
        );

      try {
        usedModel = candidate;
        usedEngineId = engineId;

        let pass: Awaited<ReturnType<typeof runPass>>;
        try {
          pass = await runPass(reasoning);
        } catch (firstError) {
          // 400 при заданных размышлениях обычно значит, что модель не принимает это значение:
          // один повтор без параметра. Повторять можно только пока клиенту ничего не отправлено.
          if (
            reasoning &&
            !emitted &&
            firstError instanceof OpenRouterError &&
            firstError.status === 400 &&
            !isContextOverflow(firstError)
          ) {
            console.warn(
              `[agent-gateway] ${engineId} отклонил reasoning=${JSON.stringify(reasoning)}, повтор без параметра`,
            );
            pass = await runPass(undefined);
          } else {
            throw firstError;
          }
        }

        const hasOutput = pass.result.content.length > 0 || pass.result.toolCalls.length > 0;
        if (hasOutput) {
          result = pass.result;
          timedOut = pass.timedOut;
          if (pass.timedOut) {
            this.circuitBreaker.recordFailure(breakerKey, new Error('Stream stalled'));
          } else {
            this.circuitBreaker.recordSuccess(breakerKey);
          }
          break;
        }
        if (!pass.timedOut && isCancelled()) {
          result = pass.result;
          break;
        }
        lastError = new Error('Empty response from provider');
        this.circuitBreaker.recordFailure(breakerKey, lastError);
      } catch (error) {
        lastError = error;
        if (error instanceof OpenRouterError && (error.status === 401 || error.status === 402)) {
          console.error(
            `[agent-gateway] Ключ OpenRouter не принят или баланс исчерпан (HTTP ${error.status})`,
          );
          authFailure = true;
          break;
        }
        if (emitted) {
          // Клиент уже получил начало ответа: второй ответ другой модели склеился бы с ним.
          console.warn(`[agent-gateway] ${candidate.name} оборвался после начала ответа:`, error);
          result = {
            content: accumulator.content,
            toolCalls: accumulator.toolCalls,
            finishReason: 'error',
            usage: { inputTokens: 0, outputTokens: 0 },
          };
          break;
        }
        const clientFault = error instanceof OpenRouterError && error.status === 400;
        if (!clientFault) this.circuitBreaker.recordFailure(breakerKey, error);
        console.warn(`[agent-gateway] Модель ${candidate.name} вернула ошибку:`, error);
      }
    }

    const latencyMs = (): number => Date.now() - ctx.startTime;

    if (!result) {
      if (isCancelled()) {
        this.recordUsage(
          req,
          ctx,
          usedModel,
          usedEngineId,
          null,
          0,
          'cancelled',
          firstEventMs,
          latencyMs(),
        );
        return this.buildSuccess(
          req,
          ctx,
          usedModel,
          {
            content: '',
            toolCalls: [],
            finishReason: 'cancelled',
            usage: { inputTokens: 0, outputTokens: 0 },
          },
          0,
        );
      }
      this.recordUsage(req, ctx, target, usedEngineId, null, 0, 'error', null, latencyMs());
      if (authFailure || !anyProviderTried) {
        return fail(
          503,
          'provider_unavailable',
          'Сервис ИИ временно недоступен. Повторите запрос позже.',
        );
      }
      if (lastError instanceof OpenRouterError && lastError.status === 400) {
        if (isContextOverflow(lastError)) {
          return fail(
            400,
            'context_length_exceeded',
            'История не помещается в окно модели. Сожмите контекст.',
          );
        }
        return fail(
          400,
          'invalid_request_error',
          `Провайдер отклонил запрос: ${lastError.message.slice(0, 300)}`,
        );
      }
      return fail(502, 'upstream_error', 'Все модели цепочки недоступны. Повторите запрос позже.');
    }

    const cost = computeRequestCost({
      model: usedModel,
      engineId: usedEngineId,
      tokens: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedTokens: result.usage.cachedTokens,
        reasoningTokens: result.usage.reasoningTokens,
      },
      providerCost: result.cost,
    });
    const costUsd = Number(cost.usd.toFixed(6));

    let finishReason = result.finishReason;
    if (timedOut && !isCancelled() && finishReason !== 'stop' && finishReason !== 'tool_calls') {
      finishReason = 'length';
    }

    this.recordUsage(
      req,
      ctx,
      usedModel,
      usedEngineId,
      result,
      costUsd,
      isCancelled() ? 'cancelled' : 'success',
      firstEventMs,
      latencyMs(),
    );
    return this.buildSuccess(req, ctx, usedModel, { ...result, finishReason }, costUsd);
  }

  private recordUsage(
    req: AgentRunRequest,
    ctx: { conversationId: string; plan: PlanId; fundedByCredits: boolean },
    model: ModelRegistryEntry,
    _engineId: string | undefined,
    result: AgentProviderResult | null,
    costUsd: number,
    status: 'success' | 'cancelled' | 'error',
    ttftMs: number | null,
    latencyMs: number,
  ): void {
    // Премиум-запрос сверх квоты тарифа (или за счёт пакета) списывается с кредитов пакетов.
    const premium = isPremiumClass(model.costClass);
    const premiumCreditUsd = premium
      ? settlePremiumCost(req.userId, ctx.plan, costUsd, ctx.fundedByCredits, this.quotaDeps())
      : 0;
    this.usageStore.recordUsage({
      userId: req.userId,
      conversationId: ctx.conversationId,
      modelId: model.id,
      provider: model.provider,
      premiumCreditUsd,
      ...(premium && ctx.fundedByCredits ? { fundedBy: 'credits' as const } : {}),
      inputTokens: result?.usage.inputTokens ?? 0,
      outputTokens: result?.usage.outputTokens ?? 0,
      cachedTokens: result?.usage.cachedTokens,
      reasoningTokens: result?.usage.reasoningTokens,
      estimatedCost: costUsd,
      actualCost: typeof result?.cost === 'number' ? Number(result.cost.toFixed(6)) : null,
      latencyMs,
      ttftMs,
      status,
      source: 'provider',
    });
  }

  private buildSuccess(
    req: AgentRunRequest,
    ctx: {
      plan: PlanId;
      entitlements: ReturnType<typeof EntitlementService.getEntitlements>;
      routingReason: string;
      target: ModelRegistryEntry;
    },
    usedModel: ModelRegistryEntry,
    result: AgentProviderResult,
    costUsd: number,
  ): AgentSuccess {
    // Бюджет после записи расхода: клиент видит, сколько осталось именно сейчас.
    const snapshot = this.usageStore.getFairUseSnapshot(req.userId);
    const after = evaluateBudget(snapshot.estimatedCostLastMonth, ctx.entitlements.costBudget);
    const premium = getPremiumQuota(req.userId, ctx.plan, this.quotaDeps());
    return {
      kind: 'ok',
      content: result.content,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      model: { id: usedModel.id, name: usedModel.name },
      requestedModel: req.model,
      routingReason:
        usedModel.id !== ctx.target.id
          ? `${ctx.routingReason}; fallback to ${usedModel.name}`
          : ctx.routingReason,
      usage: result.usage,
      costUsd,
      budget: {
        stage: after.stage,
        usedPct: Math.round(after.ratio * 1000) / 10,
        premiumAvailable: premium.available,
      },
    };
  }

  /** Один проход со сторожем: сроки на первый фрагмент, простой и общую длительность. */
  private async streamWithWatchdog(
    provider: AgentCapableProvider & { type: string },
    req: AgentRunRequest,
    request: Omit<Parameters<AgentCapableProvider['streamAgent']>[0], 'signal'>,
    hooks: { onEvent: (event: AgentStreamEvent) => void; isCancelled: () => boolean },
  ): Promise<{ result: AgentProviderResult; timedOut: boolean }> {
    const attempt = new AbortController();
    const limits: WatchdogLimits = { ...AGENT_WATCHDOG_LIMITS, ...req.watchdog };
    const watchdog = createStreamWatchdog(limits, (reason) => {
      attempt.abort(new Error(`Timeout (${reason}) у провайдера ${provider.type}`));
    });

    const onClientAbort = (): void => attempt.abort();
    if (req.signal?.aborted) {
      attempt.abort();
    } else {
      req.signal?.addEventListener('abort', onClientAbort, { once: true });
    }

    try {
      const result = await provider.streamAgent(
        { ...request, signal: attempt.signal },
        {
          onEvent: (event) => {
            watchdog.touch();
            hooks.onEvent(event);
          },
          isCancelled: () => hooks.isCancelled() || attempt.signal.aborted,
        },
      );
      return { result, timedOut: watchdog.reason !== null };
    } finally {
      watchdog.stop();
      req.signal?.removeEventListener('abort', onClientAbort);
    }
  }
}
