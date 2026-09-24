/**
 * Каталог моделей заглушки.
 *
 * Ответы у моделей одинаковые — различаются подпись и лимит контекста.
 * На реальном провайдере этот список заменится ответом `GET /api/meta`
 * (см. docs/ai-integration-todo.md).
 */
export const DEFAULT_MODEL_ID = 'ketner-mini';
export const MODELS = [
    {
        id: DEFAULT_MODEL_ID,
        name: 'Qwen 2.5 Coder',
        contextMessages: 20,
        isPro: false,
    },
    {
        id: 'gpt-6-astra',
        name: 'GPT-6 Astra *',
        contextMessages: 120,
        isPro: true,
        requiredPlan: 'gpt-pro',
    },
    {
        id: 'claude-fable',
        name: 'Claude Fable 5.5 *',
        contextMessages: 120,
        isPro: true,
        requiredPlan: 'claude-pro',
    },
    {
        id: 'gemini-pro',
        name: 'Gemini 3.8 Pro *',
        contextMessages: 120,
        isPro: true,
        requiredPlan: 'gemini-pro',
    },
    {
        id: 'ketner-pro',
        name: 'Qwen 2.5 Max *',
        contextMessages: 60,
        isPro: true,
        requiredPlan: 'ultra',
    },
];
export const PLAN_LIMITS = {
    free: { messagesPerDay: 10, contextMessages: 20 },
    'gpt-pro': { messagesPerDay: null, contextMessages: 120 },
    'claude-pro': { messagesPerDay: null, contextMessages: 120 },
    'gemini-pro': { messagesPerDay: null, contextMessages: 120 },
    ultra: { messagesPerDay: null, contextMessages: 500 },
    plus: { messagesPerDay: null, contextMessages: 60 },
    pro: { messagesPerDay: null, contextMessages: 120 },
};
export const MODEL_CATALOG = {
    models: [...MODELS],
    defaultModelId: DEFAULT_MODEL_ID,
    limits: PLAN_LIMITS,
};
/** Проверка доступности модели по текущему тарифу пользователя. */
export function canAccessModel(userPlan, model) {
    if (!model.isPro)
        return true;
    if (!userPlan || userPlan === 'free')
        return false;
    if (userPlan === 'ultra')
        return true;
    if (model.requiredPlan && userPlan === model.requiredPlan)
        return true;
    if (model.id === 'ketner-pro' && (userPlan === 'plus' || userPlan === 'pro'))
        return true;
    return false;
}
/** Неизвестный идентификатор модели не ломает запрос: берём модель по умолчанию. */
export function resolveModel(modelId) {
    return MODELS.find((model) => model.id === modelId) ?? MODELS[0];
}
