/** Ответ GET /api/usage/credits (apps/mock-api/src/services/credits.ts → CreditsReport). */

/** `normal` — кредиты есть; `exhausted` — кончились, отвечает бесплатная модель. */
export type CreditStage = 'normal' | 'exhausted';

export interface ModelCredit {
  id: string;
  name: string;
  /** Примерная цена одного запроса, кредиты (с десятыми); 0 у бесплатных моделей. */
  requestCredits: number;
  priceSource: 'observed' | 'estimate';
  /** Бесплатная модель: отвечает и кредитов не тратит. */
  free: boolean;
  /** На сколько запросов примерно хватит остатка; null у бесплатных моделей. */
  remaining: number | null;
  /** Хватает ли остатка хотя бы на один запрос. */
  affordable: boolean;
}

export interface CreditGrantInfo {
  id: string;
  kind: 'plan' | 'bonus' | 'free' | 'auto' | 'pack' | 'admin';
  amount: number;
  remaining: number;
  expiresAt: string;
}

export interface CreditsReport {
  /** Уровень доступа: `credits` у покупателя с неистраченными кредитами, иначе `free` или тариф подписчика. */
  plan: string;
  reasoningMode: 'standard' | 'max';
  /** Остаток, кредиты. */
  balance: number;
  /** Сколько кредитов выдано по действующим грантам (знаменатель шкалы остатка). */
  granted: number;
  /** Пробные кредиты, которые получает каждый пользователь один раз. */
  trialCredits: number;
  /** Есть ли неистраченные купленные кредиты (они открывают полный уровень лимитов). */
  purchased: boolean;
  stage: CreditStage;
  /** Кредиты на исходе (меньше 15% выданных, но ещё есть). */
  low: boolean;
  /** Когда сгорает ближайший грант и сколько кредитов в нём. */
  nextExpiresAt: string | null;
  nextExpiring: number;
  grants: CreditGrantInfo[];
  /** Бесплатная модель, которая отвечает, когда кредиты кончились. */
  freeModel: { id: string; name: string } | null;
  models: ModelCredit[];
}
