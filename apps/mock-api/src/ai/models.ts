import type { ModelCatalog, ModelInfo, PlanId, PlanLimits } from '../types.js';

/**
 * Каталог моделей заглушки.
 *
 * Ответы у моделей одинаковые — различаются подпись и лимит контекста.
 * На реальном провайдере этот список заменится ответом `GET /api/meta`
 * (см. docs/ai-integration-todo.md).
 */
export const DEFAULT_MODEL_ID = 'ketner-mini';

export const MODELS: readonly ModelInfo[] = [
  { id: DEFAULT_MODEL_ID, name: 'Ketner mini', contextMessages: 20 },
  { id: 'ketner-pro', name: 'Ketner pro', contextMessages: 60 },
];

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { messagesPerDay: 10, contextMessages: 20 },
  plus: { messagesPerDay: null, contextMessages: 60 },
  pro: { messagesPerDay: null, contextMessages: 120 },
};

export const MODEL_CATALOG: ModelCatalog = {
  models: [...MODELS],
  defaultModelId: DEFAULT_MODEL_ID,
  limits: PLAN_LIMITS,
};

/** Неизвестный идентификатор модели не ломает запрос: берём модель по умолчанию. */
export function resolveModel(modelId: string | undefined): ModelInfo {
  return MODELS.find((model) => model.id === modelId) ?? MODELS[0];
}
