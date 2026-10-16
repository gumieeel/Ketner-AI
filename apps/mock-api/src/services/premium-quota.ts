/**
 * Квота премиум-моделей пользователя и «сколько запросов осталось».
 *
 * Квота — это `premiumBudget` тарифа за скользящие 30 дней (модели классов strong и top). Сверху
 * могут быть кредиты докупленных пакетов (store/premium-credit-store.ts): они тратятся после
 * квоты тарифа, не входят в месячный бюджет и не ограничены лимитами моделей — пакет оплачен
 * отдельно. Здесь всё это считается для шлюза, агента и интерфейса одинаково, а для каждой
 * топ-модели — сколько её запросов примерно осталось и когда вернётся следующий:
 *   - по квоте тарифа: меньшее из «остаток квоты / цена запроса» и остатка недельного пула модели
 *     и его суточной доли (services/daily-limits.ts); ноль, если месячный бюджет на исходе (80%+);
 *   - плюс по кредитам: остаток кредитов / цена запроса.
 * Цена запроса — средняя фактическая за 30 дней по всем пользователям (если запросов набралось
 * достаточно), иначе оценка по таблице цен для типичного запроса (ai/engine-pricing.ts).
 */

import type { ModelRegistryEntry, ReasoningMode } from '../ai/gateway-types.js';
import type { ModelRegistry } from '../ai/model-registry.js';
import { typicalRequestCost } from '../ai/engine-pricing.js';
import { modelLimitStatus } from '../ai/model-limits.js';
import { effectiveReasoningMode, isPremiumClass, limitUnitsFor } from '../ai/reasoning-policy.js';
import type { UsageStore } from '../store/usage-store.js';
import type { PremiumCreditSource } from '../store/premium-credit-store.js';
import { billingLedger } from '../billing/index.js';
import type { PlanId } from '../types.js';
import { BUDGET_SOFT_RATIO, evaluateBudget, type BudgetStage } from './budget-policy.js';
import { EntitlementService, planAllowsModel } from './entitlement.js';

const DAY_MS = 24 * 3600 * 1000;
const QUOTA_WINDOW_MS = 30 * DAY_MS;
/** С этой доли израсходованной квоты интерфейс предупреждает пользователя. */
export const PREMIUM_QUOTA_WARNING_PCT = 80;

export interface PremiumQuota {
  /** Квота тарифа за 30 дней, $. */
  budgetUsd: number;
  /** Сколько из квоты тарифа потрачено (без того, что оплачено кредитами пакетов), $. */
  spentUsd: number;
  remainingUsd: number;
  usedPct: number;
  /** Остаток кредитов докупленных пакетов, $, и когда сгорает ближайший из них. */
  creditsUsd: number;
  creditsExpireAt: string | null;
  /** Осталась ли квота тарифа (Auto тратит только её). */
  baseAvailable: boolean;
  /** Можно ли сейчас ответить премиум-моделью: квота тарифа или кредиты (бюджет и лимиты — отдельно). */
  available: boolean;
}

export interface QuotaDeps {
  usageStore: UsageStore;
  registry: ModelRegistry;
  /** Кредиты докупленных пакетов; по умолчанию — общий журнал платежей. */
  credits?: PremiumCreditSource;
}

const creditsOf = (deps: QuotaDeps): PremiumCreditSource => deps.credits ?? billingLedger.credits;

const round = (value: number, digits = 4): number => Number(value.toFixed(digits));

/** Квота премиум-моделей пользователя за скользящие 30 дней. */
export function getPremiumQuota(userId: string, plan: PlanId, deps: QuotaDeps): PremiumQuota {
  const budgetUsd = EntitlementService.getEntitlements(plan).premiumBudget;
  const spentUsd = deps.usageStore.getCostLastMonthByModels(
    userId,
    deps.registry.getPremiumModelIds(),
  );
  const remainingUsd = Math.max(0, budgetUsd - spentUsd);
  const credits = creditsOf(deps).balanceOf(userId);
  return {
    budgetUsd,
    spentUsd: round(spentUsd),
    remainingUsd: round(remainingUsd),
    usedPct: budgetUsd > 0 ? Math.min(100, Math.round((spentUsd / budgetUsd) * 100)) : 0,
    creditsUsd: round(credits.remainingUsd),
    creditsExpireAt: credits.nextExpiresAt,
    baseAvailable: remainingUsd > 0,
    available: remainingUsd > 0 || credits.remainingUsd > 0,
  };
}

