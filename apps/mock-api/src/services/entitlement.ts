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
  // Legacy Pro: 1199 ₽ ≈ $12.62, бюджет $5.00 ≈ 40%.
  maxDailyCost: 0.60,
  costBudget: 5.00,
  premiumBudget: 1.80,
};

/**
 * Экономика тарифов (курс 95 ₽/$, расходы считаются за скользящие 30 дней).
 *
 * costBudget — потолок расхода на модели, ≈40% цены тарифа: остальное идёт на эквайринг (~4%),
 * налоги (~6%), комиссию OpenRouter за пополнение (5.5% от расхода), инфраструктуру и прибыль.
 * premiumBudget — часть costBudget на премиум-модели (классы strong и top, см. ModelCostClass).
 * Ориентиры по запросам в месяц при 7.6k токенов на входе и 0.7k на выходе:
 *   Plus  $0.60 ≈ 18 запросов GPT-6.1 Sol;
 *   Pro   $3.00 ≈ 90 запросов Sol или 36 запросов Claude Opus 5.5;
 *   Ultra $5.50 ≈ 160 запросов Sol или 66 запросов Opus.
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
    // Free: GPT-6 Luna без размышлений ≈ $0.001–0.0013 за запрос → 10 сообщений в день ≈ $0.3–0.4
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
    // Plus: 990 ₽ ≈ $10.42 → бюджет $4.00 (38%).
    maxDailyCost: 0.40,
    costBudget: 4.00,
    premiumBudget: 0.60,
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
    // Pro: 1990 ₽ ≈ $20.95 → бюджет $8.50 (41%).
    maxDailyCost: 1.00,
    costBudget: 8.50,
    premiumBudget: 3.00,
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
    // Ultra: 2990 ₽ ≈ $31.47 → бюджет $12.50 (40%). Раньше стояло $11.50, посчитанное на цену 2499 ₽.
    maxDailyCost: 1.50,
    costBudget: 12.50,
    premiumBudget: 5.50,
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
