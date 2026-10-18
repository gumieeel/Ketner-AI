/**
 * Единый источник цен подписок.
 *
 * Каноническая валюта — доллар: именно эти цены показаны на сайте, их же берут Stripe и
 * CryptoCloud. Рубли нужны только для СБП (сумма перевода в банке), Stars считаются отдельно
 * в `telegram/bot.ts` (`planStars`, `packStars`: по курсу, но не ниже точки безубыточности).
 *
 * Бюджеты расходов на модели в `services/entitlement.ts` рассчитаны от этих цен
 * (см. docs/models-and-pricing.md). Меняя цену, пересчитайте и бюджеты.
 */

import type { PlanId } from '../types.js';

/** Цена в долларах в месяц. Ultra продаётся со скидкой с $59 (старая цена нужна только витрине). */
export const PLAN_PRICE_USD = {
  free: 0,
  plus: 9,
  pro: 25,
  ultra: 49,
} as const;

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
} as const;

/**
 * Старые тарифы (gpt-pro, claude-pro, gemini-pro) по возможностям равны Pro, но продавались
 * по 1199 ₽ (≈ $12.62). Новых продаж по старой цене нет, но счета для действующих подписчиков
 * выставляются по прежней сумме.
 */
export const LEGACY_PRICE_RUB = 1199;
export const LEGACY_PRICE_USD = 12.62;

type PricedPlanId = keyof typeof PLAN_PRICE_USD;

function isCatalogPlan(planId: PlanId | string): planId is PricedPlanId {
  return planId in PLAN_PRICE_USD;
}

export function planPriceUsd(planId: PlanId | string): number {
  return isCatalogPlan(planId) ? PLAN_PRICE_USD[planId] : LEGACY_PRICE_USD;
}

export function planPriceRub(planId: PlanId | string): number {
  return isCatalogPlan(planId) ? PLAN_PRICE_RUB[planId] : LEGACY_PRICE_RUB;
}

/** Сумма для Stripe в центах. */
export function planPriceCents(planId: PlanId | string): number {
  return Math.round(planPriceUsd(planId) * 100);
}

// ─────────────────────────────────────────────────────────────
// Экономика: комиссии и доли выручки (на них опираются бюджеты тарифов, пакеты и тесты)
// ─────────────────────────────────────────────────────────────

/** Налог с выручки. */
export const TAX_RATE = 0.06;
/** Комиссия OpenRouter за пополнение баланса: каждый доллар расхода на модели стоит $1.055. */
export const OPENROUTER_TOPUP_FEE = 0.055;
/**
 * Официальная цена звёзд в Telegram — справочный прайс покупки в приложении: 1 000 ⭐ = $19.99.
 * По нему считается цена в звёздах и её эквивалент в долларах на сайте и в боте
 * (telegram/stars-rate.ts). Рыночный курс Fragment и перекупщиков только для сравнения: по нему
 * звёзд выходило больше, и тариф в звёздах стоил дороже, чем картой (Pro 1 670 ⭐ — не меньше $31
 * даже у перекупщиков). Переопределяется переменной STARS_USD_RATE.
 */
export const STARS_OFFICIAL_USD_PER_STAR = 19.99 / 1000;

/**
 * Сколько Telegram платит разработчику за одну звезду при выводе через Fragment, $. Выплата
 * фиксирована, а цена звёзд для покупателя выше, поэтому цена в звёздах не опускается ниже точки
 * безубыточности (services/margin.ts).
 */
export const STARS_PAYOUT_USD = 0.013;

/**
 * Какая доля цены доходит до нас по каналу оплаты (до налога). Звёзды: выплата за звезду / её
 * официальная цена, $0.013 / $0.01999 ≈ 65% (Telegram и магазины приложений оставляют себе ≈ 35%);
 * Trybit (крипта) берёт ≈ 2%.
 */
export const PAYMENT_NET_SHARE = {
  stars: STARS_PAYOUT_USD / STARS_OFFICIAL_USD_PER_STAR,
  crypto: 0.98,
} as const;
/** Себестоимость $1 расхода на модели с учётом комиссии пополнения OpenRouter. */
export function modelSpendCostUsd(spendUsd: number): number {
  return spendUsd * (1 + OPENROUTER_TOPUP_FEE);
}

/** Сколько долларов доходит до нас с `stars` звёзд после налога. */
export function starsNetUsd(stars: number): number {
  return stars * STARS_PAYOUT_USD * (1 - TAX_RATE);
}

/** Минимум звёзд, выручка с которых после налога покрывает `costUsd` (вверх до 10). */
export function breakEvenStars(costUsd: number): number {
  if (!(costUsd > 0)) return 0;
  return Math.ceil(costUsd / (STARS_PAYOUT_USD * (1 - TAX_RATE)) / 10) * 10;
}

/**
 * Субсидия Free-тира на одного платящего, оценка сверху: конверсия 5%, средний расход Free $0.15
 * ($0.15 × 19 бесплатных на платящего, с комиссией OpenRouter). Сейчас Free идёт на бесплатные
 * эндпоинты OpenRouter, так что реальная субсидия ближе к нулю.
 */
export const FREE_TIER_SUBSIDY_USD = 3.01;

// ─────────────────────────────────────────────────────────────
// Пакеты премиум-квоты — СНЯТЫ С ПРОДАЖИ 18.10.2026
// ─────────────────────────────────────────────────────────────

/**
 * Пакет докупки: `quotaUsd` долларов премиум-квоты за `priceUsd`, кредиты действуют
 * `PREMIUM_PACK_DAYS` дней. Новые пакеты не продаются (POST create-invoice с `packId` → 410).
 * Каталог остаётся, пока живы старые записи: счета, выставленные до 18.10.2026 и оплаченные позже,
 * кредиты (тратятся до 17.11.2026), возвраты и названия платежей в истории. После 17.11.2026
 * можно удалить каталог, premium-credit-store и ветки `packId` в billing-service, bot и routes.
 */
export interface PremiumPack {
  id: string;
  quotaUsd: number;
  priceUsd: number;
}

export const PREMIUM_PACKS: readonly PremiumPack[] = [
  { id: 'premium-3', quotaUsd: 3, priceUsd: 6 },
  { id: 'premium-5', quotaUsd: 5, priceUsd: 9 },
  { id: 'premium-10', quotaUsd: 10, priceUsd: 18 },
];

/** Срок действия кредитов пакета. */
export const PREMIUM_PACK_DAYS = 30;
/** Себестоимость пакета — не больше этой доли его цены. */
export const PACK_MAX_COST_SHARE = 0.6;

export function findPremiumPack(id: unknown): PremiumPack | undefined {
  return PREMIUM_PACKS.find((pack) => pack.id === id);
}
