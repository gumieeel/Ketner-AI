/**
 * Централизованная служба проверки прав доступа (Entitlement Service).
 *
 * Определяет правила доступа к моделям, лимиты контекста, параллелизма и
 * допустимые объёмы использования для каждого тарифного плана.
 */

import type { PlanId, PlanLimits } from '../types.js';
import type { PlanEntitlements } from '../ai/gateway-types.js';
import type { ModelRegistryEntry } from '../ai/gateway-types.js';
import { isVipEmail } from './vip.js';

/**
 * Ранг тарифа для проверки доступа: модель доступна, если ранг тарифа не ниже `requiredPlan` модели.
 * Устаревшие планы gpt-pro / claude-pro / gemini-pro равны Pro. Неизвестный план считается Free.
 */
const PLAN_RANKS: Record<string, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  'gpt-pro': 2,
  'claude-pro': 2,
  'gemini-pro': 2,
  ultra: 3,
};

export function planRank(plan: string | null | undefined): number {
  return plan ? (PLAN_RANKS[plan] ?? 0) : 0;
}

/** Единое правило доступа к модели по тарифу (его используют реестр, шлюз и /api/meta). */
export function planAllowsModel(
  userPlan: string | null | undefined,
  requiredPlan: string | null | undefined,
): boolean {
  if (!requiredPlan) return true;
  return planRank(userPlan) >= planRank(requiredPlan);
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  ultra: 'Ultra',
};

/** Общие параметры для устаревших legacy-планов (gpt-pro, claude-pro, gemini-pro). */
const LEGACY_PRO_BASE: Omit<PlanEntitlements, 'planId'> = {
  maxConcurrency: 4,
  priority: 2,
  fairUseLevel: 2,
  requestsPerMinute: 40,
  requestsPerHour: 300,
  requestsPerDay: 1500,
  tokensPerHour: 1_500_000,
  tokensPerDay: 6_000_000,
  maxContextMessages: 120,
  contextLimit: 120,
  maxTokens: 12288,
  streamingEnabled: true,
  // Legacy Pro: 1199 ₽ ≈ $12.62, 5 000 кредитов ($5.00) ≈ 40% (новых оплат по старой цене нет).
  monthlyCredits: 5_000,
};

/**
 * Экономика тарифов. Цены в долларах: Plus $9, Pro $25, Ultra $49 (services/pricing.ts).
 * Полный расчёт: docs/models-and-pricing.md.
 *
 * Тариф даёт кредиты на 30 дней (`monthlyCredits`), один пул на чат, картинки и Ketner Code.
 * 1 кредит = $0.001 реальной себестоимости (services/credits.ts): запрос списывает ровно столько,
 * сколько он стоил провайдеру. Кредитов дано на 33% цены у Plus и 44–45% у Pro и Ultra: из остального
 * идут налог (~6%), эквайринг (Stripe ≈ 4% + $0.30, крипта ≈ 2%, Telegram Stars отдаёт ≈ 65% цены),
 * комиссия OpenRouter за пополнение (5.5% от расхода), субсидия Free-тира и прибыль. Кредиты
 * кончились — отвечает бесплатная модель, кредиты не тратятся, платные модели недоступны до обновления.
 * Остаток не сгорает в конце периода и переносится на один следующий период.
 *
 * Остальные поля — технические лимиты честного использования (запросы в минуту/час/сутки, токены,
 * параллелизм): они защищают сервис от злоупотреблений и на расход кредитов не влияют.
 *
 * Тест services/currency.test.ts проверяет, что при любых изменениях выдачи тариф не уходит в
 * минус в худшем случае (потрачены все кредиты, доля Free-тира) ни в одном канале оплаты
 * (services/margin.ts).
 */
