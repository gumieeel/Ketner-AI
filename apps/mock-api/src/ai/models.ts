import type { ModelCatalog, ModelInfo, PlanId, PlanLimits } from '../types.js';
import { modelRegistry } from './model-registry.js';

/** Публичный каталог моделей для `GET /api/meta`. Источник правды — реестр моделей. */
export const DEFAULT_MODEL_ID = 'auto';

/**
 * Публичный список моделей для переключателя в интерфейсе.
 *
 * Состав и отображаемые имена задаются здесь, а доступность по тарифу (isPro / requiredPlan)
 * и размер контекста берутся из реестра моделей. Второго источника правды нет: раньше этот файл
 * вёл свой каталог, и выбранная модель вне него молча превращалась в `auto`.
 */
const PUBLIC_MODELS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'claude-3-haiku', name: 'Claude Haiku 4.5' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
  { id: 'claude-fable', name: 'Claude Fable 5.1' },
  { id: 'gemini-2.5-pro', name: 'Gemini Flash 3.8' },
  { id: 'grok-4.7', name: 'Grok 4.7' },
];

export const MODELS: readonly ModelInfo[] = PUBLIC_MODELS.flatMap(({ id, name }) => {
  const entry = modelRegistry.get(id);
  if (!entry || !entry.enabled) {
    return [];
  }
  const info: ModelInfo = {
    id,
    name,
    contextMessages: entry.contextMessages,
    isPro: entry.isPro,
    requiredPlan: entry.requiredPlan ?? undefined,
  };
  return [info];
});

import { getPlanLimits } from '../services/entitlement.js';

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = getPlanLimits();

export const AUTO_MODEL: ModelInfo = {
  id: 'auto',
  name: '✨ Auto (Smart Router)',
  contextMessages: 120,
  isPro: false,
};

export const MODEL_CATALOG: ModelCatalog = {
  models: [AUTO_MODEL, ...MODELS],
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
  if (modelId === 'auto' || !modelId) {
    return AUTO_MODEL;
  }
  return MODELS.find((model) => model.id === modelId) ?? AUTO_MODEL;
}
