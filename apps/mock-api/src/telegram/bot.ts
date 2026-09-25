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
import type { PlanId, PlanItem } from '../types.js';

export function calculateStars(priceRub: number): number {
  if (priceRub <= 0) return 0;
  if (priceRub === 1199) return 650;
  if (priceRub === 2499) return 1350;
  if (priceRub === 999 || priceRub === 990) return 550;
  if (priceRub === 1999 || priceRub === 1990) return 1100;
  return Math.round(priceRub / 1.84);
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
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number | string;
      type: string;
      first_name?: string;
      username?: string;
    };
    text?: string;
    date: number;
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
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number | string;
      };
    };
    data?: string;
  };
  pre_checkout_query?: {
    id: string;
    from: {
      id: number;
      first_name: string;
    };
    currency: string;
    total_amount: number;
    invoice_payload: string;
  };
}

export class TelegramBotService {
  private token: string;
  private username: string;
  private deps: TelegramBotDeps;
  private chatToUserId = new Map<string | number, string>();
  private isPolling = false;

  constructor(deps: TelegramBotDeps) {
    this.deps = deps;
    this.token = deps.botToken || config.telegramBotToken || '';
    this.username = (deps.botUsername || config.telegramBotUsername || 'Robo_kassa_bot').replace(
      /^@/,
      '',
    );
  }

  get botUsername(): string {
    return this.username;
  }

  get isConfigured(): boolean {
    return Boolean(this.token && this.token.length > 10);
  }

