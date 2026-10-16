import { join } from 'node:path';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { findPremiumPack, planPriceUsd, PREMIUM_PACK_DAYS } from '../services/pricing.js';
import { DocStore } from '../store/doc-store.js';
import { PremiumCreditStore, type PremiumCredit } from '../store/premium-credit-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UsageStore } from '../store/usage-store.js';
import type { UserStore } from '../store/user-store.js';
import type { PlanId, Subscription, User } from '../types.js';

export const DAY_MS = 24 * 3600 * 1000;
const PERIOD_DAYS = 30;

/**
 * Правила возврата (показываются клиенту в кабинете, в /terms и на сайте):
 * вернуть оплату можно в течение 24 часов, если после неё не было ни одного запроса к моделям.
 * Звёзды возвращаются сразу, криптовалюта — вручную по заявке.
 */
export const REFUND_POLICY = {
  windowMs: 24 * 3600 * 1000,
} as const;

/** Запросы, которые считаются использованием: модель ответила (полностью или до остановки). */
const COUNTS_AS_USE = new Set(['success', 'cancelled']);

export type PaymentMethod = 'stars' | 'crypto';
export type PaymentStatus = 'paid' | 'refund_requested' | 'refunded' | 'refund_declined';

export interface PlanSnapshot {
  plan: PlanId;
  renewsAt: string | null;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  method: PaymentMethod;
  /** Тариф, который дала оплата; для пакета — тариф на момент покупки (подписка не меняется). */
  planId: PlanId;
  /** Оплачен пакет премиум-квоты (services/pricing.ts), а не тариф. */
  packId?: string;
  /** Звёзды (XTR) или доллары (USD). */
  amount: number;
  currency: 'XTR' | 'USD';
  paidAt: string;
  status: PaymentStatus;
  /** Подписка до и после этой оплаты — по ним возврат откатывает срок. */
  before: PlanSnapshot;
  after: PlanSnapshot;
  /** Дни, пересчитанные из остатка прежнего тарифа при смене тарифа. */
  bonusDays: number;
  invoiceId?: string;
  /** Номер платежа Telegram и id плательщика — нужны для возврата звёзд. */
  chargeId?: string;
  telegramUserId?: number;
  /** Платёж по подписке со звёздами (автопродление). */
  recurring?: boolean;
  /** ВРЕМЕННО: тестовая оплата с тестового баланса звёзд (настоящие звёзды не списывались). */
  test?: boolean;
  refund?: {
    requestedAt?: string;
    reason?: string;
    comment?: string;
    decidedAt?: string;
    auto?: boolean;
    note?: string;
  };
}

/** Автопродление звёздами: подписка Telegram Stars на 30 дней. */
export interface StarsSubscription {
  /** id пользователя Ketner. */
  id: string;
  planId: PlanId;
  telegramUserId: number;
  /** Номер первого платежа — по нему Telegram управляет подпиской. */
  chargeId: string;
  invoiceId: string;
  stars: number;
  status: 'active' | 'canceled';
  nextChargeAt: string | null;
  startedAt: string;
  canceledAt?: string;
}

export interface NotificationPrefs {
  /** id пользователя Ketner. */
  id: string;
  reminders: boolean;
  receipts: boolean;
}

export interface BillingLedger {
  payments: DocStore<PaymentRecord>;
  starsSubscriptions: DocStore<StarsSubscription>;
  prefs: DocStore<NotificationPrefs>;
  /** Кредиты премиум-квоты из докупленных пакетов. */
  credits: PremiumCreditStore;
}

export function createBillingLedger(dir?: string): BillingLedger {
  const file = (name: string) => (dir ? join(dir, `${name}.json`) : undefined);
  return {
    payments: new DocStore<PaymentRecord>('payments', file('payments')),
    starsSubscriptions: new DocStore<StarsSubscription>(
      'stars_subscriptions',
      file('stars-subscriptions'),
    ),
    prefs: new DocStore<NotificationPrefs>('notification_prefs', file('notification-prefs')),
    credits: new PremiumCreditStore(file('premium-credits')),
  };
}

