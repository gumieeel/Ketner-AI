import type { ModelInfo, PlanId } from './types';

/**
 * Проверяет, доступна ли модель пользователю по его текущему тарифу.
 * - Бесплатные модели (Qwen 2.5 Coder) доступны всегда.
 * - Платные модели (со звёздочкой) требуют соответствующего тарифа или тарифа Ultra.
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
  // 1. Базовые модели (Тариф Free)
  {
    id: 'ketner-mini',
    name: 'Ketner Mini · Qwen 2.5 Coder',
    contextMessages: 20,
    isPro: false,
    requiredPlan: 'free',
  },
  {
    id: 'auto',
    name: '✨ Auto (Smart Router)',
    contextMessages: 120,
    isPro: false,
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

export function findModel(models: ModelInfo[] | undefined, modelId: string): ModelInfo {
  const list = models && models.length > 0 ? models : DEFAULT_MODELS;
  return list.find((m) => m.id === modelId) ?? DEFAULT_MODELS[0];
}
