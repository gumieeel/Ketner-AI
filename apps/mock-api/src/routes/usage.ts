/**
 * Остаток ресурсов тарифа для интерфейса: сколько запросов топ-моделей осталось и когда вернутся.
 *
 * GET /api/usage/quota[?mode=max] — квота премиум-моделей, стадия месячного бюджета и по каждой
 * топ-модели тарифа: примерная цена запроса, остаток запросов, недельный пул и время восстановления
 * (services/premium-quota.ts). Только для вошедших пользователей; тариф берётся из сессии и
 * хранилищ, а не из запроса.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import { EntitlementService } from '../services/entitlement.js';
import { buildQuotaReport, type PlanBonusSource } from '../services/premium-quota.js';
import type { UsageStore } from '../store/usage-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import type { PremiumCreditSource } from '../store/premium-credit-store.js';

export interface UsageRouterDeps {
  usageStore: UsageStore;
  userStore: UserStore;
  subscriptionStore: SubscriptionStore;
  registry?: ModelRegistry;
  /** Кредиты докупленных пакетов (тот же журнал, что у биллинга). */
  credits?: PremiumCreditSource;
  /** Бонус к квоте за оплату криптой (тот же биллинг). */
  bonus?: PlanBonusSource;
}

export function createUsageRouter({
  usageStore,
  userStore,
  subscriptionStore,
  registry = modelRegistry,
  credits,
  bonus,
}: UsageRouterDeps): Router {
  const router = Router();

  router.get('/quota', requireAuth, (request: Request, response: Response) => {
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
      buildQuotaReport(identity.userId, plan, { usageStore, registry, credits, bonus }, mode),
    );
  });

  return router;
}
