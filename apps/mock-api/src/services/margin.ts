/**
 * Худший случай по марже: сколько может стоить нам один платящий пользователь за 30 дней.
 *
 * Пользователь выбирает весь бюджет тарифа и доходит до жёсткого предела (125% `costBudget`,
 * дальше запросы отклоняются, services/budget-policy.ts), каждый доллар расхода на модели стоит
 * $1.055 (комиссия пополнения OpenRouter), и на него приходится доля Free-тира. Выше предела
 * расход не растёт: после 100% бюджета отвечает только Ketner Mini, агент и картинки ограничены
 * остатком до 125%, а расход, оплаченный кредитами пакетов, в бюджет тарифа не входит.
 *
 * По этим суммам считается минимальная цена в звёздах (telegram/bot.ts → planStars, packStars),
 * а services/currency.test.ts проверяет, что ни один тариф и пакет не убыточен ни в одном канале.
 */

import type { PlanId } from '../types.js';
import { BUDGET_HARD_STOP_RATIO } from './budget-policy.js';
import { EntitlementService } from './entitlement.js';
import {
  breakEvenStars,
  FREE_TIER_SUBSIDY_USD,
  modelSpendCostUsd,
  type PremiumPack,
} from './pricing.js';

/** Худший расход на платящего за 30 дней ($): предел бюджета с комиссией и доля Free-тира. */
export function planWorstCaseCostUsd(
  planId: PlanId,
  options: { cryptoBonus?: boolean } = {},
): number {
  const { costBudget } = EntitlementService.getEntitlements(planId, options);
  return modelSpendCostUsd(costBudget * BUDGET_HARD_STOP_RATIO) + FREE_TIER_SUBSIDY_USD;
}

/**
 * Худший расход на пакет ($): квота, выбранная целиком, с комиссией OpenRouter. Запрос, которому не
 * хватило кредитов, дописывается в расход тарифа и ограничен его бюджетом.
 */
export function packWorstCaseCostUsd(pack: PremiumPack): number {
  return modelSpendCostUsd(pack.quotaUsd);
}

/** Минимальная цена тарифа в звёздах: дешевле — тариф может уйти в минус. */
export function planMinStars(planId: PlanId): number {
  return breakEvenStars(planWorstCaseCostUsd(planId));
}

/** Минимальная цена пакета в звёздах. */
export function packMinStars(pack: PremiumPack): number {
  return breakEvenStars(packWorstCaseCostUsd(pack));
}
