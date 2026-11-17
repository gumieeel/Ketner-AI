/**
 * Кто делает возможность: сам клиент в Ketner или команда (решение владельца 16.11.2026).
 *
 * - «Сам в Ketner» — все работы есть в Ketner (статус `available`): помощник, бот, кнопка на сайте,
 *   заявки, передача человеку. Прайс-лист, вставленный в знания помощника, — тоже, но только если
 *   он помещается в лимит знаний помощника. Цены в тенге и сроков у такой карточки нет: клиент
 *   платит за тариф, а не за работу команды.
 * - «Команда» — нужна работа, которой в Ketner нет: интеграции, обработка заказов, большой каталог.
 *   Такая карточка показывает оценку в тенге; работа по интеграциям — только на платном тарифе.
 * - «Запланировано» — в работе есть то, что Ketner пока не делает (WhatsApp, Instagram, 1С, Kaspi):
 *   ни цены, ни оценки команды, пока владелец не решит это поддерживать.
 *
 * Тариф — из services/tiers.ts (единственный источник названий, цен и объёмов).
 */

import { PLATFORM_LIMITS } from '../services/discovery-limits.js';
import { tierFor } from '../services/tiers.js';
import type { CatalogItem } from './catalog.js';
import type { EstimateResult } from './engine.js';

/**
 * Работы, которые остаются «запланировано» независимо от сохранённой версии каталога, пока Ketner
 * не подключается к этим каналам (раньше в каталоге они были «делает команда»).
 */
export const PLANNED_UNTIL_SUPPORTED: readonly string[] = [
  'whatsapp_business_integration',
  'instagram_direct_integration',
];

/** Прайс-лист или каталог, перенесённый в знания помощника. */
export const PRICE_LIST_WORK = 'product_catalog_processing';

/** Лимит знаний помощника, символов (тот же, что проверяет конструктор). */
export const KNOWLEDGE_LIMIT_CHARS = PLATFORM_LIMITS.assistants.knowledgeChars;

/**
 * Допущение: строка прайс-листа (название, цена, короткое условие) — около 80 символов. 8 000
 * символов — примерно 100 позиций.
 */
export const CHARS_PER_PRICE_LINE = 80;

/** Каталог в силе: WhatsApp и Instagram — «запланировано», что бы ни было в сохранённой версии. */
export function catalogInForce(catalog: readonly CatalogItem[]): CatalogItem[] {
  return catalog.map((item) =>
    PLANNED_UNTIL_SUPPORTED.includes(item.id) && item.status !== 'disabled'
      ? { ...item, status: 'planned' }
      : item,
  );
}

export interface PriceListFit {
  /** fits — помещается; too_large — не помещается; unknown — размер не назван. */
  status: 'fits' | 'too_large' | 'unknown';
  limitChars: number;
  /** Позиций, которые помещаются в лимит. */
  maxPositions: number;
  positions: number | null;
}

export function priceListFit(positions: number | null | undefined): PriceListFit {
  const maxPositions = Math.floor(KNOWLEDGE_LIMIT_CHARS / CHARS_PER_PRICE_LINE);
  const known = typeof positions === 'number' && positions > 0 ? positions : null;
  return {
    status: known === null ? 'unknown' : known <= maxPositions ? 'fits' : 'too_large',
    limitChars: KNOWLEDGE_LIMIT_CHARS,
    maxPositions,
    positions: known,
  };
}

export type DeliveryKind = 'self_service' | 'team' | 'planned';

export interface DeliveryContext {
  /** Позиций в прайс-листе со слов человека; null — не назвал. */
  catalogPositions: number | null;
  /** Обращений в месяц со слов человека; null — не назвал. */
  monthlyRequests: number | null;
}

export interface Delivery {
  kind: DeliveryKind;
  /** Работы, которых в Ketner пока нет (для «запланировано»). */
  plannedWork: string[];
  /** Работы команды (для «команда»). */
  teamWork: string[];
  /** Прайс-лист в знаниях помощника: есть ли такая работа и помещается ли. */
  priceList: PriceListFit | null;
  /** Работа по интеграциям — только на платном тарифе. */
  paidTierRequired: boolean;
  /**
   * Наименьший тариф под нагрузку (services/tiers.ts); null — больше самого большого тарифа или
   * карточка «запланировано».
   */
  tier: { id: string; name: string; priceUsd: number; monthlyRequests: number } | null;
  /** Объём обращений назван человеком (иначе тариф подобран по минимальной нагрузке). */
  volumeKnown: boolean;
}

/**
 * Классификация сметы. `solutions` — сколько решений включается (у общей сметы — несколько).
 * Работает и по старым сохранённым сметам: WhatsApp и Instagram в строках — тоже «запланировано».
 */
export function deliveryOf(
  result: EstimateResult,
  context: DeliveryContext,
  language: 'ru' | 'en' = 'ru',
  solutions = result.opportunityIds.length || 1,
): Delivery {
  const work = result.lines.filter((line) => !line.projectTask);
  const planned = [
    ...result.excluded
      .filter((item) => item.reason === 'not_offered')
      .map((item) => item.name ?? item.capabilityId),
    ...work
      .filter((line) => PLANNED_UNTIL_SUPPORTED.includes(line.capabilityId))
      .map((line) => line.name[language]),
  ];
  const priceList = work.some((line) => line.capabilityId === PRICE_LIST_WORK)
    ? priceListFit(context.catalogPositions)
    : null;
  const team = work.filter(
    (line) =>
      line.status !== 'available' &&
      !(line.capabilityId === PRICE_LIST_WORK && priceList?.status !== 'too_large'),
  );
  const unknownWork = result.excluded.some((item) => item.reason === 'unknown_capability');
  const kind: DeliveryKind =
    planned.length > 0
      ? 'planned'
      : team.length > 0 || unknownWork || work.length === 0
        ? 'team'
        : 'self_service';
  const externalServices =
    kind === 'team'
      ? team.filter((line) => line.category === 'integration' || line.category === 'channel').length
      : 0;
  const tier =
    kind === 'planned'
      ? null
      : tierFor({
          activeSolutions: solutions,
          monthlyRequests: context.monthlyRequests ?? 0,
          externalServices,
        });
  return {
    kind,
    plannedWork: [...new Set(planned)],
    teamWork: team.map((line) => line.name[language]),
    priceList,
    paidTierRequired: kind === 'team',
    tier: tier
      ? {
          id: tier.id,
          name: tier.name,
          priceUsd: tier.priceUsd,
          monthlyRequests: tier.monthlyRequests,
        }
      : null,
    volumeKnown: context.monthlyRequests !== null,
  };
}