/**
 * Сколько из стоимости премиум-запроса списать с кредитов пакетов (и списать). Запрос за счёт
 * кредитов (`fundedByCredits`: квота тарифа или лимит модели исчерпаны) оплачивается кредитами
 * целиком; обычный — только той частью, что не помещается в остаток квоты тарифа. Вызывается до
 * записи расхода: возвращённая сумма пишется в `UsageRecord.premiumCreditUsd`.
 */
export function settlePremiumCost(
  userId: string,
  plan: PlanId,
  costUsd: number,
  fundedByCredits: boolean,
  deps: QuotaDeps,
): number {
  if (!(costUsd > 0)) return 0;
  const credits = creditsOf(deps);
  if (fundedByCredits) return credits.debit(userId, costUsd);
  const { remainingUsd } = getPremiumQuota(userId, plan, deps);
  const overflow = costUsd - remainingUsd;
  return overflow > 0 ? credits.debit(userId, overflow) : 0;
}

/**
 * Когда скользящее окно освободит `needUsd`: траты выпадают из окна по одной, начиная со старых.
 * null — если ждать нечего или окно столько не освободит.
 */
function restoresAt(
  events: Array<{ at: number; cost: number }>,
  windowMs: number,
  needUsd: number,
): string | null {
  if (needUsd <= 0) return null;
  let freed = 0;
  for (const event of events) {
    freed += event.cost;
    if (freed >= needUsd) return new Date(event.at + windowMs).toISOString();
  }
  return null;
}

export type QuotaLimitedBy = 'quota' | 'week' | 'day' | 'budget' | null;

export interface ModelQuota {
  id: string;
  name: string;
  /** Примерная цена одного запроса ($) и откуда она взята. */
  requestCostUsd: number;
  priceSource: 'observed' | 'estimate';
  /** Сколько запросов примерно осталось: по квоте тарифа (с лимитами модели) плюс по кредитам. */
  remaining: number;
  /** Сколько запросов покрывает остаток квоты тарифа (без лимитов модели). */
  remainingByQuota: number;
  /** Сколько запросов покрывают кредиты докупленных пакетов (лимиты модели на них не действуют). */
  remainingByCredits: number;
  /** Остаток недельного пула и его суточной доли (в запросах), если у модели есть лимит. */
  pool: {
    weekly: number;
    perDay: number;
    weekRemaining: number;
    dayRemaining: number;
  } | null;
  /** Что ограничивает квоту тарифа, когда её запросов не осталось (null — запросы есть). */
  limitedBy: QuotaLimitedBy;
  /** Когда вернётся хотя бы один запрос (ISO), если сейчас их 0. */
  restoresAt: string | null;
}

export interface QuotaReport {
  plan: PlanId;
  reasoningMode: ReasoningMode;
  premium: PremiumQuota & {
    warning: boolean;
    /** Когда вернётся хотя бы часть израсходованной квоты (первая трата выпадет из 30 дней). */
    restoresAt: string | null;
  };
  budget: { stage: BudgetStage; usedPct: number };
  models: ModelQuota[];
}

