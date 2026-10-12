import {
  canAccessModel as checkAccess,
  getRequiredPlanName,
  planRank,
  DEFAULT_MODELS,
  PLAN_RANKS,
} from '../chat/can-access-model';
import type { ModelInfo, PlanId } from '../chat/types';

/** Ранги тарифов совпадают с серверными (см. `PLAN_RANKS` в features/chat/can-access-model.ts). */
export const PLAN_LEVELS: Readonly<Record<string, number>> = PLAN_RANKS;

/** Тариф, с которого доступна модель каталога (зеркало `requiredPlan` из реестра моделей сервера). */
export const REQUIRED_PLANS: Record<string, string> = {
  'auto': 'free',
  'ketner-mini': 'free',
  'ketner-pro': 'plus',
  'claude-haiku-5.5': 'plus',
  'deepseek-v4.1-flash': 'plus',
  'gpt-6.1-sol': 'plus',
  'gpt-5.6-luna-pro': 'plus',
  'qwen3.8-27b': 'plus',
  'gemini-3.7-flash': 'plus',
  'gemini-3.8-flash': 'pro',
  'grok-4.7': 'pro',
  'claude-opus-5.5': 'pro',
  'claude-sonnet-5.5': 'pro',
  'gpt-6-astra': 'pro',
  'gpt-5.6-sol': 'pro',
  'gpt-5.6-terra': 'pro',
  'gemini-4-argon': 'pro',
};

/**
 * Проверка прав доступа пользователя к модели по идентификатору или объекту ModelInfo.
 * Неизвестный идентификатор считается моделью уровня Pro.
 */
export function canAccessModel(userPlan: PlanId | undefined, model: string | ModelInfo): boolean {
  if (typeof model === 'string') {
    const found = DEFAULT_MODELS.find((m) => m.id === model);
    if (!found) {
      return planRank(userPlan) >= planRank(REQUIRED_PLANS[model] ?? 'pro');
    }
    return checkAccess(userPlan, found);
  }
  return checkAccess(userPlan, model);
}

export { getRequiredPlanName, DEFAULT_MODELS };
