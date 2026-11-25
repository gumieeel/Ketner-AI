import planFacts from './plan-facts.json';

/**
 * Тарифы на работающие решения для текстов сайта. Источник — services/tiers.ts на сервере; копию в
 * plan-facts.json сверяет apps/mock-api/src/services/plan-facts.test.ts.
 */
export interface TierFacts {
  id: string;
  name: string;
  priceUsd: number;
  activeSolutions: number;
  monthlyRequests: number;
  externalServices: number;
  integrationHelp: { kind: 'widget_install' } | { kind: 'hours'; hoursPerMonth: number };
}

export const TIERS = planFacts.tiers.items as TierFacts[];

/**
 * Подключения к внешним сервисам — системам данных с учётными данными клиента (Google Таблицы, CRM,
 * календарь). Работают с этапа F (Google Таблицы, 23.11.2026): сайт показывает число сервисов тарифа.
 * Каналы (страница бота, виджет, позже — Telegram-бот клиента) сервисами не считаются (решение
 * владельца 23.11.2026).
 */
export const EXTERNAL_SERVICES_LIVE = true;

/**
 * Канал «ваш бот в Telegram» (docs/TELEGRAM_CHANNEL.md) ещё не сделан. Пока false, тексты сайта
 * называют его «позже» — это проверяет tests/product-texts.test.tsx.
 */
export const CUSTOMER_TELEGRAM_CHANNEL_LIVE = false;
export const TIER_WARN_RATE = planFacts.tiers.warnRate;
export const TIER_GRACE_RATE = planFacts.tiers.graceRate;

/** Цена самого младшего тарифа для «от $N в месяц». */
export const STARTING_PRICE = `$${Math.min(...TIERS.map((tier) => tier.priceUsd))}`;
