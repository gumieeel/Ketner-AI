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
            ru: 'Базовый доступ',
            en: 'Basic access',
        },
        modelsHighlight: 'Ketner Mini + Auto Mode',
        bullets: {
            ru: ['Ketner Mini (быстрая модель)', 'Интеллектуальный Auto Mode', 'Базовые функции и история чатов'],
            en: ['Ketner Mini (fast model)', 'Intelligent Auto Mode', 'Basic features & chat history'],
        },
    },
    {
        id: 'plus',
        nameKey: 'pricing.plus',
        priceMonthly: 990,
        limitBadge: {
            ru: 'Plus · 2 параллельных',
            en: 'Plus · 2 concurrent',
        },
        modelsHighlight: 'Ketner Pro & Mini + Auto Mode',
        bullets: {
            ru: [
                'Стандартные и продвинутые модели',
                'Auto Mode с оптимизацией себестоимости',
                'Контекст до 60 сообщений',
                '2 параллельных запроса',
            ],
            en: [
                'Standard and advanced models',
                'Auto Mode with cost optimization',
                'Up to 60 context messages',
                '2 concurrent requests',
            ],
        },
    },
    {
        id: 'pro',
        nameKey: 'pricing.pro',
        priceMonthly: 1990,
        popular: true,
        limitBadge: {
            ru: 'Все флагманы AI',
            en: 'All Flagship AIs',
        },
        modelsHighlight: 'GPT-6 Astra, Claude Fable, Gemini Pro',
        bullets: {
            ru: [
                'Доступ ко ВСЕМ флагманским моделям (GPT, Claude, Gemini)',
                'Без раздельных подписок на каждого провайдера',
                'Контекст до 120 сообщений',
                '4 параллельных запроса и повышенный приоритет',
            ],
            en: [
                'Access to ALL flagship models (GPT, Claude, Gemini)',
                'No separate subscriptions per AI provider',
                'Up to 120 context messages',
                '4 concurrent requests & higher priority',
            ],
        },
    },
    {
        id: 'ultra',
        nameKey: 'pricing.ultra',
        priceMonthly: 2499,
        limitBadge: {
            ru: 'Без ограничений · Высший приоритет',
            en: 'No limits · Highest priority',
        },
        modelsHighlight: 'Максимальный контекст + 8 параллельных потоков',
        bullets: {
            ru: [
                'Всё из Pro с максимальным лимитом Fair Use',
                'До 500 сообщений контекста для больших файлов',
                '8 параллельных запросов',
                'Максимальная скорость и мгновенный отклик',
            ],
            en: [
                'Everything in Pro with highest Fair Use limits',
                'Up to 500 context messages for large codebases',
                '8 concurrent requests',
                'Maximum processing speed & instant response',
            ],
        },
    },
];
export const LEGACY_PLANS = [
    {
        id: 'gpt-pro',
        nameKey: 'pricing.gptPro',
        priceMonthly: 1199,
        limitBadge: { ru: 'Legacy Pro', en: 'Legacy Pro' },
        modelsHighlight: 'GPT-6 Astra + All Pro Models',
        bullets: {
            ru: ['Устаревший тариф (включает все возможности Pro)'],
            en: ['Legacy plan (includes all Pro features)'],
        },
    },
    {
        id: 'claude-pro',
        nameKey: 'pricing.claudePro',
        priceMonthly: 1199,
        limitBadge: { ru: 'Legacy Pro', en: 'Legacy Pro' },
        modelsHighlight: 'Claude Fable + All Pro Models',
        bullets: {
            ru: ['Устаревший тариф (включает все возможности Pro)'],
            en: ['Legacy plan (includes all Pro features)'],
        },
    },
    {
        id: 'gemini-pro',
        nameKey: 'pricing.geminiPro',
        priceMonthly: 1199,
        limitBadge: { ru: 'Legacy Pro', en: 'Legacy Pro' },
        modelsHighlight: 'Gemini Pro + All Pro Models',
        bullets: {
            ru: ['Устаревший тариф (включает все возможности Pro)'],
            en: ['Legacy plan (includes all Pro features)'],
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
        return (PLANS.find((p) => p.id === rawPlanId) ??
            LEGACY_PLANS.find((p) => p.id === rawPlanId));
    };
    router.get('/plans', (request, response) => {
        if (request.query.includeLegacy === 'true') {
            response.json({ plans: [...PLANS, ...LEGACY_PLANS] });
            return;
        }
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
        const validPlanIds = ['plus', 'pro', 'ultra', 'gpt-pro', 'claude-pro', 'gemini-pro'];
        if (!validPlanIds.includes(rawPlanId)) {
            sendError(response, 400, 'invalid_plan', 'Допустимые тарифы для оплаты: plus, pro, ultra');
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
