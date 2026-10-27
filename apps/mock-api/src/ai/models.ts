import type { ModelCatalog, ModelInfo, PlanId, PlanLimits } from '../types.js';
import { modelRegistry } from './model-registry.js';
import { disclosureOf } from './model-disclosure.js';
import type { ModelRegistryEntry } from './gateway-types.js';
import { isFreeModel, requestPriceUsd } from '../services/credit-policy.js';
import { CREDITS_PER_USD } from '../services/entitlement.js';

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Цена типичного запроса в кредитах: то, что показывают страницы «Модели» и «Тарифы». */
function priceFields(
  entry: ModelRegistryEntry,
): Pick<ModelInfo, 'requestCredits' | 'requestCreditsMax' | 'free'> {
  if (isFreeModel(entry)) return { requestCredits: 0, free: true };
  const standard = round1(requestPriceUsd(entry, 'standard') * CREDITS_PER_USD);
  const max = round1(requestPriceUsd(entry, 'max') * CREDITS_PER_USD);
  return { requestCredits: standard, ...(max !== standard ? { requestCreditsMax: max } : {}) };
}

/** Публичный каталог моделей для `GET /api/meta`. Источник правды — реестр моделей. */
export const DEFAULT_MODEL_ID = 'auto';

/**
 * Публичный список моделей для переключателя в интерфейсе: по возрастанию цены. Все модели доступны
 * всем: платные тратят кредиты. Выключенные в реестре модели (например, Gemini 4 Argon, пока её нет в
 * OpenRouter) в каталог не попадают.
 *
 * Состав задаётся здесь, а отображаемое имя, доступность (requiredPlan, сейчас у всех моделей пусто) и размер
 * контекста берутся из реестра моделей. Второго источника правды нет: раньше этот файл вёл свой
 * каталог, и выбранная модель вне него молча превращалась в `auto`.
 */
export const PUBLIC_MODEL_IDS: readonly string[] = [
  'ketner-mini',
  'ketner-pro',
  'claude-haiku-5.5',
  'deepseek-v4.1-flash',
  'glm-5.3-flash',
  'qwen3.8-flash',
  'gpt-5.6-luna-pro',
  'qwen3.8-27b',
  'gemini-3.7-flash',
  'gpt-6.1-terra',
  'glm-5.3',
  'qwen3.8-max',
  'kimi-k3.1',
  'gpt-6.1-sol',
  'claude-opus-5.5',
  'claude-sonnet-5.5',
  'gpt-6-astra',
  'grok-4.7',
  'gemini-4-argon',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
];

/** Публичные сведения о модели: доступ и прозрачность (разработчик, настоящая модель). */
function toModelInfo(id: string, entry: ModelRegistryEntry): ModelInfo {
  const disclosure = disclosureOf(entry);
  return {
    id,
    name: entry.name,
    contextMessages: entry.contextMessages,
    isPro: entry.isPro,
    requiredPlan: entry.requiredPlan ?? undefined,
    ...(entry.effortProfile ? { reasoningEffort: { ...entry.effortProfile } } : {}),
    ...(disclosure ?? {}),
    contextWindow: entry.contextWindow,
    ...priceFields(entry),
    ...(entry.fallbackModelId
      ? {
          fallbackModelId: entry.fallbackModelId,
          fallbackModelName: modelRegistry.get(entry.fallbackModelId)?.name,
        }
      : {}),
  };
}

export const MODELS: readonly ModelInfo[] = PUBLIC_MODEL_IDS.flatMap((id) => {
  const entry = modelRegistry.get(id);
  if (!entry || !entry.enabled) {
    return [];
  }
  return [toModelInfo(id, entry)];
});

/** Бесплатные эндпоинты, которые отвечают на Free вместо Ketner Mini (ai/plan-substitute.ts). */
export const FREE_TIER_MODEL_IDS: readonly string[] = ['nemotron-ultra', 'north-mini-code'];

export const FREE_TIER_MODELS: readonly ModelInfo[] = FREE_TIER_MODEL_IDS.flatMap((id) => {
  const entry = modelRegistry.get(id);
  return entry && entry.enabled ? [toModelInfo(id, entry)] : [];
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
  freeTierModels: [...FREE_TIER_MODELS],
};

/** Проверка доступности модели по текущему тарифу пользователя (единое правило в entitlement). */
export function canAccessModel(userPlan: PlanId | undefined, model: ModelInfo): boolean {
  if (model.id === 'auto') return true;
  return planAllowsModel(userPlan, model.requiredPlan ?? null);
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