export const PLAN_ENTITLEMENTS: Record<PlanId, PlanEntitlements> = {
  free: {
    planId: 'free',
    maxConcurrency: 1,
    priority: 0,
    fairUseLevel: 0,
    requestsPerMinute: 5,
    requestsPerHour: 10,
    // Пользователю обещано 10 сообщений в день, и сервер действительно держит этот лимит.
    requestsPerDay: 10,
    userFacingDailyMessages: 10,
    tokensPerHour: 50_000,
    tokensPerDay: 150_000,
    maxContextMessages: 20,
    contextLimit: 20,
    maxTokens: 2048,
    streamingEnabled: true,
    // Free идёт на бесплатные :free-эндпоинты (ai/plan-substitute.ts), платный GPT-6 Luna — только запасной
    // при отказе общего пула OpenRouter. 300 кредитов ($0.30) — это худший случай: 10 сообщений в день
    // на GPT-6 Luna стоят ≈ $0.3–0.4 в месяц, средний пользователь тратит в 3–5 раз меньше.
    monthlyCredits: 300,
  },
  plus: {
    planId: 'plus',
    maxConcurrency: 2,
    priority: 1,
    fairUseLevel: 1,
    requestsPerMinute: 20,
    requestsPerHour: 100,
    requestsPerDay: 500,
    tokensPerHour: 300_000,
    tokensPerDay: 1_500_000,
    maxContextMessages: 60,
    contextLimit: 60,
    maxTokens: 6144,
    streamingEnabled: true,
    // Plus: $9 → 3 000 кредитов ($3.00, 33%): самый тесный тариф, из-за Free-субсидии и комиссии Stripe
    // $0.30. В худшем случае (все кредиты потрачены, Stripe, Free-тир по старой оценке $3.01) маржа ≈ 18%.
    monthlyCredits: 3_000,
  },
  pro: {
    planId: 'pro',
    maxConcurrency: 4,
    priority: 2,
    fairUseLevel: 2,
    requestsPerMinute: 40,
    requestsPerHour: 300,
    requestsPerDay: 1500,
    tokensPerHour: 1_500_000,
    tokensPerDay: 6_000_000,
    maxContextMessages: 120,
    contextLimit: 120,
    maxTokens: 12288,
    streamingEnabled: true,
    // Pro: $25 → 11 000 кредитов ($11.00, 44%). Худший случай (Stripe, Free-тир): маржа ≈ 30%.
    // Одного запуска агента ($2, services/code-limits.ts) хватает за счёт кредитов с запасом.
    monthlyCredits: 11_000,
  },
  ultra: {
    planId: 'ultra',
    maxConcurrency: 8,
    priority: 3,
    fairUseLevel: 3,
    requestsPerMinute: 80,
    requestsPerHour: 600,
    requestsPerDay: 4000,
    tokensPerHour: 4_000_000,
    tokensPerDay: 20_000_000,
    maxContextMessages: 500,
    contextLimit: 500,
    maxTokens: 16384,
    streamingEnabled: true,
    // Ultra: $49 → 22 000 кредитов ($22.00, 44.9%). Режим Max тратит кредиты быстрее: модели думают
    // глубже. Худший случай (Stripe, Free-тир): маржа ≈ 36%.
    monthlyCredits: 22_000,
  },
  // ── Legacy-планы для обратной совместимости ──
  'gpt-pro': { planId: 'gpt-pro', ...LEGACY_PRO_BASE },
  'claude-pro': { planId: 'claude-pro', ...LEGACY_PRO_BASE },
  'gemini-pro': { planId: 'gemini-pro', ...LEGACY_PRO_BASE },
};

/**
 * Бонус за оплату тарифа криптовалютой (Trybit): отдельный грант кредитов на тот же срок, что и
 * основной. Размер — 15% от прежней квоты премиум-моделей: Plus +200, Pro +1 200, Ultra +2 480.
 *
 * Откуда деньги: Telegram Stars отдаёт ≈ 65% цены, крипта ≈ 98% (services/pricing.ts →
 * PAYMENT_NET_SHARE). Бонус стоит не больше $2.48 × 1.055 ≈ $2.62 (Ultra), а разница комиссий — около
 * 33% цены (Pro ≈ $8, Ultra ≈ $16): оплата криптой с бонусом остаётся выгоднее для нас, чем оплата
 * звёздами без него. Проверка: services/currency.test.ts.
 */
