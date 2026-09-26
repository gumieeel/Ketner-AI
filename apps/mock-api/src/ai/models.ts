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
  // Дешёвые модели (для Free и fallback)
  {
    id: DEFAULT_MODEL_ID,
    name: 'Ketner Mini (Qwen 2.5)',
    contextMessages: 20,
    isPro: false,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    contextMessages: 40,
    isPro: false,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    contextMessages: 40,
    isPro: false,
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    contextMessages: 40,
    isPro: false,
  },
  // Топовые модели (ядро продукта)
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'claude-fable',
    name: 'Claude Fable 5.5 *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 3.8 Pro *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'ketner-pro',
    name: 'Qwen 2.5 Max *',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'plus',
  },
];

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { messagesPerDay: 10, contextMessages: 20 },
  'gpt-pro': { messagesPerDay: null, contextMessages: 120 },
  'claude-pro': { messagesPerDay: null, contextMessages: 120 },
  'gemini-pro': { messagesPerDay: null, contextMessages: 120 },
  ultra: { messagesPerDay: null, contextMessages: 500 },
  plus: { messagesPerDay: null, contextMessages: 60 },
  pro: { messagesPerDay: null, contextMessages: 120 },
};

export const MODEL_CATALOG: ModelCatalog = {
  models: [...MODELS],
  defaultModelId: DEFAULT_MODEL_ID,
  limits: PLAN_LIMITS,
};

/** Проверка доступности модели по текущему тарифу пользователя. */
export function canAccessModel(userPlan: PlanId | undefined, model: ModelInfo): boolean {
  if (model.id === 'auto') return true;
  if (!model.isPro) return true;
  if (!userPlan || userPlan === 'free') return false;
  return true;
}

/** Неизвестный идентификатор модели не ломает запрос: берём модель по умолчанию. */
export function resolveModel(modelId: string | undefined): ModelInfo {
  if (modelId === 'auto') {
    return {
      id: 'auto',
      name: '✨ Auto (Smart Router)',
      contextMessages: 120,
      isPro: false,
    };
  }
  return MODELS.find((model) => model.id === modelId) ?? MODELS[0];
}
