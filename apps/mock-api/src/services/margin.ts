/**
 * Худший случай по марже: сколько может стоить нам один платящий пользователь за 30 дней.
 *
 * Пользователь выбирает весь бюджет тарифа и доходит до жёсткого предела (125% `costBudget`,
 * дальше запросы отклоняются, services/budget-policy.ts), каждый доллар расхода на модели стоит
 * $1.055 (комиссия пополнения OpenRouter), и на него приходится доля Free-тира. Выше предела
 * расход не растёт: после 100% бюджета отвечает только Ketner Mini, агент и картинки ограничены
 * остатком до 125%, а расход, оплаченный кредитами пакетов, в бюджет тарифа не входит.
 *
 * Карта и крипта проверяются с долей Free-тира. Звёзды — без неё: тариф в звёздах продаётся по
 * официальному курсу Telegram ровно за цену тарифа (решение владельца), и с верхней оценкой доли
 * Free-тира ($3.01) худший случай звёзд был бы в минусе; сейчас Free идёт на бесплатные эндпоинты,
 * и реальная доля близка к нулю. Минимальная цена в звёздах (telegram/bot.ts → planStars,
 * packStars) защищает от убытка, если курс в STARS_USD_RATE задан слишком дорогим.
 * services/currency.test.ts проверяет оба расчёта.
 */

import type { PlanId } from '../types.js';
import { BUDGET_HARD_STOP_RATIO } from './budget-policy.js';
import { EntitlementService } from './entitlement.js';
import { breakEvenStars, FREE_TIER_SUBSIDY_USD, modelSpendCostUsd } from './pricing.js';

/** Худший расход на платящего за 30 дней ($): предел бюджета с комиссией и доля Free-тира. */
export function planWorstCaseCostUsd(
  planId: PlanId,
  options: { cryptoBonus?: boolean } = {},
): number {
  const { costBudget } = EntitlementService.getEntitlements(planId, options);
  return modelSpendCostUsd(costBudget * BUDGET_HARD_STOP_RATIO) + FREE_TIER_SUBSIDY_USD;
}

/** Худший расход на платящего звёздами ($): предел бюджета с комиссией, без доли Free-тира. */
export function planStarsWorstCaseCostUsd(planId: PlanId): number {
  return modelSpendCostUsd(
    EntitlementService.getEntitlements(planId).costBudget * BUDGET_HARD_STOP_RATIO,
  );
}

/** Минимальная цена тарифа в звёздах: дешевле — тариф в худшем случае уйдёт в минус. */
export function planMinStars(planId: PlanId): number {
  return breakEvenStars(planStarsWorstCaseCostUsd(planId));
}
