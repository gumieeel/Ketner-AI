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
      ru: 'Бесплатные модели, запасная — Ketner Mini',
      en: 'Free models, Ketner Mini as backup',
    },
    bullets: {
      ru: [
        'Отвечает бесплатная Nemotron 3 Ultra (NVIDIA), запасная — Ketner Mini',
        '10 сообщений в сутки',
        'Режим Auto и история чатов',
        '5 картинок FLUX.1 schnell в сутки — за кредиты',
      ],
      en: [
        'Free Nemotron 3 Ultra (NVIDIA) answers, Ketner Mini as backup',
        '10 messages a day',
        'Auto mode and chat history',
        '5 FLUX.1 schnell images a day, paid with credits',
      ],
    },
    highlights: {
      ru: ['Nemotron 3 Ultra и Ketner Mini', '10 сообщений в сутки', 'Режим Auto'],
      en: ['Nemotron 3 Ultra and Ketner Mini', '10 messages a day', 'Auto mode'],
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
        '500 сообщений в сутки, 2 запроса одновременно',
        'Когда кредиты кончились, продолжает отвечать бесплатная модель',
        'Режим Auto или ручной выбор модели',
      ],
      en: [
        'Models: Ketner Pro, GPT-6.1 Sol, Claude Haiku 5.5, DeepSeek V4.1 Flash',
        'FLUX.2 klein images in five aspect ratios',
        '500 messages a day, 2 requests at once',
        'When credits run out, a free model keeps answering',
        'Auto mode or manual model selection',
      ],
    },
    highlights: {
      ru: [
        'Ketner Pro, GPT-6.1 Sol, Haiku 5.5, DeepSeek',
        '500 сообщений в сутки',
        'После кредитов отвечает бесплатная модель',
      ],
      en: [
        'Ketner Pro, GPT-6.1 Sol, Haiku 5.5, DeepSeek',
        '500 messages a day',
        'After credits: a free model keeps answering',
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
        '1 500 сообщений в сутки, до 4 запросов одновременно',
      ],
      en: [
        'All Plus tier features included',
        'Top models: Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
        'FLUX.2 dev and Seedream images',
        '1,500 messages a day, up to 4 requests at once',
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
      ru: 'Скидка $10',
      en: '$10 off',
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
        '4 000 сообщений в сутки, до 8 запросов одновременно',
      ],
      en: [
        'All Pro tier features included',
        'Max mode: models think longer and deeper',
        'FLUX.2 pro and Nano Banana 2 images',
        '4,000 messages a day, up to 8 requests at once',
      ],
    },
    highlights: {
      ru: [
        'Режим Max: модели думают глубже',
        'FLUX.2 pro и Nano Banana 2',
        '4 000 сообщений в сутки',
      ],
      en: ['Max mode: deeper thinking', 'FLUX.2 pro and Nano Banana 2', '4,000 messages a day'],
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
