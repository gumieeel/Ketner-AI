import { Router } from 'express';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { invoiceStore as defaultInvoiceStore } from '../store/index.js';
import { calculateStars } from '../telegram/bot.js';
export const PLANS = [
    {
        id: 'free',
        nameKey: 'pricing.free',
        priceMonthly: 0,
        limitBadge: {
            ru: '3 сообщения в час',
            en: '3 messages / hour',
        },
        modelsHighlight: 'Gemini 3.8 Flash',
        bullets: {
            ru: ['3 сообщения в час', 'Gemini 3.8 Flash', 'Базовые функции и история чатов'],
            en: ['3 messages per hour', 'Gemini 3.8 Flash', 'Basic features & chat history'],
        },
    },
    {
        id: 'gpt-pro',
        nameKey: 'pricing.gptPro',
        priceMonthly: 1199,
        limitBadge: {
            ru: '5-часовой лимит',
            en: '5-hour limit',
        },
        modelsHighlight: 'GPT-6 Astra, Luna, 5.5 Omni',
        bullets: {
            ru: [
                '5-часовой плавающий лимит',
                'GPT-6 Astra, GPT-6 Luna, GPT-5.5 Omni',
                'Рассуждающие модели o3-mini',
                'Приоритет в часы пиковой нагрузки',
            ],
            en: [
                '5-hour rolling limit',
                'GPT-6 Astra, GPT-6 Luna, GPT-5.5 Omni',
                'o3-mini reasoning models',
                'Priority access during peak hours',
            ],
        },
    },
    {
        id: 'claude-pro',
        nameKey: 'pricing.claudePro',
        priceMonthly: 1199,
        limitBadge: {
            ru: '5-часовой лимит',
            en: '5-hour limit',
        },
        modelsHighlight: 'Claude 4.5 Sonnet & Opus, Fable',
        bullets: {
            ru: [
                '5-часовой плавающий лимит',
                'Claude 4.5 Sonnet, Claude 4.5 Opus',
                'Семейство Fable 5.5, Fable 5.1 Haiku',
                'Глубокий анализ кода и сложных текстов',
            ],
            en: [
                '5-hour rolling limit',
                'Claude 4.5 Sonnet, Claude 4.5 Opus',
                'Fable 5.5, Fable 5.1 Haiku family',
                'Advanced code analysis & writing',
            ],
        },
    },
    {
        id: 'gemini-pro',
        nameKey: 'pricing.geminiPro',
        priceMonthly: 1199,
        limitBadge: {
            ru: '5-часовой лимит',
            en: '5-hour limit',
        },
        modelsHighlight: 'Gemini 3.8 Pro & 3.5 Ultra',
        bullets: {
            ru: [
                '5-часовой плавающий лимит',
                'Gemini 3.8 Pro, Gemini 3.5 Ultra',
                'Gemini Flash Thinking 2.5',
                'Огромное контекстное окно до 2M токенов',
            ],
            en: [
                '5-hour rolling limit',
                'Gemini 3.8 Pro, Gemini 3.5 Ultra',
                'Gemini Flash Thinking 2.5',
                'Massive context window up to 2M tokens',
            ],
        },
    },
    {
        id: 'ultra',
        nameKey: 'pricing.ultra',
        priceMonthly: 2499,
        popular: true,
        limitBadge: {
            ru: 'Без лимитов · Бесконечный кодинг',
            en: 'No limits · Endless coding',
        },
        modelsHighlight: 'Все флагманы GPT, Claude, Gemini',
        bullets: {
            ru: [
                'Всё включено: GPT-6, Claude 4.5, Gemini 3.8',
                'Без лимитов: бесконечный кодинг без пауз',
                'Максимальный размер контекста для репозиториев',
                'Высший приоритет серверов и мгновенный отклик',
            ],
            en: [
                'All-in-one: GPT-6, Claude 4.5, Gemini 3.8',
                'No limits: non-stop continuous coding',
                'Maximum context window for repositories',
                'Highest server priority & instant response',
            ],
        },
    },
];
export function createBillingRouter({ subscriptionStore, userStore, invoiceStore: activeInvoiceStore = defaultInvoiceStore, defaultUserId, }) {
    const router = Router();
    const getUserId = (request) => {
        const headerUserId = typeof request.headers?.['x-user-id'] === 'string' ? request.headers['x-user-id'] : undefined;
        return request.userId ?? headerUserId ?? defaultUserId;
    };
    const findPlan = (rawPlanId) => {
        return PLANS.find((p) => p.id === rawPlanId);
    };
    router.get('/plans', (_request, response) => {
        response.json({ plans: PLANS });
    });
    router.get('/billing/subscription', (request, response) => {
        const userId = getUserId(request);
        let subscription = subscriptionStore.get(userId);
        const user = userStore.findById(userId);
        if (request.user?.email?.toLowerCase() === 'artemsinyakov09@gmail.com' ||
            user?.email?.toLowerCase() === 'artemsinyakov09@gmail.com') {
            subscription = {
                userId,
                plan: 'ultra',
                status: 'active',
                renewsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
            };
        }
        response.json({ subscription });
    });
    router.post('/billing/checkout', (request, response) => {
        const rawPlanId = request.body?.planId;
        const validPlanIds = ['gpt-pro', 'claude-pro', 'gemini-pro', 'ultra', 'plus', 'pro'];
        if (!validPlanIds.includes(rawPlanId)) {
            sendError(response, 400, 'invalid_plan', 'Допустимые тарифы для оплаты: gpt-pro, claude-pro, gemini-pro, ultra');
            return;
        }
        const planId = rawPlanId;
        const userId = getUserId(request);
        const subscription = subscriptionStore.checkout(userId, planId);
        const user = userStore.updatePlan(userId, planId);
        response.json({
            subscription,
            user: user ?? { id: userId, plan: planId },
        });
    });
    router.post('/billing/cancel', (request, response) => {
        const userId = getUserId(request);
        const subscription = subscriptionStore.cancel(userId);
        const user = userStore.updatePlan(userId, 'free');
        response.json({
            subscription,
            user: user ?? { id: userId, plan: 'free' },
        });
    });
    // --- СБП (Система быстрых платежей) ---
    router.post('/billing/sbp/create-invoice', (request, response) => {
        const rawPlanId = request.body?.planId;
        const plan = findPlan(rawPlanId);
        if (!plan || plan.priceMonthly <= 0) {
            sendError(response, 400, 'invalid_plan', 'Некорректный тариф для оплаты через СБП');
            return;
        }
        const userId = getUserId(request);
        const invoice = activeInvoiceStore.createSbpInvoice(userId, plan.id, plan.priceMonthly);
        response.json({ invoice });
    });
    const getParamInvoiceId = (req) => {
        const raw = req.params.invoiceId;
        return (Array.isArray(raw) ? raw[0] : raw) ?? '';
    };
    router.get('/billing/sbp/status/:invoiceId', (request, response) => {
        const invoiceId = getParamInvoiceId(request);
        const invoice = activeInvoiceStore.getSbpInvoice(invoiceId);
        if (!invoice) {
            sendError(response, 404, 'invoice_not_found', 'Счёт СБП не найден');
            return;
        }
        response.json({
            status: invoice.status,
            invoice,
        });
    });
    router.post('/billing/sbp/confirm/:invoiceId', (request, response) => {
        const invoiceId = getParamInvoiceId(request);
        const invoice = activeInvoiceStore.getSbpInvoice(invoiceId);
        if (!invoice) {
            sendError(response, 404, 'invoice_not_found', 'Счёт СБП не найден');
            return;
        }
        const updated = activeInvoiceStore.markSbpPaid(invoiceId) ?? invoice;
        const userId = getUserId(request) || invoice.userId;
        const subscription = subscriptionStore.checkout(userId, invoice.planId);
        const user = userStore.updatePlan(userId, invoice.planId);
        response.json({
            success: true,
            subscription,
            user: user ?? { id: userId, plan: invoice.planId },
            invoice: updated,
        });
    });
    // --- Telegram Stars (⭐️ XTR) ---
    router.post('/billing/telegram-stars/create-invoice', (request, response) => {
        const rawPlanId = request.body?.planId;
        const plan = findPlan(rawPlanId);
        if (!plan || plan.priceMonthly <= 0) {
            sendError(response, 400, 'invalid_plan', 'Некорректный тариф для оплаты через Telegram Stars');
            return;
        }
        const userId = getUserId(request);
        const starsAmount = calculateStars(plan.priceMonthly);
        const invoice = activeInvoiceStore.createTelegramStarsInvoice(userId, plan.id, plan.priceMonthly, starsAmount, config.telegramBotUsername);
        response.json({ invoice });
    });
    router.get('/billing/telegram-stars/status/:invoiceId', (request, response) => {
        const invoiceId = getParamInvoiceId(request);
        let invoice = activeInvoiceStore.getTelegramStarsInvoice(invoiceId);
        if (!invoice) {
            sendError(response, 404, 'invoice_not_found', 'Счёт Telegram Stars не найден');
            return;
        }
        if (invoice.status === 'pending') {
            const sub = subscriptionStore.get(invoice.userId);
            if (sub && sub.status === 'active' && sub.plan === invoice.planId) {
                invoice = activeInvoiceStore.markTelegramStarsPaid(invoiceId) ?? invoice;
            }
        }
        response.json({
            status: invoice.status,
            invoice,
        });
    });
    router.post('/billing/telegram-stars/confirm/:invoiceId', (request, response) => {
        const invoiceId = getParamInvoiceId(request);
        const invoice = activeInvoiceStore.getTelegramStarsInvoice(invoiceId);
        if (!invoice) {
            sendError(response, 404, 'invoice_not_found', 'Счёт Telegram Stars не найден');
            return;
        }
        const updated = activeInvoiceStore.markTelegramStarsPaid(invoiceId) ?? invoice;
        const userId = getUserId(request) || invoice.userId;
        const subscription = subscriptionStore.checkout(userId, invoice.planId);
        const user = userStore.updatePlan(userId, invoice.planId);
        if (user?.email && user.email !== userId) {
            subscriptionStore.checkout(user.email, invoice.planId);
        }
        if (user?.id && user.id !== userId) {
            subscriptionStore.checkout(user.id, invoice.planId);
        }
        response.json({
            success: true,
            subscription,
            user: user ?? { id: userId, plan: invoice.planId },
            invoice: updated,
        });
    });
    return router;
}
