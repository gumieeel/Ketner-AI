/**
 * Единый источник цен: пакеты кредитов (CREDIT_PACKS) и цены прежних подписок, по которым
 * доживают действующие подписчики.
 *
 * Каноническая валюта — доллар: именно эти цены показаны на сайте, их же берут Stripe и
 * CryptoCloud. Рубли нужны только для СБП (сумма перевода в банке), Stars считаются отдельно
 * в `telegram/bot.ts` (`planStars`, `packStars`: по официальному курсу, но не ниже точки безубыточности).
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
 * Субсидия Free-тира на одного платящего подписчика, оценка сверху: конверсия 5%, средний расход Free
 * $0.15 ($0.15 × 19 бесплатных на платящего, с комиссией OpenRouter). Нужна только расчётам прежних
 * подписок; пакеты считаются без неё, пробные кредиты — отдельно (`TRIAL_COST_USD`).
 */
export const FREE_TIER_SUBSIDY_USD = 3.01;

/**
 * Самое большее, что стоит нам один пробный кредит (200 кредитов, потрачены целиком, с комиссией
 * OpenRouter): ≈ $0.21 на каждого зарегистрированного. Окупается долей зарегистрированных, которые
 * потом покупают пакет: см. `trialBreakEvenConversion` (services/margin.ts).
 */
export const TRIAL_COST_USD = 0.2 * (1 + OPENROUTER_TOPUP_FEE);

// ─────────────────────────────────────────────────────────────
// Пакеты кредитов — единственный способ платить (подписки сняты с продажи 26.10.2026)
// ─────────────────────────────────────────────────────────────

/**
 * Пакет кредитов: `credits` кредитов за `priceUsd`. Чем больше пакет, тем дешевле тысяча кредитов
 * (скидка к ставке пакета $5: $10 −2%, $25 −3.4%, $50 −5.4%, $100 −20%). Кредиты действуют
 * `CREDIT_PACK_VALID_DAYS` дней, при оплате криптой к ним добавляется бонус `CRYPTO_PACK_BONUS_RATE`.
 *
 * Маржа считается от худшего случая (потрачены все кредиты и бонус), налога 6%, комиссии OpenRouter
 * 5.5% и выплаты Telegram $0.013 за звезду (services/margin.ts, проверка в currency.test.ts):
 *
 *   пакет   кредитов   $/1000   звёзды   маржа ⭐   крипта (с бонусом)   карта
 *   $5       2 300     2.17      260     ≈ 15%        ≈ 36%            ≈ 36%
 *   $10      4 700     2.13      510     ≈ 13%        ≈ 35%            ≈ 38%
 *   $25     11 900     2.10     1 260    ≈ 11%        ≈ 34%            ≈ 39%
 *   $50     24 300     2.06     2 510    ≈ 10%        ≈ 33%            ≈ 38%
 *   $100    57 500     1.74     5 010    ≈ 1%         ≈ 22%            ≈ 29%
 *
 * Пакет $100 со скидкой 20% решение владельца: в звёздах он почти на нуле, но остаётся в плюсе.
 */
export interface CreditPack {
  id: string;
  priceUsd: number;
  credits: number;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: 'credits-5', priceUsd: 5, credits: 2_300 },
  { id: 'credits-10', priceUsd: 10, credits: 4_700 },
  { id: 'credits-25', priceUsd: 25, credits: 11_900 },
  { id: 'credits-50', priceUsd: 50, credits: 24_300 },
  { id: 'credits-100', priceUsd: 100, credits: 57_500 },
];

/** Сколько дней действуют купленные кредиты (дольше — меньше обязательств перед покупателем, короче — стимул тратить). */
export const CREDIT_PACK_VALID_DAYS = 365;

/** Бонус за оплату пакета криптовалютой: доля от кредитов пакета, отдельный грант на тот же срок. */
export const CRYPTO_PACK_BONUS_RATE = 0.15;

export function findCreditPack(id: unknown): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

/** Бонусные кредиты за оплату пакета криптовалютой (округление до 5 кредитов). */
export function packCryptoBonusCredits(pack: Pick<CreditPack, 'credits'>): number {
  return Math.round((pack.credits * CRYPTO_PACK_BONUS_RATE) / 5) * 5;
}

/** Сколько долларов стоит тысяча кредитов пакета. */
export function packPricePerThousand(pack: CreditPack): number {
  return (pack.priceUsd / pack.credits) * 1000;
}
