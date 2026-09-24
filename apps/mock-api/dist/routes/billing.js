import { Router } from 'express';
import { sendError } from '../middleware/errors.js';
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
export function createBillingRouter({ subscriptionStore, userStore, defaultUserId, }) {
    const router = Router();
    const getUserId = (request) => request.userId ?? defaultUserId;
    router.get('/plans', (_request, response) => {
        response.json({ plans: PLANS });
    });
    router.get('/billing/subscription', (request, response) => {
        const userId = getUserId(request);
        const subscription = subscriptionStore.get(userId);
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
    return router;
}
