/**
 * Кредиты для интерфейса: остаток, срок, цена запроса по каждой модели тарифа.
 *
 * GET /api/usage/credits[?mode=max] — остаток и месячная выдача, гранты со сроками, бесплатная модель
 * на случай, когда кредиты кончатся, и по каждой модели тарифа примерная цена запроса в кредитах и
 * на сколько запросов хватит остатка (services/credits.ts). Только для вошедших пользователей; тариф
 * берётся из сессии и хранилищах, а не из запроса.
 */

import { Router, type Request, type Response } from 'express';
import { creditService } from '../billing/index.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import { EntitlementService } from '../services/entitlement.js';
import { buildCreditsReport, type CreditService } from '../services/credits.js';
import type { UsageStore } from '../store/usage-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';

export interface UsageRouterDeps {
  usageStore: UsageStore;
  userStore: UserStore;
  subscriptionStore: SubscriptionStore;
  registry?: ModelRegistry;
  /** Кредиты пользователей (тот же журнал, что у биллинга). */
  credits?: CreditService;
}

export function createUsageRouter({
  usageStore,
  userStore,
  subscriptionStore,
  registry = modelRegistry,
  credits = creditService,
}: UsageRouterDeps): Router {
  const router = Router();

  router.get('/credits', requireAuth, (request: Request, response: Response) => {
    const sessionUser = request.user!;
    const identity = resolveChatIdentity({
      sessionUser,
      storedUser: userStore.findById(sessionUser.id),
      subscription: subscriptionStore.get(sessionUser.id),
      anonymousUserId: sessionUser.id,
      anonymousPlan: 'free',
      allowAnonymous: false,
    });
    if (!identity.ok) {
      sendError(response, identity.status, identity.code, identity.message);
      return;
    }
    const plan = EntitlementService.resolveEffectivePlan(
      identity.plan,
      identity.email,
      identity.isVip,
    );
    const mode = request.query.mode === 'max' ? 'max' : 'standard';
    // Остаток меняется после каждого ответа: кэшировать его браузеру нельзя.
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      buildCreditsReport(identity.userId, plan, { usageStore, registry, credits }, mode),
    );
  });

  return router;
}