  /**
   * Инициализирует Telegram-бота при старте приложения:
   * 1. Проверяет getMe (валидирует токен)
   * 2. Устанавливает команды /start, /plans, /status, /help
   * 3. Устанавливает описание бота
   * 4. Настраивает Webhook (если HTTPS / Render) или запускает Long Polling (если локально)
   */
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
          { command: 'start', description: 'Запустить бота и оформить подписку' },
          { command: 'plans', description: 'Каталог тарифов и оплата (Stars ⭐️ / СБП)' },
          { command: 'status', description: 'Проверить статус вашей подписки' },
          { command: 'help', description: 'Помощь и контакты поддержки' },
        ],
      });

      await this.callApi('setMyDescription', {
        description:
          '🤖 Официальный платёжный сервис Ketner AI.\n\nМгновенная оплата подписок на флагманские модели ИИ (GPT-6, Claude 5.5, Gemini 3.8 Pro, Qwen 2.5 Max) через Telegram Stars (⭐️) и СБП (0% комиссии).',
      });

      const effectiveBaseUrl =
        config.telegramWebhookUrl ||
        process.env.RENDER_EXTERNAL_URL ||
        publicBaseUrl ||
        config.betterAuthUrl;

      if (effectiveBaseUrl && effectiveBaseUrl.startsWith('https://')) {
        const webhookUrl = `${effectiveBaseUrl.replace(/\/$/, '')}/api/telegram/webhook`;
        const res = await this.callApi<{ ok: boolean; description?: string }>('setWebhook', {
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
          drop_pending_updates: false,
        });
        console.log(`✅ [TelegramBot] Webhook зарегистрирован на: ${webhookUrl}`, res);
      } else {
        console.log('⚡ [TelegramBot] Локальное окружение: запуск фонового long-polling...');
        await this.callApi('deleteWebhook', { drop_pending_updates: false });
        this.startPolling();
      }
    } catch (error) {
      console.error('⚠️ [TelegramBot] Ошибка инициализации бота:', error);
    }
  }

  startPolling(): void {
    if (this.isPolling) return;
    this.isPolling = true;

    (async () => {
      let offset = 0;
      while (this.isPolling) {
        try {
          const res = await this.callApi<TelegramUpdate[]>('getUpdates', {
            offset,
            timeout: 20,
            allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
          });
          if (Array.isArray(res)) {
            for (const update of res) {
              offset = update.update_id + 1;
              await this.processUpdate(update);
            }
          }
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    })().catch((err) => {
      console.error('[TelegramBot] Polling loop error:', err);
    });
  }

  stopPolling(): void {
    this.isPolling = false;
  }

  /**
   * Вызов Telegram Bot API.
   */
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

  async sendMessage(
    chatId: number | string,
    text: string,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...extra,
    });
  }

  async sendInvoice(
    chatId: number | string,
    params: {
      title: string;
      description: string;
      payload: string;
      currency: string;
      prices: Array<{ label: string; amount: number }>;
    },
  ): Promise<unknown> {
    return this.callApi('sendInvoice', {
      chat_id: chatId,
      title: params.title,
      description: params.description,
      payload: params.payload,
      currency: params.currency,
      prices: params.prices,
      provider_token: params.currency === 'XTR' ? '' : config.telegramPaymentProviderToken,
    });
  }

  async answerPreCheckoutQuery(
    preCheckoutQueryId: string,
    ok: boolean,
    errorMessage?: string,
  ): Promise<unknown> {
    return this.callApi('answerPreCheckoutQuery', {
      pre_checkout_query_id: preCheckoutQueryId,
      ok,
      error_message: errorMessage,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    return this.callApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  /**
   * Обработка входящего обновления от Telegram (webhook или polling).
   */
  async processUpdate(update: TelegramUpdate): Promise<{ handled: boolean; action?: string }> {
    // 1. Pre-checkout query (проверка перед списанием Stars)
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      await this.answerPreCheckoutQuery(q.id, true);
      return { handled: true, action: 'pre_checkout_approved' };
    }

    // 2. Callback query от инлайн-кнопок
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data ?? '';
      const chatId = cb.message?.chat.id;

      if (!chatId) {
        await this.answerCallbackQuery(cb.id);
        return { handled: true, action: 'callback_no_chat' };
      }

      if (data.startsWith('pay_stars:')) {
        const parts = data.split(':');
        const planId = (parts[1] || 'gpt-pro') as PlanId;
        const storedUser = this.chatToUserId.get(chatId);
        const userId = parts[2] || storedUser || config.demoUserId;
        const invoiceId = parts[3] || undefined;
        const plan = getPlanItem(planId) ?? getPlanItem('gpt-pro')!;
        const stars = calculateStars(plan.priceMonthly);

        await this.answerCallbackQuery(cb.id, `Выставляем счёт на ${stars} ⭐️`);
        await this.sendInvoice(chatId, {
          title: `Ketner AI: ${plan.id.toUpperCase()}`,
          description: `Месячная подписка на 30 дней: ${plan.modelsHighlight}. Мгновенная активация.`,
          payload: JSON.stringify({
            planId: plan.id,
            userId,
            invoiceId,
          }),
          currency: 'XTR',
          prices: [{ label: `Тариф ${plan.id.toUpperCase()}`, amount: stars }],
        });
        return { handled: true, action: 'invoice_stars_sent' };
      }

      if (data === 'cmd_plans') {
        await this.answerCallbackQuery(cb.id);
        const targetUserId = this.chatToUserId.get(chatId) || config.demoUserId;
        await this.sendPlansMessage(chatId, targetUserId);
        return { handled: true, action: 'cmd_plans_handled' };
      }

      if (data === 'cmd_status') {
        await this.answerCallbackQuery(cb.id);
        const targetUserId = this.chatToUserId.get(chatId) || config.demoUserId;
        await this.sendStatusMessage(chatId, targetUserId);
        return { handled: true, action: 'cmd_status_handled' };
      }

      if (data.startsWith('pay_sbp:')) {
        const [, planId, userId] = data.split(':');
        const plan = getPlanItem(planId) ?? getPlanItem('gpt-pro')!;
        const targetUser = userId || config.demoUserId;
        const invoice = this.deps.invoiceStore.createSbpInvoice(
          targetUser,
          plan.id,
          plan.priceMonthly,
        );

        await this.answerCallbackQuery(cb.id);
        const sbpMessage = [
          '⚡ *Оплата через СБП (Система быстрых платежей)*',
          '',
          `Тариф: *${plan.id.toUpperCase()}*`,
          `Сумма: *${plan.priceMonthly} ₽* (без комиссии)`,
          '',
          '📲 *Для оплаты на смартфоне нажмите ссылку:*',
          `[👉 Открыть в банковском приложении](${invoice.deepLink})`,
          '',
          'Либо перейдите на страницу оформления на сайте Ketner AI для сканирования QR-кода.',
        ].join('\n');

        await this.sendMessage(chatId, sbpMessage, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📲 Оплатить в приложении банка', url: invoice.deepLink }],
              [
                {
                  text: '🌐 Открыть на сайте Ketner AI',
                  url: `${config.webAppUrl}/checkout/${plan.id}`,
                },
              ],
              [
                {
                  text: '✅ Я оплатил через СБП',
                  callback_data: `confirm_sbp:${invoice.id}:${plan.id}:${targetUser}`,
                },
              ],
            ],
          },
        });
        return { handled: true, action: 'sbp_link_sent' };
      }

      if (data.startsWith('confirm_sbp:')) {
        const [, invoiceId, planId, userId] = data.split(':');
        const validPlan = (planId || 'gpt-pro') as PlanId;
        const validUser = userId || config.demoUserId;

        this.deps.invoiceStore.markSbpPaid(invoiceId);
        this.deps.subscriptionStore.checkout(validUser, validUser ? validPlan : 'gpt-pro');
        this.deps.userStore.updatePlan(validUser, validPlan);

        await this.answerCallbackQuery(cb.id, 'Оплата успешно подтверждена!');
        await this.sendMessage(
          chatId,
          `🎉 *Подписка активирована!*\n\nВаш тариф *${validPlan.toUpperCase()}* успешно активирован через СБП на 30 дней.\nМодели разблокированы в веб-интерфейсе Ketner AI.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚀 Перейти в чат Ketner AI', url: `${config.webAppUrl}/chat` }],
              ],
            },
          },
        );
        return { handled: true, action: 'sbp_payment_confirmed' };
      }

      if (data.startsWith('confirm_stars:')) {
        const parts = data.split(':');
        const invoiceId = parts[1] || undefined;
        const planId = (parts[2] || 'gpt-pro') as PlanId;
        const storedUser = this.chatToUserId.get(chatId);
        const userId = parts[3] || storedUser || config.demoUserId;

        if (invoiceId) {
          this.deps.invoiceStore.markTelegramStarsPaid(invoiceId);
        }
        this.deps.subscriptionStore.checkout(userId, planId);
        const user = this.deps.userStore.updatePlan(userId, planId);
        if (user?.email && user.email !== userId) {
          this.deps.subscriptionStore.checkout(user.email, planId);
        }

        await this.answerCallbackQuery(cb.id, 'Оплата успешно подтверждена!');
        await this.sendMessage(
          chatId,
          `🎉 *Оплата подтверждена!*\n\nВаш тариф *${planId.toUpperCase()}* успешно активирован на 30 дней.\n\nВсе флагманские модели ИИ разблокированы в Ketner AI!`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚀 Открыть веб-чат Ketner AI', url: `${config.webAppUrl}/chat` }],
              ],
            },
          },
        );
        return { handled: true, action: 'stars_payment_confirmed' };
      }

      await this.answerCallbackQuery(cb.id);
      return { handled: true, action: 'callback_unhandled' };
    }

    // 3. Сообщения пользователя
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;

      // Успешный платёж Stars
      if (msg.successful_payment) {
        const pay = msg.successful_payment;
        let planId: PlanId = 'gpt-pro';
        let userId: string = this.chatToUserId.get(chatId) || config.demoUserId;
        let invoiceId: string | undefined;

        try {
          const payload = JSON.parse(pay.invoice_payload) as {
            planId?: PlanId;
            userId?: string;
            invoiceId?: string;
          };
          if (payload.planId) planId = payload.planId;
          if (payload.userId) userId = payload.userId;
          if (payload.invoiceId) invoiceId = payload.invoiceId;
        } catch {
          // Игнорируем ошибку парсинга
        }

        this.deps.subscriptionStore.checkout(userId, planId);
        this.deps.userStore.updatePlan(userId, planId);

        if (invoiceId) {
          this.deps.invoiceStore.markTelegramStarsPaid(invoiceId);
        }

        const successText = [
          '🎉 *Оплата Telegram Stars успешно завершена!*',
          '',
          `Списано: *${pay.total_amount} ⭐️ Stars*`,
          `Активирован тариф: *${planId.toUpperCase()}* на 30 дней`,
          '',
          'Доступ ко всем возможностям тарифа мгновенно открыт в веб-интерфейсе Ketner AI!',
        ].join('\n');

        await this.sendMessage(chatId, successText, {
          reply_markup: {
            inline_keyboard: [[{ text: '🚀 Открыть Ketner AI', url: `${config.webAppUrl}/chat` }]],
          },
        });
        return { handled: true, action: 'stars_payment_completed' };
      }

      const text = msg.text?.trim() ?? '';

      // Команда /start с deep-link параметром: /start pay_stars_12345 или /start pay_ultra
      if (text.startsWith('/start pay_') || text.startsWith('/start stars_')) {
        const rawPayload = text.startsWith('/start pay_')
          ? text.replace('/start pay_', '').trim()
          : text.replace('/start ', '').trim();

        let planId: PlanId = 'gpt-pro';
        let userId: string = this.chatToUserId.get(chatId) || config.demoUserId;
        let invoiceId: string | undefined;

        if (rawPayload.startsWith('stars_')) {
          invoiceId = rawPayload;
          const inv = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
          if (inv) {
            planId = inv.planId;
            userId = inv.userId;
          }
        } else if (rawPayload.includes('__')) {
          const parts = rawPayload.split('__');
          planId = (parts[0] || 'gpt-pro') as PlanId;
          if (parts[1]?.startsWith('stars_')) {
            invoiceId = parts[1];
            const inv = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
            if (inv) {
              planId = inv.planId;
              userId = inv.userId;
            }
          } else {
            userId = parts[1] || userId;
            invoiceId = parts[2] || undefined;
          }
        } else if (rawPayload.includes('_')) {
          const parts = rawPayload.split('_');
          planId = (parts[0] || 'gpt-pro') as PlanId;
          userId = parts[1] || userId;
          invoiceId = parts.slice(2).join('_') || undefined;
        } else if (rawPayload) {
          planId = rawPayload as PlanId;
        }

        this.chatToUserId.set(chatId, userId);
        const plan = getPlanItem(planId) ?? getPlanItem('gpt-pro')!;
        const stars = calculateStars(plan.priceMonthly);

        // 1. АВТОМАТИЧЕСКИ выставляем нативный счёт на оплату в Telegram Stars (sendInvoice)
        await this.sendInvoice(chatId, {
          title: `Ketner AI: ${plan.id.toUpperCase()}`,
          description: `Месячная подписка на 30 дней: ${plan.modelsHighlight}. Активируется мгновенно на ваш аккаунт.`,
          payload: JSON.stringify({
            planId: plan.id,
            userId,
            invoiceId,
          }),
          currency: 'XTR',
          prices: [{ label: `Тариф ${plan.id.toUpperCase()}`, amount: stars }],
        });

        // 2. Дополнительно отправляем карточку с описанием возможностей тарифа
        const bulletsText = plan.bullets.ru.map((b) => `• ${b}`).join('\n');
        const planText = [
          `💎 *Оформление подписки ${plan.id.toUpperCase()}*`,
          '',
          `⭐️ Счёт на *${stars} Stars* выставлен выше. Нажмите нативную кнопку **Заплатить** для оплаты в Telegram, либо кнопку подтверждения ниже:`,
          '',
          '✨ *Включено в подписку:*',
          bulletsText,
          '',
          '💡 _Доступные действия:_',
        ].join('\n');

        await this.sendMessage(chatId, planText, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '✅ Подтвердить оплату и активировать',
                  callback_data: `confirm_stars:${invoiceId || ''}:${plan.id}:${userId}`,
                },
              ],
              [
                {
                  text: `⚡ Оплатить через СБП (${plan.priceMonthly} ₽)`,
                  callback_data: `pay_sbp:${plan.id}:${userId}`,
                },
              ],
              [
                {
                  text: '🌐 Открыть на сайте Ketner AI',
                  url: `${config.webAppUrl}/checkout/${plan.id}`,
                },
              ],
            ],
          },
        });
        return { handled: true, action: 'pay_deep_link_handled' };
      }

      const cleanCmd = text.replace(/@\w+/g, '').trim().toLowerCase();

      // Обычный /start
      if (cleanCmd === '/start' || cleanCmd === 'start' || cleanCmd === '/menu') {
        const welcomeText = [
          `👋 Добро пожаловать в официальный платёжный бот **Ketner AI** (@${this.username})!`,
          '',
          'Здесь вы можете легко и безопасно оплатить подписку на передовые ИИ-модели:',
          '• ⭐️ **Telegram Stars** — быстрая оплата виртуальной валютой Telegram без ввода карт.',
          '• ⚡ **СБП (Система быстрых платежей)** — мгновенная оплата через Сбербанк, Т-Банк, Альфа-Банк по QR-коду с 0% комиссии.',
          '',
          '💎 *Доступные тарифы:*',
          '• **GPT Pro** (650 ⭐️ / 1 199 ₽) — GPT-6 Astra, GPT-5.5 Omni, o3-mini',
          '• **Claude Pro** (650 ⭐️ / 1 199 ₽) — Claude 4.5 Sonnet & Opus, Fable 5.5',
          '• **Gemini Pro** (650 ⭐️ / 1 199 ₽) — Gemini 3.8 Pro, Gemini 3.5 Ultra',
          '• **Ultra** (1 350 ⭐️ / 2 499 ₽) — Полный безлимит ко всем моделям без пауз',
          '',
          '💡 *Доступные команды:*',
          '/plans — посмотреть каталог тарифов и оплатить',
          '/status — проверить статус вашей подписки',
          '/help — контакты и поддержка',
        ].join('\n');

        await this.sendMessage(chatId, welcomeText, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💎 Каталог тарифов и оплата', callback_data: 'cmd_plans' }],
              [{ text: '📊 Моя подписка', callback_data: 'cmd_status' }],
              [{ text: '🌐 Перейти на сайт Ketner AI', url: config.webAppUrl }],
            ],
          },
        });
        return { handled: true, action: 'start_handled' };
      }

      // /plans
      if (
        cleanCmd === '/plans' ||
        cleanCmd === 'plans' ||
        cleanCmd === '/tariffs' ||
        cleanCmd === '/pricing'
      ) {
        const targetUserId = this.chatToUserId.get(chatId) || config.demoUserId;
        await this.sendPlansMessage(chatId, targetUserId);
        return { handled: true, action: 'plans_handled' };
      }

      // /status
      if (
        cleanCmd === '/status' ||
        cleanCmd === 'status' ||
        cleanCmd === '/sub' ||
        cleanCmd === '/subscription'
      ) {
        const targetUserId = this.chatToUserId.get(chatId) || config.demoUserId;
        await this.sendStatusMessage(chatId, targetUserId);
        return { handled: true, action: 'status_handled' };
      }

      // /help
      if (cleanCmd === '/help' || cleanCmd === 'help') {
        const helpText = [
          'ℹ️ *Справка и поддержка Ketner AI*',
          '',
          'Официальный сайт: https://ketner.ai',
          'По вопросам оплаты и подписок:',
          '• Поддержка: support@ketner.ai',
          '• Способы оплаты: Telegram Stars ⭐️, СБП (0% комиссия)',
        ].join('\n');

        await this.sendMessage(chatId, helpText);
        return { handled: true, action: 'help_handled' };
      }

      // Неизвестная команда
      await this.sendMessage(
        chatId,
        'Я понимаю команды:\n/start — начало работы\n/plans — каталог тарифов\n/status — статус подписки\n/help — помощь',
      );
      return { handled: true, action: 'fallback_handled' };
    }

    return { handled: false };
  }

  async sendPlansMessage(chatId: number | string, _userId?: string): Promise<void> {
    const premiumPlans = PLANS.filter((p) => p.priceMonthly > 0);
    let plansText = '💎 *Тарифные планы Ketner AI:*\n\n';

    for (const p of premiumPlans) {
      const stars = calculateStars(p.priceMonthly);
      plansText += `🔹 *${p.id.toUpperCase()}*\n`;
      plansText += `   Цена: *${p.priceMonthly} ₽/мес* или *${stars} ⭐️*\n`;
      plansText += `   Модели: ${p.modelsHighlight}\n`;
      plansText += `   Лимит: ${p.limitBadge?.ru}\n\n`;
    }

    plansText += 'Нажмите кнопку ниже для быстрой оплаты в Telegram Stars:';

    const buttons = premiumPlans.map((p) => [
      {
        text: `⭐️ Оплатить ${p.id.toUpperCase()} (${calculateStars(p.priceMonthly)} ⭐️)`,
        callback_data: `pay_stars:${p.id}`,
      },
    ]);

    await this.sendMessage(chatId, plansText, {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  }

  async sendStatusMessage(chatId: number | string, userId: string): Promise<void> {
    const sub = this.deps.subscriptionStore.get(userId);
    const plan = getPlanItem(sub?.plan || 'free') ?? getPlanItem('free')!;
    const statusText = [
      '📊 *Статус вашей подписки Ketner AI:*',
      '',
      `Текущий план: *${plan.id.toUpperCase()}*`,
      `Статус: *${sub?.status === 'active' ? '✅ Активна' : '❌ Бесплатный тариф'}*`,
      sub?.renewsAt
        ? `Дата продления: *${new Date(sub.renewsAt).toLocaleDateString('ru-RU')}*`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    await this.sendMessage(chatId, statusText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Выбрать тариф', callback_data: 'cmd_plans' }],
          [{ text: '🌐 Открыть настройки на сайте', url: `${config.webAppUrl}/settings` }],
        ],
      },
    });
  }
}

export const telegramBotService = new TelegramBotService({
  subscriptionStore: defaultSubscriptionStore,
  userStore: defaultUserStore,
  invoiceStore: defaultInvoiceStore,
  botToken: config.telegramBotToken,
  botUsername: config.telegramBotUsername,
});


