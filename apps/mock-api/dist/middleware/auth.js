import { randomBytes } from 'node:crypto';
import { fromNodeHeaders } from 'better-auth/node';
import { defaultBetterAuth } from '../auth/better-auth.js';
import { verifyMockToken } from '../auth/jwt.js';
import { resolveBillingPlan } from '../services/plan-resolver.js';
import { sendError } from './errors.js';
import { isVipEmail, isAdminEmail } from '../services/vip.js';
/**
 * Middleware для аутентификации.
 * Проверяет сессию Better Auth (через cookie или сессионный токен),
 * либо извлекает Bearer-токен из заголовка Authorization.
 * Если пользователь найден, устанавливает req.user и req.userId.
 */
export function createAuthMiddleware(userStore, betterAuthInstance = defaultBetterAuth, subscriptionStore) {
    /**
     * Срок подписки: если оплаченный период (и льготные сутки) закончился, тариф сводится к free
     * и это сохраняется в профиле, чтобы интерфейс и лимиты видели одно и то же.
     */
    const applySubscriptionExpiry = (userId, plan, isVip) => {
        if (!subscriptionStore || isVip || plan === 'free')
            return plan;
        const resolved = resolveBillingPlan({
            storedPlan: plan,
            subscription: subscriptionStore.get(userId),
        });
        if (resolved.expired) {
            userStore.updatePlan(userId, 'free');
        }
        return resolved.plan;
    };
    return async (request, response, next) => {
        // 1. Проверяем сессию Better Auth через headers/cookies
        try {
            const session = await betterAuthInstance.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });
            if (session?.user) {
                let stored = userStore.findByEmail(session.user.email);
                if (!stored) {
                    // Пароль локальной копии не используется для входа: вход идёт через Better Auth.
                    stored = userStore.create(session.user.email, randomBytes(32).toString('hex'), session.user.name);
                }
                const rawPlan = session.user.plan;
                const VALID_PLANS = ['free', 'gpt-pro', 'claude-pro', 'gemini-pro', 'ultra', 'plus', 'pro'];
                let plan = (typeof rawPlan === 'string' && VALID_PLANS.includes(rawPlan) && rawPlan !== 'free')
                    ? rawPlan
                    : (stored?.plan && stored.plan !== 'free')
                        ? stored.plan
                        : (typeof rawPlan === 'string' && VALID_PLANS.includes(rawPlan))
                            ? rawPlan
                            : (stored?.plan ?? 'free');
                const isVip = Boolean(stored?.isVip || isVipEmail(session.user.email));
                const isAdmin = Boolean(stored?.isAdmin || isAdminEmail(session.user.email));
                if (isVip) {
                    plan = 'ultra';
                }
                else if (stored) {
                    plan = applySubscriptionExpiry(stored.id, plan, false);
                }
                request.user = {
                    id: stored?.id || session.user.id,
                    email: session.user.email,
                    name: stored?.name || session.user.name,
                    plan,
                    createdAt: stored?.createdAt || (session.user.createdAt
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
        }
        catch {
            // Игнорируем ошибки Better Auth и переходим к проверке Bearer токена
        }
        // 2. Fallback: проверка Bearer токена для обратной совместимости
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.slice(7).trim();
            const payload = verifyMockToken(token);
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
                    let plan = user.plan;
                    if (isVip) {
                        plan = 'ultra';
                    }
                    else {
                        plan = applySubscriptionExpiry(user.id, plan, false);
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
            // Заглушка better-auth-session живёт только в cookie: без cookie-сессии она тоже недействительна.
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
export function requireAuth(request, response, next) {
    if (!request.user) {
        sendError(response, 401, 'unauthorized', 'Сессия не найдена или истекла');
        return;
    }
    next();
}
