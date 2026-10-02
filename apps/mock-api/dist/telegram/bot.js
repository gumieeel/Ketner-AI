import { config } from '../config.js';
import { LEGACY_PLANS, PLANS } from '../routes/billing.js';
import { invoiceStore as defaultInvoiceStore, subscriptionStore as defaultSubscriptionStore, userStore as defaultUserStore, } from '../store/index.js';
/**
 * Расчёт стоимости в Telegram Stars (⭐️ XTR).
 * Точно соответствует расчёту на сайте Ketner AI:
 * - Plus (10 $ / 990 ₽) -> 550 ⭐️
 * - Pro (20 $ / 1 990 ₽) -> 650 ⭐️
 * - Ultra (30 $ / 2 990 ₽) -> 1 350 ⭐️
 */
export function calculateStars(price) {
    if (price <= 0)
        return 0;
    // Ultra ($30 / 2990 ₽ / 2499 ₽ / $40 / 49$)
    if (price === 30 || price === 39 || price === 40 || price === 2499 || price === 2990 || price === 49) {
        return 1350;
    }
    // Pro ($20 / 1990 ₽ / 1199 ₽ / $29)
    if (price === 20 || price === 29 || price === 1199 || price === 1990 || price === 1999) {
        return 650;
    }
    // Plus ($10 / 990 ₽ / $9)
    if (price === 10 || price === 9 || price === 990 || price === 999) {
        return 550;
    }
    return Math.round(price * 35);
}
export function getPlanItem(planId) {
    return PLANS.find((p) => p.id === planId) ?? LEGACY_PLANS.find((p) => p.id === planId);
}
export class TelegramBotService {
    token;
    username;
    deps;
    chatToUserId = new Map();
    isPolling = false;
    constructor(deps) {
        this.deps = deps;
        this.token = deps.botToken || config.telegramBotToken || '';
        this.username = (deps.botUsername || config.telegramBotUsername || 'Robo_kassa_bot').replace(/^@/, '');
    }
    get botUsername() {
        return this.username;
    }
    get isConfigured() {
        return Boolean(this.token && this.token.length > 10);
    }
    /**
     * Разрешает пользователя для переданного Telegram chat_id.
     * 1. Ищет в постоянном userStore по telegramChatId.
     * 2. Ищет во временном маппинге chatToUserId и, если находит, привязывает навсегда.
     */
    resolveUser(chatId) {
        const byTg = this.deps.userStore.findByTelegramChatId(chatId);
        if (byTg)
            return byTg;
        const mappedUserId = this.chatToUserId.get(chatId);
        if (mappedUserId) {
            const byId = this.deps.userStore.findById(mappedUserId);
            if (byId) {
                this.deps.userStore.linkTelegram(byId.id, chatId);
                return byId;
            }
        }
        return null;
    }
    /**
     * Инициализирует Telegram-бота при старте приложения:
     * 1. Проверяет getMe (валидирует токен)
     * 2. Устанавливает команды /start, /plans, /status, /link, /unlink, /help
     * 3. Устанавливает описание бота
     * 4. Настраивает Webhook (если HTTPS / Render) или запускает Long Polling (если локально)
     */
    async initRuntime(publicBaseUrl) {
        if (!this.isConfigured) {
            console.log('🤖 [TelegramBot] Бот не сконфигурирован (нет токена), режим заглушки');
            return;
        }
        try {
            const me = await this.callApi('getMe', {});
            if (me?.username) {
                this.username = me.username;
                console.log(`🤖 [TelegramBot] Авторизован бот оплаты: @${this.username}`);
            }
            await this.callApi('setMyCommands', {
                commands: [
                    { command: 'start', description: 'Личный кабинет и оформление подписки' },
                    { command: 'plans', description: 'Каталог тарифов (Stars ⭐️ / СБП)' },
                    { command: 'status', description: 'Статус моей подписки и доступные модели' },
                    { command: 'check', description: 'Проверить статус оплаты счёта' },
                    { command: 'link', description: 'Привязать аккаунт на сайте' },
                    { command: 'unlink', description: 'Отвязать текущий аккаунт' },
                    { command: 'help', description: 'Помощь и контакты поддержки' },
                ],
            });
            await this.callApi('setMyDescription', {
                description: '🤖 Официальный платёжный сервис Ketner AI.\n\nМгновенная оплата подписок на флагманские модели ИИ (GPT-6 Astra, Claude Fable, Gemini 2.5 Pro) через Telegram Stars (⭐️) и СБП (0% комиссии). Синхронизация с веб-аккаунтом.',
            });
            const effectiveBaseUrl = config.telegramWebhookUrl ||
                process.env.RENDER_EXTERNAL_URL ||
                publicBaseUrl ||
                config.betterAuthUrl;
            if (effectiveBaseUrl && effectiveBaseUrl.startsWith('https://')) {
                const webhookUrl = `${effectiveBaseUrl.replace(/\/$/, '')}/api/telegram/webhook`;
                const res = await this.callApi('setWebhook', {
                    url: webhookUrl,
                    allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
                    drop_pending_updates: false,
                });
                console.log(`✅ [TelegramBot] Webhook зарегистрирован на: ${webhookUrl}`, res);
            }
            else {
                console.log('⚡ [TelegramBot] Локальное окружение: запуск фонового long-polling...');
                await this.callApi('deleteWebhook', { drop_pending_updates: false });
                this.startPolling();
            }
        }
        catch (error) {
            console.error('⚠️ [TelegramBot] Ошибка инициализации бота:', error);
        }
    }
    startPolling() {
        if (this.isPolling)
            return;
        this.isPolling = true;
        (async () => {
            let offset = 0;
            while (this.isPolling) {
                try {
                    const res = await this.callApi('getUpdates', {
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
                }
                catch {
                    await new Promise((resolve) => setTimeout(resolve, 3000));
                }
            }
        })().catch((err) => {
            console.error('[TelegramBot] Polling loop error:', err);
        });
    }
    stopPolling() {
        this.isPolling = false;
    }
    async callApi(method, body) {
        if (!this.isConfigured) {
            console.log(`[TelegramBot:mock] ${method}:`, JSON.stringify(body));
            return { ok: true, result: {} };
        }
        try {
            const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = (await response.json());
            if (!data.ok) {
                console.error(`[TelegramBot] Error in ${method}:`, data.description);
                return null;
            }
            return data.result;
        }
        catch (error) {
            console.error(`[TelegramBot] Network error in ${method}:`, error);
            return null;
        }
    }
    async sendMessage(chatId, text, extra = {}) {
        return this.callApi('sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            ...extra,
        });
    }
    async sendInvoice(chatId, params) {
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
    async answerPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage) {
        return this.callApi('answerPreCheckoutQuery', {
            pre_checkout_query_id: preCheckoutQueryId,
            ok,
            error_message: errorMessage,
        });
    }
    async answerCallbackQuery(callbackQueryId, text, showAlert = false) {
        return this.callApi('answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text,
            show_alert: showAlert,
        });
    }
    /**
     * Обработка входящего обновления от Telegram (webhook или polling).
     */
    async processUpdate(update) {
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
            // Выставление счёта в Stars для выбранного тарифа
            if (data.startsWith('pay_stars:')) {
                const parts = data.split(':');
                const planId = (parts[1] || 'plus');
                const linkedUser = this.resolveUser(chatId);
                const userId = parts[2] || linkedUser?.id || this.chatToUserId.get(chatId) || config.demoUserId;
                const invoiceId = parts[3] || undefined;
                const plan = getPlanItem(planId) ?? getPlanItem('plus') ?? PLANS[1];
                const stars = calculateStars(plan.priceMonthly);
                await this.answerCallbackQuery(cb.id, `Счёт на ${stars} ⭐️`);
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
            // Меню выбора тарифов
            if (data === 'cmd_plans') {
                await this.answerCallbackQuery(cb.id);
                const user = this.resolveUser(chatId);
                await this.sendPlansMessage(chatId, user?.id);
                return { handled: true, action: 'cmd_plans_handled' };
            }
            // Проверка статуса подписки
            if (data === 'cmd_status') {
                await this.answerCallbackQuery(cb.id);
                const user = this.resolveUser(chatId);
                await this.sendStatusMessage(chatId, user?.id);
                return { handled: true, action: 'cmd_status_handled' };
            }
            // Проверка оплаты через callback
            if (data === 'cmd_check') {
                await this.answerCallbackQuery(cb.id, 'Проверка оплаты...');
                const user = this.resolveUser(chatId);
                await this.sendCheckPaymentMessage(chatId, user?.id);
                return { handled: true, action: 'cmd_check_handled' };
            }
            // Меню выбора СБП
            if (data === 'cmd_sbp') {
                await this.answerCallbackQuery(cb.id);
                const user = this.resolveUser(chatId);
                await this.sendSbpChoiceMessage(chatId, user?.id);
                return { handled: true, action: 'cmd_sbp_handled' };
            }
            // Инструкция по привязке аккаунта
            if (data === 'cmd_link_info') {
                await this.answerCallbackQuery(cb.id);
                await this.sendLinkInfoMessage(chatId);
                return { handled: true, action: 'cmd_link_info_handled' };
            }
            // Отвязка аккаунта
            if (data === 'cmd_unlink') {
                await this.answerCallbackQuery(cb.id);
                const user = this.resolveUser(chatId);
                if (user) {
                    this.deps.userStore.unlinkTelegram(user.id);
                    this.chatToUserId.delete(chatId);
                    await this.sendMessage(chatId, '✅ Аккаунт успешно отвязан от Telegram. Чтобы привязать новый аккаунт, используйте /link или перейдите в настройки на сайте.');
                }
                else {
                    await this.sendMessage(chatId, 'У вас нет привязанного аккаунта.');
                }
                return { handled: true, action: 'cmd_unlink_handled' };
            }
            // Оплата конкретного тарифа через СБП
            if (data.startsWith('pay_sbp:')) {
                const [, planId, customUserId] = data.split(':');
                const plan = getPlanItem(planId) ?? getPlanItem('plus') ?? PLANS[1];
                const linkedUser = this.resolveUser(chatId);
                const targetUser = customUserId || linkedUser?.id || config.demoUserId;
                const invoice = this.deps.invoiceStore.createSbpInvoice(targetUser, plan.id, plan.priceMonthly);
                await this.answerCallbackQuery(cb.id);
                const sbpMessage = [
                    '⚡ <b>Оплата через СБП (Система быстрых платежей)</b>',
                    '',
                    `Тариф: <b>${plan.id.toUpperCase()}</b>`,
                    `Сумма к оплате: <b>${plan.priceMonthly} ₽</b> (0% комиссии)`,
                    '',
                    '📲 <b>Для оплаты на смартфоне нажмите кнопку «Оплатить в банке»:</b>',
                    'Она автоматически откроет приложение вашего банка (Сбер, Т-Банк, ВТБ, Альфа).',
                    '',
                    'Либо откройте страницу на сайте Ketner AI для сканирования QR-кода камерой.',
                ].join('\n');
                await this.sendMessage(chatId, sbpMessage, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📲 Оплатить в приложении банка', url: invoice.deepLink }],
                            [
                                {
                                    text: '🌐 Открыть QR-код на сайте',
                                    url: `${config.webAppUrl}/checkout/${plan.id}`,
                                },
                            ],
                            [
                                {
                                    text: '✅ Я оплатил через СБП',
                                    callback_data: `confirm_sbp:${invoice.id}:${plan.id}:${targetUser}`,
                                },
                            ],
                            [{ text: '« Назад к тарифам', callback_data: 'cmd_plans' }],
                        ],
                    },
                });
                return { handled: true, action: 'sbp_link_sent' };
            }
            // Подтверждение СБП оплаты
            if (data.startsWith('confirm_sbp:')) {
                const [, invoiceId, planId, customUserId] = data.split(':');
                const validPlan = (planId || 'plus');
                const linkedUser = this.resolveUser(chatId);
                const validUser = customUserId || linkedUser?.id || config.demoUserId;
                this.deps.invoiceStore.markSbpPaid(invoiceId);
                this.deps.subscriptionStore.checkout(validUser, validPlan);
                const user = this.deps.userStore.updatePlan(validUser, validPlan);
                // Привязываем аккаунт, если ещё не был привязан
                this.deps.userStore.linkTelegram(validUser, chatId, cb.from?.username);
                this.chatToUserId.set(chatId, validUser);
                await this.answerCallbackQuery(cb.id, 'Оплата успешно подтверждена!');
                await this.sendMessage(chatId, `🎉 <b>Подписка активирована!</b>\n\nТариф <b>${validPlan.toUpperCase()}</b> успешно активирован через СБП на 30 дней.\nВсе модели разблокированы в аккаунте <b>${escapeHtml(user?.email || validUser)}</b>.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚀 Открыть веб-чат Ketner AI', url: `${config.webAppUrl}/chat` }],
                            [{ text: '📊 Статус подписки', callback_data: 'cmd_status' }],
                        ],
                    },
                });
                return { handled: true, action: 'sbp_payment_confirmed' };
            }
            // Проверка оплаты Stars (без принудительной активации, если не оплачено)
            if (data.startsWith('check_stars:') || data.startsWith('check_payment:')) {
                const parts = data.split(':');
                const invoiceId = parts[1] || undefined;
                const planId = (parts[2] || 'plus');
                const linkedUser = this.resolveUser(chatId);
                const userId = parts[3] || linkedUser?.id || this.chatToUserId.get(chatId) || config.demoUserId;
                let isPaid = false;
                if (invoiceId) {
                    const inv = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
                    if (inv && inv.status === 'paid') {
                        isPaid = true;
                    }
                }
                const sub = this.deps.subscriptionStore.get(userId);
                if (sub && sub.status === 'active' && (sub.plan === planId || sub.plan === 'ultra')) {
                    isPaid = true;
                }
                if (isPaid) {
                    await this.answerCallbackQuery(cb.id, '✅ Оплата подтверждена!');
                    await this.sendMessage(chatId, `🎉 <b>Оплата успешно подтверждена!</b>\n\nТариф <b>${planId.toUpperCase()}</b> активен на 30 дней.\nВсе модели разблокированы в аккаунте.`, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🚀 Открыть веб-чат Ketner AI', url: `${config.webAppUrl}/chat` }],
                                [{ text: '📊 Статус подписки', callback_data: 'cmd_status' }],
                            ],
                        },
                    });
                    return { handled: true, action: 'stars_check_paid' };
                }
                else {
                    await this.answerCallbackQuery(cb.id, '⏳ Платёж ещё не поступил. Оплатите счёт через кнопку «Заплатить ⭐️» выше и повторите проверку.', true);
                    return { handled: true, action: 'stars_check_pending' };
                }
            }
            // Подтверждение Stars оплаты
            if (data.startsWith('confirm_stars:')) {
                const parts = data.split(':');
                const invoiceId = parts[1] || undefined;
                const planId = (parts[2] || 'plus');
                const linkedUser = this.resolveUser(chatId);
                const userId = parts[3] || linkedUser?.id || this.chatToUserId.get(chatId) || config.demoUserId;
                if (invoiceId) {
                    this.deps.invoiceStore.markTelegramStarsPaid(invoiceId);
                }
                this.deps.subscriptionStore.checkout(userId, planId);
                const user = this.deps.userStore.updatePlan(userId, planId);
                if (user?.email && user.email !== userId) {
                    this.deps.subscriptionStore.checkout(user.email, planId);
                }
                // Привязываем аккаунт
                this.deps.userStore.linkTelegram(userId, chatId, cb.from?.username);
                this.chatToUserId.set(chatId, userId);
                await this.answerCallbackQuery(cb.id, 'Оплата успешно подтверждена!');
                await this.sendMessage(chatId, `🎉 <b>Подписка успешно активирована!</b>\n\nТариф: <b>${planId.toUpperCase()}</b> (на 30 дней)\nАккаунт: <b>${escapeHtml(user?.email || userId)}</b>\n\nВсе модели тарифа мгновенно разблокированы!`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚀 Открыть веб-чат Ketner AI', url: `${config.webAppUrl}/chat` }],
                            [{ text: '📊 Моя подписка', callback_data: 'cmd_status' }],
                        ],
                    },
                });
                return { handled: true, action: 'stars_payment_confirmed' };
            }
            await this.answerCallbackQuery(cb.id);
            return { handled: true, action: 'callback_unhandled' };
        }
        // 3. Сообщения пользователя
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            // Успешный нативный платёж Telegram Stars
            if (msg.successful_payment) {
                const pay = msg.successful_payment;
                let planId = 'plus';
                const linkedUser = this.resolveUser(chatId);
                let userId = linkedUser?.id || this.chatToUserId.get(chatId) || config.demoUserId;
                let invoiceId;
                try {
                    const payload = JSON.parse(pay.invoice_payload);
                    if (payload.planId)
                        planId = payload.planId;
                    if (payload.userId)
                        userId = payload.userId;
                    if (payload.invoiceId)
                        invoiceId = payload.invoiceId;
                }
                catch {
                    // Игнорируем ошибку парсинга
                }
                this.deps.subscriptionStore.checkout(userId, planId);
                const updatedUser = this.deps.userStore.updatePlan(userId, planId);
                if (updatedUser?.email && updatedUser.email !== userId) {
                    this.deps.subscriptionStore.checkout(updatedUser.email, planId);
                }
                if (updatedUser?.id && updatedUser.id !== userId) {
                    this.deps.subscriptionStore.checkout(updatedUser.id, planId);
                }
                // Привязываем Telegram к аккаунту
                this.deps.userStore.linkTelegram(userId, chatId, msg.from?.username);
                this.chatToUserId.set(chatId, userId);
                if (invoiceId) {
                    this.deps.invoiceStore.markTelegramStarsPaid(invoiceId);
                }
                const successText = [
                    '🎉 <b>Оплата Telegram Stars успешно завершена!</b>',
                    '',
                    `⭐️ Списано: <b>${pay.total_amount} Stars</b>`,
                    `💎 Активирован тариф: <b>${planId.toUpperCase()}</b> на 30 дней`,
                    `👤 Привязано к аккаунту: <b>${escapeHtml(updatedUser?.email || userId)}</b>`,
                    '',
                    'Доступ ко всем флагманским моделям открыт в веб-интерфейсе Ketner AI!',
                ].join('\n');
                await this.sendMessage(chatId, successText, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚀 Открыть веб-чат Ketner AI', url: `${config.webAppUrl}/chat` }],
                            [{ text: '📊 Статус подписки', callback_data: 'cmd_status' }],
                        ],
                    },
                });
                return { handled: true, action: 'stars_payment_completed' };
            }
            const text = msg.text?.trim() ?? '';
            // Команда /start с deep-link параметром привязки аккаунта: /start link_<userId>
            if (text.startsWith('/start link_') || text.startsWith('/start link=')) {
                const targetUserId = text.replace(/^\/start link[=_]/, '').trim();
                const user = this.deps.userStore.findById(targetUserId);
                if (!user) {
                    await this.sendMessage(chatId, '❌ Не удалось найти аккаунт по указанной ссылке. Войдите в настройки на сайте и нажмите кнопку «Подключить Telegram» заново.');
                    return { handled: true, action: 'link_user_not_found' };
                }
                this.deps.userStore.linkTelegram(user.id, chatId, msg.from?.username);
                this.chatToUserId.set(chatId, user.id);
                const sub = this.deps.subscriptionStore.get(user.id);
                const isActive = (sub && sub.status === 'active') || user.isVip;
                const planName = (user.isVip ? 'ultra' : (isActive ? sub?.plan : user.plan) || 'free').toUpperCase();
                const linkedMsg = [
                    '🎉 <b>Аккаунт Ketner AI успешно привязан!</b>',
                    '',
                    `👤 <b>Пользователь:</b> ${escapeHtml(user.name)} (<code>${escapeHtml(user.email)}</code>)`,
                    `💎 <b>Текущий тариф:</b> <b>${planName}</b>`,
                    isActive && sub?.renewsAt
                        ? `✅ <b>Подписка активна до:</b> <b>${new Date(sub.renewsAt).toLocaleDateString('ru-RU')}</b>`
                        : 'ℹ️ <b>Статус:</b> Базовый бесплатный тариф',
                    '',
                    'Теперь вы можете управлять подпиской прямо через этого бота, продлевать тариф в 1 клик и оплачивать через Telegram Stars или СБП.',
                ].join('\n');
                await this.sendMessage(chatId, linkedMsg, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💎 Каталог тарифов и оплата', callback_data: 'cmd_plans' }],
                            [{ text: '📊 Моя подписка', callback_data: 'cmd_status' }],
                            [{ text: '🚀 Открыть Ketner AI', url: `${config.webAppUrl}/chat` }],
                        ],
                    },
                });
                return { handled: true, action: 'account_linked_deep_link' };
            }
            // Команда /start с deep-link параметром оплаты с сайта: /start pay_...
            if (text.startsWith('/start pay_') || text.startsWith('/start stars_')) {
                const rawPayload = text.startsWith('/start pay_')
                    ? text.replace('/start pay_', '').trim()
                    : text.replace('/start ', '').trim();
                let planId = 'plus';
                const linkedUser = this.resolveUser(chatId);
                let userId = linkedUser?.id || this.chatToUserId.get(chatId) || config.demoUserId;
                let invoiceId;
                if (rawPayload.startsWith('stars_')) {
                    invoiceId = rawPayload;
                    const inv = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
                    if (inv) {
                        planId = inv.planId;
                        userId = inv.userId;
                    }
                }
                else if (rawPayload.includes('__')) {
                    const parts = rawPayload.split('__');
                    planId = (parts[0] || 'plus');
                    if (parts[1]?.startsWith('stars_')) {
                        invoiceId = parts[1];
                        const inv = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
                        if (inv) {
                            planId = inv.planId;
                            userId = inv.userId;
                        }
                    }
                    else {
                        userId = parts[1] || userId;
                        invoiceId = parts[2] || undefined;
                        if (invoiceId) {
                            const inv = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
                            if (inv) {
                                planId = inv.planId;
                                userId = inv.userId;
                            }
                        }
                    }
                }
                else if (rawPayload.includes('_')) {
                    const firstUnderscore = rawPayload.indexOf('_');
                    planId = (rawPayload.slice(0, firstUnderscore) || 'plus');
                    const remainder = rawPayload.slice(firstUnderscore + 1);
                    if (remainder.startsWith('stars_')) {
                        invoiceId = remainder;
                        const inv = this.deps.invoiceStore.getTelegramStarsInvoice(invoiceId);
                        if (inv) {
                            planId = inv.planId;
                            userId = inv.userId;
                        }
                    }
                    else {
                        userId = remainder || userId;
                    }
                }
                else if (rawPayload) {
                    planId = rawPayload;
                }
                // Привязываем пользователя
                const targetUser = this.deps.userStore.findById(userId);
                if (targetUser) {
                    this.deps.userStore.linkTelegram(targetUser.id, chatId, msg.from?.username);
                }
                this.chatToUserId.set(chatId, userId);
                const plan = getPlanItem(planId) ?? getPlanItem('plus') ?? PLANS[1];
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
                // 2. Карточка тарифа с кнопками действий
                const bulletsText = plan.bullets.ru.map((b) => `• ${escapeHtml(b)}`).join('\n');
                const planText = [
                    `💎 <b>Оформление подписки ${plan.id.toUpperCase()}</b>`,
                    '',
                    `⭐️ Счёт на <b>${stars} Stars</b> выставлен выше. Нажмите нативную кнопку <b>«Заплатить ${stars} ⭐️»</b> прямо в Telegram.`,
                    '',
                    '✨ <b>Включено в подписку:</b>',
                    bulletsText,
                    '',
                    '💡 <i>Альтернативные способы:</i>',
                ].join('\n');
                await this.sendMessage(chatId, planText, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '🔄 Проверить оплату Stars',
                                    callback_data: `check_stars:${invoiceId || ''}:${plan.id}:${userId}`,
                                },
                            ],
                            [
                                {
                                    text: '✅ Подтвердить оплату (тест/активация)',
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
            // Обычный /start или /menu
            if (cleanCmd === '/start' || cleanCmd === 'start' || cleanCmd === '/menu') {
                const linkedUser = this.resolveUser(chatId);
                if (linkedUser) {
                    const sub = this.deps.subscriptionStore.get(linkedUser.id);
                    const isActive = (sub && sub.status === 'active') || linkedUser.isVip;
                    const planName = (linkedUser.isVip ? 'ultra' : (isActive ? sub?.plan : linkedUser.plan) || 'free').toUpperCase();
                    const welcomeLinked = [
                        `👋 Здравствуйте, <b>${escapeHtml(linkedUser.name)}</b>!`,
                        '',
                        'Вы авторизованы в официальном платёжном сервисе <b>Ketner AI</b>.',
                        '',
                        `👤 <b>Ваш аккаунт:</b> <code>${escapeHtml(linkedUser.email)}</code>`,
                        `💎 <b>Текущий тариф:</b> <b>${planName}</b>`,
                        isActive && sub?.renewsAt
                            ? `✅ <b>Статус подписки:</b> Активна (до <b>${new Date(sub.renewsAt).toLocaleDateString('ru-RU')}</b>)`
                            : 'ℹ️ <b>Статус подписки:</b> Базовый бесплатный тариф',
                        '',
                        'Выберите нужное действие в меню ниже:',
                    ].join('\n');
                    await this.sendMessage(chatId, welcomeLinked, {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '💎 Каталог тарифов и оплата', callback_data: 'cmd_plans' }],
                                [{ text: '📊 Моя подписка и модели', callback_data: 'cmd_status' }],
                                [{ text: '🚀 Открыть чат Ketner AI', url: `${config.webAppUrl}/chat` }],
                                [
                                    { text: '💬 Поддержка', url: 'https://t.me/ketner_support_bot' },
                                    { text: '🔓 Отвязать аккаунт', callback_data: 'cmd_unlink' },
                                ],
                            ],
                        },
                    });
                    return { handled: true, action: 'start_linked_handled' };
                }
                // Гостевой режим (аккаунт пока не привязан)
                const welcomeGuest = [
                    `👋 Добро пожаловать в официальный платёжный бот <b>Ketner AI</b> (@${this.username})!`,
                    '',
                    'Здесь вы можете легко и безопасно оплатить подписку на передовые ИИ-модели:',
                    '• ⭐️ <b>Telegram Stars</b> — быстрая оплата в Telegram без ввода банковских карт.',
                    '• ⚡ <b>СБП (Система быстрых платежей)</b> — моментальная оплата банковскими приложениями РФ по QR-коду с 0% комиссии.',
                    '',
                    '💎 <b>Актуальные тарифы:</b>',
                    '• <b>Plus</b> (<b>550 ⭐️</b> / 990 ₽) — быстрые модели GPT-4o mini, DeepSeek V4.1 Flash, Claude Haiku 4.5',
                    '• <b>Pro</b> (<b>650 ⭐️</b> / 1 990 ₽) — флагманы GPT-6 Astra, Claude Fable 5.1, Gemini 2.5 Pro',
                    '• <b>Ultra</b> (<b>1 350 ⭐️</b> / 2 990 ₽) — максимум скорости, VIP-приоритет, безлимит Fair Use',
                    '',
                    '💡 <i>Чтобы привязать этот Telegram к вашему аккаунту на сайте, нажмите кнопку «Привязать аккаунт» ниже.</i>',
                ].join('\n');
                await this.sendMessage(chatId, welcomeGuest, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💎 Каталог тарифов и оплата', callback_data: 'cmd_plans' }],
                            [{ text: '🔗 Привязать аккаунт сайта', callback_data: 'cmd_link_info' }],
                            [{ text: '🌐 Перейти на сайт Ketner AI', url: config.webAppUrl }],
                            [{ text: '💬 Поддержка', url: 'https://t.me/ketner_support_bot' }],
                        ],
                    },
                });
                return { handled: true, action: 'start_guest_handled' };
            }
            // Команда /link [<email>]
            if (cleanCmd.startsWith('/link') || cleanCmd === 'link') {
                const param = text.replace('/link', '').trim();
                if (param) {
                    const user = this.deps.userStore.findByEmail(param) || this.deps.userStore.findById(param);
                    if (user) {
                        this.deps.userStore.linkTelegram(user.id, chatId, msg.from?.username);
                        this.chatToUserId.set(chatId, user.id);
                        await this.sendMessage(chatId, `✅ <b>Telegram успешно привязан!</b>\n\nАккаунт: <b>${escapeHtml(user.email)}</b> (${escapeHtml(user.name)})\nТариф: <b>${user.plan.toUpperCase()}</b>`, {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📊 Моя подписка', callback_data: 'cmd_status' }],
                                    [{ text: '💎 Каталог тарифов', callback_data: 'cmd_plans' }],
                                ],
                            },
                        });
                        return { handled: true, action: 'link_manual_success' };
                    }
                }
                await this.sendLinkInfoMessage(chatId);
                return { handled: true, action: 'link_info_sent' };
            }
            // Команда /unlink
            if (cleanCmd === '/unlink' || cleanCmd === 'unlink') {
                const user = this.resolveUser(chatId);
                if (user) {
                    this.deps.userStore.unlinkTelegram(user.id);
                    this.chatToUserId.delete(chatId);
                    await this.sendMessage(chatId, `✅ Ваш Telegram отвязан от аккаунта <b>${escapeHtml(user.email)}</b>.`);
                }
                else {
                    await this.sendMessage(chatId, 'У вас нет привязанного аккаунта.');
                }
                return { handled: true, action: 'unlink_handled' };
            }
            // /plans
            if (cleanCmd === '/plans' ||
                cleanCmd === 'plans' ||
                cleanCmd === '/tariffs' ||
                cleanCmd === '/pricing') {
                const user = this.resolveUser(chatId);
                await this.sendPlansMessage(chatId, user?.id);
                return { handled: true, action: 'plans_handled' };
            }
            // /status
            if (cleanCmd === '/status' ||
                cleanCmd === 'status' ||
                cleanCmd === '/sub' ||
                cleanCmd === '/subscription') {
                const user = this.resolveUser(chatId);
                await this.sendStatusMessage(chatId, user?.id);
                return { handled: true, action: 'status_handled' };
            }
            // /check
            if (cleanCmd === '/check' ||
                cleanCmd === 'check' ||
                cleanCmd === '/check_payment' ||
                cleanCmd === 'проверить') {
                const user = this.resolveUser(chatId);
                await this.sendCheckPaymentMessage(chatId, user?.id);
                return { handled: true, action: 'check_payment_handled' };
            }
            // /help
            if (cleanCmd === '/help' || cleanCmd === 'help') {
                const helpText = [
                    'ℹ️ <b>Справка и поддержка Ketner AI</b>',
                    '',
                    `🌐 Официальный сайт: <a href="${config.webAppUrl}">${config.webAppUrl}</a>`,
                    '',
                    '💬 <b>Служба поддержки пользователей:</b>',
                    'Все вопросы по оплате, тарифам и доступу решаются в боте поддержки: <a href="https://t.me/ketner_support_bot">@ketner_support_bot</a>',
                    '',
                    '📌 <b>Основные команды бота:</b>',
                    '/start — личный кабинет и оплата',
                    '/plans — каталог тарифов (Stars / СБП)',
                    '/status — статус подписки и моделей',
                    '/link — привязать аккаунт к сайту',
                    '/unlink — отвязать Telegram аккаунт',
                    '/help — эта справка',
                ].join('\n');
                await this.sendMessage(chatId, helpText, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💬 Написать в поддержку @ketner_support_bot', url: 'https://t.me/ketner_support_bot' }],
                            [{ text: '💎 Каталог тарифов', callback_data: 'cmd_plans' }],
                        ],
                    },
                });
                return { handled: true, action: 'help_handled' };
            }
            // Неизвестная команда
            await this.sendMessage(chatId, '💡 <b>Доступные команды:</b>\n/start — личный кабинет и меню\n/plans — тарифы и оплата (Stars ⭐️ / СБП)\n/status — статус вашей подписки\n/link — привязать аккаунт\n/help — помощь и поддержка', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💎 Каталог тарифов', callback_data: 'cmd_plans' }],
                        [{ text: '📊 Моя подписка', callback_data: 'cmd_status' }],
                    ],
                },
            });
            return { handled: true, action: 'fallback_handled' };
        }
        return { handled: false };
    }
    async sendPlansMessage(chatId, _userId) {
        const plansText = [
            '💎 <b>Тарифные планы Ketner AI</b>',
            '',
            '1️⃣ <b>PLUS</b> — <b>990 ₽/мес</b> или <b>550 ⭐️</b>',
            '• Модели: DeepSeek v4.1 Flash, Claude Haiku 4.5, GPT-4o',
            '• Быстрая скорость генерации и базовый контекст',
            '',
            '2️⃣ <b>PRO</b> (⭐️ Популярный) — <b>1 990 ₽/мес</b> или <b>650 ⭐️</b>',
            '• Модели: GPT-6 Astra, Claude Fable 5.1, Gemini 2.5 Pro, Grok 4.7',
            '• Все флагманские модели без отдельных подписок',
            '',
            '3️⃣ <b>ULTRA</b> (🔥 Скидка 25%) — <b>2 990 ₽/мес</b> или <b>1 350 ⭐️</b>',
            '• Все топовые модели на 100% мощности без ограничений',
            '• Максимальный контекст диалога и высший VIP-приоритет',
            '',
            '👇 <i>Выберите способ оплаты:</i>',
        ].join('\n');
        await this.sendMessage(chatId, plansText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⭐️ Оплатить Plus (550 ⭐️)', callback_data: 'pay_stars:plus' }],
                    [{ text: '⭐️ Оплатить Pro (650 ⭐️)', callback_data: 'pay_stars:pro' }],
                    [{ text: '⭐️ Оплатить Ultra (1 350 ⭐️)', callback_data: 'pay_stars:ultra' }],
                    [{ text: '⚡ Оплатить через СБП (0% комиссии)', callback_data: 'cmd_sbp' }],
                    [{ text: '🌐 Оплатить на сайте (СБП / Крипта)', url: `${config.webAppUrl}/pricing` }],
                ],
            },
        });
    }
    async sendSbpChoiceMessage(chatId, userId) {
        const target = userId || config.demoUserId;
        const text = [
            '⚡ <b>Оплата через СБП (Система быстрых платежей)</b>',
            '',
            'Мгновенная оплата через банки РФ по QR-коду и прямой банковской ссылке (0% комиссии).',
            'Выберите нужный тариф:',
        ].join('\n');
        await this.sendMessage(chatId, text, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⚡ СБП: Plus — 990 ₽', callback_data: `pay_sbp:plus:${target}` }],
                    [{ text: '⚡ СБП: Pro — 1 990 ₽', callback_data: `pay_sbp:pro:${target}` }],
                    [{ text: '⚡ СБП: Ultra — 2 990 ₽', callback_data: `pay_sbp:ultra:${target}` }],
                    [{ text: '« Назад к тарифам', callback_data: 'cmd_plans' }],
                ],
            },
        });
    }
    async sendStatusMessage(chatId, userId) {
        const user = this.resolveUser(chatId) || (userId ? this.deps.userStore.findById(userId) : null);
        if (!user) {
            const guestStatusText = [
                '📊 <b>Статус подписки</b>',
                '',
                '⚠️ <b>Ваш Telegram пока не привязан к аккаунту на сайте Ketner AI.</b>',
                '',
                'Привяжите ваш аккаунт, чтобы просматривать активную подписку и управлять доступом к моделям.',
            ].join('\n');
            await this.sendMessage(chatId, guestStatusText, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔗 Привязать аккаунт сайта', callback_data: 'cmd_link_info' }],
                        [{ text: '💎 Каталог тарифов и оплата', callback_data: 'cmd_plans' }],
                        [{ text: '🌐 Открыть сайт Ketner AI', url: config.webAppUrl }],
                    ],
                },
            });
            return;
        }
        const sub = this.deps.subscriptionStore.get(user.id) ||
            (user.email ? this.deps.subscriptionStore.get(user.email) : undefined);
        const isActive = (sub && sub.status === 'active') || user.isVip;
        const currentPlanId = user.isVip ? 'ultra' : (isActive ? sub?.plan : user.plan) || 'free';
        const plan = getPlanItem(currentPlanId) ?? getPlanItem('free');
        const statusText = [
            '📊 <b>Управление подпиской Ketner AI</b>',
            '',
            `👤 <b>Пользователь:</b> ${escapeHtml(user.name)}`,
            `📧 <b>Email:</b> <code>${escapeHtml(user.email)}</code>`,
            `🔗 <b>Telegram:</b> привязан к этому чату`,
            `💎 <b>Текущий тариф:</b> <b>${plan.id.toUpperCase()}</b>`,
            isActive && sub?.renewsAt
                ? `✅ <b>Статус:</b> Активна (до <b>${new Date(sub.renewsAt).toLocaleDateString('ru-RU')}</b>)`
                : user.isVip
                    ? '👑 <b>Статус:</b> VIP доступ (активен бессрочно)'
                    : 'ℹ️ <b>Статус:</b> Базовый бесплатный тариф',
            '',
            `🧠 <b>Включённые модели:</b> ${plan.modelsHighlight || 'Базовые модели'}`,
            '',
            '⚡ <b>Возможности:</b>',
            ...plan.bullets.ru.map((b) => `• ${escapeHtml(b)}`),
        ].join('\n');
        await this.sendMessage(chatId, statusText, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⚡ Продлить / Улучшить тариф', callback_data: 'cmd_plans' }],
                    [{ text: '🚀 Открыть веб-чат Ketner AI', url: `${config.webAppUrl}/chat` }],
                    [
                        { text: '💬 Поддержка', url: 'https://t.me/ketner_support_bot' },
                        { text: '🔓 Отвязать аккаунт', callback_data: 'cmd_unlink' },
                    ],
                ],
            },
        });
    }
    async sendCheckPaymentMessage(chatId, userId) {
        const user = this.resolveUser(chatId) || (userId ? this.deps.userStore.findById(userId) : null);
        const targetUserId = user?.id || userId || this.chatToUserId.get(chatId);
        if (targetUserId) {
            const sub = this.deps.subscriptionStore.get(targetUserId) ||
                (user?.email ? this.deps.subscriptionStore.get(user.email) : undefined);
            const isActive = (sub && sub.status === 'active' && sub.plan !== 'free') || user?.isVip;
            if (isActive) {
                const planName = (user?.isVip ? 'ultra' : sub?.plan || 'pro').toUpperCase();
                const dateStr = sub?.renewsAt
                    ? new Date(sub.renewsAt).toLocaleDateString('ru-RU')
                    : 'активен бессрочно';
                await this.sendMessage(chatId, `✅ <b>Оплата подтверждена!</b>\n\nТариф: <b>${planName}</b> (до <b>${dateStr}</b>)\nАккаунт: <b>${escapeHtml(user?.email || targetUserId)}</b>\n\nВсе флагманские модели доступны в веб-интерфейсе Ketner AI!`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚀 Открыть веб-чат Ketner AI', url: `${config.webAppUrl}/chat` }],
                            [{ text: '📊 Детали подписки', callback_data: 'cmd_status' }],
                        ],
                    },
                });
                return;
            }
        }
        await this.sendMessage(chatId, '⏳ <b>Статус оплаты счетов</b>\n\nПлатёж пока обрабатывается или не был инициирован.\nЕсли вы только что произвели оплату через <b>Telegram Stars</b> или <b>СБП</b>, зачисление обычно занимает 15–60 секунд.\n\nНажмите «Проверить снова» через минуту или выберите тариф:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Проверить снова', callback_data: 'cmd_check' }],
                    [{ text: '💎 Каталог тарифов (Stars / СБП)', callback_data: 'cmd_plans' }],
                    [{ text: '💬 Поддержка @ketner_support_bot', url: 'https://t.me/ketner_support_bot' }],
                ],
            },
        });
    }
    async sendLinkInfoMessage(chatId) {
        const text = [
            '🔗 <b>Привязка аккаунта Ketner AI к Telegram:</b>',
            '',
            '<b>Способ 1 (самый быстрый):</b>',
            `1. Откройте Настройки на сайте: <a href="${config.webAppUrl}/settings">${config.webAppUrl}/settings</a>`,
            '2. В разделе <b>«Telegram аккаунт»</b> нажмите кнопку <b>«Подключить Telegram»</b>.',
            '3. Бот мгновенно свяжет ваш аккаунт!',
            '',
            '<b>Способ 2 (через команду):</b>',
            'Отправьте команду с вашим email, указанным при регистрации:',
            '<code>/link ваш_email@example.com</code>',
        ].join('\n');
        await this.sendMessage(chatId, text, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌐 Открыть настройки на сайте', url: `${config.webAppUrl}/settings` }],
                    [{ text: '💎 Каталог тарифов', callback_data: 'cmd_plans' }],
                ],
            },
        });
    }
}
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
export const telegramBotService = new TelegramBotService({
    subscriptionStore: defaultSubscriptionStore,
    userStore: defaultUserStore,
    invoiceStore: defaultInvoiceStore,
    botToken: config.telegramBotToken,
    botUsername: config.telegramBotUsername,
});
