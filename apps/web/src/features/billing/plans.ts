import type { Language } from '@/features/preferences/preferences-store';
import type { TranslationKey } from '@/i18n';

export type PlanId = 'free' | 'plus' | 'pro';

export interface Plan {
  id: PlanId;
  nameKey: TranslationKey;
  /** Стоимость в долларах США за месяц. 0 — бесплатный план. */
  priceMonthly: number;
  popular?: boolean;
  bullets: Record<Language, readonly string[]>;
}

/**
 * Каталог тарифов.
 *
 * Пока это статический модуль. На этапе 4 он переезжает в mock-API
 * (`GET /api/plans`), а на этапе интеграции оплаты — в реальный биллинг.
 * Структура Plan при этом не меняется — см. docs/payment-integration-todo.md.
 */
export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    nameKey: 'pricing.free',
    priceMonthly: 0,
    bullets: {
      ru: ['10 сообщений в день', 'Базовые модели', 'История чатов'],
      en: ['10 messages per day', 'Base models', 'Chat history'],
    },
  },
  {
    id: 'plus',
    nameKey: 'pricing.plus',
    priceMonthly: 20,
    popular: true,
    bullets: {
      ru: ['Безлимит сообщений', 'Приоритетный доступ', 'Все модели, включая pro'],
      en: ['Unlimited messages', 'Priority access', 'All models, including pro'],
    },
  },
  {
    id: 'pro',
    nameKey: 'pricing.pro',
    priceMonthly: 40,
    bullets: {
      ru: ['Всё из Plus', 'Расширенный контекст', 'Ранний доступ к новым моделям'],
      en: ['Everything in Plus', 'Extended context', 'Early access to new models'],
    },
  },
];

export function getPlan(id: string | undefined): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}
