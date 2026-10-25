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
import { breakEvenStars, FREE_TIER_SUBSIDY_USD, modelSpendCostUsd } from './pricing.js';

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
