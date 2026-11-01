/**
 * Подписка «Автоматизации» через Dodo Payments (docs/AUTOMATION_PLAN.md, этап E).
 *
 * $15 в месяц = 7 500 кредитов на период; первый месяц бесплатно — 2 000 кредитов, карта
 * сохраняется сразу (пробный период Dodo: подписка `active`, первое списание — в конце пробного
 * месяца). Dodo — продавец для покупателя (налоги, возвраты, споры на нём).
 *
 * Деньги и доступ — только по проверенным вебхукам (Standard Webhooks, `client.webhooks.unwrap`
 * на сырое тело), не по возврату браузера на сайт. Каждый вебхук обрабатывается один раз
 * (`webhook-id` в `ketner_docs`), а гранты кредитов идемпотентны по подписке и периоду: повтор
 * события не начисляет кредиты дважды. Отмена — в портале клиента Dodo в одно нажатие; уже
 * начисленные кредиты остаются до конца периода.
 */

import { DAY_MS, type CreditStore } from '../store/credit-store.js';
import type { DocStore } from '../store/doc-store.js';
import type { UserStore } from '../store/user-store.js';
import { toUsd } from '../services/entitlement.js';
import type { Mailer } from '../services/mailer.js';

export const AUTOMATION_PLAN = {
  priceUsd: 15,
  monthlyCredits: 7_500,
  trialCredits: 2_000,
  trialDays: 30,
  /** За сколько дней до конца пробного месяца напоминаем о списании. */
  reminderDays: 3,
} as const;

export type AutomationStatus =
  'pending' | 'active' | 'past_due' | 'on_hold' | 'paused' | 'cancelled' | 'failed' | 'expired';

/** Подписка пользователя (id — пользователь Ketner). */
export interface AutomationSubscription {
  id: string;
  subscriptionId: string;
  customerId: string;
  status: AutomationStatus;
  /** Пробный месяц: до этой даты списаний нет. */
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  trialReminderSentAt: string | null;
  updatedAt: string;
}

export interface ProcessedWebhook {
  id: string;
  type: string;
  receivedAt: string;
}

/** То, что нужно от клиента Dodo (SDK `dodopayments`; в тестах — подделка). */
export interface DodoClientPort {
  checkoutSessions: {
    create(params: {
      product_cart: Array<{ product_id: string; quantity: number }>;
      customer: { email: string; name?: string };
      subscription_data?: { trial_period_days?: number };
      metadata?: Record<string, string>;
      return_url?: string;
    }): Promise<{ checkout_url?: string | null; session_id: string }>;
  };
  customers: {
    customerPortal: {
      create(customerId: string, params?: { send_email?: boolean }): Promise<{ link: string }>;
    };
  };
  webhooks: {
    unwrap(
      body: string,
      options: { headers: Record<string, string> },
    ): {
      type: string;
      data: unknown;
    };
  };
}

interface DodoSubscriptionData {
  subscription_id: string;
  status: AutomationStatus;
  product_id: string;
  customer: { customer_id: string; email?: string };
  metadata?: Record<string, string>;
  trial_period_days?: number;
  previous_billing_date?: string;
  next_billing_date?: string;
  cancel_at_next_billing_date?: boolean;
  created_at?: string;
}

export interface AutomationSubscriptionDeps {
  client: DodoClientPort | null;
  productId: string;
  credits: CreditStore;
  subscriptions: DocStore<AutomationSubscription>;
  webhooks: DocStore<ProcessedWebhook>;
  users: Pick<UserStore, 'findById' | 'findByEmail'>;
  mailer?: Mailer;
  siteUrl: string;
  now?: () => number;
}

export type AutomationError = { ok: false; status: number; code: string; message: string };

/** Подписка даёт доступ: активна (в том числе пробный месяц) или в льготном периоде после сбоя оплаты. */
export function hasAccess(record: AutomationSubscription | undefined | null): boolean {
  return record?.status === 'active' || record?.status === 'past_due';
}

