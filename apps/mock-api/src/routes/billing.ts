import { Router } from 'express';
import { sendError } from '../middleware/errors.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import type { PlanId, PlanItem } from '../types.js';

export const PLANS: readonly PlanItem[] = [
  {
    id: 'free',
    nameKey: 'pricing.free',
    priceMonthly: 0,
    bullets: {
      ru: ['10 сообщений в день', 'Базовые модели', 'История чатов'],
      en: ['10 messages per day', 'Base models', 'Chat history'],
    },
  },
  {
    id: 'plus',
    nameKey: 'pricing.plus',
    priceMonthly: 20,
    popular: true,
    bullets: {
      ru: ['Безлимит сообщений', 'Приоритетный доступ', 'Все модели, включая pro'],
      en: ['Unlimited messages', 'Priority access', 'All models, including pro'],
    },
  },
  {
    id: 'pro',
    nameKey: 'pricing.pro',
    priceMonthly: 40,
    bullets: {
      ru: ['Всё из Plus', 'Расширенный контекст', 'Ранний доступ к новым моделям'],
      en: ['Everything in Plus', 'Extended context', 'Early access to new models'],
    },
  },
];

export interface BillingRouterDeps {
  subscriptionStore: SubscriptionStore;
  userStore: UserStore;
  defaultUserId: string;
}

export function createBillingRouter({
  subscriptionStore,
  userStore,
  defaultUserId,
}: BillingRouterDeps): Router {
  const router = Router();

  const getUserId = (request: { userId?: string }): string => request.userId ?? defaultUserId;

  router.get('/plans', (_request, response) => {
    response.json({ plans: PLANS });
  });

  router.get('/billing/subscription', (request, response) => {
    const userId = getUserId(request);
    const subscription = subscriptionStore.get(userId);
    response.json({ subscription });
  });

  router.post('/billing/checkout', (request, response) => {
    const rawPlanId: unknown = request.body?.planId;
    if (rawPlanId !== 'plus' && rawPlanId !== 'pro') {
      sendError(response, 400, 'invalid_plan', 'Допустимые тарифы для оплаты: plus, pro');
      return;
    }

    const planId = rawPlanId as PlanId;
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
