/**
 * Каталог тарифов на работающие решения (docs/SUBSCRIPTION_PRICING_DESIGN.md, разделы 2–4 и 8).
 * Цены утверждены владельцем 14.11.2026. Один источник для сервера, сайта и смет; сам по себе ничего
 * не включает: проверки по тарифу появятся в P3.
 *
 * Кредит здесь — внутренняя единица стоимости (1 кредит = $0.001 себестоимости), клиенту не продаётся.
 */

export const TIER_IDS = ['start', 'growth', 'business', 'scale'] as const;
export type TierId = (typeof TIER_IDS)[number];

/** Помощь команды с подключением, входящая в тариф. */
export type IntegrationHelp = { kind: 'widget_install' } | { kind: 'hours'; hoursPerMonth: number };

export interface Tier {
  id: TierId;
  name: string;
  priceUsd: number;
  /** Решений с включённой версией, открытых не только владельцу. */
  activeSolutions: number;
  /** Обращений (исполнений для посетителей и по событиям) в месяц. */
  monthlyRequests: number;
  /** Подключений к системам вне Ketner с учётными данными клиента. */
  externalServices: number;
  integrationHelp: IntegrationHelp;
  /** Бесплатный лимит на создание и проверку в месяц, во внутренних кредитах (раздел 4, предложение). */
  buildAllowanceCredits: number;
}

export const TIERS: readonly Tier[] = [
  {
    id: 'start',
    name: 'Start',
    priceUsd: 10,
    activeSolutions: 1,
    monthlyRequests: 1_000,
    externalServices: 1,
    integrationHelp: { kind: 'widget_install' },
    buildAllowanceCredits: 2_000,
  },
  {
    id: 'growth',
    name: 'Growth',
    priceUsd: 29,
    activeSolutions: 3,
    monthlyRequests: 5_000,
    externalServices: 2,
    integrationHelp: { kind: 'hours', hoursPerMonth: 2 },
    buildAllowanceCredits: 4_000,
  },
  {
    id: 'business',
    name: 'Business',
    priceUsd: 89,
    activeSolutions: 10,
    monthlyRequests: 20_000,
    externalServices: 5,
    integrationHelp: { kind: 'hours', hoursPerMonth: 4 },
    buildAllowanceCredits: 8_000,
  },
  {
    id: 'scale',
    name: 'Scale',
    priceUsd: 235,
    activeSolutions: 25,
    monthlyRequests: 60_000,
    externalServices: 15,
    integrationHelp: { kind: 'hours', hoursPerMonth: 4 },
    buildAllowanceCredits: 15_000,
  },
];

/** Льготный объём сверх включённого: 10%, дальше — режим заявок. */
export const GRACE_RATE = 0.1;
/** Порог предупреждения о расходе объёма. */
export const WARN_RATE = 0.8;
/** Пробный период тарифа: место есть, выключен (раздел 9). */
export const SUBSCRIPTION_TRIAL_DAYS = 0;

/** Бесплатный лимит на создание и проверку у аккаунта без тарифа (раздел 4, предложение). */
export const NO_TIER_BUILD_ALLOWANCE = { monthlyCredits: 1_500, dailyCredits: 500 } as const;

export function isTierId(value: unknown): value is TierId {
  return typeof value === 'string' && (TIER_IDS as readonly string[]).includes(value);
}

export function tierById(id: TierId): Tier {
  const tier = TIERS.find((item) => item.id === id);
  if (!tier) throw new Error(`unknown tier: ${id}`);
  return tier;
}

/** Сколько обращений можно до режима заявок: включённые плюс льготные, вниз до целого. */
export function requestLimit(tier: Tier): number {
  return Math.floor(tier.monthlyRequests * (1 + GRACE_RATE));
}

/** Состояние объёма за период: обычная работа, предупреждение, льготный объём, режим заявок. */
export type UsageState = 'ok' | 'warning' | 'grace' | 'leads_only';

export function usageState(tier: Tier, used: number): UsageState {
  if (used >= requestLimit(tier)) return 'leads_only';
  if (used >= tier.monthlyRequests) return 'grace';
  if (used >= Math.ceil(tier.monthlyRequests * WARN_RATE)) return 'warning';
  return 'ok';
}

/** Ожидаемая нагрузка аккаунта: по ней смета выбирает тариф. */
export interface TierNeeds {
  activeSolutions: number;
  monthlyRequests: number;
  externalServices: number;
}

/** Наименьший тариф, покрывающий нагрузку; null — больше Scale (индивидуальные условия). */
export function tierFor(needs: TierNeeds): Tier | null {
  return (
    TIERS.find(
      (tier) =>
        tier.activeSolutions >= needs.activeSolutions &&
        tier.monthlyRequests >= needs.monthlyRequests &&
        tier.externalServices >= needs.externalServices,
    ) ?? null
  );
}

/** Допущения расчёта маржи (раздел 2.3). */
export const TIER_ECONOMICS = {
  /** Комиссия пополнения OpenRouter. */
  modelTopupFee: 0.055,
  /** Карта через Dodo: доля и фиксированная часть комиссии. */
  cardFeeRate: 0.06,
  cardFeeFixedUsd: 0.4,
  /** Крипта (Trybit): доля, которая доходит. */
  cryptoNetShare: 0.98,
  /** Налог с поступивших денег. */
  taxRate: 0.06,
  /** Доля инфраструктуры на клиента. */
  infraBaseUsd: 1.5,
  infraPerSolutionUsd: 0.5,
  infraPerServiceUsd: 2,
} as const;

export type PaymentChannel = 'card' | 'crypto';

/**
 * Маржа тарифа в худшем случае внутри тарифа: весь включённый объём по цене `costPerRequestUsd`.
 * Без времени команды на помощь с подключением.
 */
export function tierMargin(
  tier: Tier,
  channel: PaymentChannel,
  costPerRequestUsd: number,
): { netUsd: number; infraUsd: number; modelsUsd: number; marginUsd: number } {
  const e = TIER_ECONOMICS;
  const received =
    channel === 'card'
      ? tier.priceUsd * (1 - e.cardFeeRate) - e.cardFeeFixedUsd
      : tier.priceUsd * e.cryptoNetShare;
  const netUsd = received * (1 - e.taxRate);
  const infraUsd =
    e.infraBaseUsd +
    e.infraPerSolutionUsd * tier.activeSolutions +
    e.infraPerServiceUsd * tier.externalServices;
  const modelsUsd = tier.monthlyRequests * costPerRequestUsd * (1 + e.modelTopupFee);
  return { netUsd, infraUsd, modelsUsd, marginUsd: netUsd - infraUsd - modelsUsd };
}
