import { config } from '../config.js';
import { PLANS } from '../routes/billing.js';
import type { InvoiceStore } from '../store/invoice-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import type { PlanId, PlanItem } from '../types.js';

export function calculateStars(priceRub: number): number {
  if (priceRub <= 0) return 0;
  if (priceRub === 1199) return 650;
  if (priceRub === 2499) return 1350;
  if (priceRub === 999) return 550;
  if (priceRub === 1999) return 1100;
  return Math.round(priceRub / 1.84);
}

export function getPlanItem(planId: string): PlanItem | undefined {
  return PLANS.find((p) => p.id === planId);
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

  constructor(deps: TelegramBotDeps) {
    this.deps = deps;
    this.token = deps.botToken || config.telegramBotToken || '';
    this.username = (deps.botUsername || config.telegramBotUsername || 'KetnerAIBot').replace(
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
        const [, planId, userId] = data.split(':');
        const plan = getPlanItem(planId) ?? getPlanItem('gpt-pro')!;
        const stars = calculateStars(plan.priceMonthly);

        await this.answerCallbackQuery(cb.id, `Создаём счёт на ${stars} ⭐️`);
        await this.sendInvoice(chatId, {
          title: `Подписка Ketner AI: ${plan.id.toUpperCase()}`,
          description: `Месячная подписка на флагманские модели ИИ (${plan.modelsHighlight})`,
          payload: JSON.stringify({ planId: plan.id, userId: userId || config.demoUserId }),
          currency: 'XTR',
          prices: [{ label: `Подписка ${plan.id.toUpperCase()}`, amount: stars }],
        });
        return { handled: true, action: 'invoice_stars_sent' };
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
        let userId: string = config.demoUserId;

        try {
          const payload = JSON.parse(pay.invoice_payload) as { planId?: PlanId; userId?: string };
          if (payload.planId) planId = payload.planId;
          if (payload.userId) userId = payload.userId;
        } catch {
          // Игнорируем ошибку парсинга
        }

        this.deps.subscriptionStore.checkout(userId, planId);
        this.deps.userStore.updatePlan(userId, planId);

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

      // Команда /start с deep-link параметром: /start pay_gpt-pro_demo-user
      if (text.startsWith('/start pay_')) {
        const payload = text.replace('/start pay_', '');
        const parts = payload.split('_');
        const planId = (parts[0] || 'gpt-pro') as PlanId;
        const userId = parts.slice(1).join('_') || config.demoUserId;
        const plan = getPlanItem(planId) ?? getPlanItem('gpt-pro')!;
        const stars = calculateStars(plan.priceMonthly);

        const bulletsText = plan.bullets.ru.map((b) => `• ${b}`).join('\n');
        const planText = [
          '🤖 *Ketner AI Billing*',
          '',
          `Вы выбрали тариф: *${plan.id.toUpperCase()}*`,
          `💰 Стоимость: *${plan.priceMonthly} ₽* или *${stars} ⭐️ (Telegram Stars)*`,
          `Лимит: *${plan.limitBadge?.ru ?? 'Без лимита'}*`,
          '',
          '✨ *Включено в подписку:*',
          bulletsText,
          '',
          'Выберите удобный способ оплаты:',
        ].join('\n');

        await this.sendMessage(chatId, planText, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: `⭐️ Оплатить ${stars} ⭐️ Stars`,
                  callback_data: `pay_stars:${plan.id}:${userId}`,
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

      // Обычный /start
      if (text === '/start') {
        const welcomeText = [
          `👋 Добро пожаловать в официальный платёжный бот **Ketner AI** (@${this.username})!`,
          '',
          'Здесь вы можете легко и безопасно оплатить подписку на передовые ИИ-модели:',
          '• ⭐️ **Telegram Stars** — быстрая оплата виртуальной валютой Telegram без ввода карт.',
          '• ⚡ **СБП (Система быстрых платежей)** — мгновенная оплата через Сбербанк, Т-Банк, Альфа-Банк по QR-коду с 0% комиссии.',
          '',
          '💡 *Доступные команды:*',
          '/plans — посмотреть доступные тарифы (GPT Pro, Claude Pro, Gemini Pro, Ultra)',
          '/status — проверить статус вашей подписки',
          '/help — контакты и поддержка',
        ].join('\n');

        await this.sendMessage(chatId, welcomeText, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Каталог тарифов', callback_data: 'cmd_plans' }],
              [{ text: '🌐 Перейти на сайт Ketner AI', url: config.webAppUrl }],
            ],
          },
        });
        return { handled: true, action: 'start_handled' };
      }

      // /plans
      if (text === '/plans' || text === 'cmd_plans') {
        const premiumPlans = PLANS.filter((p) => p.priceMonthly > 0);
        let plansText = '💎 *Тарифные планы Ketner AI:*\n\n';

        for (const p of premiumPlans) {
          const stars = calculateStars(p.priceMonthly);
          plansText += `🔹 *${p.id.toUpperCase()}*\n`;
          plansText += `   Цена: *${p.priceMonthly} ₽/мес* или *${stars} ⭐️*\n`;
          plansText += `   Модели: ${p.modelsHighlight}\n`;
          plansText += `   Лимит: ${p.limitBadge?.ru}\n\n`;
        }

        plansText += 'Нажмите кнопку ниже для быстрого оформления:';

        const buttons = premiumPlans.map((p) => [
          {
            text: `Оформить ${p.id.toUpperCase()} (${calculateStars(p.priceMonthly)} ⭐️ / ${p.priceMonthly} ₽)`,
            callback_data: `pay_stars:${p.id}:${config.demoUserId}`,
          },
        ]);

        await this.sendMessage(chatId, plansText, {
          reply_markup: {
            inline_keyboard: buttons,
          },
        });
        return { handled: true, action: 'plans_handled' };
      }

      // /status
      if (text === '/status') {
        const sub = this.deps.subscriptionStore.get(config.demoUserId);
        const plan = getPlanItem(sub.plan) ?? getPlanItem('free')!;
        const statusText = [
          '📊 *Статус вашей подписки Ketner AI:*',
          '',
          `Текущий план: *${plan.id.toUpperCase()}*`,
          `Статус: *${sub.status === 'active' ? '✅ Активна' : '❌ Отменена'}*`,
          sub.renewsAt
            ? `Дата продления: *${new Date(sub.renewsAt).toLocaleDateString('ru-RU')}*`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

        await this.sendMessage(chatId, statusText, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '⚡ Улучшить тариф', callback_data: 'cmd_plans' }],
              [{ text: '🌐 Открыть настройки на сайте', url: `${config.webAppUrl}/settings` }],
            ],
          },
        });
        return { handled: true, action: 'status_handled' };
      }

      // /help
      if (text === '/help') {
        const helpText = [
          'ℹ️ *Справка и поддержка Ketner AI*',
          '',
          'Официальный сайт: https://ketner.ai',
          'По вопросам оплаты и подписок:',
          '• Поддержка: support@ketner.ai',
          '• Способы оплаты: СБП (0% комиссия), Telegram Stars ⭐️, Карты МИР/Visa/Mastercard',
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
}
