import { verifyMockToken } from '../auth/jwt.js';
import { sendError } from './errors.js';
/**
 * Middleware для аутентификации.
 * Извлекает Bearer-токен из заголовка Authorization.
 * Если токен валиден, устанавливает req.user и req.userId.
 * Если токена нет или он невалиден, оставляет req.user пустым (гостевой режим).
 */
export function createAuthMiddleware(userStore) {
    return (request, _response, next) => {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            next();
            return;
        }
        const token = authHeader.slice(7).trim();
        const payload = verifyMockToken(token);
        if (!payload) {
            next();
            return;
        }
        const user = userStore.findById(payload.sub);
        if (user) {
            request.user = user;
            request.userId = user.id;
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
