import type { NextFunction, Request, Response } from 'express';
import { verifyMockToken } from '../auth/jwt.js';
import type { UserStore } from '../store/user-store.js';
import type { User } from '../types.js';
import { sendError } from './errors.js';

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
 * Извлекает Bearer-токен из заголовка Authorization.
 * Если токен валиден, устанавливает req.user и req.userId.
 * Если токена нет или он невалиден, оставляет req.user пустым (гостевой режим).
 */
export function createAuthMiddleware(userStore: UserStore) {
  return (request: Request, _response: Response, next: NextFunction): void => {
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
export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (!request.user) {
    sendError(response, 401, 'unauthorized', 'Сессия не найдена или истекла');
    return;
  }
  next();
}
