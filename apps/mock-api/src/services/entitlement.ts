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
  // Legacy Pro: 1199 ₽ ≈ $12.62, бюджет $5.00 ≈ 40% (новых оплат по старой цене нет).
  maxDailyCost: 0.60,
  costBudget: 5.00,
  premiumBudget: 1.80,
};

/**
 * Экономика тарифов. Цены в долларах: Plus $9, Pro $25, Ultra $49 (services/pricing.ts).
 * Расходы считаются за скользящие 30 дней. Полный расчёт: docs/models-and-pricing.md.
 *
 * costBudget — потолок расхода на модели за 30 дней. Это 31% цены у Plus и 40–41% у Pro и Ultra:
 * из остального идут налог (~6%), эквайринг (Stripe ≈ 4% + $0.30, крипта ≈ 2%, Telegram Stars
 * отдаёт только ≈ $0.013 за звезду, то есть ≈ 72% цены), комиссия OpenRouter за пополнение
 * (5.5% от расхода), субсидия Free-тира (≈ $3 на платящего при конверсии 5%) и прибыль.
 * Поведение при подходе к потолку: 80% — экономный режим, 100% — только лёгкие модели,
 * 125% — отказ (services/budget-policy.ts), поэтому 1.25 × costBudget — жёсткий предел расхода.
 *
 * premiumBudget — часть costBudget на премиум-модели (классы strong и top, см. ModelCostClass).
 * Ориентиры по запросам в месяц при 7.6k токенов на входе:
 *   Plus  $1.30 ≈ 49 запросов GPT-6.1 Sol (низкая глубина размышлений; в сутки Sol ограничен 2 запросами);
 *   Pro   $7.00 ≈ 200 запросов Sonnet 5.5 или 100 запросов Opus 5.5 (medium);
 *   Ultra $15.00 ≈ 213 запросов Opus (medium) или 88 в режиме Max (xhigh).
 * Квота — главный ресурс Pro и Ultra, поэтому она больше половины бюджета (до 75%). Остаток costBudget
 * ($3 и $5) — на Ketner Pro и лёгкие модели: при $0.005 за запрос это 600–1 000 запросов. Общий бюджет
 * не менялся, поэтому худший случай по марже тот же. Суточные лимиты моделей: services/daily-limits.ts.
 *
 * Тест services/currency.test.ts проверяет, что при любых изменениях бюджетов тариф остаётся
 * прибыльным в худшем случае (пользователь выбрал весь бюджет, платит через Stripe).
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
    // при отказе общего пула OpenRouter. Худший случай: GPT-6 Luna без размышлений ≈ $0.001–0.0013 за запрос → 10 сообщений в день ≈ $0.3–0.4
    // в месяц в худшем случае; средний пользователь тратит в 3–5 раз меньше. Премиум-моделей нет.
    maxDailyCost: 0.03,
    costBudget: 0.30,
    premiumBudget: 0,
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
    // Plus: $9 → бюджет $2.75 (31%): самый тесный тариф, из-за Free-субсидии и комиссии Stripe $0.30.
    maxDailyCost: 0.35,
    costBudget: 2.75,
    // Премиум-квота $1.30 (потолок: половина costBudget, см. currency.test): ≈ 49 запросов Sol в месяц
    // при лимите 2 в сутки. Общий costBudget не менялся, поэтому худший случай по марже прежний.
    premiumBudget: 1.30,
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
    // Pro: $25 → бюджет $10.00 (40%), из них $7 — квота премиум-моделей. Дневной потолок $2.20 не ниже
    // бюджета одного запуска агента ($2): иначе задача на GPT-6 Astra обрывалась бы на полпути.
    // Месячный бюджет прежний, поэтому худший случай по марже не меняется.
    maxDailyCost: 2.2,
    costBudget: 10.0,
    premiumBudget: 7.0,
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
    // Ultra: $49 → бюджет $20.00 (41%), из них $15 — квота премиум-моделей (режим Max тратит её быстрее).
    // Дневной потолок $4.40 не ниже бюджета запуска агента ($3).
    maxDailyCost: 4.4,
    costBudget: 20.0,
    premiumBudget: 15.0,
  },
  // ── Legacy-планы для обратной совместимости ──
  'gpt-pro': { planId: 'gpt-pro', ...LEGACY_PRO_BASE },
  'claude-pro': { planId: 'claude-pro', ...LEGACY_PRO_BASE },
  'gemini-pro': { planId: 'gemini-pro', ...LEGACY_PRO_BASE },
};

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

  /**
   * Получить права доступа для тарифа.
   */
  static getEntitlements(planId: PlanId): PlanEntitlements {
    return PLAN_ENTITLEMENTS[planId] ?? PLAN_ENTITLEMENTS.free;
  }

  /**
   * Phase 3: Динамический пересчёт или обновление costBudget тарифа по эмпирическим данным.
   */
  static updatePlanCostBudget(planId: PlanId, newBudget: number): void {
    if (PLAN_ENTITLEMENTS[planId]) {
      PLAN_ENTITLEMENTS[planId].costBudget = Math.max(0.01, newBudget);
    }
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
      messagesPerDay: ent.userFacingDailyMessages !== undefined ? ent.userFacingDailyMessages : null,
    };
  }
  return result;
}
