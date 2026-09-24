/**
 * Каталог моделей заглушки.
 *
 * Ответы у моделей одинаковые — различаются подпись и лимит контекста.
 * На реальном провайдере этот список заменится ответом `GET /api/meta`
 * (см. docs/ai-integration-todo.md).
 */
export const DEFAULT_MODEL_ID = 'ketner-mini';
export const MODELS = [
    { id: DEFAULT_MODEL_ID, name: 'Ketner mini', contextMessages: 20 },
    { id: 'ketner-pro', name: 'Ketner pro', contextMessages: 60 },
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
/** Неизвестный идентификатор модели не ломает запрос: берём модель по умолчанию. */
export function resolveModel(modelId) {
    return MODELS.find((model) => model.id === modelId) ?? MODELS[0];
}
