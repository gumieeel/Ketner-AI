/**
 * Кредиты пользователя: единственный пул на чат, картинки и Ketner Code.
 *
 * Кредит — это доля реальной себестоимости запроса: внутри хранилища всё считается в долларах
 * (1 кредит = $0.001, см. services/credits.ts), потому что провайдер присылает именно стоимость.
 * Начисление называется «грант»: оплата тарифа, бонус за крипту, бесплатный месячный грант Free,
 * ручная выдача администратором. У каждого гранта есть срок: оплаченные кредиты живут весь
 * оплаченный период и ещё один (остаток переносится на один период), поэтому на списании первым
 * идёт грант, который сгорает раньше.
 *
 * Идентификатор гранта делает начисление идемпотентным: повторная доставка платежа (тот же id)
 * второй грант не создаёт.
 */

import { DocStore } from './doc-store.js';

export type CreditGrantKind =
  /** Кредиты тарифа за оплаченный период. */
  | 'plan'
  /** Бонус за оплату тарифа криптовалютой. */
  | 'bonus'
  /** Месячный грант Free-тира. */
  | 'free'
  /** Кредиты тарифа без платежа: VIP, тариф, выданный администратором, переход с прежней системы. */
  | 'auto'
  /** Остаток докупленного пакета премиум-квоты (пакеты больше не продаются). */
  | 'pack'
  /** Ручная выдача администратором. */
  | 'admin';

export interface CreditGrant {
  /** Для платежа — `${payment.id}` (тариф) или `${payment.id}:bonus`. */
  id: string;
  userId: string;
  kind: CreditGrantKind;
  /** Тариф, по которому выдан грант (для кабинета). */
  planId?: string;
  /** Платёж, который создал грант: по нему возврат отзывает кредиты. */
  paymentId?: string;
  /** Сколько выдано, $ себестоимости. */
  amountUsd: number;
  /** Сколько осталось, $. */
  remainingUsd: number;
  grantedAt: string;
  expiresAt: string;
  status: 'active' | 'revoked';
  note?: string;
}

export interface CreditBalance {
  /** Всего доступно сейчас, $. */
  remainingUsd: number;
  /** Когда сгорает ближайший грант, в котором ещё есть кредиты. */
  nextExpiresAt: string | null;
  /** Сколько кредитов сгорит в этот момент, $. */
  nextExpiringUsd: number;
}

/** Старые кредиты докупленных пакетов (до перехода на кредитную систему). */
export interface LegacyPremiumCredit {
  id: string;
  userId: string;
  packId: string;
  amountUsd: number;
  remainingUsd: number;
  purchasedAt: string;
  expiresAt: string;
  status: 'active' | 'refunded';
}

export const DAY_MS = 24 * 3600 * 1000;
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

export interface GrantInput {
  id: string;
  userId: string;
  kind: CreditGrantKind;
  amountUsd: number;
  /** Когда грант сгорает (ISO). */
  expiresAt: string;
  planId?: string;
  paymentId?: string;
  note?: string;
}

export class CreditStore extends DocStore<CreditGrant> {
  /** Идентификаторы грантов по пользователям: баланс спрашивают на каждый запрос. */
  private byUser: Map<string, Set<string>> | null = null;

  constructor(file?: string) {
    super('credit_grants', file);
  }

  private index(): Map<string, Set<string>> {
    if (!this.byUser) {
      this.byUser = new Map();
      for (const grant of this.all()) this.track(grant);
    }
    return this.byUser;
  }

  private track(grant: Pick<CreditGrant, 'id' | 'userId'>): void {
    const ids = this.byUser!.get(grant.userId) ?? new Set<string>();
    ids.add(grant.id);
    this.byUser!.set(grant.userId, ids);
  }

  override put(doc: CreditGrant): CreditGrant {
    const saved = super.put(doc);
    if (this.byUser) this.track(saved);
    return saved;
  }

