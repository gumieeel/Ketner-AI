/**
 * Кредиты для тестов: хранилище в памяти, без файлов и базы.
 *
 * При первом обращении Free получает пробные кредиты (`TRIAL_CREDITS`), а подписчик прежней системы —
 * месячный грант тарифа (services/credits.ts); `setBalance` доводит остаток до нужного.
 */

import { CreditStore, DAY_MS } from '../store/credit-store.js';
import type { PlanId } from '../types.js';
import { CreditService, toUsd } from './credits.js';

export function memoryCredits(): CreditService {
  return new CreditService(new CreditStore());
}

let sequence = 0;

/** Оставляет пользователю ровно `credits` кредитов: лишнее списывает, недостающее выдаёт. */
export function setBalance(
  service: CreditService,
  userId: string,
  plan: PlanId,
  credits: number,
): void {
  const target = toUsd(credits);
  const current = service.balance(userId, plan).remainingUsd;
  if (current > target) {
    service.charge(userId, current - target);
  } else if (target > current) {
    sequence += 1;
    service.store.grant({
      id: `fixture:${userId}:${sequence}`,
      userId,
      kind: 'admin',
      amountUsd: target - current,
      expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    });
  }
}

/** Все кредиты потрачены. */
export function exhaust(service: CreditService, userId: string, plan: PlanId): void {
  setBalance(service, userId, plan, 0);
}