/** То, что биллингу нужно от Telegram: возвраты, подписки и сообщения. Реализует бот. */
export interface TelegramPaymentsPort {
  refundStars(telegramUserId: number, chargeId: string): Promise<boolean>;
  setStarsSubscriptionCanceled(
    telegramUserId: number,
    chargeId: string,
    canceled: boolean,
  ): Promise<boolean>;
  notifyUser(
    userId: string,
    text: string,
    kind: 'receipt' | 'refund' | 'reminder' | 'system',
  ): Promise<void>;
  notifyAdminsAboutRefund(payment: PaymentRecord, user: User | null): Promise<void>;
}

export class BillingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export type RefundOption =
  | { kind: 'auto' }
  | { kind: 'request' }
  | { kind: 'none'; reason: 'refunded' | 'pending' | 'declined' | 'expired' | 'used' };

export interface GrantPreview {
  mode: 'new' | 'extend' | 'switch';
  renewsAt: string;
  bonusDays: number;
}

interface BillingDeps {
  userStore: UserStore;
  subscriptionStore: SubscriptionStore;
  ledger: BillingLedger;
  usageStore?: UsageStore;
}

function isRunning(sub: Subscription, now: number): boolean {
  const end = sub.renewsAt ? Date.parse(sub.renewsAt) : NaN;
  return sub.plan !== 'free' && Number.isFinite(end) && end > now;
}

/**
 * Подписки и платежи: выдача тарифа с пересчётом остатка, журнал оплат, возвраты
 * и автопродление звёздами. Один источник правды для бота, мини-приложения и сайта.
 */
export class BillingService {
  telegram: TelegramPaymentsPort | null = null;

  constructor(private readonly deps: BillingDeps) {}

  get ledger(): BillingLedger {
    return this.deps.ledger;
  }

  // ───────────── выдача тарифа ─────────────

  /**
   * Что получит человек при оплате тарифа: продление того же тарифа добавляет 30 дней к сроку,
   * смена тарифа начинает 30 дней сегодня и добавляет дни за неиспользованный остаток прежнего.
   */
  preview(userId: string, planId: PlanId, now = Date.now()): GrantPreview {
    const sub = this.deps.subscriptionStore.get(userId);
    if (isRunning(sub, now) && sub.plan === planId) {
      return {
        mode: 'extend',
        bonusDays: 0,
        renewsAt: new Date(Date.parse(sub.renewsAt!) + PERIOD_DAYS * DAY_MS).toISOString(),
      };
    }
    if (isRunning(sub, now)) {
      const leftDays = (Date.parse(sub.renewsAt!) - now) / DAY_MS;
      const credit = leftDays * (planPriceUsd(sub.plan) / PERIOD_DAYS);
      const bonusDays = Math.floor(credit / (planPriceUsd(planId) / PERIOD_DAYS));
      return {
        mode: 'switch',
        bonusDays,
        renewsAt: new Date(now + (PERIOD_DAYS + bonusDays) * DAY_MS).toISOString(),
      };
    }
    return {
      mode: 'new',
      bonusDays: 0,
      renewsAt: new Date(now + PERIOD_DAYS * DAY_MS).toISOString(),
    };
  }

  private setSubscription(
    userId: string,
    snapshot: PlanSnapshot,
    status: Subscription['status'] = 'active',
  ): Subscription {
    const sub = this.deps.subscriptionStore.set({
      userId,
      plan: snapshot.plan,
      status,
      renewsAt: snapshot.renewsAt,
    });
    const user = this.deps.userStore.findById(userId);
    this.deps.userStore.updatePlan(userId, snapshot.plan);
    // Ранние версии хранили подписку и по email: держим обе записи одинаковыми.
    if (user?.email && user.email !== userId) {
      this.deps.subscriptionStore.set({
        userId: user.email,
        plan: snapshot.plan,
        status,
        renewsAt: snapshot.renewsAt,
      });
    }
    return sub;
  }

