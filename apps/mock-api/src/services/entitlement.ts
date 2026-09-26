/**
 * Централизованная служба проверки прав доступа (Entitlement Service).
 *
 * Определяет правила доступа к моделям, лимиты контекста, параллелизма и
 * допустимые объёмы использования для каждого тарифного плана.
 */

import type { PlanId } from '../types.js';
import type { PlanEntitlements } from '../ai/gateway-types.js';
import type { ModelRegistryEntry } from '../ai/gateway-types.js';

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
    tokensPerHour: 50_000,
    tokensPerDay: 150_000,
    maxContextMessages: 20,
    contextLimit: 20,
    maxTokens: 1024,
    streamingEnabled: true,
    maxDailyCost: 0.1,
    costBudget: 0.5,
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
    maxDailyCost: 3.0,
    costBudget: 6.0,
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
    maxDailyCost: 10.0,
    costBudget: 15.0,
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
    maxDailyCost: 30.0,
    costBudget: 40.0,
  },
  // Legacy alias для обратной совместимости (получают права уровня Pro)
  'gpt-pro': {
    planId: 'gpt-pro',
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
    maxDailyCost: 10.0,
    costBudget: 15.0,
  },
  'claude-pro': {
    planId: 'claude-pro',
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
    maxDailyCost: 10.0,
    costBudget: 15.0,
  },
  'gemini-pro': {
    planId: 'gemini-pro',
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
    maxDailyCost: 10.0,
    costBudget: 15.0,
  },
};

export class EntitlementService {
  /**
   * Разрешить эффективный план пользователя.
   * VIP аккаунты (artemsinyakov09@gmail.com) получают тариф 'ultra'.
   */
  static resolveEffectivePlan(userPlan?: PlanId, userEmail?: string): PlanId {
    if (userEmail && userEmail.toLowerCase() === 'artemsinyakov09@gmail.com') {
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
   * Проверить, имеет ли пользователь доступ к модели.
   */
  static checkModelAccess(
    model: ModelRegistryEntry,
    userPlan: PlanId,
    userEmail?: string,
  ): { allowed: boolean; reason?: string; requiredPlan?: string } {
    const effectivePlan = this.resolveEffectivePlan(userPlan, userEmail);

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
