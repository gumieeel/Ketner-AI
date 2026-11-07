/**
 * UsageCostEstimationService: ежемесячные расходы отдельно от цены внедрения.
 *
 * - Подписка Ketner «Автоматизации» — действующая цена из billing/automation-subscription.ts.
 * - Поддержка — только если администратор задал цену.
 * - Расход на модели — прогноз: обращения в месяц (со слов человека) × вызовы × токены × цена
 *   модели из реестра шлюза (та же таблица, по которой шлюз считает себестоимость). Без числа
 *   обращений прогноз не считается — честное «зависит от объёма».
 * - Плата внешним провайдерам (WhatsApp, Meta) — не выдумывается: «по тарифу провайдера».
 */

import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import { AUTOMATION_PLAN } from '../billing/automation-subscription.js';
import { OPENROUTER_TOPUP_FEE } from '../services/pricing.js';
import type { PricingConfig } from './catalog.js';
import type { Confidence, EstimateLine, Range } from './engine.js';
import { mulDiv, toMilli } from './money.js';

export interface MoneyAmount {
  /** Сумма в тенге, если задан курс, иначе null. */
  kzt: number | null;
  /** Сумма в долларах (центы), исходная валюта цены. */
  usdCents: number;
}

export interface RecurringCost {
  kind: 'subscription' | 'support';
  amount: MoneyAmount | { kzt: number; usdCents: null };
  /** Что это: для подписки — кредиты в месяц. */
  monthlyCredits?: number;
}

export interface UsageForecast {
  status: 'forecast' | 'volume_unknown' | 'not_applicable' | 'model_unknown';
  monthlyRequests: number | null;
  /** Прогноз расхода на модели в месяц, микро-доллары (мин/ожид/макс). */
  aiMicroUsd: Range | null;
  /** То же в тенге (если задан курс). */
  aiKzt: Range | null;
  modelId: string | null;
  /** Провайдеры с собственными тарифами, которые не включены. */
  externalProviderFees: string[];
  confidence: Confidence;
  assumptions: string[];
}

export interface MonthlyCosts {
  recurring: RecurringCost[];
  usage: UsageForecast;
  usdToKztRate: number | null;
}

const MICRO = 1_000_000;

function usdCentsToKzt(cents: number, rate: number | null): number | null {
  return rate === null ? null : mulDiv(cents, toMilli(rate), 100_000);
}

function microToKzt(micro: number, rate: number | null): number | null {
  return rate === null ? null : mulDiv(micro, toMilli(rate), MICRO * 1000);
}

export function monthlyCosts(
  lines: readonly EstimateLine[],
  monthlyRequests: number | null,
  config: PricingConfig,
  registry: ModelRegistry = modelRegistry,
): MonthlyCosts {
  const rate = config.usdToKztRate;
  const recurring: RecurringCost[] = [];
  if (lines.length > 0) {
    const cents = AUTOMATION_PLAN.priceUsd * 100;
    recurring.push({
      kind: 'subscription',
      amount: { usdCents: cents, kzt: usdCentsToKzt(cents, rate) },
      monthlyCredits: AUTOMATION_PLAN.monthlyCredits,
    });
  }
  if (config.supportMonthlyKzt !== null && lines.length > 0) {
    recurring.push({ kind: 'support', amount: { kzt: config.supportMonthlyKzt, usdCents: null } });
  }

  const externalProviderFees = lines
    .filter((line) => line.directCostKzt === null && line.category === 'channel')
    .map((line) => line.name.ru);
  const ai = lines.some((line) => line.category === 'ai');
  const base = { externalProviderFees, monthlyRequests };
  if (!ai) {
    return {
      recurring,
      usdToKztRate: rate,
      usage: {
        ...base,
        status: 'not_applicable',
        aiMicroUsd: null,
        aiKzt: null,
        modelId: null,
        confidence: 'high',
        assumptions: [],
      },
    };
  }
  if (monthlyRequests === null) {
    return {
      recurring,
      usdToKztRate: rate,
      usage: {
        ...base,
        status: 'volume_unknown',
        aiMicroUsd: null,
        aiKzt: null,
        modelId: config.usage.modelId,
        confidence: 'low',
        assumptions: [],
      },
    };
  }
  // Строго по id: подмена моделью по умолчанию дала бы прогноз по чужой цене.
  const model = registry.get(config.usage.modelId);
  if (!model) {
    return {
      recurring,
      usdToKztRate: rate,
      usage: {
        ...base,
        status: 'model_unknown',
        aiMicroUsd: null,
        aiKzt: null,
        modelId: config.usage.modelId,
        confidence: 'low',
        assumptions: [],
      },
    };
  }
  const pricing = model.pricing;
  // Цена за миллион токенов — в тысячных доллара; токены × (тысячные $ за 1М) / 1000 = микро-$.
  const inMilli = toMilli(pricing.inputPricePerMillion);
  const outMilli = toMilli(pricing.outputPricePerMillion);
  const feeMilli = 1000 + toMilli(OPENROUTER_TOPUP_FEE);
  const perRequest = (index: 0 | 1 | 2) => {
    const tokens =
      mulDiv(config.usage.inputTokensPerRequest[index], inMilli, 1000) +
      mulDiv(config.usage.outputTokensPerRequest[index], outMilli, 1000);
    return mulDiv(tokens, toMilli(config.usage.callsPerRequest[index]), 1000);
  };
  const requests = Math.max(0, Math.round(monthlyRequests));
  const monthly = (index: 0 | 1 | 2) => mulDiv(perRequest(index) * requests, feeMilli, 1000);
  const aiMicroUsd: Range = { min: monthly(0), expected: monthly(1), max: monthly(2) };
  return {
    recurring,
    usdToKztRate: rate,
    usage: {
      ...base,
      status: 'forecast',
      aiMicroUsd,
      aiKzt:
        rate === null
          ? null
          : {
              min: microToKzt(aiMicroUsd.min, rate) as number,
              expected: microToKzt(aiMicroUsd.expected, rate) as number,
              max: microToKzt(aiMicroUsd.max, rate) as number,
            },
      modelId: config.usage.modelId,
      confidence: 'medium',
      assumptions: [
        `${requests} обращений в месяц — со слов клиента`,
        `${config.usage.inputTokensPerRequest[1]} входных и ${config.usage.outputTokensPerRequest[1]} выходных токенов на обращение — допущение`,
      ],
    },
  };
}