  /**
   * Оплата прошла: выдаёт тариф и записывает платёж. Повторная доставка того же платежа
   * (тот же id) ничего не меняет и возвращает `duplicate: true`.
   */
  grant(
    userId: string,
    planId: PlanId,
    payment: {
      id: string;
      method: PaymentMethod;
      amount: number;
      currency: 'XTR' | 'USD';
      invoiceId?: string;
      chargeId?: string;
      telegramUserId?: number;
      recurring?: boolean;
      test?: boolean;
    },
    now = Date.now(),
  ): { duplicate: boolean; payment: PaymentRecord; subscription: Subscription; user: User | null } {
    const existing = this.deps.ledger.payments.get(payment.id);
    if (existing) {
      return {
        duplicate: true,
        payment: existing,
        subscription: this.deps.subscriptionStore.get(userId),
        user: this.deps.userStore.findById(userId),
      };
    }
    const current = this.deps.subscriptionStore.get(userId);
    const before: PlanSnapshot = { plan: current.plan, renewsAt: current.renewsAt };
    const preview = this.preview(userId, planId, now);
    const after: PlanSnapshot = { plan: planId, renewsAt: preview.renewsAt };
    const subscription = this.setSubscription(userId, after);
    const record = this.deps.ledger.payments.put({
      ...payment,
      userId,
      planId,
      paidAt: new Date(now).toISOString(),
      status: 'paid',
      before,
      after,
      bonusDays: preview.bonusDays,
    });
    return {
      duplicate: false,
      payment: record,
      subscription,
      user: this.deps.userStore.findById(userId),
    };
  }

  /**
   * Оплачен пакет премиум-квоты: начисляет кредиты на 30 дней и записывает платёж. Подписка не
   * меняется. Повторная доставка того же платежа (тот же id) ничего не меняет: `duplicate: true`.
   */
  grantPack(
    userId: string,
    packId: string,
    payment: {
      id: string;
      method: PaymentMethod;
      amount: number;
      currency: 'XTR' | 'USD';
      invoiceId?: string;
      chargeId?: string;
      telegramUserId?: number;
    },
    now = Date.now(),
  ): { duplicate: boolean; payment: PaymentRecord; credit: PremiumCredit } {
    const pack = findPremiumPack(packId);
    if (!pack) throw new BillingError('unknown_pack', 'Такого пакета нет', 400);
    const existing = this.deps.ledger.payments.get(payment.id);
    const { credit } = this.deps.ledger.credits.grant(
      { id: payment.id, userId, packId, amountUsd: pack.quotaUsd, days: PREMIUM_PACK_DAYS },
      now,
    );
    if (existing) return { duplicate: true, payment: existing, credit };
    const current = this.deps.subscriptionStore.get(userId);
    const snapshot: PlanSnapshot = { plan: current.plan, renewsAt: current.renewsAt };
    const record = this.deps.ledger.payments.put({
      ...payment,
      userId,
      planId: current.plan,
      packId,
      paidAt: new Date(now).toISOString(),
      status: 'paid',
      before: snapshot,
      after: snapshot,
      bonusDays: 0,
    });
    return { duplicate: false, payment: record, credit };
  }

  /**
   * Оплачен ли текущий период тарифа криптовалютой: есть оплата тарифа через Trybit (не пакет, не
   * возвращённая), чей период покрывает `now`. Период оплаты — от её даты (а при продлении того же
   * тарифа — от прежнего срока) до срока, который она дала. Даёт бонус к премиум-квоте
   * (services/entitlement.ts → CRYPTO_PREMIUM_BONUS).
   */
  cryptoBonusActive(userId: string, plan: PlanId, now = Date.now()): boolean {
    return this.deps.ledger.payments
      .filter(
        (payment) =>
          payment.userId === userId &&
          payment.method === 'crypto' &&
          !payment.packId &&
          payment.status !== 'refunded' &&
          payment.planId === plan,
      )
      .some((payment) => {
        const end = payment.after.renewsAt ? Date.parse(payment.after.renewsAt) : NaN;
        const paidAt = Date.parse(payment.paidAt);
        const previousEnd =
          payment.before.plan === payment.planId && payment.before.renewsAt
            ? Date.parse(payment.before.renewsAt)
            : NaN;
        const start = previousEnd > paidAt ? previousEnd : paidAt;
        return now >= start && now < end;
      });
  }

  paymentsOf(userId: string): PaymentRecord[] {
    return this.deps.ledger.payments
      .filter((payment) => payment.userId === userId)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  }

  findPayment(paymentId: string): PaymentRecord | undefined {
    return this.deps.ledger.payments.get(paymentId);
  }

  findByCharge(chargeId: string): PaymentRecord | undefined {
    return this.deps.ledger.payments.filter((payment) => payment.chargeId === chargeId)[0];
  }

  // ───────────── возвраты ─────────────

