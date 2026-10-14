import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { LEGACY_PLANS, PLANS } from '../routes/billing.js';
import type { InvoiceStore } from '../store/invoice-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import {
  invoiceStore as defaultInvoiceStore,
  subscriptionStore as defaultSubscriptionStore,
  userStore as defaultUserStore,
} from '../store/index.js';
import type { PlanId, PlanItem, Subscription, TelegramStarsInvoice, User } from '../types.js';
import { planPriceRub, planPriceUsd } from '../services/pricing.js';
import {
  BillingError,
  REFUND_POLICY,
  type BillingService,
  type PaymentRecord,
  type TelegramPaymentsPort,
} from '../billing/billing-service.js';
import { billingService as defaultBillingService } from '../billing/index.js';
import {
  isTelegramAccountEmail,
  telegramAccountEmail,
  telegramAuthRequests,
  type TelegramAuthRequests,
} from './auth-requests.js';
import { telegramLinkCodes, type TelegramLinkCodes } from './link-codes.js';
import { starsRateService, type StarsRateService } from './stars-rate.js';

/** Тарифы, которые продаются за звёзды. */
export const STARS_PLANS = ['plus', 'pro', 'ultra'] as const satisfies readonly PlanId[];

const PLAN_TITLES: Record<string, string> = { free: 'Free', plus: 'Plus', pro: 'Pro', ultra: 'Ultra' };

export function planTitle(planId: string): string {
  return PLAN_TITLES[planId] ?? planId.toUpperCase();
}

/** Цена тарифа в звёздах по текущему курсу Telegram Stars (см. stars-rate.ts). */
export function calculateStars(priceUsd: number, rates: StarsRateService = starsRateService): number {
  return rates.quote(priceUsd);
}

export function getPlanItem(planId: string): PlanItem | undefined {
  return PLANS.find((p) => p.id === planId) ?? LEGACY_PLANS.find((p) => p.id === planId);
}

/** Как называть аккаунт в сообщениях: почта или «аккаунт Telegram». */
export function accountLabel(user: Pick<User, 'email'> | null | undefined): string {
  if (!user) return 'аккаунт Ketner';
  return isTelegramAccountEmail(user.email) ? 'аккаунт Telegram' : user.email;
}

export interface TelegramBotDeps {
  subscriptionStore: SubscriptionStore;
  userStore: UserStore;
  invoiceStore: InvoiceStore;
  botToken?: string;
  botUsername?: string;
  rateService?: StarsRateService;
  linkCodes?: TelegramLinkCodes;
  authRequests?: TelegramAuthRequests;
  billingService?: BillingService;
  /** Адрес сайта: из него строится ссылка мини-приложения (`<сайт>/tg`). */
  webAppUrl?: string;
}

interface TelegramFrom {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: TelegramFrom;
    chat: { id: number | string; type: string; first_name?: string; username?: string };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    voice?: { file_id: string; duration: number };
    video?: { file_id: string; duration: number };
    sticker?: { file_id: string };
    date: number;
    reply_to_message?: { message_id: number; from?: TelegramFrom; text?: string; caption?: string };
    successful_payment?: SuccessfulPayment;
    refunded_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string };
  };
  callback_query?: {
    id: string;
    from: TelegramFrom;
    message?: { message_id: number; chat: { id: number | string } };
    data?: string;
  };
  pre_checkout_query?: {
    id: string;
    from: TelegramFrom;
    currency: string;
    total_amount: number;
    invoice_payload: string;
  };
}

/** Данные, зашитые в счёт. Их задаёт только бот, поэтому им можно доверять при оплате. */
export interface StarsPayload {
  planId: PlanId;
  stars: number;
  invoiceId: string;
  userId: string;
  /** Счёт на подписку с автопродлением. */
  recurring?: boolean;
}

export function encodePayload(payload: StarsPayload): string {
  const parts = ['v1', payload.planId, payload.stars, payload.invoiceId, payload.userId];
  if (payload.recurring) parts.push('r');
  return parts.join('|');
}

