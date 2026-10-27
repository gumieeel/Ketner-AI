import type { TranslationKey } from '@/i18n';
import type { ModelInfo } from './types';

/**
 * Ранг уровня доступа для лимитов сравнения: зеркало PLAN_RANKS на сервере
 * (apps/mock-api/src/services/entitlement.ts). `credits` — покупатель с неистраченным пакетом
 * (как Ultra), устаревшие gpt-pro / claude-pro / gemini-pro равны Pro, неизвестный уровень — Free.
 * Доступ к моделям от ранга не зависит: все модели открыты всем, платит только баланс кредитов.
 */
export const PLAN_RANKS: Readonly<Record<string, number>> = {
  free: 0,
  plus: 1,
  pro: 2,
  'gpt-pro': 2,
  'claude-pro': 2,
  'gemini-pro': 2,
  ultra: 3,
  credits: 3,
};

export function planRank(plan: string | null | undefined): number {
  return plan ? (PLAN_RANKS[plan] ?? 0) : 0;
}

/**
 * Каталог моделей на случай, пока /api/meta не загрузился. Зеркало публичного каталога сервера
 * (apps/mock-api/src/ai/models.ts): те же id, названия и размер контекста, тот же порядок.
 */
export const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'auto',
    name: '✨ Auto',
    contextMessages: 120,
  },
  {
    id: 'ketner-mini',
    name: 'Ketner Mini',
    contextMessages: 40,
  },
  {
    id: 'ketner-pro',
    name: 'Ketner Pro',
    contextMessages: 60,
  },
  {
    id: 'claude-haiku-5.5',
    name: 'Claude Haiku 5.5',
    contextMessages: 40,
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextMessages: 40,
  },
  {
    id: 'minimax-m3.1-flash',
    name: 'MiniMax M3.1 Flash',
    contextMessages: 40,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    contextMessages: 40,
  },
  {
    id: 'qwen3.8-flash',
    name: 'Qwen3.8 Flash',
    contextMessages: 40,
  },
  {
    id: 'gpt-5.6-luna-pro',
    name: 'GPT-5.6 Luna Pro',
    contextMessages: 60,
  },
  {
    id: 'qwen3.8-27b',
    name: 'Qwen3.8 27B',
    contextMessages: 60,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    contextMessages: 60,
  },
  {
    id: 'gpt-6.1-terra',
    name: 'GPT-6.1 Terra',
    contextMessages: 120,
    reasoningEffort: { standard: 'medium', max: 'xhigh' },
  },
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextMessages: 60,
  },
  {
    id: 'qwen3.8-max',
    name: 'Qwen3.8 Max',
    contextMessages: 60,
  },
  {
    id: 'kimi-k3.1',
    name: 'Kimi K3.1 Pro',
    contextMessages: 120,
  },
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    contextMessages: 120,
  },
  {
    id: 'claude-opus-5.5',
    name: 'Claude Opus 5.5',
    contextMessages: 120,
    reasoningEffort: { standard: 'medium', max: 'xhigh' },
  },
  {
    id: 'claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    contextMessages: 120,
    reasoningEffort: { standard: 'medium', max: 'xhigh' },
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    contextMessages: 120,
    reasoningEffort: { standard: 'medium', max: 'xhigh' },
  },
  {
    id: 'grok-4.7',
    name: 'Grok 4.7 xhigh',
    contextMessages: 120,
    reasoningEffort: { standard: 'xhigh', max: 'xhigh' },
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    contextMessages: 120,
    reasoningEffort: { standard: 'medium', max: 'xhigh' },
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    contextMessages: 120,
    reasoningEffort: { standard: 'medium', max: 'xhigh' },
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra xhigh',
    contextMessages: 120,
    reasoningEffort: { standard: 'xhigh', max: 'xhigh' },
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
  'glm-5.3': 'chat.modelGlm',
  'glm-5.3-flash': 'chat.modelGlmFlash',
  'minimax-m3.1-flash': 'chat.modelMiniMax',
  'qwen3.8-flash': 'chat.modelQwenFlash',
  'qwen3.8-max': 'chat.modelQwenMax',
  'gpt-6.1-terra': 'chat.modelGpt61Terra',
  'kimi-k3.1': 'chat.modelKimi',
  'gemini-3.8-flash': 'chat.modelGemini',
  'grok-4.7': 'chat.modelGrok',
  'claude-sonnet-5.5': 'chat.modelClaudeSonnet',
  'gpt-6-astra': 'chat.modelGptAstra',
  'gpt-5.6-sol': 'chat.modelGpt56Sol',
  'gpt-5.6-terra': 'chat.modelGpt56Terra',
  'gemini-4-argon': 'chat.modelGeminiArgon',
  'claude-opus-5.5': 'chat.modelClaudeOpus',
};

export function findModel(models: ModelInfo[] | undefined, modelId: string): ModelInfo {
  const list = models && models.length > 0 ? models : DEFAULT_MODELS;
  return list.find((m) => m.id === modelId) ?? DEFAULT_MODELS[0];
}
