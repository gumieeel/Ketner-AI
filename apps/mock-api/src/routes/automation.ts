/**
 * Подписка «Автоматизации» через Dodo Payments (docs/AUTOMATION_PLAN.md, этап E):
 *
 *   GET  /api/billing/automation           цена, кредиты, пробный месяц, подписка пользователя
 *   POST /api/billing/automation/checkout  `{returnPath?}` → `{url}` сессии оплаты Dodo
 *   POST /api/billing/automation/portal    → `{url}` портала клиента (карта, счета, отмена)
 *   POST /api/webhooks/dodo                вебхук Dodo (подпись Standard Webhooks)
 *
 * Без ключа Dodo и продукта — `503 card_payments_unavailable`, вебхук — 404.
 */

import { Router, type Request, type Response } from 'express';
import {
  AUTOMATION_PLAN,
  type AutomationSubscription,
  type AutomationSubscriptionService,
} from '../billing/automation-subscription.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { RateLimiter } from '../middleware/rate-limit.js';

export interface AutomationRouterDeps {
  service: AutomationSubscriptionService;
}

function publicSubscription(record: AutomationSubscription | null) {
  if (!record) return null;
  return {
    status: record.status,
    trialEndsAt: record.trialEndsAt,
    nextBillingDate: record.nextBillingDate,
    cancelAtPeriodEnd: record.cancelAtPeriodEnd,
  };
}

export function createAutomationRouter(deps: AutomationRouterDeps): Router {
  const router = Router();
  const limiter = new RateLimiter(60_000, 10);

  router.get('/billing/automation', requireAuth, (request: Request, response: Response) => {
    response.json({
      available: deps.service.available,
      plan: AUTOMATION_PLAN,
      subscription: publicSubscription(deps.service.of(request.user!.id)),
    });
  });

  router.post(
    '/billing/automation/checkout',
    requireAuth,
    async (request: Request, response: Response) => {
      const user = request.user!;
      if (limiter.hit(`checkout:${user.id}`)) {
        sendError(response, 429, 'too_many_requests', 'Слишком много попыток. Подождите минуту.');
        return;
      }
      const body = (request.body ?? {}) as { returnPath?: unknown };
      const returnPath =
        typeof body.returnPath === 'string' && /^\/(?!\/)[\w\-/?=&.%]{0,200}$/.test(body.returnPath)
          ? body.returnPath
          : '/solutions';
      try {
        const result = await deps.service.checkout(
          { id: user.id, email: user.email, ...(user.name ? { name: user.name } : {}) },
          returnPath,
        );
        if (!result.ok) {
          sendError(response, result.status, result.code, result.message);
          return;
        }
        response.json({ url: result.url });
      } catch (error) {
        console.error('[dodo] сессия оплаты не создана', error);
        sendError(
          response,
          502,
          'checkout_failed',
          'Оплата сейчас не открывается. Попробуйте через минуту.',
        );
      }
    },
  );

  router.post(
    '/billing/automation/portal',
    requireAuth,
    async (request: Request, response: Response) => {
      const user = request.user!;
      if (limiter.hit(`portal:${user.id}`)) {
        sendError(response, 429, 'too_many_requests', 'Слишком много попыток. Подождите минуту.');
        return;
      }
      try {
        const result = await deps.service.portal(user.id);
        if (!result.ok) {
          sendError(response, result.status, result.code, result.message);
          return;
        }
        response.json({ url: result.url });
      } catch (error) {
        console.error('[dodo] портал клиента не открылся', error);
        sendError(response, 502, 'portal_failed', 'Портал оплаты сейчас не открывается.');
      }
    },
  );

  router.post('/webhooks/dodo', (request: Request, response: Response) => {
    if (!deps.service.available) {
      sendError(response, 404, 'not_found', 'Эндпоинт не найден');
      return;
    }
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      sendError(response, 400, 'invalid_body', 'Нет тела запроса');
      return;
    }
    const headers: Record<string, string> = {};
    for (const name of ['webhook-id', 'webhook-signature', 'webhook-timestamp']) {
      const value = request.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const result = deps.service.handleWebhook(rawBody.toString('utf8'), headers);
    if (!result.ok) {
      sendError(response, 401, 'invalid_signature', 'Подпись вебхука не прошла проверку');
      return;
    }
    response.json({ received: true, duplicate: result.duplicate });
  });

  return router;
}
