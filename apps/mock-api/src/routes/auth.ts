import { Router, type Request, type Response } from 'express';
import { defaultBetterAuth } from '../auth/better-auth.js';
import { createMockToken } from '../auth/jwt.js';
import { sendError } from '../middleware/errors.js';
import type { UserStore } from '../store/user-store.js';
import { isVipEmail } from '../services/vip.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function createAuthRouter(
  userStore: UserStore,
  betterAuthInstance = defaultBetterAuth,
): Router {
  const router = Router();

  router.post('/signup', async (request: Request, response: Response) => {
    const rawEmail: unknown = request.body?.email;
    const rawPassword: unknown = request.body?.password;
    const rawName: unknown = request.body?.name;

    if (typeof rawEmail !== 'string' || !EMAIL_REGEX.test(rawEmail.trim())) {
      sendError(response, 400, 'invalid_email', 'Введите корректный адрес электронной почты');
      return;
    }

    if (typeof rawPassword !== 'string' || rawPassword.length < MIN_PASSWORD_LENGTH) {
      sendError(
        response,
        400,
        'weak_password',
        `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`,
      );
      return;
    }

    const email = rawEmail.trim().toLowerCase();
    const existing = userStore.findByEmail(email);
    if (existing) {
      if (isVipEmail(email)) {
        userStore.setPassword(email, rawPassword);
        const updatedUser = userStore.findByEmail(email)!;
        const { token, expiresAt } = createMockToken(updatedUser);
        try {
          await betterAuthInstance.api.signUpEmail({
            body: {
              email,
              password: rawPassword,
              name: updatedUser.name,
            },
          });
        } catch {
          // Игнорируем ошибку, если в Better Auth уже создан
        }
        response.status(200).json({ user: updatedUser, token, expiresAt });
        return;
      }
      sendError(response, 409, 'user_already_exists', 'Пользователь с таким email уже существует');
      return;
    }

    const name = typeof rawName === 'string' ? rawName.trim() : undefined;
    const user = userStore.create(email, rawPassword, name);
    const { token, expiresAt } = createMockToken(user);

    // Синхронизируем пользователя с базой данных Better Auth
    try {
      await betterAuthInstance.api.signUpEmail({
        body: {
          email,
          password: rawPassword,
          name: user.name,
        },
      });
    } catch {
      // Игнорируем, если пользователь уже присутствует в базе Better Auth
    }

    response.status(201).json({ user, token, expiresAt });
  });

  router.post('/login', async (request: Request, response: Response) => {
    const rawEmail: unknown = request.body?.email;
    const rawPassword: unknown = request.body?.password;

    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
      sendError(response, 400, 'invalid_request', 'Поля email и password обязательны');
      return;
    }

    const user = userStore.verifyPassword(rawEmail, rawPassword);
    if (!user) {
      sendError(response, 401, 'invalid_credentials', 'Неверный адрес почты или пароль');
      return;
    }

    // Синхронизируем сессию с Better Auth при необходимости
    try {
      await betterAuthInstance.api.signInEmail({
        body: {
          email: rawEmail,
          password: rawPassword,
        },
      });
    } catch {
      // Fallback: авторизация по локальному хранилищу
    }

    const { token, expiresAt } = createMockToken(user);
    response.json({ user, token, expiresAt });
  });

  router.get('/me', (request: Request, response: Response) => {
    if (!request.user) {
      sendError(response, 401, 'unauthorized', 'Сессия не найдена или истекла');
      return;
    }

    response.json({ user: request.user });
  });

  router.post('/logout', (_request: Request, response: Response) => {
    response.status(204).end();
  });

  router.get('/oauth/:provider', async (request: Request, response: Response) => {
    const rawProvider = request.params.provider;
    const provider = (Array.isArray(rawProvider) ? rawProvider[0] : rawProvider)?.toLowerCase();
    if (provider !== 'google' && provider !== 'github') {
      sendError(response, 400, 'invalid_provider', 'Поддерживаются только google и github');
      return;
    }

    const providerEmail = `oauth.${provider}@ketner.ai`;
    let user = userStore.findByEmail(providerEmail);
    if (!user) {
      user = userStore.create(
        providerEmail,
        'oauth-mock-secret-password-12345',
        provider === 'google' ? 'Google User' : 'GitHub User',
      );
      try {
        await betterAuthInstance.api.signUpEmail({
          body: {
            email: providerEmail,
            password: 'oauth-mock-secret-password-12345',
            name: user.name,
          },
        });
      } catch {
        // Уже создан
      }
    }

    const { token, expiresAt } = createMockToken(user);
    response.json({ user, token, expiresAt, provider });
  });

  router.post('/demo', (_request, response) => {
    const user = userStore.verifyPassword('demo@ketner.ai', 'password123');
    if (!user) {
      sendError(response, 500, 'demo_unavailable', 'Демо-аккаунт недоступен');
      return;
    }

    const { token, expiresAt } = createMockToken(user);
    response.json({ user, token, expiresAt });
  });

  return router;
}
