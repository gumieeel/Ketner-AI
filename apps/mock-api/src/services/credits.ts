/**
 * Кредиты: один пул на чат, картинки и Ketner Code.
 *
 * 1 кредит = $0.001 реальной себестоимости запроса (то, что провайдер берёт с нас). Запрос списывает
 * ровно свою стоимость, поэтому короткий вопрос к Ketner Mini стоит около 1 кредита, а большой запрос
 * к Claude Opus — сотни. Тариф даёт кредиты на 30 дней (`monthlyCredits`); оплаченные кредиты живут
 * весь период и ещё один (остаток переносится), на списании первыми идут те, что сгорают раньше.
 * Free получает свой месячный грант сам; тариф без платежа (VIP, выданный администратором, переход со
 * старой системы) — грант на 30 дней, который обновляется, пока тариф действует.
 *
 * Здесь лежит всё, что нужно шлюзу, агенту, картинкам и интерфейсу: начисления, остаток, списание и
 * отчёт «сколько запросов осталось».
 */

import type { ModelRegistryEntry, ReasoningMode } from '../ai/gateway-types.js';
import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import { effectiveReasoningMode } from '../ai/reasoning-policy.js';
import type { DocStore } from '../store/doc-store.js';
import {
  CreditStore,
  DAY_MS,
  type CreditBalance,
  type CreditGrant,
  type LegacyPremiumCredit,
} from '../store/credit-store.js';
import type { UsageStore } from '../store/usage-store.js';
import type { PlanId } from '../types.js';
import {
  creditStageOf,
  FREE_CHAT_MODEL_ID,
  isFreeModel,
  requestPriceUsd,
  type CreditStage,
} from './credit-policy.js';
import {
  CREDITS_PER_USD,
  cryptoBonusCredits,
  EntitlementService,
  planAllowsModel,
  planCreditsUsd,
  toCredits,
  toUsd,
} from './entitlement.js';

/** Длина оплаченного периода и срок переноса остатка, дней. */
export const PERIOD_DAYS = 30;
export const CARRY_DAYS = 30;
/** С этой доли месячной выдачи интерфейс предупреждает, что кредиты на исходе. */
export const LOW_CREDITS_RATIO = 0.15;

export { CREDITS_PER_USD, planCreditsUsd, toCredits, toUsd };

/** Что шлюзу, агенту и картинкам нужно от кредитов. */
export interface CreditLedger {
  /** Остаток пользователя; выдаёт месячный грант Free и грант тарифа без платежа, если пора. */
  balance(userId: string, plan: PlanId, now?: number): CreditBalance;
  /** Списать до `amountUsd`; возвращает, сколько реально списано. */
  charge(userId: string, amountUsd: number, now?: number): number;
}

export class CreditService implements CreditLedger {
  private readonly migrated = new Set<string>();

  constructor(
    readonly store: CreditStore,
    private readonly legacy?: DocStore<LegacyPremiumCredit>,
  ) {}

  balance(userId: string, plan: PlanId, now = Date.now()): CreditBalance {
    this.ensureGrants(userId, plan, now);
    return this.store.balanceOf(userId, now);
  }

  charge(userId: string, amountUsd: number, now = Date.now()): number {
    return this.store.debit(userId, amountUsd, now);
  }

  /** Все гранты пользователя (для кабинета и администратора). */
  grantsOf(userId: string): CreditGrant[] {
    return this.store.allOf(userId);
  }

  /**
   * Свой грант тарифа, когда платежа за него нет: Free — раз в 30 дней; платный тариф без живого
   * гранта тарифа (VIP, выдан администратором, подписчик на момент перехода) — на 30 дней.
   * Потраченный грант не возобновляется раньше срока: срок отсчитывается от выдачи.
   */
  private ensureGrants(userId: string, plan: PlanId, now: number): void {
    this.migrateLegacy(userId, now);
    const live = this.store.liveOf(userId, now);
    const day = Math.floor(now / DAY_MS);
    if (plan === 'free') {
      if (live.some((grant) => grant.kind === 'free')) return;
      this.store.grant(
        {
          id: `free:${userId}:${day}`,
          userId,
          kind: 'free',
          planId: 'free',
          amountUsd: planCreditsUsd('free'),
          expiresAt: new Date(now + PERIOD_DAYS * DAY_MS).toISOString(),
        },
        now,
      );
      return;
    }
    if (live.some((grant) => grant.kind === 'plan' || grant.kind === 'auto')) return;
    this.store.grant(
      {
        id: `auto:${userId}:${plan}:${day}`,
        userId,
        kind: 'auto',
        planId: plan,
        amountUsd: planCreditsUsd(plan),
        expiresAt: new Date(now + PERIOD_DAYS * DAY_MS).toISOString(),
      },
      now,
    );
  }

