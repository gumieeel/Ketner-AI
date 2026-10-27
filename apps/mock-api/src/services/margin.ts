/**
 * Худший случай по марже: сколько может стоить нам один платящий пользователь за 30 дней.
 *
 * Пользователь тратит все кредиты тарифа (и бонус за крипту, если платил ей): больше кредитов нет,
 * дальше отвечает бесплатная модель, которая ничего не стоит. Каждый доллар расхода на модели стоит
 * $1.055 (комиссия пополнения OpenRouter), и на него приходится доля Free-тира. Остаток переносится
 * на один период, но за новый период пользователь платит снова, поэтому выдача не складывается:
 * в месяц с деньгами потрачено не больше одной выдачи плюс перенос из уже оплаченного.
 *
 * Карта и крипта проверяются с долей Free-тира. Звёзды — без неё: тариф в звёздах продаётся по
 * официальному курсу Telegram ровно за цену тарифа (решение владельца), и с верхней оценкой доли
 * Free-тира ($3.01) худший случай звёзд был бы в минусе; сейчас Free идёт на бесплатные эндпоинты,
 * и реальная доля близка к нулю. Минимальная цена в звёздах (telegram/bot.ts → planStars,
 * packStars) защищает от убытка, если курс в STARS_USD_RATE задан слишком дорогим.
 * services/currency.test.ts проверяет оба расчёта.
 */

import type { PlanId } from '../types.js';
import { cryptoBonusCredits, planCreditsUsd, toUsd } from './entitlement.js';
import {
  breakEvenStars,
  FREE_TIER_SUBSIDY_USD,
  modelSpendCostUsd,
  PAYMENT_NET_SHARE,
  packCryptoBonusCredits,
  STARS_OFFICIAL_USD_PER_STAR,
  starsNetUsd,
  TAX_RATE,
  TRIAL_COST_USD,
  type CreditPack,
} from './pricing.js';

/** Худший расход на платящего за 30 дней ($): все кредиты с комиссией и доля Free-тира. */
export function planWorstCaseCostUsd(
  planId: PlanId,
  options: { cryptoBonus?: boolean } = {},
): number {
  const credits =
    planCreditsUsd(planId) + (options.cryptoBonus ? toUsd(cryptoBonusCredits(planId)) : 0);
  return modelSpendCostUsd(credits) + FREE_TIER_SUBSIDY_USD;
}

/** Худший расход на платящего звёздами ($): все кредиты с комиссией, без доли Free-тира. */
export function planStarsWorstCaseCostUsd(planId: PlanId): number {
  return modelSpendCostUsd(planCreditsUsd(planId));
}

/** Минимальная цена тарифа в звёздах: дешевле — тариф в худшем случае уйдёт в минус. */
export function planMinStars(planId: PlanId): number {
  return breakEvenStars(planStarsWorstCaseCostUsd(planId));
}

// ─────────────────────────────────────────────────────────────
// Пакеты кредитов
// ─────────────────────────────────────────────────────────────

/** Каналы оплаты: звёзды Telegram, криптовалюта (Trybit), карта (Stripe). */
export type PackChannel = 'stars' | 'crypto' | 'card';

/** Цена пакета в звёздах по официальному курсу, вверх до 10 звёзд. */
export function packListStars(pack: CreditPack): number {
  return Math.ceil(pack.priceUsd / STARS_OFFICIAL_USD_PER_STAR / 10) * 10;
}

/** Худший расход на покупателя пакета ($): потрачены все кредиты (и бонус за крипту) с комиссией OpenRouter. */
export function packWorstCaseCostUsd(
  pack: CreditPack,
  options: { cryptoBonus?: boolean } = {},
): number {
  const credits = pack.credits + (options.cryptoBonus ? packCryptoBonusCredits(pack) : 0);
  return modelSpendCostUsd(toUsd(credits));
}

/** Минимальная цена пакета в звёздах: дешевле пакет в худшем случае уйдёт в минус. */
export function packMinStars(pack: CreditPack): number {
  return breakEvenStars(packWorstCaseCostUsd(pack));
}

/** Чистая выручка с пакета после налога и комиссий канала, $. */
export function packNetUsd(pack: CreditPack, channel: PackChannel, stars?: number): number {
  switch (channel) {
    case 'stars':
      return starsNetUsd(stars ?? packListStars(pack));
    case 'crypto':
      return pack.priceUsd * PAYMENT_NET_SHARE.crypto * (1 - TAX_RATE);
    case 'card':
      return pack.priceUsd * (1 - TAX_RATE) - (pack.priceUsd * 0.039 + 0.3);
  }
}

/** Прибыль с пакета в худшем случае ($): чистая выручка минус все потраченные кредиты. */
export function packProfitUsd(pack: CreditPack, channel: PackChannel, stars?: number): number {
  return (
    packNetUsd(pack, channel, stars) -
    packWorstCaseCostUsd(pack, { cryptoBonus: channel === 'crypto' })
  );
}

/**
 * Какая доля зарегистрированных должна купить такой пакет, чтобы пробные кредиты (потрачены
 * целиком у всех) окупились прибылью с пакетов. Меньше — пробный кредит съедает прибыль.
 */
export function trialBreakEvenConversion(
  pack: CreditPack,
  channel: PackChannel,
  stars?: number,
): number {
  const profit = packProfitUsd(pack, channel, stars);
  return profit > 0 ? TRIAL_COST_USD / profit : Infinity;
}
