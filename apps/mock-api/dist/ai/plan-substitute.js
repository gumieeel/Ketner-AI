/**
 * Замена моделей по тарифу: на Free запросы идут на бесплатные эндпоинты OpenRouter (`:free`),
 * платная модель остаётся запасной. Это снимает с Free-тира почти весь расход на модели.
 *
 * Лимиты `:free` у OpenRouter общие на весь аккаунт (20 запросов в минуту, 1000 в день при
 * купленных кредитах от $10), поэтому при отказе бесплатной модели запрос уходит по цепочке
 * `fallbackModelId` на платный Ketner Mini, и худший случай по расходу остаётся прежним.
 */
/** Что на тарифе подставляется вместо модели: `{ тариф: { поверхность: { запрошенная: бесплатная } } }`. */
export const PLAN_MODEL_SUBSTITUTES = {
    free: {
        // Чат: универсальная модель для рассуждений (хорошо отвечает по-русски).
        chat: { 'ketner-mini': 'nemotron-ultra' },
        // Агент Ketner Code: модель, обученная работать с инструментами и кодом.
        code: { 'ketner-mini': 'north-mini-code' },
    },
};
export function applyPlanSubstitute(model, plan, surface, registry) {
    const substituteId = PLAN_MODEL_SUBSTITUTES[plan]?.[surface]?.[model.id];
    const substitute = substituteId ? registry.get(substituteId) : undefined;
    if (!substitute || !substitute.enabled)
        return { model, reason: null };
    return {
        model: substitute,
        reason: `Free plan: ${substitute.name} (free OpenRouter endpoint) answers instead of ${model.name}`,
    };
}