  /** Остаток докупленных пакетов старой системы переходит в кредиты с тем же сроком. */
  private migrateLegacy(userId: string, now: number): void {
    if (!this.legacy || this.migrated.has(userId)) return;
    this.migrated.add(userId);
    for (const credit of this.legacy.filter((item) => item.userId === userId)) {
      if (credit.status !== 'active' || !(credit.remainingUsd > 0)) continue;
      if (Date.parse(credit.expiresAt) <= now) continue;
      this.store.grant(
        {
          id: `legacy:${credit.id}`,
          userId,
          kind: 'pack',
          paymentId: credit.id,
          amountUsd: credit.remainingUsd,
          expiresAt: credit.expiresAt,
          note: credit.packId,
        },
        now,
      );
    }
  }

  /**
   * Кредиты за оплаченный тариф: основной грант на оплаченный период и ещё 30 дней (перенос остатка)
   * и, при оплате криптой, бонусный грант на тот же срок. Повторная доставка платежа ничего не
   * создаёт: id гранта совпадает с id платежа.
   */
  grantForPayment(
    payment: { id: string; userId: string; method: string },
    plan: PlanId,
    renewsAt: string | null,
    now = Date.now(),
  ): { plan: CreditGrant; bonus: CreditGrant | null } {
    const periodEnd = renewsAt ? Date.parse(renewsAt) : NaN;
    const expiresAt = new Date(
      (Number.isFinite(periodEnd) && periodEnd > now ? periodEnd : now + PERIOD_DAYS * DAY_MS) +
        CARRY_DAYS * DAY_MS,
    ).toISOString();
    const main = this.store.grant(
      {
        id: payment.id,
        userId: payment.userId,
        kind: 'plan',
        planId: plan,
        paymentId: payment.id,
        amountUsd: planCreditsUsd(plan),
        expiresAt,
      },
      now,
    ).grant;
    const bonusCredits = payment.method === 'crypto' ? cryptoBonusCredits(plan) : 0;
    const bonus =
      bonusCredits > 0
        ? this.store.grant(
            {
              id: `${payment.id}:bonus`,
              userId: payment.userId,
              kind: 'bonus',
              planId: plan,
              paymentId: payment.id,
              amountUsd: toUsd(bonusCredits),
              expiresAt,
            },
            now,
          ).grant
        : null;
    return { plan: main, bonus };
  }

  /** Ручная выдача кредитов администратором (`days` — срок действия). */
  grantManually(
    input: { userId: string; credits: number; days: number; note?: string },
    now = Date.now(),
  ): CreditGrant {
    return this.store.grant(
      {
        id: `admin:${input.userId}:${now}`,
        userId: input.userId,
        kind: 'admin',
        amountUsd: toUsd(input.credits),
        expiresAt: new Date(now + input.days * DAY_MS).toISOString(),
        note: input.note,
      },
      now,
    ).grant;
  }
}

// ─────────────────────────────────────────────────────────────
// Отчёт для интерфейса: «сколько кредитов и сколько запросов осталось»
// ─────────────────────────────────────────────────────────────

export interface CreditsReportDeps {
  credits: CreditLedger & Pick<CreditService, 'grantsOf'>;
  usageStore: UsageStore;
  registry?: ModelRegistry;
}

export interface ModelCreditPrice {
  id: string;
  name: string;
  /** Примерная цена одного запроса в кредитах (с десятыми у дешёвых моделей); 0 у бесплатных. */
  requestCredits: number;
  priceSource: 'observed' | 'estimate';
  /** Бесплатная модель: отвечает и кредитов не тратит. */
  free: boolean;
  /** Сколько запросов примерно хватит остатка; null у бесплатных моделей (кредиты не тратятся). */
  remaining: number | null;
  /** Хватает ли остатка хотя бы на один запрос. */
  affordable: boolean;
}

