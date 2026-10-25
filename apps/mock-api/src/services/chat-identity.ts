/**
 * Определение личности и тарифа для запроса к чату.
 *
 * Функция принимает только серверные данные (сессия, профиль, подписка). Тело HTTP-запроса сюда
 * не передаётся вообще, поэтому клиент не может ни назваться другим пользователем, ни повысить
 * себе тариф полями userId / userEmail / userPlan (уязвимость C8).
 */

import type { PlanId, Subscription, User } from '../types.js';
import { isVipEmail, isVipUser } from './vip.js';
import { resolveBillingPlan } from './plan-resolver.js';

export interface ChatIdentityInput {
  /** Пользователь из сессии / подписанного токена (req.user). */
  sessionUser?: Pick<User, 'id' | 'email' | 'plan'> & Partial<Pick<User, 'isVip'>>;
  /** Свежая запись профиля из хранилища (если есть). */
  storedUser?: (Pick<User, 'plan'> & Partial<Pick<User, 'isVip' | 'email'>>) | null;
  subscription?: Pick<Subscription, 'plan' | 'status' | 'renewsAt'> | null;
  /** Идентификатор общего demo-user для анонимного режима. */
  anonymousUserId: string;
  anonymousPlan: PlanId;
  allowAnonymous: boolean;
  now?: number;
}

export type ChatIdentity =
  | {
      ok: true;
      userId: string;
      email?: string;
      plan: PlanId;
      isVip: boolean;
      anonymous: boolean;
    }
  | { ok: false; status: 401; code: 'unauthorized'; message: string };

export function resolveChatIdentity(input: ChatIdentityInput): ChatIdentity {
  const { sessionUser } = input;

  if (!sessionUser) {
    if (!input.allowAnonymous) {
      return {
        ok: false,
        status: 401,
        code: 'unauthorized',
        message: 'Войдите в аккаунт, чтобы пользоваться чатом',
      };
    }
    // Анонимный режим (только вне production): общий demo-user, всегда бесплатный план.
    return {
      ok: true,
      userId: input.anonymousUserId,
      plan: input.anonymousPlan,
      isVip: false,
      anonymous: true,
    };
  }

  const email = sessionUser.email || input.storedUser?.email || undefined;
  const isVip = isVipUser(sessionUser) || isVipUser(input.storedUser) || isVipEmail(email);

  const plan = resolveBillingPlan({
    storedPlan: input.storedUser?.plan ?? sessionUser.plan,
    subscription: input.subscription,
    isVip,
    now: input.now,
  }).plan;

  return { ok: true, userId: sessionUser.id, email, plan, isVip, anonymous: false };
}