  /** Сколько раз после оплаты модели ответили этому человеку (ошибки и отказы по лимитам не считаются). */
  requestsSince(userId: string, sinceIso: string): number {
    const records = this.deps.usageStore?.getByUser(userId, 500) ?? [];
    return records.filter(
      (record) => record.createdAt >= sinceIso && COUNTS_AS_USE.has(record.status),
    ).length;
  }

  refundOption(payment: PaymentRecord, now = Date.now()): RefundOption {
    if (payment.status === 'refunded') return { kind: 'none', reason: 'refunded' };
    if (payment.status === 'refund_requested') return { kind: 'none', reason: 'pending' };
    if (payment.status === 'refund_declined') return { kind: 'none', reason: 'declined' };
    if (now - Date.parse(payment.paidAt) > REFUND_POLICY.windowMs)
      return { kind: 'none', reason: 'expired' };
    if (payment.packId) {
      // Пакет возвращается, пока из него ничего не потрачено (запросы по квоте тарифа не в счёт).
      const credit = this.deps.ledger.credits.get(payment.id);
      if (credit && credit.remainingUsd < credit.amountUsd) return { kind: 'none', reason: 'used' };
    } else if (this.requestsSince(payment.userId, payment.paidAt) > 0) {
      return { kind: 'none', reason: 'used' };
    }
    // Звёзды Telegram возвращает сам и сразу; криптовалюту администратор переводит вручную.
    // Тестовую оплату возвращает администратор по заявке (рассмотрение до 3 дней).
    const instant =
      !payment.test &&
      payment.method === 'stars' &&
      Boolean(payment.chargeId && payment.telegramUserId);
    return instant ? { kind: 'auto' } : { kind: 'request' };
  }

  /** Возврат по запросу клиента: сразу (звёзды, по правилам) или заявкой администратору. */
  async requestRefund(
    userId: string,
    paymentId: string,
    details: { reason?: string; comment?: string } = {},
    now = Date.now(),
  ): Promise<{ outcome: 'refunded' | 'requested'; payment: PaymentRecord }> {
    const payment = this.deps.ledger.payments.get(paymentId);
    if (!payment || payment.userId !== userId)
      throw new BillingError('payment_not_found', 'Платёж не найден', 404);
    const option = this.refundOption(payment, now);
    if (option.kind === 'none') {
      const messages = {
        refunded: 'Деньги за этот платёж уже возвращены.',
        pending: 'Заявка на возврат уже отправлена — ответим в течение суток.',
        declined:
          'По этому платежу в возврате уже отказано. Напишите в поддержку, если не согласны.',
        expired: 'Вернуть оплату можно только в течение 24 часов после неё.',
        used: 'После этой оплаты моделями уже пользовались, поэтому вернуть её нельзя. Возврат возможен в течение 24 часов, если не было ни одного запроса.',
      } as const;
      throw new BillingError(`refund_${option.reason}`, messages[option.reason], 409);
    }
    const refund = {
      requestedAt: new Date(now).toISOString(),
      reason: details.reason?.slice(0, 60),
      comment: details.comment?.slice(0, 500),
    };
    if (option.kind === 'auto' && this.telegram) {
      const ok = await this.telegram.refundStars(payment.telegramUserId!, payment.chargeId!);
      if (ok) {
        const refunded = this.completeRefund({ ...payment, refund }, { auto: true }, now);
        await this.telegram.notifyUser(
          userId,
          `↩️ Вернули <b>${payment.amount} ⭐</b> за ${paymentLabel(payment)}. Звёзды уже на вашем балансе в Telegram.`,
          'refund',
        );
        return { outcome: 'refunded', payment: refunded };
      }
      // Telegram не принял автоматический возврат — передаём заявку человеку.
    }
    const requested = this.deps.ledger.payments.put({
      ...payment,
      status: 'refund_requested',
      refund,
    });
    await this.telegram?.notifyAdminsAboutRefund(requested, this.deps.userStore.findById(userId));
    return { outcome: 'requested', payment: requested };
  }

