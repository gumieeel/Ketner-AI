/**
 * Правила кредитов: хватает ли пользователю кредитов на модель и кто отвечает, когда не хватает.
 *
 * Запрос списывает реальную стоимость (services/credits.ts), поэтому «хватает ли» — это сравнение
 * остатка с ценой типичного запроса модели при её глубине размышлений. Бесплатные эндпоинты
 * (`:free` у OpenRouter) ничего не стоят и доступны всегда: когда кредиты кончились, отвечает
 * бесплатная модель, кредиты не тратятся. Платные запасные модели при этом исключены: расход не должен
 * выходить за остаток кредитов.
 */

import { isFreeEngine, typicalRequestCost } from '../ai/engine-pricing.js';
import type { ModelRegistryEntry, ReasoningEffort, ReasoningMode } from '../ai/gateway-types.js';
import { FLOOR_MODEL_ID, type ModelRegistry } from '../ai/model-registry.js';
import { planAllowsModel } from './entitlement.js';

/** `normal` — кредиты есть; `exhausted` — платить за ответ нечем, отвечает бесплатная модель. */
export type CreditStage = 'normal' | 'exhausted';

/** Бесплатная модель чата: отвечает, когда кредиты кончились, и кредитов не тратит. */
export const FREE_CHAT_MODEL_ID = 'nemotron-ultra';
/** Бесплатная модель агента Ketner Code. */
export const FREE_AGENT_MODEL_ID = 'north-mini-code';
/** Меньше одного кредита ($0.001) — кредитов нет. */
export const EXHAUSTED_BELOW_USD = 0.001;

export type ModelSurface = 'chat' | 'code';

export function creditStageOf(balanceUsd: number): CreditStage {
  return balanceUsd < EXHAUSTED_BELOW_USD ? 'exhausted' : 'normal';
}

/** Бесплатный эндпоинт: ничего не стоит и не списывает кредиты. */
export function isFreeModel(model: Pick<ModelRegistryEntry, 'providerModelId'>): boolean {
  return isFreeEngine(model.providerModelId);
}

/** Глубина размышлений, по которой оценивается цена запроса модели в выбранном режиме. */
export function typicalEffort(
  model: Pick<ModelRegistryEntry, 'effortProfile'>,
  mode: ReasoningMode,
): ReasoningEffort {
  if (!model.effortProfile) return 'medium';
  return mode === 'max' ? model.effortProfile.max : model.effortProfile.standard;
}

/** Цена типичного запроса модели, $ (0 для бесплатной). */
export function requestPriceUsd(model: ModelRegistryEntry, mode: ReasoningMode): number {
  return isFreeModel(model) ? 0 : typicalRequestCost(model, typicalEffort(model, mode));
}

/** Хватает ли остатка хотя бы на один типичный запрос модели. */
export function canAfford(
  model: ModelRegistryEntry,
  balanceUsd: number,
  mode: ReasoningMode = 'standard',
): boolean {
  return isFreeModel(model) || balanceUsd >= requestPriceUsd(model, mode);
}

export interface AffordableChoice {
  model: ModelRegistryEntry;
  /** Причина замены для `routingReason`; null, если запрошенная модель оставлена. */
  reason: string | null;
}

/**
 * Модель, которая ответит вместо запрошенной, если на неё не хватает кредитов: сначала запасные из
 * её цепочки (они дешевле), потом Ketner Mini, и последней — бесплатная модель поверхности.
 */
export function pickAffordable(
  requested: ModelRegistryEntry,
  input: {
    balanceUsd: number;
    plan: string;
    mode?: ReasoningMode;
    surface?: ModelSurface;
    registry: ModelRegistry;
    /** Дополнительное условие допустимости (лимиты, доступность провайдера и т.п.). */
    canUse?: (model: ModelRegistryEntry) => boolean;
  },
): AffordableChoice {
  const mode = input.mode ?? 'standard';
  const usable = (model: ModelRegistryEntry): boolean =>
    (input.canUse?.(model) ?? true) &&
    (isFreeModel(model) || planAllowsModel(input.plan, model.requiredPlan));
  if (canAfford(requested, input.balanceUsd, mode) && usable(requested)) {
    return { model: requested, reason: null };
  }

  const freeId = input.surface === 'code' ? FREE_AGENT_MODEL_ID : FREE_CHAT_MODEL_ID;
  const ladder = [
    ...input.registry.getFallbackChain(requested.id, 10).slice(1),
    input.registry.get(FLOOR_MODEL_ID),
    input.registry.get(freeId),
  ];
  const seen = new Set<string>([requested.id]);
  for (const candidate of ladder) {
    if (!candidate || !candidate.enabled || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (canAfford(candidate, input.balanceUsd, mode) && usable(candidate)) {
      const exhausted = creditStageOf(input.balanceUsd) === 'exhausted' || isFreeModel(candidate);
      return {
        model: candidate,
        reason: exhausted
          ? `Credits used up: ${candidate.name} answers instead of ${requested.name}`
          : `Not enough credits for ${requested.name}: ${candidate.name} answers instead`,
      };
    }
  }
  // Бесплатной модели в реестре нет (отключена администратором): отвечает запрошенная.
  return { model: requested, reason: null };
}

/**
 * Допустима ли запасная модель при сбое основной: платная — только если на неё хватает кредитов,
 * бесплатная — всегда. Права по тарифу для запасной не требуются, если она дешевле выбранной:
 * пользователь видит в ответе, какая модель реально ответила.
 */
export function isAffordableFallback(
  model: ModelRegistryEntry,
  balanceUsd: number,
  mode: ReasoningMode = 'standard',
): boolean {
  return canAfford(model, balanceUsd, mode);
}
