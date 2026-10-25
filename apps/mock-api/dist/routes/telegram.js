import { Router } from 'express';
import { sendError } from '../middleware/errors.js';
import { TelegramBotService } from '../telegram/bot.js';
import { TelegramSupportBotService, telegramSupportBotService as defaultSupportBotService, } from '../telegram/support-bot.js';
import { supportStore as defaultSupportStore } from '../store/index.js';
export function createTelegramRouter(deps) {
    const router = Router();
    const botService = deps.botService ?? new TelegramBotService(deps);
    const supportBot = deps.supportBotService ?? defaultSupportBotService;
    const supportStore = deps.supportStore ?? defaultSupportStore;
    // -------------------------------------------------------------
    // 1. ПЛАТЁЖНЫЙ БОТ (@Robo_kassa_bot)
    // -------------------------------------------------------------
    /**
     * Статус Telegram-бота оплаты.
     */
    router.get('/telegram/status', (_request, response) => {
        response.json({
            configured: botService.isConfigured,
            botUsername: botService.botUsername,
            botUrl: `https://t.me/${botService.botUsername}`,
        });
    });
    /**
     * Официальный Webhook для Telegram Bot API (платежи).
     */
    router.post('/telegram/webhook', async (request, response) => {
        const update = request.body;
        if (!update || typeof update !== 'object') {
            sendError(response, 400, 'invalid_update', 'Некорректное тело обновления Telegram');
            return;
        }
        try {
            const result = await botService.processUpdate(update);
            response.json({ ok: true, result });
        }
        catch (error) {
            console.error('[Telegram Router] Ошибка обработки webhook:', error);
            response.status(500).json({ ok: false, error: 'Internal webhook error' });
        }
    });
    /**
     * Эмуляция оплаты через Telegram Stars (для локального тестирования и демо без реальных денег).
     */
    router.post('/telegram/simulate-payment', async (request, response) => {
        const planId = (request.body?.planId || 'plus');
        const userId = (request.body?.userId || 'demo-user');
        const fakeUpdate = {
            update_id: Date.now(),
            message: {
                message_id: Math.floor(Math.random() * 10000),
                chat: { id: 12345678, type: 'private' },
                date: Math.floor(Date.now() / 1000),
                successful_payment: {
                    currency: 'XTR',
                    total_amount: 550,
                    invoice_payload: JSON.stringify({ planId, userId }),
                    telegram_payment_charge_id: `tg_charge_${Date.now()}`,
                },
            },
        };
        const result = await botService.processUpdate(fakeUpdate);
        const subscription = deps.subscriptionStore.get(userId);
        const user = deps.userStore.findById(userId);
        response.json({
            ok: true,
            result,
            subscription,
            user,
        });
    });
    // -------------------------------------------------------------
    // 2. SUPPORT БОТ (@ketner_support_bot)
    // -------------------------------------------------------------
    /**
     * Статус бота поддержки.
     */
    router.get('/telegram/support/status', (_request, response) => {
        response.json({
            configured: supportBot.isConfigured,
            botUsername: supportBot.botUsername,
            botUrl: `https://t.me/${supportBot.botUsername}`,
            adminConnected: Boolean(supportStore.getAdminChatId()),
            adminChatId: supportStore.getAdminChatId(),
            openTickets: supportStore.listOpenTickets().length,
            totalTickets: supportStore.listAllTickets().length,
        });
    });
    /**
     * Официальный Webhook для Telegram Support Bot API.
     */
    router.post('/telegram/support/webhook', async (request, response) => {
        const update = request.body;
        if (!update || typeof update !== 'object') {
            sendError(response, 400, 'invalid_update', 'Некорректное тело обновления Telegram');
            return;
        }
        try {
            const result = await supportBot.processUpdate(update);
            response.json({ ok: true, result });
        }
        catch (error) {
            console.error('[SupportBot Router] Ошибка обработки webhook:', error);
            response.status(500).json({ ok: false, error: 'Internal support webhook error' });
        }
    });
    /**
     * Список обращений (тикеты).
     */
    router.get('/telegram/support/tickets', (_request, response) => {
        response.json({
            openTickets: supportStore.listOpenTickets(),
            allTickets: supportStore.listAllTickets(),
        });
    });
    /**
     * Эмуляция отправки сообщения в поддержку (для тестов).
     */
    router.post('/telegram/support/simulate-message', async (request, response) => {
        const text = request.body?.text || 'Тестовая жалоба от пользователя';
        const userChatId = Number(request.body?.chatId || 10000001);
        const username = request.body?.username || 'test_user';
        const fakeUpdate = {
            update_id: Date.now(),
            message: {
                message_id: Math.floor(Math.random() * 10000),
                chat: { id: userChatId, type: 'private' },
                from: {
                    id: userChatId,
                    is_bot: false,
                    first_name: 'Тестовый',
                    username,
                },
                date: Math.floor(Date.now() / 1000),
                text,
            },
        };
        const result = await supportBot.processUpdate(fakeUpdate);
        const activeTicket = supportStore.getActiveTicketForUser(userChatId);
        response.json({
            ok: true,
            result,
            ticket: activeTicket,
        });
    });
    return router;
}
