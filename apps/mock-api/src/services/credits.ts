/**
 * Кредиты: один пул на чат, картинки и Ketner Code.
 *
 * 1 кредит = $0.001 реальной себестоимости запроса (то, что провайдер берёт с нас). Запрос списывает
 * ровно свою стоимость, поэтому короткий вопрос к Ketner Mini стоит около 1 кредита, а большой запрос
 * к Claude Opus — сотни. Кредиты покупают пакетами (services/pricing.ts → CREDIT_PACKS), они действуют
 * год; на списании первыми идут те, что сгорают раньше. Каждому пользователю один раз выдаются
 * пробные кредиты (`TRIAL_CREDITS`). Подписчикам прежней системы тариф по-прежнему выдаёт кредиты на
 * 30 дней (грант `plan` / `auto`), пока подписка действует.
 *
 * Здесь лежит всё, что нужно шлюзу, агенту, картинкам и интерфейсу: начисления, остаток, списание и
 * отчёт «сколько запросов осталось».
 */

import type { ModelRegistryEntry, ReasoningMode } from '../ai/gateway-types.js';
import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import { effectiveReasoningMode } from '../ai/reasoning-policy.js';
import type { DocStore } from '../store/doc-store.js';
import {
  ACCESS_GRANT_KINDS,
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
  EXHAUSTED_BELOW_USD,
  FREE_CHAT_MODEL_ID,
  isFreeModel,
  requestPriceUsd,
  type CreditStage,
} from './credit-policy.js';
import {
  CREDITS_PER_USD,
  cryptoBonusCredits,
  planAllowsModel,
  planCreditsUsd,
  toCredits,
  toUsd,
  TRIAL_CREDITS,
} from './entitlement.js';
import { CREDIT_PACK_VALID_DAYS, packCryptoBonusCredits, type CreditPack } from './pricing.js';

/** Длина оплаченного периода подписки и срок переноса остатка, дней (прежние подписки). */
export const PERIOD_DAYS = 30;
export const CARRY_DAYS = 30;
/** Сколько дней действуют пробные кредиты с момента выдачи. */
export const TRIAL_DAYS = 30;
/** С этой доли выданных кредитов интерфейс предупреждает, что кредиты на исходе. */
export const LOW_CREDITS_RATIO = 0.15;

export { CREDITS_PER_USD, planCreditsUsd, toCredits, toUsd, TRIAL_CREDITS };

/** Что шлюзу, агенту и картинкам нужно от кредитов. */
export interface CreditLedger {
  /** Остаток пользователя; выдаёт пробные кредиты и грант подписки без платежа, если пора. */
  balance(userId: string, plan: PlanId, now?: number): CreditBalance;
  /** Списать до `amountUsd`; возвращает, сколько реально списано. */
  charge(userId: string, amountUsd: number, now?: number): number;
  /** Остались ли купленные кредиты: пока да, у пользователя полный уровень доступа. */
  hasPurchased?(userId: string, now?: number): boolean;
}

export class CreditService implements CreditLedger {
  private readonly migrated = new Set<string>();
  /** Вызывается после каждого списания (письмо «кредиты на исходе», этап C). */
  onCharged: ((userId: string) => void) | null = null;

  constructor(
    readonly store: CreditStore,
    private readonly legacy?: DocStore<LegacyPremiumCredit>,
  ) {}

  balance(userId: string, plan: PlanId, now = Date.now()): CreditBalance {
    this.ensureGrants(userId, plan, now);
    return this.store.balanceOf(userId, now);
  }

  charge(userId: string, amountUsd: number, now = Date.now()): number {
    const charged = this.store.debit(userId, amountUsd, now);
    if (charged > 0 && this.onCharged) {
      try {
        this.onCharged(userId);
      } catch (error) {
        console.error('[credits] обработчик списания упал', error);
      }
    }
    return charged;
  }

  hasPurchased(userId: string, now = Date.now()): boolean {
    return this.store.hasPurchased(userId, now);
  }

  /** Все гранты пользователя (для кабинета и администратора). */
  grantsOf(userId: string): CreditGrant[] {
    return this.store.allOf(userId);
  }

