/**
 * Эффективный тариф сохранённого пользователя: VIP получает Ultra, у платного тарифа проверяется срок.
 * Одно правило для сессии сайта (middleware/auth.ts) и для API-ключей (routes/v1.ts).
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

export function resolveUserPlan(
  user: User,
  userStore: UserStore,
  subscriptionStore: SubscriptionStore | undefined,
): { plan: PlanId; isVip: boolean } {
  const isVip = Boolean(user.isVip || isVipEmail(user.email));
  if (isVip) return { plan: 'ultra', isVip: true };
  return {
    plan: applySubscriptionExpiry(userStore, subscriptionStore, user.id, user.plan, false),
    isVip: false,
  };
}
