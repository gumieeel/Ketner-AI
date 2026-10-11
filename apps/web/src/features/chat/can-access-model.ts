import type { TranslationKey } from '@/i18n';
import type { ModelInfo, PlanId } from './types';

/**
 * Ранг тарифа для проверки доступа: зеркало PLAN_RANKS на сервере
 * (apps/mock-api/src/services/entitlement.ts). Устаревшие gpt-pro / claude-pro / gemini-pro
 * равны Pro, неизвестный тариф считается Free.
 */
export const PLAN_RANKS: Readonly<Record<string, number>> = {
  free: 0,
  plus: 1,
  pro: 2,
  'gpt-pro': 2,
  'claude-pro': 2,
  'gemini-pro': 2,
  ultra: 3,
};

export function planRank(plan: string | null | undefined): number {
  return plan ? (PLAN_RANKS[plan] ?? 0) : 0;
}

/**
 * Тариф, с которого доступна модель, или `null`, если модель бесплатная.
 * Как на сервере (`canAccessModel` в ai/models.ts): `requiredPlan` учитывается только у платных моделей,
 * а платная модель без `requiredPlan` считается моделью Plus.
 */
export function requiredPlanOf(model: ModelInfo): PlanId | null {
  if (model.id === 'auto' || !model.isPro) return null;
  return model.requiredPlan ?? 'plus';
}

/**
 * Проверяет, доступна ли модель пользователю по его текущему тарифу:
 * модель доступна, если ранг тарифа пользователя не ниже ранга `requiredPlan` модели.
 * Auto и бесплатные модели доступны всем.
 */
export function canAccessModel(userPlan: PlanId | undefined, model: ModelInfo): boolean {
  return planRank(userPlan) >= planRank(requiredPlanOf(model));
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

/**
 * Каталог моделей на случай, пока /api/meta не загрузился. Зеркало публичного каталога сервера
 * (apps/mock-api/src/ai/models.ts): те же id, названия, `requiredPlan` и размер контекста, тот же порядок.
 */
export const DEFAULT_MODELS: ModelInfo[] = [
  // Auto — умный выбор модели, доступен всем
  {
    id: 'auto',
    name: '✨ Auto',
    contextMessages: 120,
    isPro: false,
  },
  // Free — повседневная модель
  {
    id: 'ketner-mini',
    name: 'Ketner Mini',
    contextMessages: 40,
    isPro: false,
  },
  // Plus ($9) — рабочая лошадка и быстрые модели
  {
    id: 'ketner-pro',
    name: 'Ketner Pro',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'plus',
    dailyLimits: { plus: 20 },
  },
  {
    id: 'claude-haiku-5.5',
    name: 'Claude Haiku 5.5',
    contextMessages: 40,
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
    id: 'gpt-5.6-luna-pro',
    name: 'GPT-5.6 Luna Pro',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'plus',
    dailyLimits: { plus: 10 },
  },
  {
    id: 'qwen3.8-27b',
    name: 'Qwen3.8 27B',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'plus',
    dailyLimits: { plus: 12 },
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    contextMessages: 60,
    isPro: true,
    requiredPlan: 'plus',
    dailyLimits: { plus: 5 },
  },
  // Pro ($25) — премиум-модели; Gemini, Grok и Opus расходуют квоту премиум-запросов тарифа
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  {
    id: 'grok-4.7',
    name: 'Grok 4.7',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
  // GPT-6.1 Sol открыта с Plus, но тоже расходует квоту премиум-запросов
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'plus',
    dailyLimits: { plus: 1 },
  },
  {
    id: 'claude-opus-5.5',
    name: 'Claude Opus 5.5',
    contextMessages: 120,
    isPro: true,
    requiredPlan: 'pro',
  },
];

/**
 * Ключи словаря с названиями моделей каталога: интерфейс показывает название из словаря,
 * а `name` от сервера служит запасным вариантом для моделей, которых здесь нет.
 */
export const MODEL_NAME_KEYS: Readonly<Record<string, TranslationKey>> = {
  auto: 'chat.modelAuto',
  'ketner-mini': 'chat.modelMini',
  'ketner-pro': 'chat.modelPro',
  'claude-haiku-5.5': 'chat.modelHaiku',
  'deepseek-v4.1-flash': 'chat.modelDeepSeek',
  'gpt-6.1-sol': 'chat.modelGptSol',
  'gpt-5.6-luna-pro': 'chat.modelLunaPro',
  'qwen3.8-27b': 'chat.modelQwen27b',
  'gemini-3.7-flash': 'chat.modelGemini37',
  'gemini-3.8-flash': 'chat.modelGemini',
  'grok-4.7': 'chat.modelGrok',
  'claude-opus-5.5': 'chat.modelClaudeOpus',
};

export function findModel(models: ModelInfo[] | undefined, modelId: string): ModelInfo {
  const list = models && models.length > 0 ? models : DEFAULT_MODELS;
  return list.find((m) => m.id === modelId) ?? DEFAULT_MODELS[0];
}