  override remove(id: string): boolean {
    const grant = this.get(id);
    const removed = super.remove(id);
    if (grant) this.byUser?.get(grant.userId)?.delete(id);
    return removed;
  }

  override loadExternal(docs: CreditGrant[]): void {
    super.loadExternal(docs);
    this.byUser = null;
  }

  /** Все гранты пользователя в порядке хранения. */
  private grantsOf(userId: string): CreditGrant[] {
    const ids = this.index().get(userId);
    if (!ids) return [];
    const grants: CreditGrant[] = [];
    for (const id of ids) {
      const grant = this.get(id);
      if (grant) grants.push(grant);
    }
    return grants;
  }

  /** Гранты, из которых ещё можно тратить: первым — тот, что сгорает раньше. */
  activeOf(userId: string, now = Date.now()): CreditGrant[] {
    return this.grantsOf(userId)
      .filter(
        (grant) =>
          grant.status === 'active' && grant.remainingUsd > 0 && Date.parse(grant.expiresAt) > now,
      )
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  }

  /**
   * Не отозванные гранты с неистёкшим сроком, даже если кредиты потрачены: по ним решают, пора ли
   * выдавать новый грант (потраченный месячный грант Free не возобновляется раньше срока).
   */
  liveOf(userId: string, now = Date.now()): CreditGrant[] {
    return this.grantsOf(userId).filter(
      (grant) => grant.status === 'active' && Date.parse(grant.expiresAt) > now,
    );
  }

  /** Все гранты пользователя (для кабинета), новые сверху. */
  allOf(userId: string): CreditGrant[] {
    return this.grantsOf(userId).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
  }

  balanceOf(userId: string, now = Date.now()): CreditBalance {
    const active = this.activeOf(userId, now);
    const first = active[0];
    return {
      remainingUsd: round6(active.reduce((sum, grant) => sum + grant.remainingUsd, 0)),
      nextExpiresAt: first?.expiresAt ?? null,
      nextExpiringUsd: first
        ? round6(
            active
              .filter((grant) => grant.expiresAt === first.expiresAt)
              .reduce((sum, grant) => sum + grant.remainingUsd, 0),
          )
        : 0,
    };
  }

  debit(userId: string, amountUsd: number, now = Date.now()): number {
    if (!(amountUsd > 0)) return 0;
    let left = amountUsd;
    for (const grant of this.activeOf(userId, now)) {
      if (left <= 0) break;
      const take = Math.min(grant.remainingUsd, left);
      this.put({ ...grant, remainingUsd: round6(grant.remainingUsd - take) });
      left -= take;
    }
    return round6(amountUsd - Math.max(0, left));
  }

  /** Начисление. Тот же id второй раз ничего не создаёт. */
  grant(input: GrantInput, now = Date.now()): { grant: CreditGrant; duplicate: boolean } {
    const existing = this.get(input.id);
    if (existing) return { grant: existing, duplicate: true };
    const grant = this.put({
      id: input.id,
      userId: input.userId,
      kind: input.kind,
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
      amountUsd: round6(input.amountUsd),
      remainingUsd: round6(input.amountUsd),
      grantedAt: new Date(now).toISOString(),
      expiresAt: input.expiresAt,
      status: 'active',
      ...(input.note ? { note: input.note } : {}),
    });
    return { grant, duplicate: false };
  }

  /** Возврат платежа: кредиты, которые он дал, больше не тратятся. */
  revokeByPayment(paymentId: string): CreditGrant[] {
    return this.filter((grant) => grant.paymentId === paymentId).map((grant) =>
      this.put({ ...grant, status: 'revoked', remainingUsd: 0 }),
    );
  }

  /** Потрачено ли что-нибудь из кредитов, которые дал платёж (для правила возврата). */
  spentFromPayment(paymentId: string): number {
    return round6(
      this.filter((grant) => grant.paymentId === paymentId).reduce(
        (sum, grant) => sum + (grant.amountUsd - grant.remainingUsd),
        0,
      ),
    );
  }
}
