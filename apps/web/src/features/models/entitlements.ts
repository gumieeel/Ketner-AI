import { canAccessModel as checkAccess, getRequiredPlanName, DEFAULT_MODELS } from '../chat/can-access-model';
import type { ModelInfo, PlanId } from '../chat/types';

export const PLAN_LEVELS: Record<string, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  'gpt-pro': 2,
  'claude-pro': 2,
  'gemini-pro': 2,
  ultra: 3,
};

export const REQUIRED_PLANS: Record<string, string> = {
  'auto': 'free',
  'gpt-4o': 'plus',
  'gpt-4o-mini': 'free',
  'claude-3-haiku': 'plus',
  'gpt-6-astra': 'gpt-pro',
  'claude-fable': 'claude-pro',
  'gemini-pro': 'gemini-pro',
  'ketner-pro': 'plus',
};

/**
 * Проверка прав доступа пользователя к модели по идентификатору или объекту ModelInfo.
 */
export function canAccessModel(userPlan: PlanId | undefined, model: string | ModelInfo): boolean {
  if (typeof model === 'string') {
    const found = DEFAULT_MODELS.find((m) => m.id === model);
    if (!found) {
      const required = REQUIRED_PLANS[model] || 'pro';
      if (required === 'free') return true;
      if (!userPlan || userPlan === 'free') return false;
      if (userPlan === 'ultra') return true;
      return (PLAN_LEVELS[userPlan] || 0) >= (PLAN_LEVELS[required] || 0);
    }
    return checkAccess(userPlan, found);
  }
  return checkAccess(userPlan, model);
}

export { getRequiredPlanName, DEFAULT_MODELS };
