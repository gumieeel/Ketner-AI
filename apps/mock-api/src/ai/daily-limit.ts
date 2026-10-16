/**
 * Применение суточных лимитов моделей (см. services/daily-limits.ts).
 *
 * Если модель исчерпала суточный лимит тарифа, берётся её запасная модель из реестра; если и у неё
 * лимит исчерпан, то следующая по цепочке. Цепочка конечна и без повторов, а модели без запасной
 * (или с отключённой запасной) остаются как есть: лучше ответить, чем отказать.
 */

import type { ModelRegistryEntry, ReasoningMode } from './gateway-types.js';
import { limitUnitsFor } from './reasoning-policy.js';
import type { ModelRegistry } from './model-registry.js';
import { getDailyModelLimit } from '../services/daily-limits.js';

export interface DailyUsageSource {
  getModelUsesLastDay(userId: string, modelIds: Iterable<string>): number;
}

export interface DailyLimitDecision {
  model: ModelRegistryEntry;
  /** Причина замены для `routingReason`; null, если запрошенная модель оставлена. */
  reason: string | null;
  /** Модель, лимит которой исчерпан и которую заменили (первая в цепочке). */
  limited?: { model: ModelRegistryEntry; limit: number };
}

/**
 * Исчерпан ли суточный лимит модели у пользователя. Запрос в режиме Max у модели с профилем
 * размышлений стоит 2 единицы лимита: если их не хватает, отвечает запасная модель.
 */
export function isDailyLimitReached(
  model: ModelRegistryEntry,
  plan: string,
  userId: string,
  usage: DailyUsageSource,
  registry: ModelRegistry,
  mode: ReasoningMode = 'standard',
): boolean {
  const limit = getDailyModelLimit(plan, model.id);
  if (limit === null) return false;
  const used = usage.getModelUsesLastDay(userId, registry.getIdsWithAliases(model.id));
  if (used >= limit) return true;
  return used + limitUnitsFor(model.effortProfile, mode) > limit;
}

export function applyDailyLimits(
  model: ModelRegistryEntry,
  plan: string,
  userId: string,
  usage: DailyUsageSource,
  registry: ModelRegistry,
  mode: ReasoningMode = 'standard',
): DailyLimitDecision {
  let current = model;
  const seen = new Set<string>();
  let first: DailyLimitDecision['limited'];

  while (
    !seen.has(current.id) &&
    isDailyLimitReached(current, plan, userId, usage, registry, mode)
  ) {
    seen.add(current.id);
    const next = current.fallbackModelId ? registry.get(current.fallbackModelId) : undefined;
    if (!next || !next.enabled || seen.has(next.id)) break;
    if (!first) first = { model: current, limit: getDailyModelLimit(plan, current.id) ?? 0 };
    current = next;
  }

  if (!first) return { model, reason: null };
  return {
    model: current,
    limited: first,
    reason: `Daily limit reached for ${first.model.name} (${first.limit}/day on ${plan}): ${current.name} answers instead`,
  };
}
