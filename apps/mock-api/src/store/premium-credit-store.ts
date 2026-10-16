/**
 * Кредиты премиум-квоты из докупленных пакетов (services/pricing.ts → PREMIUM_PACKS).
 *
 * Кредит — это доллары расхода на премиум-модели сверх квоты тарифа. Он создаётся оплатой пакета
 * (id кредита = id платежа, поэтому повторная доставка платежа второй кредит не создаёт), действует
 * 30 дней и тратится только после основной квоты: шлюз списывает с кредитов ту часть стоимости
 * запроса, которую квота тарифа уже не покрывает (services/premium-quota.ts). Списание идёт с
 * кредита, который сгорает раньше.
 */

import { DocStore } from './doc-store.js';

export interface PremiumCredit {
  /** Совпадает с id платежа, который его создал. */
  id: string;
  userId: string;
  packId: string;
  /** Сколько премиум-квоты дал пакет, $. */
  amountUsd: number;
  /** Сколько осталось, $. */
  remainingUsd: number;
  purchasedAt: string;
  expiresAt: string;
  status: 'active' | 'refunded';
}

/** То, что шлюзу и подсказке остатка нужно от кредитов. */
export interface PremiumCreditSource {
  balanceOf(userId: string, now?: number): { remainingUsd: number; nextExpiresAt: string | null };
  /** Списать до `amountUsd` с действующих кредитов; возвращает, сколько списано. */
  debit(userId: string, amountUsd: number, now?: number): number;
}

const DAY_MS = 24 * 3600 * 1000;
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

export class PremiumCreditStore extends DocStore<PremiumCredit> implements PremiumCreditSource {
  constructor(file?: string) {
    super('premium_credits', file);
  }

  /** Действующие кредиты пользователя: первым — тот, что сгорает раньше. */
  activeOf(userId: string, now = Date.now()): PremiumCredit[] {
    return this.filter(
      (credit) =>
        credit.userId === userId &&
        credit.status === 'active' &&
        credit.remainingUsd > 0 &&
        Date.parse(credit.expiresAt) > now,
    ).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  /** Все кредиты пользователя (для кабинета), новые сверху. */
  allOf(userId: string): PremiumCredit[] {
    return this.filter((credit) => credit.userId === userId).sort((a, b) =>
      b.purchasedAt.localeCompare(a.purchasedAt),
    );
  }

  balanceOf(
    userId: string,
    now = Date.now(),
  ): { remainingUsd: number; nextExpiresAt: string | null } {
    const active = this.activeOf(userId, now);
    return {
      remainingUsd: round6(active.reduce((sum, credit) => sum + credit.remainingUsd, 0)),
      nextExpiresAt: active[0]?.expiresAt ?? null,
    };
  }

  debit(userId: string, amountUsd: number, now = Date.now()): number {
    let left = amountUsd;
    for (const credit of this.activeOf(userId, now)) {
      if (left <= 0) break;
      const take = Math.min(credit.remainingUsd, left);
      this.put({ ...credit, remainingUsd: round6(credit.remainingUsd - take) });
      left -= take;
    }
    return round6(amountUsd - Math.max(0, left));
  }

  /** Кредит за оплаченный пакет. Тот же id платежа второй раз ничего не создаёт. */
  grant(
    input: { id: string; userId: string; packId: string; amountUsd: number; days: number },
    now = Date.now(),
  ): { credit: PremiumCredit; duplicate: boolean } {
    const existing = this.get(input.id);
    if (existing) return { credit: existing, duplicate: true };
    const credit = this.put({
      id: input.id,
      userId: input.userId,
      packId: input.packId,
      amountUsd: input.amountUsd,
      remainingUsd: input.amountUsd,
      purchasedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.days * DAY_MS).toISOString(),
      status: 'active',
    });
    return { credit, duplicate: false };
  }

  /** Возврат пакета: кредит больше не тратится. */
  revoke(id: string): PremiumCredit | undefined {
    const credit = this.get(id);
    if (!credit) return undefined;
    return this.put({ ...credit, status: 'refunded', remainingUsd: 0 });
  }
}
