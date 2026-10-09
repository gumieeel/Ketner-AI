/**
 * Webhook Router — обработчик входящих платёжных вебхуков.
 *
 * Поддерживает идемпотентность (повторные запросы не дублируют действия),
 * проверку подписи HMAC-SHA256 и управление жизненным циклом подписок.
 */
import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { stripeService } from '../services/stripe.js';
export function createWebhookRouter({ subscriptionStore, userStore, webhookSecret = config.webhookSecret, }) {
    const router = Router();
    const processedEvents = new Set();
    /**
     * Проверка подписи HMAC-SHA256 по сырому телу запроса (не по перепакованному JSON).
     * Подпись обязательна всегда; сравнение выполняется за постоянное время.
     */
    function verifySignature(req) {
        const signature = req.headers['x-webhook-signature'];
        const rawBody = req.rawBody;
        if (typeof signature !== 'string' || !rawBody) {
            return false;
        }
        const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
        const given = Buffer.from(signature, 'utf8');
        const wanted = Buffer.from(expected, 'utf8');
        return given.length === wanted.length && timingSafeEqual(given, wanted);
    }
    router.post('/', async (request, response) => {
        if (!verifySignature(request)) {
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
    router.post('/stripe', async (request, response) => {
        const sig = request.headers['stripe-signature'];
        if (!sig || typeof sig !== 'string') {
            sendError(response, 400, 'missing_signature', 'Отсутствует stripe-signature заголовок');
            return;
        }
        // Подпись Stripe считается по байтам запроса: без сырого тела проверять нечего.
        const rawBody = request.rawBody;
        if (!rawBody) {
            sendError(response, 400, 'missing_raw_body', 'Не удалось получить тело запроса для проверки подписи');
            return;
        }
        try {
            const event = stripeService.constructEvent(rawBody, sig);
            const result = await stripeService.handleWebhookEvent(event);
            response.status(200).json({ received: true, ...result });
        }
        catch (err) {
            const errorMsg = err?.message || 'Неизвестная ошибка Stripe Webhook';
            console.error('[Stripe Webhook] Error:', errorMsg);
            sendError(response, 400, 'webhook_error', `Ошибка валидации или обработки Stripe: ${errorMsg}`);
        }
    });
    return router;
}