export class AutomationSubscriptionService {
  constructor(private readonly deps: AutomationSubscriptionDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Оплата картой подключена (ключ и продукт заданы). */
  get available(): boolean {
    return this.deps.client !== null && this.deps.productId !== '';
  }

  of(userId: string): AutomationSubscription | null {
    return this.deps.subscriptions.get(userId) ?? null;
  }

  /** Сессия оплаты Dodo: пробный месяц с картой; повторно — если подписка уже действует, нельзя. */
  async checkout(
    user: { id: string; email: string; name?: string },
    returnPath = '/solutions',
  ): Promise<{ ok: true; url: string } | AutomationError> {
    if (!this.available || !this.deps.client) return unavailable();
    if (hasAccess(this.of(user.id))) {
      return {
        ok: false,
        status: 409,
        code: 'already_subscribed',
        message: 'Подписка уже действует. Управлять ею можно в портале оплаты.',
      };
    }
    if (!user.email || /@telegram\.invalid$/i.test(user.email)) {
      return {
        ok: false,
        status: 409,
        code: 'email_required',
        message: 'Для оплаты картой нужна почта в аккаунте.',
      };
    }
    const usedTrial = this.deps.credits
      .allOf(user.id)
      .some((grant) => grant.id.startsWith('dodo:') && grant.id.endsWith(':trial'));
    const session = await this.deps.client.checkoutSessions.create({
      product_cart: [{ product_id: this.deps.productId, quantity: 1 }],
      customer: { email: user.email, ...(user.name ? { name: user.name } : {}) },
      // Пробный месяц — один раз на аккаунт.
      ...(usedTrial ? {} : { subscription_data: { trial_period_days: AUTOMATION_PLAN.trialDays } }),
      metadata: { ketner_user_id: user.id },
      return_url: `${this.deps.siteUrl}${returnPath.startsWith('/') ? returnPath : '/solutions'}`,
    });
    if (!session.checkout_url) {
      return {
        ok: false,
        status: 502,
        code: 'checkout_failed',
        message: 'Оплата сейчас не открывается. Попробуйте через минуту.',
      };
    }
    return { ok: true, url: session.checkout_url };
  }

  /** Портал клиента Dodo: карта, счета, отмена в одно нажатие. */
  async portal(userId: string): Promise<{ ok: true; url: string } | AutomationError> {
    if (!this.available || !this.deps.client) return unavailable();
    const record = this.of(userId);
    if (!record) {
      return { ok: false, status: 404, code: 'no_subscription', message: 'Подписки пока нет.' };
    }
    const session = await this.deps.client.customers.customerPortal.create(record.customerId);
    return { ok: true, url: session.link };
  }

  /**
   * Вебхук Dodo: проверка подписи на сыром теле, один раз на `webhook-id`. Возвращает `false`, если
   * подпись неверна (ответ 401), `duplicate` — если событие уже обработано.
   */
  handleWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): { ok: false } | { ok: true; duplicate: boolean; type: string } {
    if (!this.deps.client) return { ok: false };
    let event: { type: string; data: unknown };
    try {
      event = this.deps.client.webhooks.unwrap(rawBody, { headers });
    } catch {
      return { ok: false };
    }
    const webhookId = headers['webhook-id'] ?? '';
    if (!webhookId) return { ok: false };
    if (this.deps.webhooks.get(webhookId)) return { ok: true, duplicate: true, type: event.type };
    this.apply(event.type, event.data);
    this.deps.webhooks.put({
      id: webhookId,
      type: event.type,
      receivedAt: new Date(this.now()).toISOString(),
    });
    return { ok: true, duplicate: false, type: event.type };
  }

  /** Применить событие подписки: статус, даты и кредиты за период. */
  apply(type: string, payload: unknown): void {
    if (!type.startsWith('subscription.')) return;
    const data = payload as DodoSubscriptionData;
    if (!data?.subscription_id || data.product_id !== this.deps.productId) return;
    const userId = this.userFor(data);
    if (!userId) {
      console.warn(`[dodo] подписка ${data.subscription_id}: пользователь не найден`);
      return;
    }
    const nowIso = new Date(this.now()).toISOString();
    const previous = this.of(userId);
    // Пробный месяц — первые `trial_period_days` дней от создания подписки, пока не было оплаты.
    const trialEnd =
      (data.trial_period_days ?? 0) > 0 && data.created_at
        ? Date.parse(data.created_at) + (data.trial_period_days ?? 0) * DAY_MS
        : Number.NaN;
    const trial =
      Number.isFinite(trialEnd) &&
      trialEnd > this.now() &&
      !this.hasPaidPeriod(data.subscription_id);
    const record: AutomationSubscription = {
      id: userId,
      subscriptionId: data.subscription_id,
      customerId: data.customer.customer_id,
      status: data.status,
      trialEndsAt: trial
        ? (data.next_billing_date ?? new Date(trialEnd).toISOString())
        : previous?.subscriptionId === data.subscription_id
          ? previous.trialEndsAt
          : null,
      nextBillingDate: data.next_billing_date ?? null,
      cancelAtPeriodEnd: data.cancel_at_next_billing_date ?? false,
      trialReminderSentAt:
        previous?.subscriptionId === data.subscription_id ? previous.trialReminderSentAt : null,
      updatedAt: nowIso,
    };
    this.deps.subscriptions.put(record);

    const expiresAt = data.next_billing_date ?? new Date(this.now() + 30 * DAY_MS).toISOString();
    if (type === 'subscription.active' && trial) {
      this.grant(
        `dodo:${data.subscription_id}:trial`,
        userId,
        AUTOMATION_PLAN.trialCredits,
        expiresAt,
      );
    } else if (
      (type === 'subscription.active' || type === 'subscription.renewed') &&
      data.status === 'active' &&
      data.previous_billing_date
    ) {
      // Оплаченный период: ключ — его начало, повтор события кредиты не удваивает.
      this.grant(
        `dodo:${data.subscription_id}:${data.previous_billing_date}`,
        userId,
        AUTOMATION_PLAN.monthlyCredits,
        expiresAt,
      );
    }
  }