  /** Решение администратора по заявке. Звёзды возвращаются через Telegram, крипта — вручную. */
  async decideRefund(
    paymentId: string,
    approve: boolean,
    note?: string,
    now = Date.now(),
  ): Promise<PaymentRecord> {
    const payment = this.deps.ledger.payments.get(paymentId);
    if (!payment) throw new BillingError('payment_not_found', 'Платёж не найден', 404);
    if (payment.status !== 'refund_requested') {
      throw new BillingError('refund_not_pending', 'По этому платежу нет открытой заявки', 409);
    }
    if (!approve) {
      const declined = this.deps.ledger.payments.put({
        ...payment,
        status: 'refund_declined',
        refund: { ...payment.refund, decidedAt: new Date(now).toISOString(), note },
      });
      await this.telegram?.notifyUser(
        payment.userId,
        `По заявке на возврат за ${paymentLabel(payment)} ответ отрицательный${note ? `: ${escapeHtml(note)}` : '.'} Если есть вопросы — напишите в поддержку @ketner_support_bot.`,
        'refund',
      );
      return declined;
    }
    if (payment.method === 'stars' && !payment.test) {
      if (!payment.chargeId || !payment.telegramUserId || !this.telegram) {
        throw new BillingError(
          'refund_unavailable',
          'У платежа нет данных Telegram для возврата',
          409,
        );
      }
      const ok = await this.telegram.refundStars(payment.telegramUserId, payment.chargeId);
      if (!ok)
        throw new BillingError(
          'refund_failed',
          'Telegram не принял возврат. Попробуйте позже.',
          502,
        );
    }
    const refunded = this.completeRefund(payment, { auto: false, note }, now);
    await this.telegram?.notifyUser(
      payment.userId,
      payment.test
        ? `↩️ Возврат одобрен: <b>${payment.amount} ⭐</b> вернулись на тестовый баланс.`
        : payment.method === 'stars'
          ? `↩️ Возврат одобрен: <b>${payment.amount} ⭐</b> вернулись на ваш баланс в Telegram.`
          : `↩️ Возврат одобрен: <b>$${payment.amount}</b> отправим на ваш кошелёк, напишите его в поддержку @ketner_support_bot, если ещё не указали.`,
      'refund',
    );
    return refunded;
  }

  /** Telegram сам сообщил о возврате (refunded_payment) — откатываем срок, если ещё не откатили. */
  markRefundedByTelegram(chargeId: string, now = Date.now()): PaymentRecord | null {
    const payment = this.findByCharge(chargeId);
    if (!payment || payment.status === 'refunded') return null;
    return this.completeRefund(payment, { auto: false, note: 'refunded_payment' }, now);
  }

  pendingRefunds(): PaymentRecord[] {
    return this.deps.ledger.payments
      .filter((payment) => payment.status === 'refund_requested')
      .sort((a, b) => (a.refund?.requestedAt ?? '').localeCompare(b.refund?.requestedAt ?? ''));
  }

  private completeRefund(
    payment: PaymentRecord,
    meta: { auto: boolean; note?: string },
    now: number,
  ): PaymentRecord {
    this.revert(payment, now);
    if (payment.recurring) {
      const sub = this.deps.ledger.starsSubscriptions.get(payment.userId);
      if (sub && sub.status === 'active' && this.telegram) {
        void this.telegram.setStarsSubscriptionCanceled(sub.telegramUserId, sub.chargeId, true);
        this.deps.ledger.starsSubscriptions.put({
          ...sub,
          status: 'canceled',
          canceledAt: new Date(now).toISOString(),
        });
      }
    }
    return this.deps.ledger.payments.put({
      ...payment,
      status: 'refunded',
      refund: {
        ...payment.refund,
        decidedAt: new Date(now).toISOString(),
        auto: meta.auto,
        note: meta.note,
      },
    });
  }

  /** Снимает с подписки (или с кредитов пакета) то, что дала эта оплата. */
  private revert(payment: PaymentRecord, now: number): void {
    if (payment.packId) {
      this.deps.ledger.credits.revoke(payment.id);
      return;
    }
    const current = this.deps.subscriptionStore.get(payment.userId);
    const untouched =
      current.plan === payment.after.plan && current.renewsAt === payment.after.renewsAt;
    const restore = (snapshot: PlanSnapshot) => {
      const end = snapshot.renewsAt ? Date.parse(snapshot.renewsAt) : NaN;
      if (snapshot.plan !== 'free' && Number.isFinite(end) && end > now)
        this.setSubscription(payment.userId, snapshot);
      else this.setSubscription(payment.userId, { plan: 'free', renewsAt: null });
    };
    if (untouched) {
      restore(payment.before);
      return;
    }
    // После этой оплаты были другие: снимаем её 30 дней с текущего срока того же тарифа.
    if (current.plan === payment.planId && current.renewsAt) {
      restore({
        plan: current.plan,
        renewsAt: new Date(Date.parse(current.renewsAt) - PERIOD_DAYS * DAY_MS).toISOString(),
      });
    }
  }

