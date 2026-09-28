import type { Plan, PlanId } from './types';

export type { Plan, PlanId };

/**
 * Каталог тарифов Ketner AI.
 * 4 тарифа: Free, Plus ($9), Pro ($29), Ultra (максимум).
 */
export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    nameKey: 'pricing.free',
    priceMonthly: 0,
    limitBadge: {
      ru: 'Попробуйте AI',
      en: 'Try AI',
    },
    modelsHighlight: 'Ketner Mini + GPT-4o mini',
    bullets: {
      ru: [
        'Базовые модели (Ketner Mini, GPT-4o mini)',
        'Стандартная скорость ответа',
        'Базовый контекст диалога',
        'Интеллектуальный режим Best AI (Auto)',
      ],
      en: [
        'Basic models (Ketner Mini, GPT-4o mini)',
        'Standard response speed',
        'Basic conversation context',
        'Intelligent Best AI (Auto) mode',
      ],
    },
  },
  {
    id: 'plus',
    nameKey: 'pricing.plus',
    priceMonthly: 9,
    limitBadge: {
      ru: 'Стандартный AI',
      en: 'Standard AI',
    },
    modelsHighlight: {
      ru: 'DeepSeek v4.1 Flash, Claude 3.5 Haiku, GPT-4o',
      en: 'DeepSeek v4.1 Flash, Claude 3.5 Haiku, GPT-4o',
    },
    bullets: {
      ru: [
        'Стандартные быстрые модели: DeepSeek v4.1 Flash, Claude 3.5 Haiku, GPT-4o',
        'Быстрая скорость ответа',
        'Расширенный контекст диалога (8K токенов)',
        'Доступ через Auto Mode или ручной выбор модели',
      ],
      en: [
        'Standard fast models: DeepSeek v4.1 Flash, Claude 3.5 Haiku, GPT-4o',
        'Fast response speed',
        'Extended conversation context (8K tokens)',
        'Access via Auto Mode or manual model selection',
      ],
    },
  },
  {
    id: 'pro',
    nameKey: 'pricing.pro',
    priceMonthly: 29,
    popular: true,
    limitBadge: {
      ru: 'Топовые модели',
      en: 'Top models',
    },
    modelsHighlight: {
      ru: 'GPT-4o, Claude 3.5 Sonnet, Gemini 2.0 Pro',
      en: 'GPT-4o, Claude 3.5 Sonnet, Gemini 2.0 Pro',
    },
    bullets: {
      ru: [
        'Топовые модели: GPT-4o, Claude 3.5 Sonnet, Gemini 2.0 Pro',
        'Пониженный контекст для оптимизации (32K токенов)',
        'Повышенная скорость обработки',
        'Все возможности из тарифа Plus',
        'Ручной выбор любой топовой модели',
      ],
      en: [
        'Top models: GPT-4o, Claude 3.5 Sonnet, Gemini 2.0 Pro',
        'Optimized context window (32K tokens)',
        'Higher processing speed',
        'All Plus tier features included',
        'Manual selection of any top model',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: 49,
    limitBadge: {
      ru: 'Максимальная мощность',
      en: 'Maximum power',
    },
    modelsHighlight: {
      ru: 'Все топовые модели + максимальный контекст (200K)',
      en: 'All top models + max context (200K)',
    },
    bullets: {
      ru: [
        'Все топовые модели: GPT-4o, GPT-4 Turbo, Claude 3.5 Sonnet, Gemini 2.0 Pro, o1-preview',
        'Максимальный контекст (200K токенов) для больших документов и кода',
        'Использование моделей на 100% без ограничений',
        'Выделенный VIP-приоритет обработки запросов',
        'Параллельные запросы без задержек',
        'Все возможности из тарифа Pro',
      ],
      en: [
        'All top models: GPT-4o, GPT-4 Turbo, Claude 3.5 Sonnet, Gemini 2.0 Pro, o1-preview',
        'Maximum context window (200K tokens) for large documents and code',
        'Full model usage at 100% without limitations',
        'Dedicated VIP queue priority',
        'Parallel concurrent requests without delays',
        'All Pro tier features included',
      ],
    },
  },
];

const LEGACY_PLANS: readonly Plan[] = [
  {
    id: 'gpt-pro',
    nameKey: 'pricing.gptPro',
    priceMonthly: 20,
    bullets: {
      ru: ['Устаревший тариф (включает Pro)'],
      en: ['Legacy plan (includes Pro)'],
    },
  },
  {
    id: 'claude-pro',
    nameKey: 'pricing.claudePro',
    priceMonthly: 20,
    bullets: {
      ru: ['Устаревший тариф (включает Pro)'],
      en: ['Legacy plan (includes Pro)'],
    },
  },
  {
    id: 'gemini-pro',
    nameKey: 'pricing.geminiPro',
    priceMonthly: 20,
    bullets: {
      ru: ['Устаревший тариф (включает Pro)'],
      en: ['Legacy plan (includes Pro)'],
    },
  },
];

export function getPlan(id: string | undefined): Plan | undefined {
  if (!id) return undefined;
  return PLANS.find((plan) => plan.id === id) ?? LEGACY_PLANS.find((plan) => plan.id === id);
}