  /**
   * Свои гранты, когда платежа за них нет. Free и покупатели кредитов получают пробные кредиты один
   * раз (идентификатор гранта привязан к пользователю, повторно он не создаётся; срок — 30 дней с
   * выдачи). Подписчик прежней системы без живого гранта подписки (VIP, выдан администратором,
   * подписчик на момент перехода) получает грант на 30 дней, который обновляется, пока подписка
   * действует. Потраченный грант не возобновляется раньше срока: срок отсчитывается от выдачи.
   */
  private ensureGrants(userId: string, plan: PlanId, now: number): void {
    this.migrateLegacy(userId, now);
    if (plan === 'free' || plan === 'credits') {
      this.store.grant(
        {
          id: `trial:${userId}`,
          userId,
          kind: 'free',
          planId: 'free',
          amountUsd: toUsd(TRIAL_CREDITS),
          expiresAt: new Date(now + TRIAL_DAYS * DAY_MS).toISOString(),
          note: 'trial',
        },
        now,
      );
      return;
    }
    const monthly = planCreditsUsd(plan);
    if (!(monthly > 0)) return;
    const live = this.store.liveOf(userId, now);
    if (live.some((grant) => grant.kind === 'plan' || grant.kind === 'auto')) return;
    const day = Math.floor(now / DAY_MS);
    this.store.grant(
      {
        id: `auto:${userId}:${plan}:${day}`,
        userId,
        kind: 'auto',
        planId: plan,
        amountUsd: monthly,
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

  /**
   * Кредиты за купленный пакет: основной грант на год и, при оплате криптой, бонусный грант на тот же
   * срок. Повторная доставка платежа ничего не создаёт: id гранта совпадает с id платежа.
   */
  grantForPack(
    payment: { id: string; userId: string; method: string },
    pack: CreditPack,
    now = Date.now(),
  ): { pack: CreditGrant; bonus: CreditGrant | null } {
    const expiresAt = new Date(now + CREDIT_PACK_VALID_DAYS * DAY_MS).toISOString();
    const main = this.store.grant(
      {
        id: payment.id,
        userId: payment.userId,
        kind: 'pack',
        paymentId: payment.id,
        amountUsd: toUsd(pack.credits),
        expiresAt,
        note: pack.id,
      },
      now,
    ).grant;
    const bonusCredits = payment.method === 'crypto' ? packCryptoBonusCredits(pack) : 0;
    const bonus =
      bonusCredits > 0
        ? this.store.grant(
            {
              id: `${payment.id}:bonus`,
              userId: payment.userId,
              kind: 'bonus',
              paymentId: payment.id,
              amountUsd: toUsd(bonusCredits),
              expiresAt,
              note: pack.id,
            },
            now,
          ).grant
        : null;
    return { pack: main, bonus };
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
  /** Сколько кредитов выдано по действующим грантам (знаменатель шкалы остатка). */
  granted: number;
  /** Пробные кредиты, которые получает каждый пользователь один раз. */
  trialCredits: number;
  /** Есть ли неистраченные купленные кредиты (открывают полный уровень доступа). */
  purchased: boolean;
  stage: CreditStage;
  /** Кредиты на исходе (меньше 15% выданных, но ещё есть). */
  low: boolean;
  /** Когда сгорает ближайший грант и сколько кредитов в нём. */
  nextExpiresAt: string | null;
  nextExpiring: number;
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
  const live = grants.filter(
    (grant) => grant.status === 'active' && Date.parse(grant.expiresAt) > now,
  );
  const grantedUsd = live.reduce((sum, grant) => sum + grant.amountUsd, 0);
  const active = live.filter((grant) => grant.remainingUsd > 0);
  return {
    plan,
    reasoningMode: mode,
    balance: toCredits(balance.remainingUsd),
    granted: toCredits(grantedUsd),
    trialCredits: TRIAL_CREDITS,
    purchased: active.some(
      (grant) => ACCESS_GRANT_KINDS.has(grant.kind) && grant.remainingUsd >= EXHAUSTED_BELOW_USD,
    ),
    stage,
    low: stage === 'normal' && balance.remainingUsd < grantedUsd * LOW_CREDITS_RATIO,
    nextExpiresAt: balance.nextExpiresAt,
    nextExpiring: toCredits(balance.nextExpiringUsd),
    grants: active
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

/** Цена типичного запроса к модели в кредитах (для оценок вне отчёта). */
export function typicalRequestCredits(model: ModelRegistryEntry, mode: ReasoningMode): number {
  return round1(requestPriceUsd(model, mode) * CREDITS_PER_USD);
}