export const CRYPTO_BONUS_CREDITS: Readonly<Record<string, number>> = {
  plus: 200,
  pro: 1_200,
  ultra: 2_480,
  'gpt-pro': 270,
  'claude-pro': 270,
  'gemini-pro': 270,
};

/** Сколько бонусных кредитов даёт оплата тарифа криптой (0 — бонуса нет). */
export function cryptoBonusCredits(planId: PlanId | string): number {
  return CRYPTO_BONUS_CREDITS[planId] ?? 0;
}

/** Сколько кредитов в одном долларе себестоимости: 1 кредит = $0.001. */
export const CREDITS_PER_USD = 1000;

/** Кредиты (целые) из долларов себестоимости. */
export const toCredits = (usd: number): number => Math.floor(usd * CREDITS_PER_USD + 1e-6);
/** Доллары себестоимости из кредитов. */
export const toUsd = (credits: number): number => credits / CREDITS_PER_USD;

/** Месячная выдача тарифа, $ себестоимости. */
export function planCreditsUsd(planId: PlanId | string): number {
  return toUsd((PLAN_ENTITLEMENTS[planId as PlanId] ?? PLAN_ENTITLEMENTS.free).monthlyCredits);
}

export class EntitlementService {
  /**
   * Разрешить эффективный план пользователя.
   * VIP аккаунты получают тариф 'ultra' (по флагу isVip или email из config.vipEmails).
   */
  static resolveEffectivePlan(userPlan?: PlanId, userEmail?: string, isVip?: boolean): PlanId {
    if (isVip || isVipEmail(userEmail)) {
      return 'ultra';
    }
    return userPlan ?? 'free';
  }

  /** Получить права доступа для тарифа (неизвестный тариф считается Free). */
  static getEntitlements(planId: PlanId): PlanEntitlements {
    return PLAN_ENTITLEMENTS[planId] ?? PLAN_ENTITLEMENTS.free;
  }

  /**
   * Динамическое получение лимитов планов для обратной совместимости и /api/meta.
   * PLAN_ENTITLEMENTS является единственным источником правды.
   */
  static getPlanLimits(): Record<PlanId, PlanLimits> {
    return getPlanLimits();
  }

  /**
   * Проверить, имеет ли пользователь доступ к модели: по `requiredPlan` модели и рангу тарифа.
   */
  static checkModelAccess(
    model: ModelRegistryEntry,
    userPlan: PlanId,
    userEmail?: string,
    isVip?: boolean,
  ): { allowed: boolean; reason?: string; requiredPlan?: string } {
    const effectivePlan = this.resolveEffectivePlan(userPlan, userEmail, isVip);

    if (!model.requiredPlan || planAllowsModel(effectivePlan, model.requiredPlan)) {
      return { allowed: true };
    }

    const label = PLAN_LABELS[model.requiredPlan] ?? model.requiredPlan;
    return {
      allowed: false,
      reason: `Доступ к модели ${model.name} требует подписки ${label} или выше.`,
      requiredPlan: label,
    };
  }
}

/**
 * Формирование PlanLimits динамически на основе PLAN_ENTITLEMENTS (Single Source of Truth).
 */
export function getPlanLimits(): Record<PlanId, PlanLimits> {
  const result = {} as Record<PlanId, PlanLimits>;
  for (const [planId, ent] of Object.entries(PLAN_ENTITLEMENTS) as [PlanId, PlanEntitlements][]) {
    result[planId] = {
      contextMessages: ent.maxContextMessages,
      messagesPerDay:
        ent.userFacingDailyMessages !== undefined ? ent.userFacingDailyMessages : null,
    };
  }
  return result;
}
