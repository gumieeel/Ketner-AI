import type { ModelInfo, PlanId } from './types';

/**
 * Проверяет, доступна ли модель пользователю по его текущему тарифу.
 * - Бесплатные модели (Qwen 2.5 Coder) доступны всегда.
 * - Платные модели (со звёздочкой) требуют соответствующего тарифа или тарифа Ultra.
 */
export function canAccessModel(userPlan: PlanId | undefined, model: ModelInfo): boolean {
  if (model.id === 'auto') return true;
  if (!model.isPro) return true;
  if (!userPlan || userPlan === 'free') return false;
  if (userPlan === 'ultra') return true;
  if (model.requiredPlan && userPlan === model.requiredPlan) return true;
  if (model.id === 'ketner-pro' && (userPlan === 'plus' || userPlan === 'pro')) return true;
  return false;
}

/**
 * Человекопонятное имя требуемого тарифа для отображения в ошибках и подсказках.
 */
export function getRequiredPlanName(model: ModelInfo): string {
  if (model.requiredPlan === 'gpt-pro') return 'GPT Pro';
  if (model.requiredPlan === 'claude-pro') return 'Claude Pro';
  if (model.requiredPlan === 'gemini-pro') return 'Gemini Pro';
  if (model.requiredPlan === 'ultra') return 'Ultra';
  return 'PRO';
}

export const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'ketner-mini', name: 'Qwen 2.5 Coder', contextMessages: 20, isPro: false },
  { id: 'auto', name: '✨ Auto (Smart Router)', contextMessages: 120, isPro: false },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'gpt-pro',
  },
  {
    id: 'claude-fable',
    name: 'Claude Fable 5.5 *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'claude-pro',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 3.8 Pro *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'gemini-pro',
  },
  {
    id: 'ketner-pro',
    name: 'Qwen 2.5 Max *',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'ultra',
  },
];

export function findModel(models: ModelInfo[] | undefined, modelId: string): ModelInfo {
  const list = models && models.length > 0 ? models : DEFAULT_MODELS;
  return list.find((m) => m.id === modelId) ?? DEFAULT_MODELS[0];
}
