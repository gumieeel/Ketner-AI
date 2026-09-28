import type { Plan, PlanId } from './types';

export type { Plan, PlanId };

/**
 * Каталог тарифов Ketner AI.
 * 4 тарифа: Free, Plus ($9), Pro ($29), Ultra ($39).
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
        'Безлимитный контекст диалога',
        'Доступ через Auto Mode или ручной выбор модели',
      ],
      en: [
        'Standard fast models: DeepSeek v4.1 Flash, Claude 3.5 Haiku, GPT-4o',
        'Fast response speed',
        'Unlimited conversation context',
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
      ru: 'GPT-6 Astra, Claude Fable 5.5, Gemini 3.8 Flash, Grok 4.7',
      en: 'GPT-6 Astra, Claude Fable 5.5, Gemini 3.8 Flash, Grok 4.7',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Plus',
        'Топовые модели: GPT-6 Astra, Claude Fable 5.5, Gemini 3.8 Flash, Grok 4.7',
        'Средняя скорость обработки',
        'Безлимитный контекст диалога',
        'Ручной выбор любой топовой модели',
      ],
      en: [
        'All Plus tier features included',
        'Top models: GPT-6 Astra, Claude Fable 5.5, Gemini 3.8 Flash, Grok 4.7',
        'Standard processing speed',
        'Unlimited conversation context',
        'Manual selection of any top model',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: 39,
    limitBadge: {
      ru: 'Максимальная мощность',
      en: 'Maximum power',
    },
    modelsHighlight: {
      ru: 'Все топовые модели + максимальное использование',
      en: 'All top models + maximum usage',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Pro',
        'Все топовые модели: GPT-6 Astra, Claude Fable 5.5, Gemini 3.8 Flash, Grok 4.7',
        'Максимальная скорость обработки',
        'Безлимитный контекст диалога',
        'Использование моделей на 100% без ограничений',
        'Выделенный VIP-приоритет обработки запросов',
        'Параллельные запросы без задержек',
      ],
      en: [
        'All Pro tier features included',
        'All top models: GPT-6 Astra, Claude Fable 5.5, Gemini 3.8 Flash, Grok 4.7',
        'Maximum processing speed',
        'Unlimited conversation context',
        'Full model usage at 100% without limitations',
        'Dedicated VIP queue priority',
        'Parallel concurrent requests without delays',
      ],
    },
  },
];

const LEGACY_PLANS: readonly Plan[] = [
  {
    id: 'gpt-pro',
    nameKey: 'pricing.gptPro',
    priceMonthly: 29,
    bullets: {
      ru: ['Устаревший тариф (включает Pro)'],
      en: ['Legacy plan (includes Pro)'],
    },
  },
  {
    id: 'claude-pro',
    nameKey: 'pricing.claudePro',
    priceMonthly: 29,
    bullets: {
      ru: ['Устаревший тариф (включает Pro)'],
      en: ['Legacy plan (includes Pro)'],
    },
  },
  {
    id: 'gemini-pro',
    nameKey: 'pricing.geminiPro',
    priceMonthly: 29,
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
