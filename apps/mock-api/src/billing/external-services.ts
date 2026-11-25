/**
 * Внешние сервисы тарифа (решение владельца 23.11.2026, docs/SUBSCRIPTION_PRICING_DESIGN.md, 2.1):
 * системы данных с учётными данными клиента — Google Таблицы, CRM, календарь. Каналы (страница бота,
 * виджет, Telegram-бот клиента, позже WhatsApp) внешними сервисами не считаются и есть на любом
 * тарифе.
 *
 * Подключение внешнего сервиса требует активного тарифа со свободным местом. Проверка — при
 * подключении, а не при работе: уже подключённый сервис не отключается, если место кончилось
 * (тариф понизили), он только учитывается. Переподключение того же сервиса места не занимает.
 */

import { TIERS, tierById, type Tier, type TierId } from '../services/tiers.js';

export type ServiceConnectCheck =
  | { ok: true }
  | { ok: false; code: 'tier_required'; message: string }
  | {
      ok: false;
      code: 'service_limit';
      message: string;
      used: number;
      limit: number;
      tier: TierId;
      nextTier: TierId | null;
    };

/** Ближайший тариф, где сервисов больше, чем в этом. */
export function nextTierWithMoreServices(tier: Tier): Tier | null {
  return TIERS.find((item) => item.externalServices > tier.externalServices) ?? null;
}

export function tierRequiredMessage(): string {
  return 'Подключение внешних сервисов (Google Таблицы, CRM, календарь) работает при активном тарифе. Тариф подключает команда Ketner — выберите его на странице «Тарифы».';
}

export function serviceLimitMessage(used: number, tier: Tier, next: Tier | null): string {
  const head = `Внешних сервисов: ${used} из ${tier.externalServices} — тариф ${tier.name}.`;
  return next
    ? `${head} Чтобы подключить ещё один, нужен тариф ${next.name} (до ${next.externalServices}) — или отключите один из подключённых.`
    : `${head} Это наибольший тариф: напишите нам, подберём условия.`;
}

/**
 * Можно ли подключить внешний сервис. `alreadyConnected` — этот сервис уже подключён (повторное
 * согласие, переподключение после отзыва, выбор прежней таблицы): место не нужно, но тариф нужен.
 */
export function checkServiceConnect(input: {
  tier: TierId | null;
  used: number;
  alreadyConnected: boolean;
}): ServiceConnectCheck {
  if (!input.tier) return { ok: false, code: 'tier_required', message: tierRequiredMessage() };
  if (input.alreadyConnected) return { ok: true };
  const tier = tierById(input.tier);
  if (input.used < tier.externalServices) return { ok: true };
  const next = nextTierWithMoreServices(tier);
  return {
    ok: false,
    code: 'service_limit',
    message: serviceLimitMessage(input.used, tier, next),
    used: input.used,
    limit: tier.externalServices,
    tier: tier.id,
    nextTier: next?.id ?? null,
  };
}
