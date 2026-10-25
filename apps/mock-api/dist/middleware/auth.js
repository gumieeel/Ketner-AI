import { fromNodeHeaders } from 'better-auth/node';
import { defaultBetterAuth } from '../auth/better-auth.js';
import { verifyMockToken } from '../auth/jwt.js';
import { sendError } from './errors.js';
import { isVipEmail, isAdminEmail } from '../services/vip.js';
/**
 * Middleware для аутентификации.
 * Проверяет сессию Better Auth (через cookie или сессионный токен),
 * либо извлекает Bearer-токен из заголовка Authorization.
 * Если пользователь найден, устанавливает req.user и req.userId.
 */
export function createAuthMiddleware(userStore, betterAuthInstance = defaultBetterAuth) {
    return async (request, _response, next) => {
        // 1. Проверяем сессию Better Auth через headers/cookies
        try {
            const session = await betterAuthInstance.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });
            if (session?.user) {
                let stored = userStore.findByEmail(session.user.email);
                if (!stored) {
                    stored = userStore.create(session.user.email, 'session-synced-password-123', session.user.name);
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
                const rawHeaderPlan = request.headers['x-user-plan'];
                const headerPlan = (Array.isArray(rawHeaderPlan) ? rawHeaderPlan[0] : rawHeaderPlan)?.trim();
                if (plan === 'free' && headerPlan && VALID_PLANS.includes(headerPlan)) {
                    plan = headerPlan;
                }
                const isVip = Boolean(stored?.isVip || isVipEmail(session.user.email));
                const isAdmin = Boolean(stored?.isAdmin || isAdminEmail(session.user.email));
                if (isVip) {
                    plan = 'ultra';
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
        }
        // 3. Fallback: проверка заголовков X-User-*
        const rawHeaderEmail = request.headers['x-user-email'];
        const headerEmail = (Array.isArray(rawHeaderEmail) ? rawHeaderEmail[0] : rawHeaderEmail)?.trim();
        const rawHeaderId = request.headers['x-user-id'];
        const headerId = (Array.isArray(rawHeaderId) ? rawHeaderId[0] : rawHeaderId)?.trim();
        const rawHeaderPlan = request.headers['x-user-plan'];
        const headerPlan = (Array.isArray(rawHeaderPlan) ? rawHeaderPlan[0] : rawHeaderPlan)?.trim();
        if (!request.user && (headerEmail || headerId)) {
            let user = headerEmail ? userStore.findByEmail(headerEmail) : (headerId ? userStore.findById(headerId) : undefined);
            if (!user && headerEmail) {
                user = userStore.create(headerEmail, 'session-synced-password-123', headerEmail.split('@')[0]);
            }
            if (user) {
                const VALID_PLANS = ['free', 'gpt-pro', 'claude-pro', 'gemini-pro', 'ultra', 'plus', 'pro'];
                let plan = (headerPlan && VALID_PLANS.includes(headerPlan))
                    ? headerPlan
                    : user.plan;
                const isVip = Boolean(user.isVip || (user.email && isVipEmail(user.email)) || (headerEmail && isVipEmail(headerEmail)));
                const isAdmin = Boolean(user.isAdmin || (user.email && isAdminEmail(user.email)) || (headerEmail && isAdminEmail(headerEmail)));
                if (isVip) {
                    plan = 'ultra';
                }
                request.user = {
                    ...user,
                    plan,
                    isVip,
                    isAdmin,
                };
                request.userId = user.id;
                next();
                return;
            }
        }
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
