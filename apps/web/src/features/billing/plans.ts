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
      ru: 'Все из Plus + Claude Opus и Sonnet, GPT-6 Astra, GPT-5.6 Sol и Terra, Grok 4.7',
      en: 'All Plus + Claude Opus & Sonnet, GPT-6 Astra, GPT-5.6 Sol & Terra, Grok 4.7',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Plus',
        'Топовые модели: Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
        'Размышления на уровне medium (Grok и Terra — всегда xhigh)',
        'Суточные лимиты по моделям: после лимита отвечает запасная модель',
        'Высокий приоритет обработки запросов',
        'Ручной выбор любой топовой модели',
      ],
      en: [
        'All Plus tier features included',
        'Top models: Claude Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra xhigh, Grok 4.7 xhigh',
        'Medium reasoning (Grok and Terra always run at xhigh)',
        'Daily limits per model: a backup model answers after the limit',
        'High request processing priority',
        'Manual selection of any top model',
      ],
    },
    highlights: {
      ru: [
        'Все возможности тарифа Plus',
        'Claude Opus, Sonnet, GPT-6 Astra, Grok 4.7',
        'Размышления medium, суточные лимиты по моделям',
      ],
      en: [
        'All Plus tier features included',
        'Claude Opus, Sonnet, GPT-6 Astra, Grok 4.7',
        'Medium reasoning, daily limits per model',
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
      ru: 'Все модели Pro + режим Max (xhigh) и лимиты в 2–3 раза выше',
      en: 'All Pro models + Max mode (xhigh) and 2–3× higher limits',
    },
    bullets: {
      ru: [
        'Все, что входит в тариф Pro',
        'Режим Max: модели Pro размышляют на уровне xhigh вместо medium',
        'Суточные лимиты моделей в 2–3 раза выше, чем на Pro',
        'Максимальный контекст диалога',
        'Наивысший VIP-приоритет обработки запросов без ожидания',
        'Параллельные запросы без задержек',
      ],
      en: [
        'All Pro tier features included',
        'Max mode: Pro models reason at xhigh instead of medium',
        'Daily model limits 2–3× higher than on Pro',
        'Maximum conversation context',
        'Top VIP queue priority with zero waiting',
        'Parallel concurrent requests without delays',
      ],
    },
    highlights: {
      ru: [
        'Режим Max: размышления xhigh',
        'Лимиты моделей в 2–3 раза выше Pro',
        'Максимальный контекст и VIP-приоритет',
      ],
      en: [
        'Max mode: xhigh reasoning',
        '2–3× higher model limits than Pro',
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
