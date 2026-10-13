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

export interface TelegramBotDeps {
  subscriptionStore: SubscriptionStore;
  userStore: UserStore;
  invoiceStore: InvoiceStore;
  botToken?: string;
  botUsername?: string;
  rateService?: StarsRateService;
  linkCodes?: TelegramLinkCodes;
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
    reply_to_message?: {
      message_id: number;
      from?: TelegramFrom;
      text?: string;
      caption?: string;
    };
    successful_payment?: {
      currency: string;
      total_amount: number;
      invoice_payload: string;
      telegram_payment_charge_id: string;
      provider_payment_charge_id?: string;
    };
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
interface StarsPayload {
  planId: PlanId;
  stars: number;
  invoiceId: string;
  userId: string;
}

export function encodePayload(payload: StarsPayload): string {
  return ['v1', payload.planId, payload.stars, payload.invoiceId, payload.userId].join('|');
}

export function decodePayload(raw: string): StarsPayload | null {
  const [version, planId, stars, invoiceId, userId] = raw.split('|');
  const amount = Number(stars);
  if (version !== 'v1' || !planId || !invoiceId || !userId || !Number.isInteger(amount) || amount <= 0) return null;
  if (!(STARS_PLANS as readonly string[]).includes(planId)) return null;
  return { planId: planId as PlanId, stars: amount, invoiceId, userId };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const DAY_MS = 24 * 3600 * 1000;
const REMINDER_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Платёжный бот Ketner AI (@Robo_kassa_bot): привязка к аккаунту сайта, оплата звёздами,
 * статус подписки, напоминания о продлении и кнопка мини-приложения.
 */
export class TelegramBotService {
  private token: string;
  private username: string;
  private deps: TelegramBotDeps;
  private rates: StarsRateService;
  private linkCodes: TelegramLinkCodes;
  private isPolling = false;
  private reminderTimer: NodeJS.Timeout | null = null;
  /** Обработанные платежи (повторная доставка того же платежа ничего не меняет). */
  private processedCharges = new Set<string>();
  /** Отправленные напоминания: пользователь, дата окончания и вид напоминания. */
  private remindersSent = new Set<string>();

  constructor(deps: TelegramBotDeps) {
    this.deps = deps;
    this.token = deps.botToken ?? config.telegramBotToken ?? '';
    this.username = (deps.botUsername || config.telegramBotUsername || 'Robo_kassa_bot').replace(/^@/, '');
    this.rates = deps.rateService ?? starsRateService;
    this.linkCodes = deps.linkCodes ?? telegramLinkCodes;
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

  private get siteUrl(): string {
    return (this.deps.webAppUrl || config.webAppUrl || 'https://ketner.org').replace(/\/+$/, '');
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
        console.log(`🤖 [TelegramBot] Авторизован бот оплаты: @${this.username}`);
      }
      await this.callApi('setMyCommands', {
        commands: [
          { command: 'start', description: 'Главное меню и кабинет' },
          { command: 'status', description: 'Моя подписка' },
          { command: 'plans', description: 'Тарифы и оплата звёздами' },
          { command: 'help', description: 'Помощь и поддержка' },
        ],
      });
      await this.callApi('setMyShortDescription', {
        short_description: 'Подписка Ketner AI: статус, продление и оплата звёздами.',
      });
      await this.callApi('setMyDescription', {
        description:
          'Официальный бот Ketner AI.\n\nОткройте кабинет, чтобы посмотреть подписку, продлить её или сменить тариф — оплата звёздами Telegram прямо здесь. Напомним, когда подписка подходит к концу.',
      });
      // Кнопка меню рядом с полем ввода открывает мини-приложение.
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

  // ───────────── счета в звёздах ─────────────

  /** Счёт на тариф по текущему курсу. Сумма фиксируется в счёте и не меняется при смене курса. */
  createStarsInvoice(userId: string, planId: PlanId): TelegramStarsInvoice {
    const stars = this.rates.quote(planPriceUsd(planId));
    return this.deps.invoiceStore.createTelegramStarsInvoice(userId, planId, planPriceRub(planId), stars, this.username);
  }

  private invoiceParams(invoice: TelegramStarsInvoice): Record<string, unknown> {
    const plan = getPlanItem(invoice.planId);
    return {
      title: `Ketner AI ${planTitle(invoice.planId)} · 30 дней`,
      description: plan?.modelsHighlight
        ? `Подписка на 30 дней: ${plan.modelsHighlight}. Включается сразу после оплаты.`
        : 'Подписка на 30 дней. Включается сразу после оплаты.',
      payload: encodePayload({
        planId: invoice.planId,
        stars: invoice.starsAmount,
        invoiceId: invoice.id,
        userId: invoice.userId,
      }),
      currency: 'XTR',
      prices: [{ label: `Ketner AI ${planTitle(invoice.planId)}`, amount: invoice.starsAmount }],
    };
  }

  /** Ссылка на окно оплаты звёздами (для мини-приложения и сайта). */
  async createInvoiceLink(invoice: TelegramStarsInvoice): Promise<string | null> {
    if (invoice.invoiceLink) return invoice.invoiceLink;
    const link = await this.callApi<string>('createInvoiceLink', this.invoiceParams(invoice));
    if (typeof link !== 'string' || !link.startsWith('https://')) return null;
    this.deps.invoiceStore.setTelegramStarsLink?.(invoice.id, link);
    return link;
  }

  async sendStarsInvoice(chatId: number | string, invoice: TelegramStarsInvoice): Promise<unknown> {
    return this.callApi('sendInvoice', { chat_id: chatId, ...this.invoiceParams(invoice) });
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
    if (invoice?.status === 'paid') return { ok: false, reason: 'already_paid' };
    return { ok: true, payload };
  }

  /** Включает оплаченный тариф. Повторная доставка того же платежа ничего не меняет. */
  activatePayment(
    payload: StarsPayload,
    chargeId: string,
  ): { status: 'activated'; subscription: Subscription; user: User | null } | { status: 'duplicate' } {
    const invoice = this.deps.invoiceStore.getTelegramStarsInvoice(payload.invoiceId);
    if (this.processedCharges.has(chargeId) || invoice?.status === 'paid') return { status: 'duplicate' };
    this.processedCharges.add(chargeId);
    if (this.processedCharges.size > 5000) {
      const oldest = this.processedCharges.values().next().value;
      if (oldest) this.processedCharges.delete(oldest);
    }
    this.deps.invoiceStore.markTelegramStarsPaid(payload.invoiceId, chargeId);
    const subscription = this.deps.subscriptionStore.checkout(payload.userId, payload.planId);
    const user = this.deps.userStore.updatePlan(payload.userId, payload.planId);
    if (user?.email && user.email !== payload.userId) this.deps.subscriptionStore.checkout(user.email, payload.planId);
    return { status: 'activated', subscription, user };
  }

  // ───────────── тексты и кнопки ─────────────

  private openAppButton(text = '📱 Открыть кабинет'): Record<string, unknown> {
    return { text, web_app: { url: this.miniAppUrl } };
  }

  private statusLines(user: User): string[] {
    const sub = this.deps.subscriptionStore.get(user.id);
    if (user.isVip) return ['💎 Тариф: <b>Ultra</b> (VIP)'];
    const end = sub.renewsAt ? Date.parse(sub.renewsAt) : NaN;
    const running = sub.plan !== 'free' && Number.isFinite(end) && end > Date.now();
    if (!running) return ['Тариф: <b>Free</b>', 'Платная подписка не активна.'];
    const days = Math.max(1, Math.ceil((end - Date.now()) / DAY_MS));
    return [
      `💎 Тариф: <b>${planTitle(sub.plan)}</b>`,
      sub.status === 'canceled'
        ? `Продление отключено, доступ до <b>${formatDate(sub.renewsAt)}</b> (${days} дн.)`
        : `Действует до <b>${formatDate(sub.renewsAt)}</b> (${days} дн.)`,
    ];
  }

  private priceLines(): string[] {
    return STARS_PLANS.map((planId) => {
      const usd = planPriceUsd(planId);
      return `• <b>${planTitle(planId)}</b> — ${this.rates.quote(usd)} ⭐ (≈ $${usd})`;
    });
  }

  async sendStart(chatId: number | string, from?: TelegramFrom): Promise<void> {
    const user = this.resolveUser(chatId);
    const name = escapeHtml(from?.first_name || user?.name || '');
    if (user) {
      await this.sendMessage(
        chatId,
        [`👋 ${name ? `${name}, з` : 'З'}дравствуйте!`, '', ...this.statusLines(user), '', 'В кабинете можно продлить подписку, сменить тариф и оплатить звёздами.'].join('\n'),
        {
          reply_markup: {
            inline_keyboard: [
              [this.openAppButton()],
              [
                { text: '⭐ Тарифы', callback_data: 'plans' },
                { text: '📊 Подписка', callback_data: 'status' },
              ],
              [{ text: '🌐 Открыть Ketner AI', url: `${this.siteUrl}/chat` }],
            ],
          },
        },
      );
      return;
    }
    await this.sendMessage(
      chatId,
      [
        `👋 ${name ? `${name}, д` : 'Д'}обро пожаловать в Ketner AI!`,
        '',
        'Здесь можно оформить и продлить подписку звёздами Telegram, смотреть её статус и получать напоминания о продлении.',
        '',
        'Чтобы начать, привяжите аккаунт Ketner: откройте кабинет и войдите или нажмите «Подключить Telegram» в настройках на сайте.',
      ].join('\n'),
      {
        reply_markup: {
          inline_keyboard: [
            [this.openAppButton('📱 Открыть кабинет и войти')],
            [{ text: '⚙️ Подключить в настройках сайта', url: `${this.siteUrl}/settings#telegram` }],
          ],
        },
      },
    );
  }

  async sendStatus(chatId: number | string): Promise<void> {
    const user = this.resolveUser(chatId);
    if (!user) {
      await this.sendNotLinked(chatId);
      return;
    }
    await this.sendMessage(chatId, ['📊 <b>Ваша подписка</b>', '', `Аккаунт: <code>${escapeHtml(user.email)}</code>`, ...this.statusLines(user)].join('\n'), {
      reply_markup: { inline_keyboard: [[this.openAppButton('📱 Управлять в кабинете')], [{ text: '⭐ Продлить или сменить тариф', callback_data: 'plans' }]] },
    });
  }

  async sendPlans(chatId: number | string): Promise<void> {
    const user = this.resolveUser(chatId);
    const lines = ['⭐ <b>Тарифы Ketner AI на 30 дней</b>', '', ...this.priceLines(), '', 'Цена в звёздах пересчитывается по текущему курсу Telegram Stars.'];
    if (!user) lines.push('', 'Сначала привяжите аккаунт Ketner — оплата зачисляется на него.');
    await this.sendMessage(chatId, lines.join('\n'), {
      reply_markup: {
        inline_keyboard: user
          ? [
              STARS_PLANS.map((planId) => ({
                text: `${planTitle(planId)} · ${this.rates.quote(planPriceUsd(planId))} ⭐`,
                callback_data: `buy:${planId}`,
              })),
              [this.openAppButton('📱 Подробнее в кабинете')],
            ]
          : [[this.openAppButton('📱 Открыть кабинет и войти')]],
      },
    });
  }

  private async sendNotLinked(chatId: number | string): Promise<void> {
    await this.sendMessage(chatId, 'Этот Telegram пока не привязан к аккаунту Ketner. Откройте кабинет и войдите — или нажмите «Подключить Telegram» в настройках сайта.', {
      reply_markup: {
        inline_keyboard: [[this.openAppButton('📱 Открыть кабинет и войти')], [{ text: '⚙️ Настройки сайта', url: `${this.siteUrl}/settings#telegram` }]],
      },
    });
  }

  private async sendHelp(chatId: number | string): Promise<void> {
    await this.sendMessage(
      chatId,
      [
        'ℹ️ <b>Помощь</b>',
        '',
        '/start — главное меню',
        '/status — подписка и срок действия',
        '/plans — тарифы и оплата звёздами',
        '',
        'Кнопка «Кабинет» рядом с полем ввода открывает мини-приложение: там всё управление подпиской.',
        '',
        'Вопросы по оплате и доступу — в поддержку: @ketner_support_bot',
      ].join('\n'),
      { reply_markup: { inline_keyboard: [[{ text: '💬 Написать в поддержку', url: 'https://t.me/ketner_support_bot' }]] } },
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
                verdict.reason === 'already_paid'
                  ? 'Этот счёт уже оплачен.'
                  : 'Счёт устарел. Откройте кабинет и выставите новый.',
            }),
      });
      return { handled: true, action: verdict.ok ? 'pre_checkout_approved' : `pre_checkout_rejected:${verdict.reason}` };
    }