  // ───────────── автопродление звёздами ─────────────

  starsSubscriptionOf(userId: string): StarsSubscription | undefined {
    return this.deps.ledger.starsSubscriptions.get(userId);
  }

  /** Первая оплата подписки со звёздами: прежняя подписка на другой тариф отключается. */
  async startStarsSubscription(
    sub: Omit<StarsSubscription, 'id' | 'status' | 'startedAt'> & { userId: string },
    now = Date.now(),
  ) {
    const previous = this.deps.ledger.starsSubscriptions.get(sub.userId);
    if (
      previous &&
      previous.status === 'active' &&
      previous.chargeId !== sub.chargeId &&
      this.telegram
    ) {
      await this.telegram.setStarsSubscriptionCanceled(
        previous.telegramUserId,
        previous.chargeId,
        true,
      );
    }
    const { userId, ...rest } = sub;
    return this.deps.ledger.starsSubscriptions.put({
      ...rest,
      id: userId,
      status: 'active',
      startedAt: new Date(now).toISOString(),
    });
  }

  renewStarsSubscription(
    userId: string,
    nextChargeAt: string | null,
  ): StarsSubscription | undefined {
    const sub = this.deps.ledger.starsSubscriptions.get(userId);
    if (!sub) return undefined;
    return this.deps.ledger.starsSubscriptions.put({ ...sub, nextChargeAt });
  }

  async setAutoRenew(
    userId: string,
    enabled: boolean,
    now = Date.now(),
  ): Promise<StarsSubscription> {
    const sub = this.deps.ledger.starsSubscriptions.get(userId);
    if (!sub) throw new BillingError('no_auto_renew', 'Автопродление не подключено', 404);
    if (!this.telegram) throw new BillingError('telegram_unavailable', 'Telegram недоступен', 503);
    const ok = await this.telegram.setStarsSubscriptionCanceled(
      sub.telegramUserId,
      sub.chargeId,
      !enabled,
    );
    if (!ok) {
      throw new BillingError(
        'auto_renew_failed',
        enabled
          ? 'Не получилось включить автопродление. Оформите подписку заново на вкладке «Тарифы».'
          : 'Telegram не ответил. Попробуйте ещё раз.',
        502,
      );
    }
    return this.deps.ledger.starsSubscriptions.put({
      ...sub,
      status: enabled ? 'active' : 'canceled',
      canceledAt: enabled ? undefined : new Date(now).toISOString(),
    });
  }

  // ───────────── уведомления ─────────────

  prefsOf(userId: string): NotificationPrefs {
    return this.deps.ledger.prefs.get(userId) ?? { id: userId, reminders: true, receipts: true };
  }

  setPrefs(userId: string, patch: Partial<Omit<NotificationPrefs, 'id'>>): NotificationPrefs {
    const current = this.prefsOf(userId);
    return this.deps.ledger.prefs.put({
      ...current,
      ...(typeof patch.reminders === 'boolean' ? { reminders: patch.reminders } : {}),
      ...(typeof patch.receipts === 'boolean' ? { receipts: patch.receipts } : {}),
    });
  }
}

const PLAN_LABELS: Record<string, string> = { plus: 'Plus', pro: 'Pro', ultra: 'Ultra' };

export function planLabel(planId: string): string {
  return PLAN_LABELS[planId] ?? planId.toUpperCase();
}

/** Название пакета премиум-квоты для чеков и сообщений: «пакет +$5 премиум-квоты». */
export function packLabel(packId: string): string {
  const pack = findPremiumPack(packId);
  return pack ? `пакет +$${pack.quotaUsd} премиум-квоты` : 'пакет премиум-квоты';
}

/** За что платёж: тариф или пакет. */
export function paymentLabel(payment: Pick<PaymentRecord, 'planId' | 'packId'>): string {
  return payment.packId ? packLabel(payment.packId) : planLabel(payment.planId);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Каталог данных рядом с остальными файлами хранилищ. */
export const defaultLedgerDir = process.env.BILLING_LEDGER_DIR || dirname(config.userStoreFile);