export interface CreditsReport {
  plan: PlanId;
  reasoningMode: ReasoningMode;
  /** Остаток, кредиты. */
  balance: number;
  /** Сколько кредитов тариф выдаёт в месяц. */
  monthly: number;
  stage: CreditStage;
  /** Кредиты на исходе (меньше 15% месячной выдачи, но ещё есть). */
  low: boolean;
  /** Когда сгорает ближайший грант и сколько кредитов в нём. */
  nextExpiresAt: string | null;
  nextExpiring: number;
  /** Когда тариф выдаст новые кредиты (конец текущего периода); null, если выдача не запланирована. */
  refreshAt: string | null;
  /** Действующие гранты: откуда кредиты и когда они сгорают. */
  grants: Array<{
    id: string;
    kind: CreditGrant['kind'];
    amount: number;
    remaining: number;
    expiresAt: string;
  }>;
  /** Бесплатная модель, которая отвечает, когда кредиты кончились. */
  freeModel: { id: string; name: string } | null;
  models: ModelCreditPrice[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

function observedOrEstimate(
  model: ModelRegistryEntry,
  mode: ReasoningMode,
  usageStore: UsageStore,
): { usd: number; source: 'observed' | 'estimate' } {
  const observed = usageStore.getObservedRequestCost(model.id);
  if (observed !== null) return { usd: observed, source: 'observed' };
  return { usd: requestPriceUsd(model, mode), source: 'estimate' };
}

/** Остаток кредитов и цена запроса по каждой модели, доступной на тарифе. */
export function buildCreditsReport(
  userId: string,
  plan: PlanId,
  deps: CreditsReportDeps,
  requestedMode?: ReasoningMode,
  now = Date.now(),
): CreditsReport {
  const registry = deps.registry ?? modelRegistry;
  const mode = effectiveReasoningMode(requestedMode, plan);
  const balance = deps.credits.balance(userId, plan, now);
  const monthly = EntitlementService.getEntitlements(plan).monthlyCredits;

  const models = registry
    .getAll()
    .filter((model) => model.id !== 'auto' && planAllowsModel(plan, model.requiredPlan))
    .map((model): ModelCreditPrice => {
      if (isFreeModel(model)) {
        return {
          id: model.id,
          name: model.name,
          requestCredits: 0,
          priceSource: 'estimate',
          free: true,
          remaining: null,
          affordable: true,
        };
      }
      const price = observedOrEstimate(model, mode, deps.usageStore);
      const perRequest = Math.max(price.usd, 1e-6);
      return {
        id: model.id,
        name: model.name,
        requestCredits: round1(price.usd * CREDITS_PER_USD),
        priceSource: price.source,
        free: false,
        remaining: Math.floor(balance.remainingUsd / perRequest),
        affordable: balance.remainingUsd >= requestPriceUsd(model, mode),
      };
    });

  const freeModel = registry.get(FREE_CHAT_MODEL_ID);
  const stage = creditStageOf(balance.remainingUsd);
  const grants = deps.credits.grantsOf(userId);
  return {
    plan,
    reasoningMode: mode,
    balance: toCredits(balance.remainingUsd),
    monthly,
    stage,
    low: stage === 'normal' && balance.remainingUsd < toUsd(monthly) * LOW_CREDITS_RATIO,
    nextExpiresAt: balance.nextExpiresAt,
    nextExpiring: toCredits(balance.nextExpiringUsd),
    refreshAt: refreshAtOf(grants, now),
    grants: grants
      .filter(
        (grant) =>
          grant.status === 'active' && grant.remainingUsd > 0 && Date.parse(grant.expiresAt) > now,
      )
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
      .map((grant) => ({
        id: grant.id,
        kind: grant.kind,
        amount: toCredits(grant.amountUsd),
        remaining: toCredits(grant.remainingUsd),
        expiresAt: grant.expiresAt,
      })),
    freeModel: freeModel?.enabled ? { id: freeModel.id, name: freeModel.name } : null,
    models,
  };
}

/**
 * Конец текущего периода тарифа — когда придут новые кредиты. У Free и гранта без платежа это срок
 * гранта, у оплаченного тарифа — срок минус месяц переноса (платёж продлевает период).
 */
function refreshAtOf(grants: CreditGrant[], now: number): string | null {
  const ends = grants
    .filter((grant) => grant.status === 'active')
    .flatMap((grant) => {
      if (grant.kind === 'free' || grant.kind === 'auto') return [Date.parse(grant.expiresAt)];
      if (grant.kind === 'plan') return [Date.parse(grant.expiresAt) - CARRY_DAYS * DAY_MS];
      return [];
    })
    .filter((end) => Number.isFinite(end) && end > now);
  return ends.length > 0 ? new Date(Math.min(...ends)).toISOString() : null;
}

/** Цена типичного запроса к модели в кредитах (для оценок вне отчёта). */
export function typicalRequestCredits(model: ModelRegistryEntry, mode: ReasoningMode): number {
  return round1(requestPriceUsd(model, mode) * CREDITS_PER_USD);
}
