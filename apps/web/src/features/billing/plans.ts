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
      ru: 'Базовая скорость',
      en: 'Standard speed',
    },
    modelsHighlight: 'Ketner Mini + Best AI (Auto)',
    bullets: {
      ru: [
        'Стандартная скорость ответа',
        'Базовый приоритет в очереди',
        'Стандартный контекст диалога',
        'Интеллектуальный режим Best AI (Auto)',
      ],
      en: [
        'Standard response speed',
        'Standard queue priority',
        'Standard conversation context',
        'Intelligent Best AI (Auto) mode',
      ],
    },
  },
  {
    id: 'plus',
    nameKey: 'pricing.plus',
    priceMonthly: 990,
    limitBadge: {
      ru: 'Быстрый отклик',
      en: 'Fast speed',
    },
    modelsHighlight: 'Продвинутые модели + Auto Mode',
    bullets: {
      ru: [
        'Высокая скорость генерации',
        'Повышенный приоритет обработки',
        'Расширенный контекст диалога',
        'Доступ к продвинутым моделям и Auto Mode',
      ],
      en: [
        'Fast response generation speed',
        'Enhanced queue priority',
        'Extended conversation context',
        'Access to advanced models and Auto Mode',
      ],
    },
  },
  {
    id: 'pro',
    nameKey: 'pricing.pro',
    priceMonthly: 1990,
    popular: true,
    limitBadge: {
      ru: 'Все флагманы AI',
      en: 'All Flagship AIs',
    },
    modelsHighlight: {
      ru: 'GPT-6 Astra, Claude Fable, Gemini Pro',
      en: 'GPT-6 Astra, Claude Fable, Gemini Pro',
    },
    bullets: {
      ru: [
        'Сверхбыстрая скорость флагманских моделей',
        'Высокий приоритет серверов без задержек',
        'Глубокий контекст для больших обсуждений',
        'Все флагманы мира: GPT, Claude, Gemini в одной подписке',
      ],
      en: [
        'Ultra-fast flagship model speed',
        'High server priority without delays',
        'Deep multi-turn context for complex discussions',
        'All world flagships: GPT, Claude, Gemini in one subscription',
      ],
    },
  },
  {
    id: 'ultra',
    nameKey: 'pricing.ultra',
    priceMonthly: 2499,
    limitBadge: {
      ru: 'Максимум · VIP приоритет',
      en: 'Maximum · VIP priority',
    },
    modelsHighlight: {
      ru: 'Максимальный контекст + 8 параллельных потоков',
      en: 'Maximum context + 8 concurrent streams',
    },
    bullets: {
      ru: [
        'Максимальная скорость с выделенными ресурсами',
        'Высший VIP-приоритет обработки запросов',
        'Огромный контекст для анализа целых проектов',
        'Все модели с мгновенным откликом',
      ],
      en: [
        'Maximum processing speed with dedicated resources',
        'Highest VIP queue priority',
        'Massive context for full codebases and projects',
        'All top AI models with instant response',
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
