/**
 * Сервис расчёта себестоимости AI запросов.
 *
 * Рассчитывает стоимость на основе тарифов модели ($ за 1M токенов):
 * - Входные токены (стандартные и кэшированные)
 * - Выходные токены (включая токены рассуждения)
 */

import type { ModelPricing } from '../ai/gateway-types.js';

export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number | null;
  reasoningTokens?: number | null;
}

export interface CostCalculationResult {
  inputCost: number;
  cachedInputCost: number;
  outputCost: number;
  totalCost: number;
}

export class CostCalculator {
  /**
   * Рассчитать стоимость по токенам и ценам модели.
   *
   * @param tokens Количество токенов
   * @param pricing Ценообразование модели ($ за 1M токенов)
   */
  static calculate(tokens: TokenBreakdown, pricing: ModelPricing): CostCalculationResult {
    const cachedTokens = Math.min(tokens.inputTokens, Math.max(0, tokens.cachedTokens ?? 0));
    const nonCachedInputTokens = Math.max(0, tokens.inputTokens - cachedTokens);

    const inputCost = (nonCachedInputTokens / 1_000_000) * pricing.inputPricePerMillion;
    const cachedInputCost = (cachedTokens / 1_000_000) * pricing.cachedInputPricePerMillion;
    const outputCost = (tokens.outputTokens / 1_000_000) * pricing.outputPricePerMillion;

    const totalCost = Number((inputCost + cachedInputCost + outputCost).toFixed(6));

    return {
      inputCost: Number(inputCost.toFixed(6)),
      cachedInputCost: Number(cachedInputCost.toFixed(6)),
      outputCost: Number(outputCost.toFixed(6)),
      totalCost,
    };
  }
}
