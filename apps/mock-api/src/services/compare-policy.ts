/**
 * Правила сравнения ответов нескольких моделей на один вопрос (POST /api/chat/compare).
 *
 * Каждая модель в сравнении — отдельный запрос в обычном порядке: он списывает кредиты по реальной
 * цене и считается в технических лимитах тарифа. Поэтому число моделей ограничено тарифом, а
 * не только удобством: сравнение троих стоит втрое дороже обычного ответа.
 */

import { planRank } from './entitlement.js';

/** Меньше двух моделей сравнивать нечего. */
export const COMPARE_MIN_MODELS = 2;

/** Потолок для любого тарифа: больше четырёх колонок не помещаются на экране. */
export const COMPARE_ABSOLUTE_MAX_MODELS = 4;

/**
 * Сколько моделей можно сравнивать за один запрос, по рангу уровня доступа (Free, Plus, Pro,
 * Ultra и покупатели кредитов). Сравнение доступно всем: до первой покупки — две модели (параллельных
 * запросов у Free один, второй ждёт очереди), после — до четырёх. Каждая модель стоит кредитов по
 * реальной цене, так что число моделей — это ещё и расход.
 */
const MAX_MODELS_BY_RANK: readonly number[] = [2, 2, 3, 4];

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
