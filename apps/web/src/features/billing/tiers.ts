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
 * Подключения к внешним сервисам с учётными данными клиента (CRM, таблицы, почта) — этап F. Пока их
 * нет, сайт не показывает «2 / 5 / 15 внешних сервисов» как доступное сейчас: только «появятся
 * позже». Включается вместе с этапом F.
 */
export const EXTERNAL_SERVICES_LIVE = false;
export const TIER_WARN_RATE = planFacts.tiers.warnRate;
export const TIER_GRACE_RATE = planFacts.tiers.graceRate;

/** Цена самого младшего тарифа для «от $N в месяц». */
export const STARTING_PRICE = `$${Math.min(...TIERS.map((tier) => tier.priceUsd))}`;
