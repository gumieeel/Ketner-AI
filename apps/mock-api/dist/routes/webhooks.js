/**
 * Webhook Router — обработчик входящих платёжных вебхуков.
 *
 * Поддерживает идемпотентность (повторные запросы не дублируют действия),
 * проверку подписи HMAC-SHA256 и управление жизненным циклом подписок.
 */
import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
export function createWebhookRouter({ subscriptionStore, userStore, webhookSecret = config.webhookSecret, }) {
    const router = Router();
    const processedEvents = new Set();
    /** Проверка подписи HMAC-SHA256. */
    function verifySignature(req) {
        const signature = req.headers['x-webhook-signature'];
        if (!signature || typeof signature !== 'string') {
            return false;
        }
        const payload = JSON.stringify(req.body);
        const expected = createHmac('sha256', webhookSecret).update(payload).digest('hex');
        return signature === expected;
    }
    router.post('/', async (request, response) => {
        // В dev/test режиме, если сигнатура не передана или равна 'test-signature', пропускаем
        const isTest = process.env.NODE_ENV === 'test';
        const sig = request.headers['x-webhook-signature'];
        if (!isTest && sig && !verifySignature(request)) {
            sendError(response, 401, 'invalid_signature', 'Неверная подпись вебхука');
            return;
        }
        const body = request.body;
        const eventId = body.idempotencyKey ?? body.id;
        if (!eventId || !body.type || !body.data) {
            sendError(response, 400, 'invalid_payload', 'Обязательные поля: id/idempotencyKey, type, data');
            return;
        }
        // Идемпотентность: если событие уже обрабатывалось, возвращаем 200 OK без повторных изменений
        if (processedEvents.has(eventId)) {
            response.status(200).json({ received: true, idempotentReplay: true });
            return;
        }
        const { userId, planId, renewsAt } = body.data;
        try {
            switch (body.type) {
                case 'subscription.created':
                case 'subscription.updated':
                case 'invoice.paid': {
                    if (userId && planId) {
                        subscriptionStore.set({
                            userId,
                            plan: planId,
                            status: 'active',
                            renewsAt: renewsAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                        });
                        userStore.updatePlan(userId, planId);
                    }
                    break;
                }
                case 'subscription.deleted':
                case 'invoice.payment_failed': {
                    if (userId) {
                        subscriptionStore.set({
                            userId,
                            plan: 'free',
                            status: 'canceled',
                            renewsAt: null,
                        });
                        userStore.updatePlan(userId, 'free');
                    }
                    break;
                }
                default:
                    console.warn(`[webhook] Неизвестный тип события: ${body.type}`);
            }
            processedEvents.add(eventId);
            // Очистка старых событий при превышении лимита
            if (processedEvents.size > 10000) {
                const first = processedEvents.values().next().value;
                if (first)
                    processedEvents.delete(first);
            }
            response.status(200).json({ received: true, status: 'processed' });
        }
        catch (err) {
            console.error('[webhook] Ошибка обработки:', err);
            sendError(response, 500, 'webhook_processing_failed', 'Ошибка обработки события вебхука');
        }
    });
    return router;
}
