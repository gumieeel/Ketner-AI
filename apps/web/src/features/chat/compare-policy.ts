import type { ModelInfo, PlanId } from './types';
import { planRank } from './model-catalog';
import type { CompareSlotView } from './compare-store';

/** Зеркало серверных правил (apps/mock-api/src/services/compare-policy.ts). */
export const COMPARE_MIN_MODELS = 2;
const MAX_MODELS_BY_RANK: readonly number[] = [2, 2, 3, 4];

/**
 * Сколько моделей уровень доступа сравнивает за раз. Сравнение открыто всем: до первой покупки —
 * две модели, после неё — до четырёх.
 */
export function maxCompareModels(plan: string | null | undefined): number {
  return MAX_MODELS_BY_RANK[planRank(plan)] ?? MAX_MODELS_BY_RANK[0];
}

/**
 * Модели, которые предлагаются по умолчанию, когда человек включил сравнение впервые: разные
 * семейства, чтобы разница была заметна.
 */
const DEFAULT_PICKS: readonly string[] = [
  'claude-sonnet-5.5',
  'gpt-5.6-sol',
  'gemini-3.7-flash',
  'claude-haiku-5.5',
  'deepseek-v4.1-flash',
  'ketner-pro',
  'ketner-mini',
];

export function defaultCompareModelIds(
  models: readonly ModelInfo[],
  plan: PlanId | undefined,
): string[] {
  const limit = Math.max(maxCompareModels(plan), COMPARE_MIN_MODELS);
  const available = new Set(models.filter((model) => model.id !== 'auto').map((m) => m.id));
  const ids = DEFAULT_PICKS.filter((id) => available.has(id));
  for (const id of available) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, Math.min(limit, 3));
}

/** Оставляет только существующие модели без повторов, не больше лимита уровня доступа. */
export function sanitizeCompareModelIds(
  ids: readonly string[],
  models: readonly ModelInfo[],
  plan: PlanId | undefined,
): string[] {
  const max = maxCompareModels(plan);
  const result: string[] = [];
  for (const id of ids) {
    const model = models.find((candidate) => candidate.id === id);
    if (!model || id === 'auto' || result.includes(id)) continue;
    result.push(id);
    if (result.length >= max) break;
  }
  return result;
}

/** Номер колонки с самым быстрым завершённым ответом; null, если сравнивать не с чем. */
export function fastestSlot(slots: readonly CompareSlotView[]): number | null {
  const finished = slots.filter(
    (slot) => slot.status === 'done' && typeof slot.latencyMs === 'number' && slot.latencyMs > 0,
  );
  if (finished.length < 2) return null;
  return finished.reduce((best, slot) =>
    (slot.latencyMs ?? Infinity) < (best.latencyMs ?? Infinity) ? slot : best,
  ).slot;
}
