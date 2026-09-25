/**
 * Централизованная служба проверки прав доступа (Entitlement Service).
 *
 * Определяет правила доступа к моделям, лимиты контекста, параллелизма и
 * допустимые объёмы использования для каждого тарифного плана.
 */
export const PLAN_ENTITLEMENTS = {
    free: {
        planId: 'free',
        allowedModels: ['ketner-mini'],
        maxConcurrency: 1,
        priority: 0,
        fairUseLevel: 0,
        requestsPerMinute: 5,
        requestsPerHour: 20,
        requestsPerDay: 50,
        tokensPerHour: 50_000,
        tokensPerDay: 150_000,
        maxContextMessages: 20,
        streamingEnabled: true,
        maxDailyCost: 0.1,
    },
    'gpt-pro': {
        planId: 'gpt-pro',
        allowedModels: ['ketner-mini', 'gpt-6-astra'],
        maxConcurrency: 3,
        priority: 1,
        fairUseLevel: 1,
        requestsPerMinute: 20,
        requestsPerHour: 150,
        requestsPerDay: 800,
        tokensPerHour: 500_000,
        tokensPerDay: 2_500_000,
        maxContextMessages: 120,
        streamingEnabled: true,
        maxDailyCost: 5.0,
    },
    'claude-pro': {
        planId: 'claude-pro',
        allowedModels: ['ketner-mini', 'claude-fable'],
        maxConcurrency: 3,
        priority: 1,
        fairUseLevel: 1,
        requestsPerMinute: 20,
        requestsPerHour: 150,
        requestsPerDay: 800,
        tokensPerHour: 500_000,
        tokensPerDay: 2_500_000,
        maxContextMessages: 120,
        streamingEnabled: true,
        maxDailyCost: 5.0,
    },
    'gemini-pro': {
        planId: 'gemini-pro',
        allowedModels: ['ketner-mini', 'gemini-pro'],
        maxConcurrency: 3,
        priority: 1,
        fairUseLevel: 1,
        requestsPerMinute: 20,
        requestsPerHour: 150,
        requestsPerDay: 800,
        tokensPerHour: 1_000_000,
        tokensPerDay: 5_000_000,
        maxContextMessages: 120,
        streamingEnabled: true,
        maxDailyCost: 5.0,
    },
    ultra: {
        planId: 'ultra',
        allowedModels: ['ketner-mini', 'gpt-6-astra', 'claude-fable', 'gemini-pro', 'ketner-pro'],
        maxConcurrency: 8,
        priority: 3,
        fairUseLevel: 3,
        requestsPerMinute: 60,
        requestsPerHour: 500,
        requestsPerDay: 3000,
        tokensPerHour: 3_000_000,
        tokensPerDay: 15_000_000,
        maxContextMessages: 500,
        streamingEnabled: true,
        maxDailyCost: 25.0,
    },
    // Legacy планы
    plus: {
        planId: 'plus',
        allowedModels: ['ketner-mini', 'ketner-pro'],
        maxConcurrency: 2,
        priority: 1,
        fairUseLevel: 1,
        requestsPerMinute: 20,
        requestsPerHour: 100,
        requestsPerDay: 500,
        tokensPerHour: 300_000,
        tokensPerDay: 1_500_000,
        maxContextMessages: 60,
        streamingEnabled: true,
        maxDailyCost: 3.0,
    },
    pro: {
        planId: 'pro',
        allowedModels: ['ketner-mini', 'ketner-pro'],
        maxConcurrency: 4,
        priority: 2,
        fairUseLevel: 2,
        requestsPerMinute: 30,
        requestsPerHour: 200,
        requestsPerDay: 1000,
        tokensPerHour: 1_000_000,
        tokensPerDay: 4_000_000,
        maxContextMessages: 120,
        streamingEnabled: true,
        maxDailyCost: 8.0,
    },
};
export class EntitlementService {
    /**
     * Разрешить эффективный план пользователя.
     * VIP аккаунты (artemsinyakov09@gmail.com) получают тариф 'ultra'.
     */
    static resolveEffectivePlan(userPlan, userEmail) {
        if (userEmail && userEmail.toLowerCase() === 'artemsinyakov09@gmail.com') {
            return 'ultra';
        }
        return userPlan ?? 'free';
    }
    /**
     * Получить права доступа для тарифа.
     */
    static getEntitlements(planId) {
        return PLAN_ENTITLEMENTS[planId] ?? PLAN_ENTITLEMENTS.free;
    }
    /**
     * Проверить, имеет ли пользователь доступ к модели.
     */
    static checkModelAccess(model, userPlan, userEmail) {
        const effectivePlan = this.resolveEffectivePlan(userPlan, userEmail);
        if (!model.isPro) {
            return { allowed: true };
        }
        if (effectivePlan === 'ultra') {
            return { allowed: true };
        }
        const entitlements = this.getEntitlements(effectivePlan);
        if (entitlements.allowedModels.includes(model.id)) {
            return { allowed: true };
        }
        if (model.requiredPlan && effectivePlan === model.requiredPlan) {
            return { allowed: true };
        }
        if (model.id === 'ketner-pro' && (effectivePlan === 'plus' || effectivePlan === 'pro')) {
            return { allowed: true };
        }
        const requiredName = model.requiredPlan ? model.requiredPlan.toUpperCase() : 'PRO';
        return {
            allowed: false,
            reason: `Доступ к модели ${model.name} требует подписки (${requiredName} или Ultra).`,
            requiredPlan: requiredName,
        };
    }
}
