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
    modelsHighlight: {
      ru: 'Ketner Mini + GPT-4o mini',
      en: 'Ketner Mini + GPT-4o mini',
    },
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
    highlights: {
      ru: [
        'Базовые модели',
        'Стандартная скорость',
        'Базовый контекст',
      ],
      en: [
        'Basic models',
        'Standard speed',
        'Basic context',
      ],
    },
  },
  {
    id: 'plus',
    nameKey: 'pricing.plus',
    priceMonthly: 9,
    limitBadge: {
      ru: 'Быстрые модели',
      en: 'Fast models',
    },
    modelsHighlight: {
      ru: 'DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o',
      en: 'DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o',
    },
    bullets: {
      ru: [
        'Стандартные быстрые модели: DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o',
        'Быстрая скорость генерации ответов',
        'Стандартный контекст диалога',
        'Доступ через Auto Mode или ручной выбор модели',
      ],
      en: [
        'Standard fast models: DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o',
        'Fast response generation speed',
        'Standard conversation context',
        'Access via Auto Mode or manual model selection',
      ],
    },
    highlights: {
      ru: [
        'DeepSeek v4.1, Haiku 4.5, GPT-4o',
        'Быстрая скорость генерации',
        'Приоритетная очередь',
      ],
      en: [
        'DeepSeek v4.1, Haiku 4.5, GPT-4o',
        'Fast generation speed',
        'Priority queue',
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
      ru: 'Все из Plus + GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7',
      en: 'All Plus + GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Plus',
        'Топовые модели: GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7',
        'Пониженный контекст и скорость по сравнению с Ultra',
        'Высокий приоритет обработки запросов',
        'Ручной выбор любой топовой модели',
      ],
      en: [
        'All Plus tier features included',
        'Top models: GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7',
        'Reduced context and speed compared to Ultra',
        'High request processing priority',
        'Manual selection of any top model',
      ],
    },
    highlights: {
      ru: [
        'Все возможности тарифа Plus',
        'GPT-6 Astra, Claude Fable, Gemini, Grok',
        'Пониженный контекст и скорость',
      ],
      en: [
        'All Plus tier features included',
        'GPT-6 Astra, Claude Fable, Gemini, Grok',
        'Reduced context and speed',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: 39,
    limitBadge: {
      ru: 'Максимум мощности',
      en: 'Maximum power',
    },
    modelsHighlight: {
      ru: 'Все топовые модели на 100% + макс. контекст',
      en: 'All top models at 100% + max context',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Pro',
        'Все топовые модели: GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7, Ketner Next',
        'Максимальный контекст диалога (до 2M токенов)',
        'Использование моделей на 100% без ограничений скорости и контекста',
        'Наивысший VIP-приоритет обработки запросов без ожидания',
        'Параллельные запросы без задержек',
      ],
      en: [
        'All Pro tier features included',
        'All top models: GPT-6 Astra, Claude Fable 5.1, Gemini Flash 3.8, Grok 4.7, Ketner Next',
        'Maximum conversation context (up to 2M tokens)',
        '100% model usage without speed or context limitations',
        'Top VIP queue priority with zero waiting',
        'Parallel concurrent requests without delays',
      ],
    },
    highlights: {
      ru: [
        'Все топовые модели на 100%',
        'Максимальный контекст (до 2M токенов)',
        'VIP-приоритет и максимальная скорость',
      ],
      en: [
        'All top models at 100%',
        'Maximum context (up to 2M tokens)',
        'VIP priority & maximum speed',
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
