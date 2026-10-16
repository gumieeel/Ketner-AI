import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { defaultBetterAuth } from '../auth/better-auth.js';
import { verifyMockToken } from '../auth/jwt.js';
import { betterAuthSessionMayOpen } from '../auth/better-auth-sync.js';
import type { UserStore } from '../store/user-store.js';
import { revokedTokenStore as defaultRevokedTokenStore } from '../store/index.js';
import type { RevokedTokenStore } from '../store/revoked-token-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import { applySubscriptionExpiry } from '../services/user-plan.js';
import type { PlanId, User } from '../types.js';
import { sendError } from './errors.js';
import { isVipEmail, isAdminEmail } from '../services/vip.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      userId?: string;
    }
  }
}

/**
 * Middleware для аутентификации.
 * Проверяет сессию Better Auth (через cookie или сессионный токен),
 * либо извлекает Bearer-токен из заголовка Authorization.
 * Если пользователь найден, устанавливает req.user и req.userId.
 */
export function createAuthMiddleware(
  userStore: UserStore,
  betterAuthInstance = defaultBetterAuth,
  subscriptionStore?: SubscriptionStore,
  revokedTokens: RevokedTokenStore = defaultRevokedTokenStore,
) {
  /** Срок подписки: правило общее с API-ключами (services/user-plan.ts). */
  const applyExpiry = (userId: string, plan: PlanId, isVip: boolean): PlanId =>
    applySubscriptionExpiry(userStore, subscriptionStore, userId, plan, isVip);

  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    // 1. Bearer-токен, выданный при входе. Он важнее cookie: клиент показывает того пользователя, чей токен
    //    хранит, а в браузере может остаться cookie-сессия другого аккаунта (вход через Google под Ultra,
    //    потом вход по паролю под Free). Если брать cookie первым, интерфейс показывал бы Free, а сервер
    //    отвечал бы как Ultra.
    let bearerRejected = false;
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      // Токен, отозванный при выходе из аккаунта, не принимается, даже если подпись и срок в порядке.
      const payload = revokedTokens.isRevoked(token) ? null : verifyMockToken(token);
      // Токен не принят (истёк, подпись не сошлась, пользователя нет): запрос идёт как гостевой, но клиент
      // получает заголовок и может сбросить устаревшую сессию вместо показа вошедшего пользователя.
      if (payload) {
        let user = userStore.findById(payload.sub);
        if (!user && payload.email) {
          user = userStore.findByEmail(payload.email);
        }
        if (user) {
          const isVip = Boolean(user.isVip || (user.email && isVipEmail(user.email)));
          const isAdmin = Boolean(user.isAdmin || (user.email && isAdminEmail(user.email)));
          let plan: PlanId = user.plan;
          if (isVip) {
            plan = 'ultra';
          } else {
            plan = applyExpiry(user.id, plan, false);
          }
          request.user = {
            ...user,
            isVip,
            isAdmin,
            plan,
          };
          request.userId = user.id;
          next();
          return;
        }
      }
      bearerRejected = true;
    }

    // 2. Сессия Better Auth через cookie (вход через Google/GitHub или токен сессии Better Auth).
    try {
      const session = await betterAuthInstance.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      let stored = session?.user ? userStore.findByEmail(session.user.email) : null;
      // Сессия Better Auth открывает аккаунт сайта только если запись Better Auth точно принадлежит
      // его владельцу (см. betterAuthSessionMayOpen): иначе чужая регистрация с той же почтой давала
      // бы вход в чужой аккаунт.
      if (session?.user && betterAuthSessionMayOpen(session.user, stored)) {
        if (!stored) {
          // Пароль локальной копии не используется для входа: вход идёт через Better Auth.
          stored = userStore.create(
            session.user.email,
            randomBytes(32).toString('hex'),
            session.user.name,
          );
        }

        const rawPlan = (session.user as Record<string, unknown>).plan;
        const VALID_PLANS: PlanId[] = [
          'free',
          'gpt-pro',
          'claude-pro',
          'gemini-pro',
          'ultra',
          'plus',
          'pro',
        ];
        let plan: PlanId =
          typeof rawPlan === 'string' &&
          VALID_PLANS.includes(rawPlan as PlanId) &&
          rawPlan !== 'free'
            ? (rawPlan as PlanId)
            : stored?.plan && stored.plan !== 'free'
              ? stored.plan
              : typeof rawPlan === 'string' && VALID_PLANS.includes(rawPlan as PlanId)
                ? (rawPlan as PlanId)
                : (stored?.plan ?? 'free');

        const isVip = Boolean(stored?.isVip || isVipEmail(session.user.email));
        const isAdmin = Boolean(stored?.isAdmin || isAdminEmail(session.user.email));
        if (isVip) {
          plan = 'ultra';
        } else if (stored) {
          plan = applyExpiry(stored.id, plan, false);
        }

        request.user = {
          id: stored?.id || session.user.id,
          email: session.user.email,
          name: stored?.name || session.user.name,
          plan,
          createdAt:
            stored?.createdAt ||
            (session.user.createdAt
              ? new Date(session.user.createdAt).toISOString()
              : new Date().toISOString()),
          isVip,
          isAdmin,
          telegramChatId: stored?.telegramChatId,
          telegramUsername: stored?.telegramUsername,
        };
        request.userId = request.user.id;
        next();
        return;
      }
    } catch {
      // Игнорируем ошибки Better Auth и переходим к проверке Bearer токена
    }

    if (bearerRejected) {
      // Токен не принят и cookie-сессии нет: запрос идёт как гостевой, клиент сбросит устаревший вход.
      response.setHeader('X-Session-Invalid', '1');
    }

    // Личность определяется только сессией Better Auth или подписанным Bearer-токеном.
    // Заголовки X-User-* намеренно игнорируются: клиент не может сам назвать себя пользователем.
    next();
  };
}

/**
 * Middleware для защиты приватных маршрутов.
 */
export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (!request.user) {
    sendError(response, 401, 'unauthorized', 'Сессия не найдена или истекла');
    return;
  }
  next();
}
