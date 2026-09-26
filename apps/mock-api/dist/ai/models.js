/**
 * Каталог моделей заглушки.
 *
 * Ответы у моделей одинаковые — различаются подпись и лимит контекста.
 * На реальном провайдере этот список заменится ответом `GET /api/meta`
 * (см. docs/ai-integration-todo.md).
 */
export const DEFAULT_MODEL_ID = 'auto';
export const MODELS = [
    // Plus (990 ₽) — стандартные модели
    {
        id: 'gpt-4o-mini',
        name: 'GPT-4o mini',
        contextMessages: 40,
        isPro: true,
        requiredPlan: 'plus',
    },
    {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextMessages: 60,
        isPro: true,
        requiredPlan: 'plus',
    },
    {
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        contextMessages: 40,
        isPro: true,
        requiredPlan: 'plus',
    },
    // Pro (1 990 ₽) — флагманские модели
    {
        id: 'gpt-6-astra',
        name: 'GPT-6 Astra *',
        contextMessages: 120,
        isPro: true,
        requiredPlan: 'pro',
    },
    {
        id: 'claude-fable',
        name: 'Claude Fable 5.5 *',
        contextMessages: 120,
        isPro: true,
        requiredPlan: 'pro',
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro *',
        contextMessages: 120,
        isPro: true,
        requiredPlan: 'pro',
    },
];
import { getPlanLimits } from '../services/entitlement.js';
export const PLAN_LIMITS = getPlanLimits();
export const AUTO_MODEL = {
    id: 'auto',
    name: '✨ Auto (Smart Router)',
    contextMessages: 120,
    isPro: false,
};
export const MODEL_CATALOG = {
    models: [AUTO_MODEL, ...MODELS],
    defaultModelId: DEFAULT_MODEL_ID,
    limits: PLAN_LIMITS,
};
/** Проверка доступности модели по текущему тарифу пользователя. */
export function canAccessModel(userPlan, model) {
    if (model.id === 'auto')
        return true;
    if (!model.isPro)
        return true;
    if (!userPlan || userPlan === 'free')
        return false;
    if (userPlan === 'ultra')
        return true;
    if (model.requiredPlan === 'plus') {
        return userPlan === 'plus' || userPlan === 'pro';
    }
    if (model.requiredPlan === 'pro') {
        return (userPlan === 'pro' ||
            userPlan === 'gpt-pro' ||
            userPlan === 'claude-pro' ||
            userPlan === 'gemini-pro');
    }
    if (model.requiredPlan && userPlan === model.requiredPlan)
        return true;
    return false;
}
/** Неизвестный идентификатор модели не ломает запрос: берём модель по умолчанию. */
export function resolveModel(modelId) {
    if (modelId === 'auto' || !modelId) {
        return AUTO_MODEL;
    }
    return MODELS.find((model) => model.id === modelId) ?? AUTO_MODEL;
}
