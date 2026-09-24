import { Router } from 'express';
import { sendError } from '../middleware/errors.js';
import { TelegramBotService } from '../telegram/bot.js';
export function createTelegramRouter(deps) {
    const router = Router();
    const botService = deps.botService ?? new TelegramBotService(deps);
    /**
     * Статус Telegram-бота.
     */
    router.get('/telegram/status', (_request, response) => {
        response.json({
            configured: botService.isConfigured,
            botUsername: botService.botUsername,
            botUrl: `https://t.me/${botService.botUsername}`,
        });
    });
    /**
     * Официальный Webhook для Telegram Bot API.
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
        const planId = (request.body?.planId || 'gpt-pro');
        const userId = (request.body?.userId || 'demo-user');
        const fakeUpdate = {
            update_id: Date.now(),
            message: {
                message_id: Math.floor(Math.random() * 10000),
                chat: { id: 12345678, type: 'private' },
                date: Math.floor(Date.now() / 1000),
                successful_payment: {
                    currency: 'XTR',
                    total_amount: 650,
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
    return router;
}