/** Остаток запросов по каждой топ-модели тарифа и состояние квоты. */
export function buildQuotaReport(
  userId: string,
  plan: PlanId,
  deps: QuotaDeps,
  requestedMode?: ReasoningMode,
): QuotaReport {
  const entitlements = EntitlementService.getEntitlements(plan);
  const mode = effectiveReasoningMode(requestedMode, plan);
  const premium = getPremiumQuota(userId, plan, deps);
  const premiumIds = deps.registry.getPremiumModelIds();
  const premiumEvents = deps.usageStore.getCostEvents(userId, premiumIds, QUOTA_WINDOW_MS);

  const snapshot = deps.usageStore.getFairUseSnapshot(userId);
  const budget = evaluateBudget(snapshot.estimatedCostLastMonth, entitlements.costBudget);
  // Премиум-модели возвращаются, когда месячный расход опустится ниже порога экономного режима.
  const budgetRestoresAt =
    budget.stage === 'normal'
      ? null
      : restoresAt(
          deps.usageStore.getCostEvents(userId, null, QUOTA_WINDOW_MS),
          QUOTA_WINDOW_MS,
          snapshot.estimatedCostLastMonth - entitlements.costBudget * BUDGET_SOFT_RATIO + 1e-6,
        );

  const topModels = deps.registry
    .getAll()
    .filter((m) => isPremiumClass(m.costClass) && planAllowsModel(plan, m.requiredPlan));

  const models = topModels.map((model): ModelQuota => {
    const observed = deps.usageStore.getObservedRequestCost(model.id);
    const requestCostUsd = round(observed ?? estimateRequestCost(model, mode), 6);
    const units = limitUnitsFor(model.effortProfile, mode);
    const remainingByQuota =
      requestCostUsd > 0 ? Math.floor(premium.remainingUsd / requestCostUsd) : 0;
    const remainingByCredits =
      requestCostUsd > 0 ? Math.floor(premium.creditsUsd / requestCostUsd) : 0;
    const status = modelLimitStatus(model, plan, userId, deps.usageStore, deps.registry, units);
    const pool = status
      ? {
          weekly: Math.floor(status.limit.weeklyPool / units),
          perDay: Math.floor(status.limit.dailyCap / units),
          weekRemaining: Math.floor(status.weekRemaining / units),
          dayRemaining: Math.floor(status.dayRemaining / units),
        }
      : null;

    const candidates: Array<{
      by: Exclude<QuotaLimitedBy, null>;
      left: number;
      at: string | null;
    }> = [
      {
        by: 'quota',
        left: remainingByQuota,
        at: restoresAt(premiumEvents, QUOTA_WINDOW_MS, requestCostUsd - premium.remainingUsd),
      },
    ];
    if (pool && status) {
      candidates.push(
        { by: 'week', left: pool.weekRemaining, at: status.weekRestoresAt },
        { by: 'day', left: pool.dayRemaining, at: status.dayRestoresAt },
      );
    }
    if (budget.stage !== 'normal') {
      candidates.push({ by: 'budget', left: 0, at: budgetRestoresAt });
    }
    const fromPlan = Math.max(0, Math.min(...candidates.map((c) => c.left)));
    const remaining = fromPlan + remainingByCredits;
    const blocking = candidates.filter((c) => c.left <= 0);
    // Все исчерпанные ограничения должны вернуться: ждём самое позднее.
    const restore =
      remaining > 0
        ? null
        : blocking.reduce<string | null>(
            (latest, c) => (c.at && (!latest || c.at > latest) ? c.at : latest),
            null,
          );
    return {
      id: model.id,
      name: model.name,
      requestCostUsd,
      priceSource: observed !== null ? 'observed' : 'estimate',
      remaining,
      remainingByQuota,
      remainingByCredits,
      pool,
      limitedBy: fromPlan > 0 ? null : (blocking[0]?.by ?? 'quota'),
      restoresAt: restore,
    };
  });

  return {
    plan,
    reasoningMode: mode,
    premium: {
      ...premium,
      warning: premium.budgetUsd > 0 && premium.usedPct >= PREMIUM_QUOTA_WARNING_PCT,
      restoresAt:
        premiumEvents.length > 0
          ? new Date(premiumEvents[0].at + QUOTA_WINDOW_MS).toISOString()
          : null,
    },
    budget: { stage: budget.stage, usedPct: Math.round(budget.ratio * 100) },
    models,
  };
}

/** Оценка цены запроса: фиксированная глубина модели (или medium для адаптивных моделей). */
function estimateRequestCost(model: ModelRegistryEntry, mode: ReasoningMode): number {
  const effort = model.effortProfile
    ? mode === 'max'
      ? model.effortProfile.max
      : model.effortProfile.standard
    : 'medium';
  return typicalRequestCost(model, effort);
}
