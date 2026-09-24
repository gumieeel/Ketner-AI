import type { ModelInfo, PlanId } from './types';

/**
 * Проверяет, доступна ли модель пользователю по его текущему тарифу.
 * - Бесплатные модели (Qwen 2.5 Coder) доступны всегда.
 * - Платные модели (со звёздочкой) требуют соответствующего тарифа или тарифа Ultra.
 */
export function canAccessModel(userPlan: PlanId | undefined, model: ModelInfo): boolean {
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