    if (update.callback_query) return this.handleCallback(update.callback_query);

    const msg = update.message;
    if (!msg) return { handled: false };
    const chatId = msg.chat.id;

    if (msg.successful_payment) {
      const pay = msg.successful_payment;
      const payload = decodePayload(pay.invoice_payload);
      if (!payload || pay.currency !== 'XTR' || pay.total_amount !== payload.stars) {
        console.warn(`[TelegramBot] Платёж ${pay.telegram_payment_charge_id} не распознан`);
        await this.sendMessage(
          chatId,
          `⚠️ Платёж получен, но тариф не включился автоматически. Напишите в поддержку @ketner_support_bot и укажите номер: <code>${escapeHtml(pay.telegram_payment_charge_id)}</code>`,
        );
        return { handled: true, action: 'stars_payment_rejected' };
      }
      const result = this.activatePayment(payload, pay.telegram_payment_charge_id);
      if (result.status === 'duplicate') return { handled: true, action: 'stars_payment_duplicate' };
      await this.sendMessage(
        chatId,
        [
          '🎉 <b>Оплата прошла!</b>',
          '',
          `Тариф <b>${planTitle(payload.planId)}</b> действует до <b>${formatDate(result.subscription.renewsAt)}</b>.`,
          result.user ? `Аккаунт: <code>${escapeHtml(result.user.email)}</code>` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🚀 Открыть Ketner AI', url: `${this.siteUrl}/chat` }], [this.openAppButton('📱 Кабинет')]],
          },
        },
      );
      return { handled: true, action: 'stars_payment_completed' };
    }

    const text = msg.text?.trim() ?? '';
    const [rawCommand, ...rest] = text.split(/\s+/);
    const command = (rawCommand ?? '').replace(/@\w+$/, '').toLowerCase();
    const arg = rest.join(' ').trim();

    if (command === '/start' && arg.startsWith('lnk_')) return this.handleLinkCode(chatId, arg.slice(4), msg.from);
    if (command === '/start' && arg.startsWith('stars_')) return this.handleStarsDeepLink(chatId, arg);
    if (command === '/start' && arg.startsWith('pay_')) {
      const planId = arg.slice(4).split('_')[0] ?? '';
      return this.handleBuy(chatId, planId);
    }
    if (command === '/start' || command === '/menu') {
      await this.sendStart(chatId, msg.from);
      return { handled: true, action: 'start' };
    }
    if (command === '/status' || command === '/sub') {
      await this.sendStatus(chatId);
      return { handled: true, action: 'status' };
    }
    if (command === '/plans' || command === '/buy') {
      await this.sendPlans(chatId);
      return { handled: true, action: 'plans' };
    }
    if (command === '/help') {
      await this.sendHelp(chatId);
      return { handled: true, action: 'help' };
    }
    if (command === '/unlink') {
      await this.sendMessage(chatId, 'Отвязать Telegram от аккаунта Ketner?', {
        reply_markup: { inline_keyboard: [[{ text: 'Да, отвязать', callback_data: 'unlink:yes' }, { text: 'Отмена', callback_data: 'status' }]] },
      });
      return { handled: true, action: 'unlink_confirm' };
    }

    await this.sendMessage(chatId, 'Подписка и оплата — в кабинете. Команды: /status, /plans, /help.', {
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
    if (data === 'plans') {
      await this.answerCallbackQuery(cb.id);
      await this.sendPlans(chatId);
      return { handled: true, action: 'plans' };
    }
    if (data === 'status') {
      await this.answerCallbackQuery(cb.id);
      await this.sendStatus(chatId);
      return { handled: true, action: 'status' };
    }
    if (data.startsWith('buy:')) {
      await this.answerCallbackQuery(cb.id);
      return this.handleBuy(chatId, data.slice(4));
    }
    if (data === 'unlink:yes') {
      const user = this.resolveUser(chatId);
      if (user) this.deps.userStore.unlinkTelegram(user.id);
      await this.answerCallbackQuery(cb.id, user ? 'Telegram отвязан' : 'Аккаунт не был привязан');
      await this.sendStart(chatId, cb.from);
      return { handled: true, action: 'unlinked' };
    }
    await this.answerCallbackQuery(cb.id);
    return { handled: true, action: 'callback_unhandled' };
  }

  private async handleBuy(chatId: number | string, planId: string): Promise<{ handled: boolean; action?: string }> {
    const user = this.resolveUser(chatId);
    if (!user) {
      await this.sendNotLinked(chatId);
      return { handled: true, action: 'buy_not_linked' };
    }
    if (!(STARS_PLANS as readonly string[]).includes(planId)) {
      await this.sendPlans(chatId);
      return { handled: true, action: 'buy_unknown_plan' };
    }
    const invoice = this.createStarsInvoice(user.id, planId as PlanId);
    await this.sendStarsInvoice(chatId, invoice);
    return { handled: true, action: 'invoice_stars_sent' };
  }

  /** Счёт, выставленный на сайте: `/start stars_<id>`. Платит тот, кто открыл ссылку, за аккаунт счёта. */
  private async handleStarsDeepLink(chatId: number | string, invoiceId: string): Promise<{ handled: boolean; action?: string }> {
    const invoice = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
    if (!invoice || invoice.status === 'paid') {
      await this.sendMessage(chatId, invoice ? 'Этот счёт уже оплачен ✅' : 'Счёт не найден или устарел. Выберите тариф заново.', {
        reply_markup: { inline_keyboard: [[this.openAppButton()]] },
      });
      return { handled: true, action: invoice ? 'deep_link_paid' : 'deep_link_missing' };
    }
    await this.sendStarsInvoice(chatId, invoice);
    return { handled: true, action: 'invoice_stars_sent' };
  }

  private async handleLinkCode(chatId: number | string, code: string, from?: TelegramFrom): Promise<{ handled: boolean; action?: string }> {
    const userId = this.linkCodes.consume(code);
    const user = userId ? this.deps.userStore.findById(userId) : null;
    if (!user) {
      await this.sendMessage(chatId, '❌ Ссылка для привязки устарела. Откройте настройки на сайте и нажмите «Подключить Telegram» ещё раз.', {
        reply_markup: { inline_keyboard: [[{ text: '⚙️ Настройки сайта', url: `${this.siteUrl}/settings#telegram` }]] },
      });
      return { handled: true, action: 'link_code_invalid' };
    }
    this.linkTelegram(user.id, chatId, from?.username);
    await this.sendMessage(chatId, ['✅ <b>Telegram привязан к аккаунту</b>', `<code>${escapeHtml(user.email)}</code>`, '', ...this.statusLines(user)].join('\n'), {
      reply_markup: { inline_keyboard: [[this.openAppButton()], [{ text: '⭐ Тарифы', callback_data: 'plans' }]] },
    });
    return { handled: true, action: 'account_linked' };
  }

  /** Один Telegram — один аккаунт: прежняя привязка этого чата снимается. */
  linkTelegram(userId: string, chatId: number | string, username?: string): User | null {
    const previous = this.deps.userStore.findByTelegramChatId(chatId);
    if (previous && previous.id !== userId) this.deps.userStore.unlinkTelegram(previous.id);
    return this.deps.userStore.linkTelegram(userId, chatId, username);
  }

  // ───────────── напоминания о продлении ─────────────

  /** Раз в час: за 3 дня и за сутки до окончания подписки, и в день, когда она закончилась. */
  async sendRenewalReminders(now = Date.now()): Promise<number> {
    let sent = 0;
    for (const user of this.deps.userStore.list()) {
      if (!user.telegramChatId || user.isVip) continue;
      const sub = this.deps.subscriptionStore.get(user.id);
      if (sub.plan === 'free' || !sub.renewsAt) continue;
      const end = Date.parse(sub.renewsAt);
      if (!Number.isFinite(end)) continue;
      const left = end - now;
      const kind = left > 2 * DAY_MS && left <= 3 * DAY_MS ? '3d' : left > 0 && left <= DAY_MS ? '1d' : left <= 0 && left > -DAY_MS ? 'ended' : null;
      if (!kind) continue;
      const key = `${user.id}:${sub.renewsAt}:${kind}`;
      if (this.remindersSent.has(key)) continue;
      this.remindersSent.add(key);
      const text =
        kind === 'ended'
          ? `⏰ Подписка <b>${planTitle(sub.plan)}</b> закончилась. Продлите её, чтобы вернуть доступ к моделям тарифа.`
          : `⏰ Подписка <b>${planTitle(sub.plan)}</b> закончится ${kind === '1d' ? '<b>завтра</b>' : `<b>${formatDate(sub.renewsAt)}</b>`}. Продлите заранее — оставшиеся дни сохранятся.`;
      await this.sendMessage(user.telegramChatId, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `⭐ Продлить ${planTitle(sub.plan)} · ${this.rates.quote(planPriceUsd(sub.plan))} ⭐`, callback_data: `buy:${sub.plan}` }],
            [this.openAppButton()],
          ],
        },
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
