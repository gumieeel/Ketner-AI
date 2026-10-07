/**
 * Себестоимость запроса: что именно записывать в учёт расходов.
 *
 * Правда о цене — это то, что вернул провайдер (`usage.cost` у OpenRouter). Цены из реестра —
 * запасной вариант, и у части моделей они заведомо занижены: «бесплатный» ketner-mini на деле идёт
 * через платный deepseek/deepseek-chat и в учёте стоил $0, поэтому лимиты по бюджету не срабатывали.
 */

import type { ModelPricing, ModelRegistryEntry } from './gateway-types.js';
import { CostCalculator, type TokenBreakdown } from '../services/cost.js';

/**
 * Консервативная цена ($ за 1M токенов) для движка, который в реестре объявлен бесплатным,
 * но не является `:free`-моделью OpenRouter. Лучше слегка завысить расход, чем не видеть его вовсе.
 */
export const UNDECLARED_PAID_ENGINE_PRICING: ModelPricing = {
  inputPricePerMillion: 0.3,
  outputPricePerMillion: 1.2,
  cachedInputPricePerMillion: 0.03,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null,
};

/** `:free`-варианты OpenRouter действительно не стоят денег (но имеют жёсткие лимиты запросов). */
export function isFreeEngine(engineId: string | undefined): boolean {
  return Boolean(engineId && engineId.trim().endsWith(':free'));
}

function isZeroPricing(pricing: ModelPricing): boolean {
  return pricing.inputPricePerMillion === 0 && pricing.outputPricePerMillion === 0;
}

/** Цена, по которой считается запрос, если провайдер не сообщил реальную стоимость. */
export function effectivePricing(
  model: Pick<ModelRegistryEntry, 'pricing' | 'provider'>,
  engineId?: string,
): ModelPricing {
  if (isZeroPricing(model.pricing) && !isFreeEngine(engineId) && model.provider === 'openrouter') {
    return UNDECLARED_PAID_ENGINE_PRICING;
  }
  return model.pricing;
}

export interface RequestCostInput {
  model: Pick<ModelRegistryEntry, 'pricing' | 'provider'>;
  /** Идентификатор движка, фактически отправленный провайдеру. */
  engineId?: string;
  tokens: TokenBreakdown;
  /** Стоимость, возвращённая провайдером (USD). Приоритетнее любых таблиц. */
  providerCost?: number;
}

export interface RequestCost {
  usd: number;
  source: 'provider' | 'table';
}

export function computeRequestCost(input: RequestCostInput): RequestCost {
  if (typeof input.providerCost === 'number' && Number.isFinite(input.providerCost) && input.providerCost >= 0) {
    return { usd: Number(input.providerCost.toFixed(6)), source: 'provider' };
  }
  const pricing = effectivePricing(input.model, input.engineId);
  return { usd: CostCalculator.calculate(input.tokens, pricing).totalCost, source: 'table' };
}