export function decodePayload(raw: string): StarsPayload | null {
  const [version, planId, stars, invoiceId, userId, flag] = raw.split('|');
  const amount = Number(stars);
  if (version !== 'v1' || !planId || !invoiceId || !userId || !Number.isInteger(amount) || amount <= 0) return null;
  if (!(STARS_PLANS as readonly string[]).includes(planId)) return null;
  return { planId: planId as PlanId, stars: amount, invoiceId, userId, ...(flag === 'r' ? { recurring: true } : {}) };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Короткая ссылка на платёж для кнопок (callback_data — не больше 64 байт). */
function paymentRef(paymentId: string): string {
  return createHash('sha256').update(paymentId).digest('base64url').slice(0, 16);
}

const DAY_MS = 24 * 3600 * 1000;
const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
/** Подписка Telegram Stars: Telegram принимает только 30 дней. */
const STARS_SUBSCRIPTION_PERIOD = 2592000;

/**
 * Бот Ketner AI (@Robo_kassa_bot). Всё управление — в мини-приложении («Кабинет»); бот отвечает
 * за вход и привязку подтверждением, оплату звёздами, автопродление, возвраты и уведомления.
 */
export class TelegramBotService implements TelegramPaymentsPort {
  private token: string;
  private username: string;
  private deps: TelegramBotDeps;
  private rates: StarsRateService;
  private linkCodes: TelegramLinkCodes;
  private auth: TelegramAuthRequests;
  readonly billing: BillingService;
  private isPolling = false;
  private reminderTimer: NodeJS.Timeout | null = null;
  /** Отправленные напоминания: пользователь, дата окончания и вид напоминания. */
  private remindersSent = new Set<string>();

  constructor(deps: TelegramBotDeps) {
    this.deps = deps;
    this.token = deps.botToken ?? config.telegramBotToken ?? '';
    this.username = (deps.botUsername || config.telegramBotUsername || 'Robo_kassa_bot').replace(/^@/, '');
    this.rates = deps.rateService ?? starsRateService;
    this.linkCodes = deps.linkCodes ?? telegramLinkCodes;
    this.auth = deps.authRequests ?? telegramAuthRequests;
    this.billing = deps.billingService ?? defaultBillingService;
    this.billing.telegram = this;
  }

  get botUsername(): string {
    return this.username;
  }

  get isConfigured(): boolean {
    return Boolean(this.token && this.token.length > 10);
  }

  /** Токен нужен мини-приложению для проверки подписи initData. */
  get botToken(): string {
    return this.token;
  }

  get rateService(): StarsRateService {
    return this.rates;
  }

  get authRequests(): TelegramAuthRequests {
    return this.auth;
  }

  /**
   * Адрес сайта для кнопок. Telegram принимает только https, поэтому локальный адрес
   * разработки (WEB_APP_URL по умолчанию — localhost) заменяется на ketner.org.
   */
  get siteUrl(): string {
    const candidate = this.deps.webAppUrl || config.webAppUrl || '';
    return (candidate.startsWith('https://') ? candidate : 'https://ketner.org').replace(/\/+$/, '');
  }

  get miniAppUrl(): string {
    return `${this.siteUrl}/tg`;
  }

  /** Аккаунт сайта, к которому привязан этот Telegram (в личном чате chat_id = id пользователя). */
  resolveUser(chatId: number | string): User | null {
    return this.deps.userStore.findByTelegramChatId(chatId);
  }

  // ───────────── запуск ─────────────

  async initRuntime(publicBaseUrl?: string): Promise<void> {
    if (!this.isConfigured) {
      console.log('🤖 [TelegramBot] Бот не сконфигурирован (нет токена), режим заглушки');
      return;
    }
    try {
      const me = await this.callApi<{ id: number; username: string }>('getMe', {});
      if (me?.username) {
        this.username = me.username;
        console.log(`🤖 [TelegramBot] Авторизован бот: @${this.username}`);
      }
      await this.callApi('setMyCommands', {
        commands: [
          { command: 'start', description: 'Открыть кабинет Ketner' },
          { command: 'status', description: 'Моя подписка' },
          { command: 'paysupport', description: 'Помощь с оплатой и возвраты' },
          { command: 'terms', description: 'Условия оплаты и возврата' },
        ],
      });
      await this.callApi('setMyShortDescription', {
        short_description: 'Ketner AI: подписка, оплата звёздами, возвраты и вход на сайт без пароля.',
      });
      await this.callApi('setMyDescription', {
        description:
          'Официальный бот Ketner AI.\n\nНажмите «Начать», затем «Открыть Ketner»: там подписка, оплата звёздами, автопродление, история платежей и возвраты. Аккаунт создаётся или привязывается в одно касание.',
      });
      await this.callApi('setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: this.miniAppUrl } },
      });

      const baseUrl = config.telegramWebhookUrl || process.env.RENDER_EXTERNAL_URL || publicBaseUrl || config.betterAuthUrl;
      if (baseUrl && baseUrl.startsWith('https://')) {
        const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/telegram/webhook`;
        await this.callApi('setWebhook', {
          url: webhookUrl,
          secret_token: config.telegramWebhookSecret,
          allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
          drop_pending_updates: false,
        });
        console.log(`✅ [TelegramBot] Webhook зарегистрирован на: ${webhookUrl}`);
      } else {
        console.log('⚡ [TelegramBot] Локальное окружение: long-polling');
        await this.callApi('deleteWebhook', { drop_pending_updates: false });
        this.startPolling();
      }
      this.rates.start();
      this.startReminders();
    } catch (error) {
      console.error('⚠️ [TelegramBot] Ошибка инициализации бота:', error);
    }
  }

  startPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;
    void (async () => {
      let offset = 0;
      while (this.isPolling) {
        try {
          const updates = await this.callApi<TelegramUpdate[]>('getUpdates', {
            offset,
            timeout: 20,
            allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
          });
          // Ошибка API (например, неверный токен) — пауза, а не частые повторы.
          if (!updates) await new Promise((resolve) => setTimeout(resolve, 5000));
          for (const update of updates ?? []) {
            offset = update.update_id + 1;
            await this.processUpdate(update);
          }
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    })();
  }

  stopPolling(): void {
    this.isPolling = false;
  }

  startReminders(): void {
    if (this.reminderTimer) return;
    this.reminderTimer = setInterval(() => void this.sendRenewalReminders(), REMINDER_INTERVAL_MS);
    this.reminderTimer.unref?.();
  }

  stopReminders(): void {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    this.reminderTimer = null;
  }

  async callApi<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
    if (!this.isConfigured) {
      console.log(`[TelegramBot:mock] ${method}:`, JSON.stringify(body));
      return { ok: true, result: {} } as unknown as T;
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
      if (!data.ok) {
        console.error(`[TelegramBot] Error in ${method}:`, data.description);
        return null;
      }
      return data.result as T;
    } catch (error) {
      console.error(`[TelegramBot] Network error in ${method}:`, error);
      return null;
    }
  }

  async sendMessage(chatId: number | string, text: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extra,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false): Promise<unknown> {
    return this.callApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
  }

  private async editMessage(chatId: number | string, messageId: number, text: string, keyboard?: unknown[][]): Promise<void> {
    await this.callApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  // ───────────── TelegramPaymentsPort ─────────────

  async refundStars(telegramUserId: number, chargeId: string): Promise<boolean> {
    const result = await this.callApi<boolean>('refundStarPayment', {
      user_id: telegramUserId,
      telegram_payment_charge_id: chargeId,
    });
    return result === true;
  }

  async setStarsSubscriptionCanceled(telegramUserId: number, chargeId: string, canceled: boolean): Promise<boolean> {
    const result = await this.callApi<boolean>('editUserStarSubscription', {
      user_id: telegramUserId,
      telegram_payment_charge_id: chargeId,
      is_canceled: canceled,
    });
    return result === true;
  }

  async notifyUser(userId: string, text: string, kind: 'receipt' | 'refund' | 'reminder' | 'system'): Promise<void> {
    const user = this.deps.userStore.findById(userId);
    if (!user?.telegramChatId) return;
    const prefs = this.billing.prefsOf(userId);
    if ((kind === 'receipt' && !prefs.receipts) || (kind === 'reminder' && !prefs.reminders)) return;
    await this.sendMessage(user.telegramChatId, text, { reply_markup: { inline_keyboard: [[this.openAppButton()]] } });
  }

  async notifyAdminsAboutRefund(payment: PaymentRecord, user: User | null): Promise<void> {
    const admins = this.deps.userStore.list().filter((candidate) => candidate.isAdmin && candidate.telegramChatId);
    const ref = paymentRef(payment.id);
    const amount = payment.currency === 'XTR' ? `${payment.amount} ⭐` : `$${payment.amount}`;
    const text = [
      '↩️ <b>Заявка на возврат</b>',
      '',
      `Клиент: ${escapeHtml(user ? `${user.name} · ${accountLabel(user)}` : payment.userId)}`,
      `Платёж: ${planTitle(payment.planId)} · ${amount} · ${payment.method === 'stars' ? 'звёзды' : 'криптовалюта'}`,
      `Оплачен: ${formatDate(payment.paidAt)}`,
      payment.refund?.reason ? `Причина: ${escapeHtml(payment.refund.reason)}` : '',
      payment.refund?.comment ? `Комментарий: ${escapeHtml(payment.refund.comment)}` : '',
      `Запросов к моделям после оплаты: ${this.billing.requestsSince(payment.userId, payment.paidAt)}`,
      payment.method === 'crypto' ? '\nКриптовалюту возвращаете вручную на кошелёк клиента.' : '',
    ]
      .filter(Boolean)
      .join('\n');
    for (const admin of admins) {
      await this.sendMessage(admin.telegramChatId!, text, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: payment.method === 'stars' ? '✅ Вернуть звёзды' : '✅ Одобрить', callback_data: `rf:y:${ref}` },
              { text: '✖️ Отказать', callback_data: `rf:n:${ref}` },
            ],
            [{ text: '📱 Все заявки в кабинете', web_app: { url: `${this.miniAppUrl}?tab=admin` } }],
          ],
        },
      });
    }
  }

  // ───────────── счета в звёздах ─────────────

  /** Счёт на тариф по текущему курсу. Сумма фиксируется в счёте и не меняется при смене курса. */
  createStarsInvoice(userId: string, planId: PlanId): TelegramStarsInvoice {
    const stars = this.rates.quote(planPriceUsd(planId));
    return this.deps.invoiceStore.createTelegramStarsInvoice(userId, planId, planPriceRub(planId), stars, this.username);
  }

  private invoiceParams(invoice: TelegramStarsInvoice, recurring: boolean): Record<string, unknown> {
    const plan = getPlanItem(invoice.planId);
    const title = recurring
      ? `Ketner AI ${planTitle(invoice.planId)} · каждый месяц`
      : `Ketner AI ${planTitle(invoice.planId)} · 30 дней`;
    const base = plan?.modelsHighlight ?? 'доступ к моделям тарифа';
    return {
      title,
      description: recurring
        ? `Подписка с автопродлением раз в 30 дней: ${base}. Отключить можно в кабинете в любой момент.`
        : `Доступ на 30 дней: ${base}. Включается сразу после оплаты.`,
      payload: encodePayload({
        planId: invoice.planId,
        stars: invoice.starsAmount,
        invoiceId: invoice.id,
        userId: invoice.userId,
        recurring,
      }),
      currency: 'XTR',
      prices: [{ label: `Ketner AI ${planTitle(invoice.planId)}`, amount: invoice.starsAmount }],
      ...(recurring ? { subscription_period: STARS_SUBSCRIPTION_PERIOD } : {}),
    };
  }

  /** Ссылка на окно оплаты звёздами (для мини-приложения и сайта). */
  async createInvoiceLink(invoice: TelegramStarsInvoice, recurring = false): Promise<string | null> {
    if (invoice.invoiceLink && !recurring) return invoice.invoiceLink;
    const link = await this.callApi<string>('createInvoiceLink', this.invoiceParams(invoice, recurring));
    if (typeof link !== 'string' || !link.startsWith('https://')) return null;
    if (!recurring) this.deps.invoiceStore.setTelegramStarsLink?.(invoice.id, link);
    return link;
  }

  async sendStarsInvoice(chatId: number | string, invoice: TelegramStarsInvoice): Promise<unknown> {
    return this.callApi('sendInvoice', { chat_id: chatId, ...this.invoiceParams(invoice, false) });
  }

  /** Проверка перед списанием: счёт наш, сумма и валюта совпадают, аккаунт существует. */
  validatePayment(currency: string, totalAmount: number, rawPayload: string):
    | { ok: true; payload: StarsPayload }
    | { ok: false; reason: string } {
    const payload = decodePayload(rawPayload);
    if (!payload) return { ok: false, reason: 'unknown_invoice' };
    if (currency !== 'XTR') return { ok: false, reason: 'invalid_currency' };
    if (totalAmount !== payload.stars) return { ok: false, reason: 'amount_mismatch' };
    if (!this.deps.userStore.findById(payload.userId)) return { ok: false, reason: 'unknown_user' };
    const invoice = this.deps.invoiceStore.getTelegramStarsInvoice(payload.invoiceId);
    if (invoice && (invoice.userId !== payload.userId || invoice.planId !== payload.planId)) {
      return { ok: false, reason: 'invoice_mismatch' };
    }
    if (invoice?.status === 'paid' && !payload.recurring) return { ok: false, reason: 'already_paid' };
    return { ok: true, payload };
  }

  /** Оплата звёздами (первая, разовая или очередное автопродление). Повтор того же платежа — без изменений. */
  async handleStarsPayment(
    chatId: number | string,
    from: TelegramFrom | undefined,
    pay: SuccessfulPayment,
    now = Date.now(),
  ): Promise<{ status: 'activated' | 'duplicate' | 'rejected'; subscription?: Subscription }> {
    const payload = decodePayload(pay.invoice_payload);
    if (!payload || pay.currency !== 'XTR' || pay.total_amount !== payload.stars || !this.deps.userStore.findById(payload.userId)) {
      console.warn(`[TelegramBot] Платёж ${pay.telegram_payment_charge_id} не распознан`);
      await this.sendMessage(
        chatId,
        `⚠️ Платёж получен, но тариф не включился автоматически. Напишите в поддержку @ketner_support_bot и укажите номер: <code>${escapeHtml(pay.telegram_payment_charge_id)}</code> — вернём звёзды или включим тариф вручную.`,
      );
      return { status: 'rejected' };
    }
    const telegramUserId = from?.id ?? Number(chatId);
    const recurring = Boolean(pay.is_recurring || payload.recurring);
    const renewal = Boolean(pay.is_recurring && !pay.is_first_recurring);
    const result = this.billing.grant(
      payload.userId,
      payload.planId,
      {
        id: `stars:${pay.telegram_payment_charge_id}`,
        method: 'stars',
        amount: pay.total_amount,
        currency: 'XTR',
        invoiceId: payload.invoiceId,
        chargeId: pay.telegram_payment_charge_id,
        telegramUserId,
        recurring,
      },
      now,
    );
    if (result.duplicate) return { status: 'duplicate' };
    this.deps.invoiceStore.markTelegramStarsPaid(payload.invoiceId, pay.telegram_payment_charge_id);

    const nextChargeAt = pay.subscription_expiration_date
      ? new Date(pay.subscription_expiration_date * 1000).toISOString()
      : result.subscription.renewsAt;
    if (recurring && !renewal) {
      await this.billing.startStarsSubscription(
        {
          userId: payload.userId,
          planId: payload.planId,
          telegramUserId,
          chargeId: pay.telegram_payment_charge_id,
          invoiceId: payload.invoiceId,
          stars: pay.total_amount,
          nextChargeAt,
        },
        now,
      );
    } else if (renewal) {
      this.billing.renewStarsSubscription(payload.userId, nextChargeAt);
    }

    // Платил из незнакомого Telegram за аккаунт без Telegram — привязываем, чтобы приходили чеки.
    const account = result.user;
    if (account && !account.telegramChatId && !this.resolveUser(chatId)) {
      this.linkTelegram(account.id, chatId, from?.username);
    }

    const until = formatDate(result.subscription.renewsAt);
    const lines = renewal
      ? [`🔄 <b>Автопродление прошло</b>`, '', `Списано ${pay.total_amount} ⭐. Тариф <b>${planTitle(payload.planId)}</b> действует до <b>${until}</b>.`]
      : [
          '🎉 <b>Оплата прошла!</b>',
          '',
          `Тариф <b>${planTitle(payload.planId)}</b> действует до <b>${until}</b>.`,
          result.payment.bonusDays > 0 ? `За неиспользованные дни прежнего тарифа добавили ${result.payment.bonusDays} дн.` : '',
          recurring ? 'Автопродление включено: через 30 дней спишем столько же звёзд. Отключить можно в кабинете.' : '',
        ];
    const payerIsAccountOwner = String(account?.telegramChatId ?? '') === String(chatId);
    if (payerIsAccountOwner && !this.billing.prefsOf(payload.userId).receipts && renewal) {
      return { status: 'activated', subscription: result.subscription };
    }
    await this.sendMessage(chatId, lines.filter(Boolean).join('\n'), {
      reply_markup: {
        inline_keyboard: [[{ text: '🚀 Открыть Ketner AI', url: `${this.siteUrl}/chat` }], [this.openAppButton('📱 Кабинет')]],
      },
    });
    return { status: 'activated', subscription: result.subscription };
  }

  // ───────────── тексты и кнопки ─────────────

  private openAppButton(text = '📱 Открыть Ketner', tab?: string): Record<string, unknown> {
    return { text, web_app: { url: tab ? `${this.miniAppUrl}?tab=${tab}` : this.miniAppUrl } };
  }

  private statusLine(user: User): string {
    if (user.isVip) return 'Тариф <b>Ultra</b> (VIP) без срока.';
    const sub = this.deps.subscriptionStore.get(user.id);
    const end = sub.renewsAt ? Date.parse(sub.renewsAt) : NaN;
    if (sub.plan === 'free' || !Number.isFinite(end) || end <= Date.now()) return 'Тариф <b>Free</b>, платная подписка не активна.';
    const auto = this.billing.starsSubscriptionOf(user.id);
    const autoText = auto?.status === 'active' && auto.planId === sub.plan ? ', автопродление включено' : '';
    return `Тариф <b>${planTitle(sub.plan)}</b> до <b>${formatDate(sub.renewsAt)}</b>${autoText}.`;
  }

  async sendStart(chatId: number | string, from?: TelegramFrom): Promise<void> {
    const user = this.resolveUser(chatId);
    const name = escapeHtml(from?.first_name || user?.name || '');
    const text = user
      ? [`👋 ${name ? `${name}, з` : 'З'}дравствуйте!`, '', this.statusLine(user), '', 'Подписка, оплата, возвраты и вход на сайт — в кабинете:'].join('\n')
      : [
          `👋 ${name ? `${name}, д` : 'Д'}обро пожаловать в Ketner AI!`,
          '',
          'Все сильные модели в одной подписке. Нажмите кнопку ниже — создадим аккаунт или привяжем существующий, без паролей.',
        ].join('\n');
    await this.sendMessage(chatId, text, { reply_markup: { inline_keyboard: [[this.openAppButton()]] } });
  }

  async sendStatus(chatId: number | string): Promise<void> {
    const user = this.resolveUser(chatId);
    if (!user) {
      await this.sendStart(chatId);
      return;
    }
    await this.sendMessage(chatId, ['📊 <b>Ваша подписка</b>', '', this.statusLine(user)].join('\n'), {
      reply_markup: { inline_keyboard: [[this.openAppButton('📱 Управлять подпиской')]] },
    });
  }

  private refundPolicyText(): string {
    const hours = Math.round(REFUND_POLICY.windowMs / 3600_000);
    return [
      `• Вернуть оплату можно в течение ${hours} часов, если после неё вы не сделали ни одного запроса к моделям.`,
      '• Если моделями уже пользовались или прошло больше 24 часов, оплата не возвращается.',
      '• Звёзды возвращаются сразу, кнопкой в кабинете. Криптовалюту возвращаем на ваш кошелёк по заявке, обычно в течение суток.',
      '• После возврата дни этой оплаты снимаются с подписки, автопродление отключается.',
    ].join('\n');
  }

  private async sendPaySupport(chatId: number | string): Promise<void> {
    await this.sendMessage(
      chatId,
      ['💳 <b>Помощь с оплатой</b>', '', 'Платежи, чеки и возвраты — на вкладке «Платежи» в кабинете. Там же можно вернуть звёзды в одно касание.', '', this.refundPolicyText(), '', 'Если что-то пошло не так — напишите @ketner_support_bot, ответим в течение суток.'].join('\n'),
      {
        reply_markup: {
          inline_keyboard: [[this.openAppButton('💳 Платежи и возвраты', 'payments')], [{ text: '💬 Написать в поддержку', url: 'https://t.me/ketner_support_bot' }]],
        },
      },
    );
  }

  private async sendTerms(chatId: number | string): Promise<void> {
    await this.sendMessage(
      chatId,
      [
        '📄 <b>Условия оплаты</b>',
        '',
        '• Подписка даёт доступ к моделям тарифа на 30 дней с момента оплаты.',
        '• Продление того же тарифа добавляет 30 дней к сроку. При смене тарифа неиспользованные дни пересчитываются в дни нового.',
        '• Автопродление звёздами списывает оплату раз в 30 дней; отключить можно в кабинете или в настройках Telegram.',
        '',
        '<b>Возвраты</b>',
        this.refundPolicyText(),
        '',
        `Полные условия: ${this.siteUrl}/docs#faq`,
      ].join('\n'),
      { reply_markup: { inline_keyboard: [[this.openAppButton()]] } },
    );
  }

  // ───────────── обработка обновлений ─────────────

  async processUpdate(update: TelegramUpdate): Promise<{ handled: boolean; action?: string }> {
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const verdict = this.validatePayment(q.currency, q.total_amount, q.invoice_payload);
      await this.callApi('answerPreCheckoutQuery', {
        pre_checkout_query_id: q.id,
        ok: verdict.ok,
        ...(verdict.ok
          ? {}
          : {
              error_message:
                verdict.reason === 'already_paid' ? 'Этот счёт уже оплачен.' : 'Счёт устарел. Откройте кабинет и выставите новый.',
            }),
      });
      return { handled: true, action: verdict.ok ? 'pre_checkout_approved' : `pre_checkout_rejected:${verdict.reason}` };
    }

    if (update.callback_query) return this.handleCallback(update.callback_query);

    const msg = update.message;
    if (!msg) return { handled: false };
    const chatId = msg.chat.id;

    if (msg.successful_payment) {
      const result = await this.handleStarsPayment(chatId, msg.from, msg.successful_payment);
      return {
        handled: true,
        action: result.status === 'activated' ? 'stars_payment_completed' : `stars_payment_${result.status}`,
      };
    }

    if (msg.refunded_payment) {
      const payment = this.billing.markRefundedByTelegram(msg.refunded_payment.telegram_payment_charge_id);
      if (payment) {
        await this.sendMessage(chatId, `↩️ Возврат ${payment.amount} ⭐ за ${planTitle(payment.planId)} оформлен, дни этой оплаты сняты с подписки.`);
      }
      return { handled: true, action: 'stars_refunded' };
    }

    const text = msg.text?.trim() ?? '';
    const [rawCommand, ...rest] = text.split(/\s+/);
    const command = (rawCommand ?? '').replace(/@\w+$/, '').toLowerCase();
    const arg = rest.join(' ').trim();

    if (command === '/start' && arg.startsWith('auth_')) return this.handleAuthStart(chatId, arg.slice(5), msg.from);
    if (command === '/start' && arg.startsWith('lnk_')) return this.handleLinkCode(chatId, arg.slice(4), msg.from);
    if (command === '/start' && arg.startsWith('stars_')) return this.handleStarsDeepLink(chatId, arg);
    if (command === '/start' || command === '/menu' || command === '/plans' || command === '/buy') {
      await this.sendStart(chatId, msg.from);
      return { handled: true, action: 'start' };
    }
    if (command === '/status' || command === '/sub') {
      await this.sendStatus(chatId);
      return { handled: true, action: 'status' };
    }
    if (command === '/paysupport' || command === '/help' || command === '/refund') {
      await this.sendPaySupport(chatId);
      return { handled: true, action: 'paysupport' };
    }
    if (command === '/terms') {
      await this.sendTerms(chatId);
      return { handled: true, action: 'terms' };
    }

    await this.sendMessage(chatId, 'Всё управление — в кабинете: подписка, оплата, возвраты и вход на сайт.', {
      reply_markup: { inline_keyboard: [[this.openAppButton()]] },
    });
    return { handled: true, action: 'fallback' };
  }

  private async handleCallback(cb: NonNullable<TelegramUpdate['callback_query']>): Promise<{ handled: boolean; action?: string }> {
    const chatId = cb.message?.chat.id;
    const data = cb.data ?? '';
    if (!chatId) {
      await this.answerCallbackQuery(cb.id);
      return { handled: true, action: 'callback_no_chat' };
    }
    if (data.startsWith('auth:')) return this.handleAuthDecision(cb, chatId, data);
    if (data.startsWith('rf:')) return this.handleRefundDecision(cb, chatId, data);
    if (data.startsWith('buy:')) {
      // Кнопки из старых напоминаний: оплата теперь в кабинете.
      await this.answerCallbackQuery(cb.id);
      await this.sendMessage(chatId, 'Продление и смена тарифа — в кабинете:', {
        reply_markup: { inline_keyboard: [[this.openAppButton('⭐ Выбрать тариф', 'plans')]] },
      });
      return { handled: true, action: 'buy_redirect' };
    }
    if (data === 'status') {
      await this.answerCallbackQuery(cb.id);
      await this.sendStatus(chatId);
      return { handled: true, action: 'status' };
    }
    await this.answerCallbackQuery(cb.id);
    return { handled: true, action: 'callback_unhandled' };
  }

  // ───────────── вход и привязка подтверждением ─────────────

  private async handleAuthStart(chatId: number | string, code: string, from?: TelegramFrom): Promise<{ handled: boolean; action?: string }> {
    const request = this.auth.byStartCode(code);
    if (!request || request.status !== 'pending') {
      await this.sendMessage(chatId, '⌛ Ссылка устарела. Вернитесь на сайт и нажмите кнопку ещё раз — ссылка действует 5 минут.');
      return { handled: true, action: 'auth_expired' };
    }
    const linked = this.resolveUser(chatId);
    const device = escapeHtml(request.device);
    const buttons = (approveText: string) => [
      [
        { text: approveText, callback_data: `auth:y:${code}` },
        { text: '✖️ Это не я', callback_data: `auth:n:${code}` },
      ],
    ];
    if (request.mode === 'link') {
      const target = request.siteUserId ? this.deps.userStore.findById(request.siteUserId) : null;
      if (!target) {
        await this.sendMessage(chatId, 'Аккаунт для привязки не найден. Начните заново в настройках сайта.');
        return { handled: true, action: 'auth_link_missing' };
      }
      if (linked && linked.id !== target.id && isTelegramAccountEmail(linked.email)) {
        await this.sendMessage(
          chatId,
          'Этот Telegram уже открывает отдельный аккаунт Ketner, созданный через Telegram. Чтобы не потерять его подписку, войдите на сайте кнопкой «Войти через Telegram».',
          { reply_markup: { inline_keyboard: [[this.openAppButton()]] } },
        );
        return { handled: true, action: 'auth_link_conflict' };
      }
      const warn =
        linked && linked.id !== target.id
          ? `\n\nСейчас этот Telegram привязан к ${escapeHtml(accountLabel(linked))}. После подтверждения он перейдёт к новому аккаунту.`
          : '';
      await this.sendMessage(
        chatId,
        `🔗 <b>Привязать Telegram к аккаунту Ketner?</b>\n\nАккаунт: <b>${escapeHtml(accountLabel(target))}</b>\nЗапрос с устройства: ${device}${warn}\n\nПодтверждайте, только если вы сами сейчас в настройках ketner.org. Если ссылку вам кто-то прислал — нажмите «Это не я».`,
        { reply_markup: { inline_keyboard: buttons('✅ Привязать') } },
      );
      return { handled: true, action: 'auth_link_prompt' };
    }
    if (linked) {
      await this.sendMessage(
        chatId,
        `🔐 <b>Вход на ketner.org</b>\n\nАккаунт: <b>${escapeHtml(accountLabel(linked))}</b>\nУстройство: ${device}\n\nПодтверждайте, только если вы сами сейчас входите на сайт. Если ссылку на этот вход вам кто-то прислал — нажмите «Это не я».`,
        { reply_markup: { inline_keyboard: buttons('✅ Войти') } },
      );
      return { handled: true, action: 'auth_login_prompt' };
    }
    await this.sendMessage(
      chatId,
      `🔐 <b>Вход на ketner.org через Telegram</b>\n\nУстройство: ${device}\n\nУ этого Telegram пока нет аккаунта Ketner — создадим его и сразу войдём${from?.first_name ? `, ${escapeHtml(from.first_name)}` : ''}.\n\nУже есть аккаунт с почтой или Google? Тогда войдите на сайте как обычно и подключите Telegram в настройках — так подписка останется на нём.`,
      { reply_markup: { inline_keyboard: buttons('✅ Создать аккаунт и войти') } },
    );
    return { handled: true, action: 'auth_signup_prompt' };
  }

  private async handleAuthDecision(
    cb: NonNullable<TelegramUpdate['callback_query']>,
    chatId: number | string,
    data: string,
  ): Promise<{ handled: boolean; action?: string }> {
    const [, decision, code] = data.split(':');
    const messageId = cb.message?.message_id;
    const request = code ? this.auth.byStartCode(code) : null;
    if (!request || request.status !== 'pending') {
      await this.answerCallbackQuery(cb.id, 'Ссылка устарела — начните заново на сайте', true);
      return { handled: true, action: 'auth_expired' };
    }
    if (decision !== 'y') {
      this.auth.resolve(code!, { approve: false });
      await this.answerCallbackQuery(cb.id, 'Отменено');
      if (messageId) await this.editMessage(chatId, messageId, '✖️ Вход отменён. Если это были не вы — ничего делать не нужно, доступа к аккаунту нет.');
      return { handled: true, action: 'auth_declined' };
    }
    let userId: string;
    if (request.mode === 'link') {
      const target = request.siteUserId ? this.deps.userStore.findById(request.siteUserId) : null;
      if (!target) {
        await this.answerCallbackQuery(cb.id, 'Аккаунт не найден', true);
        return { handled: true, action: 'auth_link_missing' };
      }
      const current = this.resolveUser(chatId);
      if (current && current.id !== target.id && isTelegramAccountEmail(current.email)) {
        await this.answerCallbackQuery(cb.id, 'Этот Telegram открывает отдельный аккаунт — войдите через Telegram на сайте', true);
        return { handled: true, action: 'auth_link_conflict' };
      }
      this.linkTelegram(target.id, chatId, cb.from.username);
      userId = target.id;
    } else {
      const linked = this.resolveUser(chatId) ?? this.createTelegramAccount(cb.from);
      userId = linked.id;
    }
    this.auth.resolve(code!, { approve: true, userId });
    await this.answerCallbackQuery(cb.id, request.mode === 'link' ? 'Telegram привязан' : 'Вход подтверждён');
    if (messageId) {
      await this.editMessage(
        chatId,
        messageId,
        request.mode === 'link' ? '✅ Telegram привязан. Вернитесь на сайт — страница обновится сама.' : '✅ Вход подтверждён. Вернитесь на сайт — он откроется сам.',
        [[this.openAppButton()]],
      );
    }
    return { handled: true, action: request.mode === 'link' ? 'auth_linked' : 'auth_approved' };
  }

  /** Аккаунт Ketner для человека, который пришёл из Telegram (вход только через Telegram). */
  createTelegramAccount(from: Pick<TelegramFrom, 'id' | 'first_name' | 'last_name' | 'username'>): User {
    const existing = this.resolveUser(from.id) ?? this.deps.userStore.findByEmail(telegramAccountEmail(from.id));
    if (existing) {
      if (!existing.telegramChatId) this.linkTelegram(existing.id, from.id, from.username);
      return this.deps.userStore.findById(existing.id) ?? existing;
    }
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || from.username || 'Telegram';
    const created = this.deps.userStore.create(telegramAccountEmail(from.id), randomBytes(24).toString('base64url'), name);
    return this.linkTelegram(created.id, from.id, from.username) ?? created;
  }

  /** Старые ссылки привязки из настроек (`/start lnk_<код>`). */
  private async handleLinkCode(chatId: number | string, code: string, from?: TelegramFrom): Promise<{ handled: boolean; action?: string }> {
    const userId = this.linkCodes.consume(code);
    const user = userId ? this.deps.userStore.findById(userId) : null;
    if (!user) {
      await this.sendMessage(chatId, '⌛ Ссылка для привязки устарела. Нажмите «Подключить Telegram» в настройках сайта ещё раз.');
      return { handled: true, action: 'link_code_invalid' };
    }
    this.linkTelegram(user.id, chatId, from?.username);
    await this.sendMessage(chatId, `✅ Telegram привязан к аккаунту <b>${escapeHtml(accountLabel(user))}</b>.\n\n${this.statusLine(user)}`, {
      reply_markup: { inline_keyboard: [[this.openAppButton()]] },
    });
    return { handled: true, action: 'account_linked' };
  }

  /** Счёт, выставленный на сайте: `/start stars_<id>`. */
  private async handleStarsDeepLink(chatId: number | string, invoiceId: string): Promise<{ handled: boolean; action?: string }> {
    const invoice = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
    if (!invoice || invoice.status === 'paid') {
      await this.sendMessage(chatId, invoice ? 'Этот счёт уже оплачен ✅' : 'Счёт не найден или устарел. Выберите тариф заново.', {
        reply_markup: { inline_keyboard: [[this.openAppButton('⭐ Тарифы', 'plans')]] },
      });
      return { handled: true, action: invoice ? 'deep_link_paid' : 'deep_link_missing' };
    }
    await this.sendStarsInvoice(chatId, invoice);
    return { handled: true, action: 'invoice_stars_sent' };
  }

  /** Один Telegram — один аккаунт: прежняя привязка этого чата снимается. */
  linkTelegram(userId: string, chatId: number | string, username?: string): User | null {
    const previous = this.deps.userStore.findByTelegramChatId(chatId);
    if (previous && previous.id !== userId) this.deps.userStore.unlinkTelegram(previous.id);
    return this.deps.userStore.linkTelegram(userId, chatId, username);
  }

  // ───────────── возвраты: решения администратора ─────────────

  private async handleRefundDecision(
    cb: NonNullable<TelegramUpdate['callback_query']>,
    chatId: number | string,
    data: string,
  ): Promise<{ handled: boolean; action?: string }> {
    const admin = this.resolveUser(chatId);
    if (!admin?.isAdmin) {
      await this.answerCallbackQuery(cb.id, 'Нет прав', true);
      return { handled: true, action: 'refund_forbidden' };
    }
    const [, decision, ref] = data.split(':');
    const payment = this.billing.pendingRefunds().find((candidate) => paymentRef(candidate.id) === ref);
    if (!payment) {
      await this.answerCallbackQuery(cb.id, 'Заявка уже обработана', true);
      return { handled: true, action: 'refund_missing' };
    }
    try {
      await this.billing.decideRefund(payment.id, decision === 'y');
      await this.answerCallbackQuery(cb.id, decision === 'y' ? 'Возврат оформлен' : 'Отказано');
      if (cb.message?.message_id) {
        await this.editMessage(
          chatId,
          cb.message.message_id,
          `${decision === 'y' ? '✅ Возврат оформлен' : '✖️ В возврате отказано'}: ${planTitle(payment.planId)} · ${payment.currency === 'XTR' ? `${payment.amount} ⭐` : `$${payment.amount}`}`,
        );
      }
      return { handled: true, action: decision === 'y' ? 'refund_approved' : 'refund_declined' };
    } catch (error) {
      await this.answerCallbackQuery(cb.id, error instanceof BillingError ? error.message : 'Не получилось', true);
      return { handled: true, action: 'refund_failed' };
    }
  }

  // ───────────── напоминания о продлении ─────────────

  /** Раз в час: за 3 дня и за сутки до окончания подписки, и в день, когда она закончилась. */
  async sendRenewalReminders(now = Date.now()): Promise<number> {
    let sent = 0;
    for (const user of this.deps.userStore.list()) {
      if (!user.telegramChatId || user.isVip) continue;
      if (!this.billing.prefsOf(user.id).reminders) continue;
      const sub = this.deps.subscriptionStore.get(user.id);
      if (sub.plan === 'free' || !sub.renewsAt) continue;
      const end = Date.parse(sub.renewsAt);
      if (!Number.isFinite(end)) continue;
      const left = end - now;
      const kind = left > 2 * DAY_MS && left <= 3 * DAY_MS ? '3d' : left > 0 && left <= DAY_MS ? '1d' : left <= 0 && left > -DAY_MS ? 'ended' : null;
      if (!kind) continue;
      const auto = this.billing.starsSubscriptionOf(user.id);
      const autoActive = auto?.status === 'active' && auto.planId === sub.plan;
      // С автопродлением напоминаем один раз — о предстоящем списании.
      if (autoActive && kind !== '3d') continue;
      const key = `${user.id}:${sub.renewsAt}:${kind}`;
      if (this.remindersSent.has(key)) continue;
      this.remindersSent.add(key);
      const text = autoActive
        ? `🔄 ${formatDate(sub.renewsAt)} автоматически продлим <b>${planTitle(sub.plan)}</b> за ${auto!.stars} ⭐. Отключить автопродление можно в кабинете.`
        : kind === 'ended'
          ? `⏰ Подписка <b>${planTitle(sub.plan)}</b> закончилась. Продлите её, чтобы вернуть доступ к моделям тарифа.`
          : `⏰ Подписка <b>${planTitle(sub.plan)}</b> закончится ${kind === '1d' ? '<b>завтра</b>' : `<b>${formatDate(sub.renewsAt)}</b>`}. Продлите заранее — оставшиеся дни сохранятся.`;
      await this.sendMessage(user.telegramChatId, text, {
        reply_markup: { inline_keyboard: [[this.openAppButton(autoActive ? '📱 Кабинет' : `⭐ Продлить ${planTitle(sub.plan)}`, autoActive ? undefined : 'plans')]] },
      });
      sent += 1;
    }
    return sent;
  }
}

export const telegramBotService = new TelegramBotService({
  subscriptionStore: defaultSubscriptionStore,
  userStore: defaultUserStore,
  invoiceStore: defaultInvoiceStore,
});
