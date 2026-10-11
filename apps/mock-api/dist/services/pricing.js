/**
 * Единый источник цен подписок.
 *
 * Каноническая валюта — доллар: именно эти цены показаны на сайте, их же берут Stripe и
 * CryptoCloud. Рубли нужны только для СБП (сумма перевода в банке), Stars считаются отдельно
 * в `telegram/bot.ts` (`calculateStars`).
 *
 * Бюджеты расходов на модели в `services/entitlement.ts` рассчитаны от этих цен
 * (см. docs/models-and-pricing.md). Меняя цену, пересчитайте и бюджеты.
 */
/** Цена в долларах в месяц. Ultra продаётся со скидкой с $59 (старая цена нужна только витрине). */
export const PLAN_PRICE_USD = {
    free: 0,
    plus: 9,
    pro: 25,
    ultra: 49,
};
/** Ultra: цена без скидки, показывается на сайте зачёркнутой. */
export const ULTRA_LIST_PRICE_USD = 59;
/**
 * Сумма перевода по СБП в рублях: цена в долларах по курсу около 99 ₽ с округлением до «красивой».
 * Выручка в долларах при этом не ниже цены на сайте (при курсе 95 ₽/$: $9.37, $26.2, $51.5).
 */
export const PLAN_PRICE_RUB = {
    free: 0,
    plus: 890,
    pro: 2490,
    ultra: 4890,
};
/**
 * Старые тарифы (gpt-pro, claude-pro, gemini-pro) по возможностям равны Pro, но продавались
 * по 1199 ₽ (≈ $12.62). Новых продаж по старой цене нет, но счета для действующих подписчиков
 * выставляются по прежней сумме.
 */
export const LEGACY_PRICE_RUB = 1199;
export const LEGACY_PRICE_USD = 12.62;
function isCatalogPlan(planId) {
    return planId in PLAN_PRICE_USD;
}
export function planPriceUsd(planId) {
    return isCatalogPlan(planId) ? PLAN_PRICE_USD[planId] : LEGACY_PRICE_USD;
}
export function planPriceRub(planId) {
    return isCatalogPlan(planId) ? PLAN_PRICE_RUB[planId] : LEGACY_PRICE_RUB;
}
/** Сумма для Stripe в центах. */
export function planPriceCents(planId) {
    return Math.round(planPriceUsd(planId) * 100);
}
