/**
 * Правила сравнения ответов нескольких моделей на один вопрос (POST /api/chat/compare).
 *
 * Каждая модель в сравнении — отдельный запрос в обычном порядке: он считается в лимите модели, в
 * квоте премиум-запросов и в месячном бюджете тарифа. Поэтому число моделей ограничено тарифом, а
 * не только удобством: сравнение троих стоит втрое дороже обычного ответа.
 */

import { planRank } from './entitlement.js';

/** Меньше двух моделей сравнивать нечего. */
export const COMPARE_MIN_MODELS = 2;

/** Потолок для любого тарифа: больше четырёх колонок не помещаются на экране. */
export const COMPARE_ABSOLUTE_MAX_MODELS = 4;

/**
 * Сколько моделей можно сравнивать за один запрос, по рангу тарифа (Free, Plus, Pro, Ultra).
 * Число не больше параллельных запросов тарифа (2 / 4 / 8), чтобы сравнение не упиралось в
 * `concurrency_limit`; у Free сравнения нет: все его запросы идут на одну бесплатную модель.
 */
const MAX_MODELS_BY_RANK: readonly number[] = [0, 2, 3, 4];

export function maxCompareModels(plan: string | null | undefined): number {
  const max = MAX_MODELS_BY_RANK[planRank(plan)] ?? 0;
  return Math.min(max, COMPARE_ABSOLUTE_MAX_MODELS);
}

export type CompareModelIdsResult = { ok: true; ids: string[] } | { ok: false; message: string };

/**
 * Разбор списка моделей из тела запроса: массив строк, без пустых значений и повторов.
 * Существование и доступность моделей проверяет роутер: здесь только форма.
 */
export function parseCompareModelIds(raw: unknown): CompareModelIdsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'Поле modelIds должно быть массивом идентификаторов моделей' };
  }
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > 80) {
      return { ok: false, message: 'Идентификатор модели должен быть непустой строкой' };
    }
    const id = item.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length < COMPARE_MIN_MODELS) {
    return {
      ok: false,
      message: `Для сравнения нужно хотя бы ${COMPARE_MIN_MODELS} разные модели`,
    };
  }
  if (ids.length > COMPARE_ABSOLUTE_MAX_MODELS) {
    return {
      ok: false,
      message: `Сравнивать можно не больше ${COMPARE_ABSOLUTE_MAX_MODELS} моделей за раз`,
    };
  }
  return { ok: true, ids };
}
