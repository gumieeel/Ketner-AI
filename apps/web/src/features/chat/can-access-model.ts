import type { ModelInfo, PlanId } from './types';

/**
 * Проверяет, доступна ли модель пользователю по его текущему тарифу.
 * - Auto доступен всем (Free).
 * - Plus модели требуют тариф Plus или выше.
 * - Pro модели требуют тариф Pro / Ultra.
 */
export function canAccessModel(userPlan: PlanId | undefined, model: ModelInfo): boolean {
  if (model.id === 'auto') return true;
  if (!model.isPro && (!model.requiredPlan || model.requiredPlan === 'free')) return true;
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
  if (model.id === 'ketner-pro' && (userPlan === 'plus' || userPlan === 'pro')) return true;
  return false;
}

/**
 * Человекопонятное имя требуемого тарифа для отображения в ошибках и подсказках.
 */
export function getRequiredPlanName(model: ModelInfo): string {
  if (model.requiredPlan === 'plus') return 'Plus';
  if (model.requiredPlan === 'gpt-pro') return 'GPT Pro';
  if (model.requiredPlan === 'claude-pro') return 'Claude Pro';
  if (model.requiredPlan === 'gemini-pro') return 'Gemini Pro';
  if (model.requiredPlan === 'ultra') return 'Ultra';
  return 'PRO';
}

export const DEFAULT_MODELS: ModelInfo[] = [
  // Auto — бесплатный умный роутинг
  {
    id: 'auto',
    name: '✨ Auto',
    contextMessages: 120,
    isPro: false,
  },
  // Plus (990 ₽) — стандартные модели
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    contextMessages: 40,
    isPro: true,
    requiredPlan: 'plus',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
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
  // Pro (1 990 ₽) — флагманские модели
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra *',
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
    name: 'Gemini 3.8 Flash *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'grok-4.7',
    name: 'Grok 4.7 *',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
];

export function findModel(models: ModelInfo[] | undefined, modelId: string): ModelInfo {
  const list = models && models.length > 0 ? models : DEFAULT_MODELS;
  return list.find((m) => m.id === modelId) ?? DEFAULT_MODELS[0];
}
