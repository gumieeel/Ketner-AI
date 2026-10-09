import type { ModelCatalog, ModelInfo, PlanId, PlanLimits } from '../types.js';
import { dailyLimitsOf, modelRegistry } from './model-registry.js';

/** Публичный каталог моделей для `GET /api/meta`. Источник правды — реестр моделей. */
export const DEFAULT_MODEL_ID = 'auto';

/**
 * Публичный список моделей для переключателя в интерфейсе: Free и Plus по возрастанию цены, затем
 * модели Pro и Ultra. Выключенные в реестре модели (например, Gemini 4 Argon, пока её нет в
 * OpenRouter) в каталог не попадают.
 *
 * Состав задаётся здесь, а отображаемое имя, доступность по тарифу (isPro / requiredPlan) и размер
 * контекста берутся из реестра моделей. Второго источника правды нет: раньше этот файл вёл свой
 * каталог, и выбранная модель вне него молча превращалась в `auto`.
 */
export const PUBLIC_MODEL_IDS: readonly string[] = [
  'ketner-mini',
  'ketner-pro',
  'claude-haiku-5.5',
  'deepseek-v4.1-flash',
  'gpt-5.6-luna-pro',
  'qwen3.8-27b',
  'gemini-3.7-flash',
  'gpt-6.1-sol',
  'claude-opus-5.5',
  'claude-sonnet-5.5',
  'gpt-6-astra',
  'grok-4.7',
  'gemini-4-argon',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
];

export const MODELS: readonly ModelInfo[] = PUBLIC_MODEL_IDS.flatMap((id) => {
  const entry = modelRegistry.get(id);
  if (!entry || !entry.enabled) {
    return [];
  }
  const info: ModelInfo = {
    id,
    name: entry.name,
    contextMessages: entry.contextMessages,
    isPro: entry.isPro,
    requiredPlan: entry.requiredPlan ?? undefined,
    ...dailyLimitsOf(id),
    ...(entry.effortProfile ? { reasoningEffort: { ...entry.effortProfile } } : {}),
  };
  return [info];
});

import { getPlanLimits, planAllowsModel } from '../services/entitlement.js';

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

/** Проверка доступности модели по текущему тарифу пользователя (единое правило в entitlement). */
export function canAccessModel(userPlan: PlanId | undefined, model: ModelInfo): boolean {
  if (model.id === 'auto') return true;
  return planAllowsModel(userPlan, model.isPro ? (model.requiredPlan ?? 'plus') : null);
}

/**
 * Неизвестный идентификатор модели не ломает запрос: берём модель по умолчанию. Старые id из
 * сохранённых диалогов (gpt-6-astra, claude-fable и др.) ведут на актуальные модели.
 */
export function resolveModel(modelId: string | undefined): ModelInfo {
  if (modelId === 'auto' || !modelId) {
    return AUTO_MODEL;
  }
  const currentId = modelRegistry.get(modelId)?.id;
  return MODELS.find((model) => model.id === currentId) ?? AUTO_MODEL;
}
