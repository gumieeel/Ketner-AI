import { Router, type Request, type Response } from 'express';
import { defaultBetterAuth } from '../auth/better-auth.js';
import { createMockToken } from '../auth/jwt.js';
import { telegramBotService } from '../telegram/bot.js';
import { telegramLinkCodes } from '../telegram/link-codes.js';
import { sendError } from '../middleware/errors.js';
import { MAX_PASSWORD_LENGTH, type UserStore } from '../store/user-store.js';
import { syncBetterAuthCredential } from '../auth/better-auth-sync.js';
import { RateLimiter, clientIp } from '../middleware/rate-limit.js';

import { config, isProduction } from '../config.js';
import { isAdminEmail, isVipEmail } from '../services/vip.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function createAuthRouter(
  userStore: UserStore,
  betterAuthInstance = defaultBetterAuth,
): Router {
  const router = Router();

  // Перебор паролей и массовые регистрации ради бесплатной квоты.
  // Неудачные входы считаются и по адресу клиента, и по почте: второе не обойти сменой IP.
  const signupsPerIp = new RateLimiter(60 * 60 * 1000, 5);
  const failedLoginsPerIp = new RateLimiter(15 * 60 * 1000, 30);
  const failedLoginsPerEmail = new RateLimiter(15 * 60 * 1000, 8);

  const tooMany = (response: Response, retryAfterSec: number, message: string): void => {
    response.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
    sendError(response, 429, 'too_many_requests', message);
  };

  router.post('/signup', async (request: Request, response: Response) => {
    const rawEmail: unknown = request.body?.email;
    const rawPassword: unknown = request.body?.password;
    const rawName: unknown = request.body?.name;

    if (typeof rawEmail !== 'string' || !EMAIL_REGEX.test(rawEmail.trim())) {
      sendError(response, 400, 'invalid_email', 'Введите корректный адрес электронной почты');
      return;
    }

    if (typeof rawPassword === 'string' && rawPassword.length > MAX_PASSWORD_LENGTH) {
      sendError(
        response,
        400,
        'invalid_password',
        `Пароль длиннее ${MAX_PASSWORD_LENGTH} символов`,
      );
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

    // Адреса администраторов и VIP заводятся только через SEED_ADMIN_* / админ-панель:
    // регистрация не подтверждает владение почтой, поэтому занять их нельзя.
    if (isProduction && (isAdminEmail(email) || isVipEmail(email))) {
      sendError(response, 409, 'user_already_exists', 'Пользователь с таким email уже существует');
      return;
    }

    const ipKey = clientIp(request);
    if (signupsPerIp.isLimited(ipKey)) {
      tooMany(
        response,
        signupsPerIp.retryAfterSec(ipKey),
        'Слишком много регистраций с этого адреса. Попробуйте позже.',
      );
      return;
    }

    const existing = userStore.findByEmail(email);
    if (existing) {
      sendError(response, 409, 'user_already_exists', 'Пользователь с таким email уже существует');
      return;
    }

    signupsPerIp.record(ipKey);
    const name = typeof rawName === 'string' ? rawName.trim().slice(0, 100) : undefined;
    const user = userStore.create(email, rawPassword, name);
    const { token, expiresAt } = createMockToken(user);

    // Запись Better Auth (для cookie-сессии) получает тот же пароль; посторонняя запись с этой почтой,
    // если её успели завести, перезаписывается, а её сессии отзываются.
    try {
      await syncBetterAuthCredential(betterAuthInstance, email, rawPassword, user.name);
    } catch (error) {
      console.warn('[auth] Не удалось синхронизировать Better Auth при регистрации:', error);
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

    const ipKey = clientIp(request);
    const emailKey = rawEmail.trim().toLowerCase().slice(0, 320);
    if (failedLoginsPerIp.isLimited(ipKey) || failedLoginsPerEmail.isLimited(emailKey)) {
      const retry = Math.max(
        failedLoginsPerIp.retryAfterSec(ipKey),
        failedLoginsPerEmail.retryAfterSec(emailKey),
      );
      tooMany(response, retry, 'Слишком много неудачных попыток входа. Подождите несколько минут.');
      return;
    }

    const user = userStore.verifyPassword(rawEmail, rawPassword);
    if (!user) {
      failedLoginsPerIp.record(ipKey);
      failedLoginsPerEmail.record(emailKey);
      sendError(response, 401, 'invalid_credentials', 'Неверный адрес почты или пароль');
      return;
    }
    failedLoginsPerEmail.reset(emailKey);

    // Запись Better Auth приводится к паролю владельца (см. syncBetterAuthCredential).
    try {
      await syncBetterAuthCredential(betterAuthInstance, user.email, rawPassword, user.name);
    } catch (error) {
      console.warn('[auth] Не удалось синхронизировать Better Auth при входе:', error);
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

  router.get('/telegram-link', (request: Request, response: Response) => {
    if (!request.user) {
      sendError(response, 401, 'unauthorized', 'Сессия не найдена или истекла');
      return;
    }
    const botUser = (telegramBotService.botUsername || config.telegramBotUsername).replace(
      /^@/,
      '',
    );
    // Одноразовый код на 15 минут вместо id пользователя: ссылку нельзя подобрать или переслать.
    response.json({
      botUsername: botUser,
      linkUrl: `https://t.me/${botUser}?start=lnk_${telegramLinkCodes.issue(request.user.id)}`,
      isLinked: Boolean(request.user.telegramChatId),
      telegramUsername: request.user.telegramUsername,
    });
  });

  router.post('/telegram-unlink', (request: Request, response: Response) => {
    if (!request.user) {
      sendError(response, 401, 'unauthorized', 'Сессия не найдена или истекла');
      return;
    }
    const updated = userStore.unlinkTelegram(request.user.id);
    response.json({ success: true, user: updated ?? request.user });
  });

  router.post('/logout', (_request: Request, response: Response) => {
    response.status(204).end();
  });

  router.get('/oauth/:provider', async (request: Request, response: Response) => {
    // Mock-вход выдаёт токен общего аккаунта без проверки у провайдера: только вне production.
    if (isProduction) {
      sendError(response, 501, 'oauth_not_configured', 'Вход через провайдера недоступен');
      return;
    }
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
    if (!config.enableDemoAccount) {
      sendError(response, 404, 'not_found', 'Маршрут не найден');
      return;
    }
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
