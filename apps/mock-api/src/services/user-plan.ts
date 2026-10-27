/**
 * Эффективный тариф сохранённого пользователя: VIP получает Ultra, у платной подписки проверяется
 * срок, а у остальных, пока остались купленные кредиты, уровень `credits` (полные технические
 * лимиты). Одно правило для сессии сайта (middleware/auth.ts) и для API-ключей (routes/v1.ts).
 */

import type { PlanId, User } from '../types.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { resolveBillingPlan } from './plan-resolver.js';
import { isVipEmail } from './vip.js';

/**
 * Если оплаченный период (и льготные сутки) закончился, тариф сводится к free, и это
 * сохраняется в профиле, чтобы интерфейс и лимиты видели одно и то же.
 */
export function applySubscriptionExpiry(
  userStore: UserStore,
  subscriptionStore: SubscriptionStore | undefined,
  userId: string,
  plan: PlanId,
  isVip: boolean,
): PlanId {
  if (!subscriptionStore || isVip || plan === 'free') return plan;
  const resolved = resolveBillingPlan({
    storedPlan: plan,
    subscription: subscriptionStore.get(userId),
  });
  if (resolved.expired) {
    userStore.updatePlan(userId, 'free');
  }
  return resolved.plan;
}

/** Что нужно правилу доступа от кредитов: остались ли у пользователя купленные. */
export interface PurchasedCreditsLookup {
  hasPurchased(userId: string, now?: number): boolean;
}

/**
 * Free с неистраченными купленными кредитами получает уровень `credits`. Подписчики остаются на
 * своём тарифе: кредиты у них и так есть, а лимиты определяет подписка.
 */
export function applyPurchasedAccess(
  plan: PlanId,
  userId: string,
  credits: PurchasedCreditsLookup | undefined,
): PlanId {
  if (plan !== 'free' || !credits) return plan;
  return credits.hasPurchased(userId) ? 'credits' : plan;
}

export function resolveUserPlan(
  user: User,
  userStore: UserStore,
  subscriptionStore: SubscriptionStore | undefined,
  credits?: PurchasedCreditsLookup,
): { plan: PlanId; isVip: boolean } {
  const isVip = Boolean(user.isVip || isVipEmail(user.email));
  if (isVip) return { plan: 'ultra', isVip: true };
  const plan = applySubscriptionExpiry(userStore, subscriptionStore, user.id, user.plan, false);
  return { plan: applyPurchasedAccess(plan, user.id, credits), isVip: false };
}
