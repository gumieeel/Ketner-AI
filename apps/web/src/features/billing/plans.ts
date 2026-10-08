import type { Plan, PlanId } from './types';

export type { Plan, PlanId };

/**
 * Каталог тарифов Ketner AI.
 * 4 тарифа: Free, Plus ($10), Pro ($20), Ultra ($30).
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
      ru: 'Ketner Mini',
      en: 'Ketner Mini',
    },
    bullets: {
      ru: [
        'Базовая модель Ketner Mini',
        'Стандартная скорость ответа',
        'Базовый контекст диалога',
        'Интеллектуальный режим Best AI (Auto)',
      ],
      en: [
        'Basic model: Ketner Mini',
        'Standard response speed',
        'Basic conversation context',
        'Intelligent Best AI (Auto) mode',
      ],
    },
    highlights: {
      ru: [
        'Базовая модель Ketner Mini',
        'Стандартная скорость',
        'Базовый контекст',
      ],
      en: [
        'Basic model: Ketner Mini',
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
      ru: 'Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash',
      en: 'Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash',
    },
    bullets: {
      ru: [
        'Модели: Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash',
        'GPT-6.1 Sol доступна в рамках ежемесячной квоты премиум-запросов',
        'Быстрая скорость генерации ответов',
        'Стандартный контекст диалога',
        'Доступ через Auto Mode или ручной выбор модели',
      ],
      en: [
        'Models: Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash',
        'GPT-6.1 Sol is available within the monthly premium-request quota',
        'Fast response generation speed',
        'Standard conversation context',
        'Access via Auto Mode or manual model selection',
      ],
    },
    highlights: {
      ru: [
        'Ketner Pro, GPT-6.1 Sol, Haiku 5.5, DeepSeek',
        'Быстрая скорость генерации',
        'Приоритетная очередь',
      ],
      en: [
        'Ketner Pro, GPT-6.1 Sol, Haiku 5.5, DeepSeek',
        'Fast generation speed',
        'Priority queue',
      ],
    },
  },
  {
    id: 'pro',
    nameKey: 'pricing.pro',
    priceMonthly: 25,
    popular: true,
    limitBadge: {
      ru: 'Топовые модели',
      en: 'Top models',
    },
    modelsHighlight: {
      ru: 'Все из Plus + Claude Opus 5.5, Grok 4.7, Gemini 3.8 Flash',
      en: 'All Plus + Claude Opus 5.5, Grok 4.7, Gemini 3.8 Flash',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Plus',
        'Топовые модели: Claude Opus 5.5, Grok 4.7, Gemini 3.8 Flash',
        'Премиум-модели расходуют ежемесячную квоту премиум-запросов тарифа',
        'Пониженный контекст и скорость по сравнению с Ultra',
        'Высокий приоритет обработки запросов',
        'Ручной выбор любой топовой модели',
      ],
      en: [
        'All Plus tier features included',
        'Top models: Claude Opus 5.5, Grok 4.7, Gemini 3.8 Flash',
        'Premium models draw from the plan\'s monthly premium-request quota',
        'Reduced context and speed compared to Ultra',
        'High request processing priority',
        'Manual selection of any top model',
      ],
    },
    highlights: {
      ru: [
        'Все возможности тарифа Plus',
        'Claude Opus 5.5, Grok 4.7, Gemini 3.8 Flash',
        'Пониженный контекст и скорость',
      ],
      en: [
        'All Plus tier features included',
        'Claude Opus 5.5, Grok 4.7, Gemini 3.8 Flash',
        'Reduced context and speed',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: 49,
    originalPriceMonthly: 59,
    discountBadge: {
      ru: '🔥 Скидка $10',
      en: '🔥 $10 OFF',
    },
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
        'Все топовые модели: GPT-6.1 Sol, Claude Opus 5.5, Grok 4.7, Gemini 3.8 Flash',
        'Максимальный контекст диалога',
        'Использование моделей на 100% без ограничений скорости и контекста',
        'Наивысший VIP-приоритет обработки запросов без ожидания',
        'Параллельные запросы без задержек',
      ],
      en: [
        'All Pro tier features included',
        'All top models: GPT-6.1 Sol, Claude Opus 5.5, Grok 4.7, Gemini 3.8 Flash',
        'Maximum conversation context',
        '100% model usage without speed or context limitations',
        'Top VIP queue priority with zero waiting',
        'Parallel concurrent requests without delays',
      ],
    },
    highlights: {
      ru: [
        'Все топовые модели на 100%',
        'Максимальный контекст диалога',
        'VIP-приоритет и максимальная скорость',
      ],
      en: [
        'All top models at 100%',
        'Maximum conversation context',
        'VIP priority & maximum speed',
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
