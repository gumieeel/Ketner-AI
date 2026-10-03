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

const ALL_MODELS = [
  'ketner-mini',
  'nemotron-ultra',
  'glm-5.3-flash',
  'deepseek-v4.1-flash',
  'gpt-4o-mini',
  'gemini-2.5-flash',
  'claude-3-haiku',
  'gpt-6-astra',
  'claude-3.5-sonnet',
  'claude-fable',
  'gemini-2.5-pro',
  'gemini-pro',
  'ketner-pro',
  'auto',
];

/** Общие параметры для устаревших legacy-планов (gpt-pro, claude-pro, gemini-pro). */
const LEGACY_PRO_BASE: Omit<PlanEntitlements, 'planId'> = {
  allowedModels: ALL_MODELS,
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
  maxTokens: 8192,
  streamingEnabled: true,
  maxDailyCost: 0.60,
  costBudget: 5.00,
};

export const PLAN_ENTITLEMENTS: Record<PlanId, PlanEntitlements> = {
  free: {
    planId: 'free',
    allowedModels: [
      'ketner-mini',
      'nemotron-ultra',
      'glm-5.3-flash',
      'deepseek-v4.1-flash',
      'gpt-4o-mini',
      'gemini-2.5-flash',
      'claude-3-haiku',
      'auto',
    ],
    maxConcurrency: 1,
    priority: 0,
    fairUseLevel: 0,
    requestsPerMinute: 5,
    requestsPerHour: 20,
    requestsPerDay: 50,
    userFacingDailyMessages: 10,
    tokensPerHour: 50_000,
    tokensPerDay: 150_000,
    maxContextMessages: 20,
    contextLimit: 20,
    maxTokens: 2048,
    streamingEnabled: true,
    // Free: цена 0₽ ($0). Субсидируемый буфер для ознакомления ($0.20/мес, $0.05/день).
    maxDailyCost: 0.05,
    costBudget: 0.20,
  },
  plus: {
    planId: 'plus',
    allowedModels: [
      'ketner-mini',
      'nemotron-ultra',
      'glm-5.3-flash',
      'deepseek-v4.1-flash',
      'gpt-4o-mini',
      'gemini-2.5-flash',
      'claude-3-haiku',
      'ketner-pro',
      'auto',
    ],
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
    maxTokens: 4096,
    streamingEnabled: true,
    // Plus: цена 990₽ (~$10.42 при курсе 95).
    // Формула: costBudget <= priceMonthly_USD * 0.40 -> $10.42 * 0.384 = $4.00
    // Оставляет 61.6% на маржу, налоги, инфраструктуру и комиссию эквайринга.
    maxDailyCost: 0.40,
    costBudget: 4.00,
  },
  pro: {
    planId: 'pro',
    allowedModels: ALL_MODELS,
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
    maxTokens: 8192,
    streamingEnabled: true,
    // Pro: цена 1990₽ (~$20.95 при курсе 95).
    // Формула: costBudget <= priceMonthly_USD * 0.45 -> $20.95 * 0.405 = $8.50
    // Оставляет 59.5% на маржу, налоги, инфраструктуру и комиссию эквайринга.
    maxDailyCost: 1.00,
    costBudget: 8.50,
  },
  ultra: {
    planId: 'ultra',
    allowedModels: ALL_MODELS,
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
    // Ultra: цена 2499₽ (~$26.31 при курсе 95).
    // Формула: costBudget <= priceMonthly_USD * 0.45 -> $26.31 * 0.437 = $11.50 (снижено с убыточных $40!)
    // Оставляет 56.3% на маржу, налоги, инфраструктуру и комиссию эквайринга.
    maxDailyCost: 1.50,
    costBudget: 11.50,
  },
  // ── Legacy-планы для обратной совместимости (цена 1199₽ ~ $12.62, costBudget $5.00 ~ 39.6%) ──
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
   * Динамическое получение лимитов планов для обратной совместимости и /api/meta.
   * PLAN_ENTITLEMENTS является единственным источником правды.
   */
  static getPlanLimits(): Record<PlanId, PlanLimits> {
    return getPlanLimits();
  }

  /**
   * Проверить, имеет ли пользователь доступ к модели.
   */
  static checkModelAccess(
    model: ModelRegistryEntry,
    userPlan: PlanId,
    userEmail?: string,
    isVip?: boolean,
  ): { allowed: boolean; reason?: string; requiredPlan?: string } {
    const effectivePlan = this.resolveEffectivePlan(userPlan, userEmail, isVip);

    if (!model.isPro) {
      return { allowed: true };
    }

    // Флагманские модели (GPT-6 Astra, Claude 3.5 Sonnet, Claude Fable, Gemini 2.5 Pro)
    // требуют тарифа Pro или Ultra
    if (model.tier === 'flagship') {
      const isProOrUltra =
        effectivePlan === 'pro' ||
        effectivePlan === 'ultra' ||
        effectivePlan === 'gpt-pro' ||
        effectivePlan === 'claude-pro' ||
        effectivePlan === 'gemini-pro';

      if (isProOrUltra) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: `Доступ к флагманской модели ${model.name} требует подписки Pro или Ultra.`,
        requiredPlan: 'Pro',
      };
    }

    // Для остальных Pro-моделей (например Qwen 2.5 Max) достаточно тарифа Plus
    if (effectivePlan !== 'free') {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Доступ к модели ${model.name} требует подписки (Plus, Pro или Ultra).`,
      requiredPlan: 'Plus',
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
