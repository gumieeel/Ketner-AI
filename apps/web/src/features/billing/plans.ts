import type { Plan, PlanId } from './types';

export type { Plan, PlanId };

/**
 * Каталог тарифов Ketner AI.
 * 4 тарифа в долларах: Free ($0), Plus ($9), Pro ($25), Ultra ($49 со скидкой с $59).
 * Те же цены на бэкенде: apps/mock-api/src/services/pricing.ts.
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
      ru: ['Базовая модель Ketner Mini', 'Стандартная скорость', 'Базовый контекст'],
      en: ['Basic model: Ketner Mini', 'Standard speed', 'Basic context'],
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
        'Картинки FLUX.2 klein в пяти форматах',
        'Быстрая скорость генерации ответов',
        'Стандартный контекст диалога',
        'Доступ через Auto Mode или ручной выбор модели',
      ],
      en: [
        'Models: Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash',
        'FLUX.2 klein images in five aspect ratios',
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
      ru: 'Все из Plus + Claude Opus и Sonnet, GPT-6 Astra, GPT-5.6 Sol и Terra, Grok 4.7',
      en: 'All Plus + Claude Opus & Sonnet, GPT-6 Astra, GPT-5.6 Sol & Terra, Grok 4.7',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Plus',
        'Топовые модели: Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
        'Картинки FLUX.2 dev и Seedream',
        'Высокий приоритет обработки запросов',
        'Ручной выбор любой топовой модели',
      ],
      en: [
        'All Plus tier features included',
        'Top models: Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
        'FLUX.2 dev and Seedream images',
        'High request processing priority',
        'Manual selection of any top model',
      ],
    },
    highlights: {
      ru: [
        'Все возможности тарифа Plus',
        'Claude Opus, Sonnet, GPT-6 Astra, Grok 4.7',
        'Картинки FLUX.2 dev и Seedream',
      ],
      en: [
        'All Plus tier features included',
        'Claude Opus, Sonnet, GPT-6 Astra, Grok 4.7',
        'FLUX.2 dev and Seedream images',
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
      ru: 'Все модели Pro + режим Max и лучшие модели картинок',
      en: 'All Pro models + Max mode and the best image models',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Pro',
        'Режим Max: модели думают дольше и глубже',
        'Картинки FLUX.2 pro и Nano Banana 2',
        'Максимальный контекст диалога',
        'Наивысший VIP-приоритет обработки запросов без ожидания',
        'Параллельные запросы без задержек',
      ],
      en: [
        'All Pro tier features included',
        'Max mode: models think longer and deeper',
        'FLUX.2 pro and Nano Banana 2 images',
        'Maximum conversation context',
        'Top VIP queue priority with zero waiting',
        'Parallel concurrent requests without delays',
      ],
    },
    highlights: {
      ru: [
        'Режим Max: модели думают глубже',
        'FLUX.2 pro и Nano Banana 2',
        'Максимальный контекст и VIP-приоритет',
      ],
      en: [
        'Max mode: deeper thinking',
        'FLUX.2 pro and Nano Banana 2',
        'Maximum context & VIP priority',
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
