import planFacts from './plan-facts.json';
import type { PlanId } from './types';

export type { PlanId };

/** Сколько кредитов тратит запрос к модели и на сколько запросов хватит пакета. */
export interface PackExample {
  model: string;
  name: string;
  requestCredits: number;
  requests: number;
}

/**
 * Пакет кредитов для страницы «Кредиты», лендинга и оформления. Числа — из plan-facts.json
 * (их сверяет серверный тест plan-facts.test.ts); цена за 1 000 и скидка считаются здесь.
 */
export interface PackFacts {
  id: string;
  priceUsd: number;
  credits: number;
  /** Дополнительные кредиты при оплате криптовалютой. */
  cryptoBonusCredits: number;
  stars: number;
  /** Цена за 1 000 кредитов, $. */
  pricePerThousandUsd: number;
  /** Скидка к самому маленькому пакету, %. */
  discountPct: number;
  examples: readonly PackExample[];
}

const smallest = planFacts.packs[0];
const smallestRate = smallest.priceUsd / smallest.credits;

export const PACKS: readonly PackFacts[] = planFacts.packs.map((pack) => {
  const rate = pack.priceUsd / pack.credits;
  return {
    ...pack,
    pricePerThousandUsd: Number((rate * 1000).toFixed(2)),
    discountPct: Math.round((1 - rate / smallestRate) * 100),
  };
});

/** Пробные кредиты, которые получает каждый новый пользователь один раз. */
export const TRIAL = planFacts.trial;

/** Сколько действуют купленные кредиты, дней. */
export const PACK_VALID_DAYS = planFacts.packValidDays;

/** Бонус кредитами при оплате криптовалютой (0.15 = +15 %). */
export const CRYPTO_BONUS_RATE = planFacts.cryptoBonusRate;

export function getPack(id: string | undefined): PackFacts | undefined {
  if (!id) return undefined;
  return PACKS.find((pack) => pack.id === id);
}

/** Пакет, который предлагаем по умолчанию: средний, $10. */
export const DEFAULT_PACK_ID = 'credits-10';
