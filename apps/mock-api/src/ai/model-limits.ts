/**
 * Применение лимитов моделей: недельный пул и суточная доля пула (см. services/daily-limits.ts).
 *
 * Если у модели исчерпан пул или суточная доля, берётся её запасная модель из реестра; если и у неё
 * лимит исчерпан, то следующая по цепочке. Цепочка конечна и без повторов, а модели без запасной
 * (или с отключённой запасной) остаются как есть: лучше ответить, чем отказать.
 */

import type { ModelRegistryEntry, ReasoningMode } from './gateway-types.js';
import { limitUnitsFor } from './reasoning-policy.js';
import type { ModelRegistry } from './model-registry.js';
import { getModelLimit, WEEKLY_POOL_DAYS, type ModelLimit } from '../services/daily-limits.js';

const DAY_MS = 24 * 3600 * 1000;

export interface ModelUsageSource {
  getModelUseEvents(
    userId: string,
    modelIds: Iterable<string>,
    windowMs: number,
  ): Array<{ at: number; units: number }>;
}

export interface ModelLimitStatus {
  limit: ModelLimit;
  weekUsed: number;
  dayUsed: number;
  /** Сколько единиц осталось прямо сейчас: меньшее из остатка пула и суточной доли. */
  remaining: number;
  weekRemaining: number;
  dayRemaining: number;
  /** Что сейчас ограничивает: пул, суточная доля или ничего. */
  binding: 'week' | 'day' | null;
  /** Когда вернётся хотя бы одна единица пула / суточной доли (ISO), если они исчерпаны. */
  weekRestoresAt: string | null;
  dayRestoresAt: string | null;
}

/**
 * Когда освободится `need` единиц: использования выпадают из окна по одному, начиная со старых.
 * null, если ждать нечего (уже хватает) или окно пустое.
 */
function restoresAt(
  events: Array<{ at: number; units: number }>,
  windowMs: number,
  overBy: number,
): string | null {
  if (overBy <= 0) return null;
  let freed = 0;
  for (const event of events) {
    freed += event.units;
    if (freed >= overBy) return new Date(event.at + windowMs).toISOString();
  }
  return null;
}

/** Остаток лимитов модели у пользователя или null, если у модели на тарифе лимита нет. */
export function modelLimitStatus(
  model: ModelRegistryEntry,
  plan: string,
  userId: string,
  usage: ModelUsageSource,
  registry: ModelRegistry,
  units = 1,
): ModelLimitStatus | null {
  const limit = getModelLimit(plan, model.id);
  if (!limit) return null;
  const weekMs = WEEKLY_POOL_DAYS * DAY_MS;
  const ids = registry.getIdsWithAliases(model.id);
  const weekEvents = usage.getModelUseEvents(userId, ids, weekMs);
  const dayStart = Date.now() - DAY_MS;
  const dayEvents = weekEvents.filter((event) => event.at >= dayStart);
  const weekUsed = weekEvents.reduce((sum, e) => sum + e.units, 0);
  const dayUsed = dayEvents.reduce((sum, e) => sum + e.units, 0);
  const weekRemaining = Math.max(0, limit.weeklyPool - weekUsed);
  const dayRemaining = Math.max(0, limit.dailyCap - dayUsed);
  const weekShort = weekUsed + units - limit.weeklyPool;
  const dayShort = dayUsed + units - limit.dailyCap;
  return {
    limit,
    weekUsed,
    dayUsed,
    remaining: Math.min(weekRemaining, dayRemaining),
    weekRemaining,
    dayRemaining,
    binding: weekShort > 0 ? 'week' : dayShort > 0 ? 'day' : null,
    weekRestoresAt: restoresAt(weekEvents, weekMs, weekShort),
    dayRestoresAt: restoresAt(dayEvents, DAY_MS, dayShort),
  };
}

/**
 * Исчерпан ли лимит модели у пользователя: не хватает пула или суточной доли на этот запрос.
 * Запрос в режиме Max у модели с профилем размышлений стоит 2 единицы: если их не хватает,
 * отвечает запасная модель.
 */
export function isModelLimitReached(
  model: ModelRegistryEntry,
  plan: string,
  userId: string,
  usage: ModelUsageSource,
  registry: ModelRegistry,
  mode: ReasoningMode = 'standard',
): boolean {
  const status = modelLimitStatus(
    model,
    plan,
    userId,
    usage,
    registry,
    limitUnitsFor(model.effortProfile, mode),
  );
  return status !== null && status.binding !== null;
}

export interface ModelLimitDecision {
  model: ModelRegistryEntry;
  /** Причина замены для `routingReason`; null, если запрошенная модель оставлена. */
  reason: string | null;
  /** Модель, лимит которой исчерпан и которую заменили (первая в цепочке). */
  limited?: { model: ModelRegistryEntry; status: ModelLimitStatus };
}

function describeLimit(model: ModelRegistryEntry, plan: string, status: ModelLimitStatus): string {
  const { weeklyPool, dailyCap } = status.limit;
  return status.binding === 'week'
    ? `Weekly pool used up for ${model.name} (${weeklyPool}/week on ${plan})`
    : `Daily share of the weekly pool used up for ${model.name} (${dailyCap}/day of ${weeklyPool}/week on ${plan})`;
}

export function applyModelLimits(
  model: ModelRegistryEntry,
  plan: string,
  userId: string,
  usage: ModelUsageSource,
  registry: ModelRegistry,
  mode: ReasoningMode = 'standard',
): ModelLimitDecision {
  let current = model;
  const seen = new Set<string>();
  let first: ModelLimitDecision['limited'];

  while (!seen.has(current.id)) {
    const status = modelLimitStatus(
      current,
      plan,
      userId,
      usage,
      registry,
      limitUnitsFor(current.effortProfile, mode),
    );
    if (!status || status.binding === null) break;
    seen.add(current.id);
    const next = current.fallbackModelId ? registry.get(current.fallbackModelId) : undefined;
    if (!next || !next.enabled || seen.has(next.id)) break;
    if (!first) first = { model: current, status };
    current = next;
  }

  if (!first) return { model, reason: null };
  return {
    model: current,
    limited: first,
    reason: `${describeLimit(first.model, plan, first.status)}: ${current.name} answers instead`,
  };
}
