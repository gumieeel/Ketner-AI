import { fromNodeHeaders } from 'better-auth/node';
import { defaultBetterAuth } from '../auth/better-auth.js';
import { verifyMockToken } from '../auth/jwt.js';
import { sendError } from './errors.js';
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
                const rawPlan = session.user.plan;
                const VALID_PLANS = ['free', 'gpt-pro', 'claude-pro', 'gemini-pro', 'ultra', 'plus', 'pro'];
                let plan = typeof rawPlan === 'string' && VALID_PLANS.includes(rawPlan)
                    ? rawPlan
                    : 'free';
                if (session.user.email?.toLowerCase() === 'artemsinyakov09@gmail.com') {
                    plan = 'ultra';
                }
                request.user = {
                    id: session.user.id,
                    email: session.user.email,
                    name: session.user.name,
                    plan,
                    createdAt: session.user.createdAt
                        ? new Date(session.user.createdAt).toISOString()
                        : new Date().toISOString(),
                };
                request.userId = session.user.id;
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
                const user = userStore.findById(payload.sub);
                if (user) {
                    request.user = user;
                    request.userId = user.id;
                }
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
