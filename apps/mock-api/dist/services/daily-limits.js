/**
 * Суточные лимиты запросов по моделям.
 *
 * Помимо месячного бюджета себестоимости и квоты премиум-запросов у каждой модели тарифа может быть
 * свой суточный лимит: сколько раз за скользящие 24 часа пользователь может получить ответ именно
 * от неё. Когда лимит исчерпан, отвечает запасная модель из реестра (`fallbackModelId`): дешевле,
 * но по возможности близкая по качеству; когда исчерпан и её лимит — следующая, ещё дешевле.
 * Замена видна в `selectedModel` и `routingReason`, скрытой подмены нет.
 *
 * Лимиты заданы тарифу и модели: нет записи — модель без суточного лимита. Старые тарифы
 * (gpt-pro, claude-pro, gemini-pro) получают лимиты Pro.
 *
 * Запрос в режиме Max (только Ultra) у модели с профилем размышлений поднимает глубину medium → xhigh,
 * стоит примерно в 2.4 раза дороже и считается за 2 (UsageRecord.limitUnits).
 *
 * Как выбирались числа (полный расчёт: docs/models-and-pricing.md). Типичный запрос — 7.6k токенов
 * входа, выход 2k при medium и 7k при xhigh.
 *
 * Plus: бюджет $2.75, квота премиум-моделей $1.30. Лимит Sol 2 в сутки: 60 × $0.027 ≈ $1.64 в месяц,
 * дальше квота сама переключает на work-модели.
 *
 * Pro и Ultra: лимит модели = квота премиум-моделей тарифа / 30 дней / цена запроса этой модели,
 * то есть если пользоваться одной моделью каждый день до лимита, квоты хватает примерно на месяц.
 * Квота общая: несколько моделей сразу расходуют её быстрее, и тогда отвечают модели класса work.
 *   Pro   (квота $7 → $0.23 в день): Opus $0.070 → 3, Sonnet и Sol $0.035 → 6, Astra $0.176 → 1,
 *         Grok xhigh $0.057 → 4, Terra xhigh $0.099 → 2.
 *   Ultra (квота $15 → $0.50 в день): Opus 7, Sonnet и Sol 14, Astra 3, Grok 8, Terra 5.
 * Худший случай (пользователь выбирает все лимиты каждый день) ограничен месячным бюджетом и его
 * стадиями 80% / 100% / 125%: маржа Pro ≈ 34%, Ultra ≈ 36% с учётом Free-тира, не ниже 24% и 30%
 * на жёстком пределе.
 */
/** Лимиты: тариф → id модели → запросов за скользящие 24 часа. */
export const DAILY_MODEL_LIMITS = {
    plus: {
        'gpt-6.1-sol': 2,
        'ketner-pro': 20,
        'gemini-3.7-flash': 5,
        'gpt-5.6-luna-pro': 10,
        'qwen3.8-27b': 12,
    },
    pro: {
        'gpt-6-astra': 1,
        'claude-opus-5.5': 3,
        'gpt-5.6-terra': 2,
        'claude-sonnet-5.5': 6,
        'gpt-5.6-sol': 6,
        'gemini-4-argon': 6,
        'grok-4.7': 4,
        // Модели Plus на Pro: тот же принцип, запас больше.
        'gpt-6.1-sol': 6,
        'gemini-3.8-flash': 15,
        'gemini-3.7-flash': 15,
        'ketner-pro': 60,
        'gpt-5.6-luna-pro': 30,
        'qwen3.8-27b': 40,
    },
    ultra: {
        'gpt-6-astra': 3,
        'claude-opus-5.5': 7,
        'gpt-5.6-terra': 5,
        'claude-sonnet-5.5': 14,
        'gpt-5.6-sol': 14,
        'gemini-4-argon': 14,
        'grok-4.7': 8,
        'gpt-6.1-sol': 14,
        'gemini-3.8-flash': 40,
        'gemini-3.7-flash': 40,
        'ketner-pro': 150,
        'gpt-5.6-luna-pro': 80,
        'qwen3.8-27b': 100,
    },
};
/** Старые тарифы с доступом уровня Pro пользуются лимитами Pro. */
const PLAN_ALIASES = {
    'gpt-pro': 'pro',
    'claude-pro': 'pro',
    'gemini-pro': 'pro',
};
function limitsOf(plan) {
    if (!plan)
        return undefined;
    return DAILY_MODEL_LIMITS[PLAN_ALIASES[plan] ?? plan];
}
/** Суточный лимит модели на тарифе или null, если лимита нет. */
export function getDailyModelLimit(plan, modelId) {
    const limit = limitsOf(plan)?.[modelId];
    return typeof limit === 'number' && limit >= 0 ? limit : null;
}
/** Все суточные лимиты тарифа (для /api/meta и интерфейса). */
export function getDailyModelLimits(plan) {
    return { ...(limitsOf(plan) ?? {}) };
}
