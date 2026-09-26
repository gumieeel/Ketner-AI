import type { Plan, PlanId } from './types';

export type { Plan, PlanId };

/**
 * Каталог тарифов Ketner AI.
 * 5 специализированных тарифов: Free, GPT Pro, Claude Pro, Gemini Pro, Ultra.
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
    priceMonthly: 990,
    limitBadge: {
      ru: 'Безлимитный AI',
      en: 'Unlimited AI',
    },
    modelsHighlight: {
      ru: 'Все модели через Auto Mode',
      en: 'All models via Auto Mode',
    },
    bullets: {
      ru: [
        'Безлимитный доступ к AI',
        'Доступ ко всем моделям через Auto Mode',
        'Обычная скорость генерации',
        'Расширенный контекст диалога',
      ],
      en: [
        'Unlimited AI access',
        'Access to all models via Auto Mode',
        'Normal response generation speed',
        'Extended conversation context',
      ],
    },
  },
  {
    id: 'pro',
    nameKey: 'pricing.pro',
    priceMonthly: 1990,
    popular: true,
    limitBadge: {
      ru: 'Быстрее и умнее',
      en: 'Faster & smarter',
    },
    modelsHighlight: {
      ru: 'GPT-6 Astra, Claude 3.5 Sonnet, Gemini Pro',
      en: 'GPT-6 Astra, Claude 3.5 Sonnet, Gemini Pro',
    },
    bullets: {
      ru: [
        'Все топовые модели: GPT-6 Astra, Claude 3.5, Gemini',
        'Повышенная скорость и приоритет серверов',
        'Глубокий контекст для сложных рассуждений',
        'Ручной выбор любой флагманской модели',
      ],
      en: [
        'All flagship models: GPT-6 Astra, Claude 3.5, Gemini',
        'Higher speed and queue priority',
        'Deep multi-turn context for complex reasoning',
        'Manual selection of any flagship model',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: 2499,
    limitBadge: {
      ru: 'Максимальная мощность',
      en: 'Maximum performance',
    },
    modelsHighlight: {
      ru: 'Выделенный VIP приоритет + Огромный контекст',
      en: 'Dedicated VIP priority + Massive context',
    },
    bullets: {
      ru: [
        'Максимальная скорость с выделенными ресурсами',
        'Выделенный VIP-приоритет обработки запросов',
        'Огромный контекст для кода и больших документов',
        'Параллельные запросы без задержек',
      ],
      en: [
        'Maximum speed with dedicated resources',
        'Dedicated VIP queue priority',
        'Massive context for code and large documents',
        'Parallel concurrent requests without delays',
      ],
    },
  },
];

const LEGACY_PLANS: readonly Plan[] = [
  {
    id: 'gpt-pro',
    nameKey: 'pricing.gptPro',
    priceMonthly: 1199,
    bullets: {
      ru: ['Устаревший тариф (включает Pro)'],
      en: ['Legacy plan (includes Pro)'],
    },
  },
  {
    id: 'claude-pro',
    nameKey: 'pricing.claudePro',
    priceMonthly: 1199,
    bullets: {
      ru: ['Устаревший тариф (включает Pro)'],
      en: ['Legacy plan (includes Pro)'],
    },
  },
  {
    id: 'gemini-pro',
    nameKey: 'pricing.geminiPro',
    priceMonthly: 1199,
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
