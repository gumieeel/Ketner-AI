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
  // 1. Базовые модели (Тариф Free)
  {
    id: DEFAULT_MODEL_ID,
    name: 'Ketner Mini · Qwen 2.5 Coder',
    contextMessages: 20,
    isPro: false,
    requiredPlan: 'free',
  },
  // 2. Стандартные и продвинутые модели (Тариф Plus)
  {
    id: 'ketner-pro',
    name: 'Ketner Pro · Qwen 2.5 Max *',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    contextMessages: 40,
    isPro: false,
    requiredPlan: 'free',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM 5.3 Flash',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'nemotron-ultra',
    name: 'Nemotron 3 Ultra',
    contextMessages: 30,
    isPro: true,
    requiredPlan: 'plus',
  },
  // 3. Флагманские модели (Тарифы Pro и Ultra)
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'claude-fable',
    name: 'Claude Fable 5.5 *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 3.8 Pro *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
];

import { getPlanLimits } from '../services/entitlement.js';

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = getPlanLimits();

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
  if (userPlan === 'ultra') return true;
  if (model.requiredPlan === 'plus') {
    return userPlan === 'plus' || userPlan === 'pro';
  }
  if (model.requiredPlan === 'pro') {
    return (
      userPlan === 'pro' ||
      userPlan === 'gpt-pro' ||
      userPlan === 'claude-pro' ||
      userPlan === 'gemini-pro'
    );
  }
  if (model.requiredPlan && userPlan === model.requiredPlan) return true;
  return false;
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