  private hasPaidPeriod(subscriptionId: string): boolean {
    return this.deps.credits
      .all()
      .some(
        (grant) => grant.id.startsWith(`dodo:${subscriptionId}:`) && !grant.id.endsWith(':trial'),
      );
  }

  private grant(id: string, userId: string, credits: number, expiresAt: string): void {
    this.deps.credits.grant(
      {
        id,
        userId,
        kind: 'plan',
        planId: 'automation',
        amountUsd: toUsd(credits),
        expiresAt,
        note: 'dodo',
      },
      this.now(),
    );
  }

  private userFor(data: DodoSubscriptionData): string | null {
    const fromMetadata = data.metadata?.ketner_user_id;
    if (fromMetadata && this.deps.users.findById(fromMetadata)) return fromMetadata;
    const known = this.deps.subscriptions.filter(
      (item) => item.subscriptionId === data.subscription_id,
    )[0];
    if (known) return known.id;
    const email = data.customer.email;
    return email ? (this.deps.users.findByEmail(email)?.id ?? null) : null;
  }

  /**
   * Напоминание за 3 дня до конца пробного месяца: сколько и когда спишется, как отменить.
   * Вызывается по таймеру; отметка не даёт отправить письмо дважды.
   */
  async sendTrialReminders(): Promise<number> {
    if (!this.deps.mailer) return 0;
    const now = this.now();
    let sent = 0;
    for (const record of this.deps.subscriptions.all()) {
      if (record.status !== 'active' || record.cancelAtPeriodEnd || record.trialReminderSentAt)
        continue;
      if (!record.trialEndsAt) continue;
      const left = Date.parse(record.trialEndsAt) - now;
      if (left <= 0 || left > AUTOMATION_PLAN.reminderDays * DAY_MS) continue;
      const user = this.deps.users.findById(record.id);
      if (!user?.email || /@telegram\.invalid$/i.test(user.email)) continue;
      this.deps.subscriptions.put({ ...record, trialReminderSentAt: new Date(now).toISOString() });
      const date = new Date(record.trialEndsAt).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
      const lines = [
        `Здравствуйте${user.name ? `, ${user.name}` : ''}!`,
        '',
        `Пробный месяц Ketner AI заканчивается ${date}. В этот день с карты спишется $${AUTOMATION_PLAN.priceUsd} за следующий месяц — ${AUTOMATION_PLAN.monthlyCredits.toLocaleString('ru-RU')} кредитов на ботов и анализы.`,
        '',
        `Отменить подписку в одно нажатие: ${this.deps.siteUrl}/pricing → «Управлять подпиской». После отмены списаний не будет.`,
      ];
      try {
        await this.deps.mailer.send({
          to: user.email,
          subject: `Пробный месяц заканчивается ${date}`,
          text: lines.join('\n'),
          html: lines.map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '')).join(''),
        });
        sent += 1;
      } catch (error) {
        this.deps.subscriptions.put({ ...record, trialReminderSentAt: null });
        console.error(`[dodo] напоминание ${record.id} не отправлено`, error);
      }
    }
    return sent;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function unavailable(): AutomationError {
  return {
    ok: false,
    status: 503,
    code: 'card_payments_unavailable',
    message: 'Оплата картой пока не подключена.',
  };
}
