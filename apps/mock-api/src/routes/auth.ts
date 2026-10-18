import { Router, type Request, type Response } from 'express';
import { attributionFromCookieHeader } from '../services/signup-attribution.js';
import { defaultBetterAuth } from '../auth/better-auth.js';
import { createMockToken, verifyMockToken } from '../auth/jwt.js';
import { telegramBotService } from '../telegram/bot.js';
import { telegramLinkCodes } from '../telegram/link-codes.js';
import { sendError } from '../middleware/errors.js';
import { MAX_PASSWORD_LENGTH, type UserStore } from '../store/user-store.js';
import { revokedTokenStore as defaultRevokedTokenStore } from '../store/index.js';
import type { RevokedTokenStore } from '../store/revoked-token-store.js';
import { syncBetterAuthCredential } from '../auth/better-auth-sync.js';
import { RateLimiter, clientIp } from '../middleware/rate-limit.js';
import {
  PendingSignups,
  SIGNUP_CODE_RESEND_MS,
  signupCodeMail,
} from '../auth/signup-verification.js';
import { mailer as defaultMailer, type Mailer } from '../services/mailer.js';

import { config, isProduction } from '../config.js';
import { isAdminEmail, isVipEmail } from '../services/vip.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function createAuthRouter(
  userStore: UserStore,
  betterAuthInstance = defaultBetterAuth,
  revokedTokens: RevokedTokenStore = defaultRevokedTokenStore,
  mailer: Mailer = defaultMailer,
  pendingSignups = new PendingSignups(),
): Router {
  const router = Router();

  // Перебор паролей и массовые регистрации ради бесплатной квоты.
  // Неудачные входы считаются и по адресу клиента, и по почте: второе не обойти сменой IP.
  const signupsPerIp = new RateLimiter(60 * 60 * 1000, 5);
  const failedLoginsPerIp = new RateLimiter(15 * 60 * 1000, 30);
  const failedLoginsPerEmail = new RateLimiter(15 * 60 * 1000, 8);
  // Письма с кодом: не больше 6 в час на один адрес, чтобы через форму нельзя было засыпать
  // чужую почту. Попытки ввода кода ограничены и по адресу клиента (сам код — 5 попыток).
  const codesPerEmail = new RateLimiter(60 * 60 * 1000, 6);
  const verifyAttemptsPerIp = new RateLimiter(15 * 60 * 1000, 30);

  const tooMany = (response: Response, retryAfterSec: number, message: string): void => {
    response.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
    sendError(response, 429, 'too_many_requests', message);
  };

  /** Отправляет письмо с кодом; при ошибке сам отвечает клиенту и возвращает false. */
  const sendSignupCode = async (
    response: Response,
    email: string,
    code: string,
  ): Promise<boolean> => {
    try {
      await mailer.send(signupCodeMail(email, code));
      return true;
    } catch (error) {
      console.error('[auth] Письмо с кодом регистрации не отправлено:', error);
      sendError(
        response,
        502,
        'mail_failed',
        'Не получилось отправить письмо с кодом. Попробуйте ещё раз через минуту.',
      );
      return false;
    }
  };

  // Регистрация в два шага: форма → код на почту → аккаунт (см. auth/signup-verification.ts).
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

    // Адреса администраторов и VIP заводятся только через SEED_ADMIN_* / админ-панель.
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

    if (codesPerEmail.isLimited(email)) {
      tooMany(
        response,
        codesPerEmail.retryAfterSec(email),
        'На эту почту уже отправлено много писем. Попробуйте позже.',
      );
      return;
    }

    if (mailer.kind === 'none') {
      sendError(
        response,
        503,
        'mail_unavailable',
        'Регистрация временно недоступна: не настроена отправка писем.',
      );
      return;
    }

    const name =
      typeof rawName === 'string' ? rawName.trim().slice(0, 100) || undefined : undefined;
    const issued = pendingSignups.create({
      email,
      password: rawPassword,
      name,
      attribution: attributionFromCookieHeader(request.headers.cookie),
    });
    signupsPerIp.record(ipKey);
    codesPerEmail.record(email);

    if (!(await sendSignupCode(response, issued.email, issued.code))) return;

    response.status(202).json({
      status: 'verification_required',
      signupId: issued.signupId,
      email,
      codeExpiresAt: new Date(issued.codeExpiresAt).toISOString(),
      resendAfterSec: Math.ceil(SIGNUP_CODE_RESEND_MS / 1000),
    });
  });

  router.post('/signup/verify', async (request: Request, response: Response) => {
    const ipKey = clientIp(request);
    if (verifyAttemptsPerIp.isLimited(ipKey)) {
      tooMany(
        response,
        verifyAttemptsPerIp.retryAfterSec(ipKey),
        'Слишком много попыток ввода кода. Подождите несколько минут.',
      );
      return;
    }
    verifyAttemptsPerIp.record(ipKey);

    const signupId: unknown = request.body?.signupId;
    const code: unknown = request.body?.code;
    if (typeof signupId !== 'string' || typeof code !== 'string' || !code.trim()) {
      sendError(response, 400, 'invalid_request', 'Введите код из письма');
      return;
    }

    const result = pendingSignups.check(signupId, code);
    if (!result.ok) {
      switch (result.reason) {
        case 'missing':
          sendError(
            response,
            410,
            'signup_expired',
            'Заявка на регистрацию устарела. Заполните форму регистрации ещё раз.',
          );
          break;
        case 'expired':
          sendError(
            response,
            400,
            'code_expired',
            'Срок действия кода истёк. Запросите новый код.',
          );
          break;
        case 'used_up':
          sendError(
            response,
            400,
            'code_attempts_exceeded',
            'Слишком много неверных попыток. Запросите новый код.',
          );
          break;
        case 'invalid':
          sendError(
            response,
            400,
            'invalid_code',
            `Неверный код. Осталось попыток: ${result.attemptsLeft}`,
          );
          break;
      }
      return;
    }

    const { email, password, name, attribution } = result.data;
    // Пока письмо шло, аккаунт с этой почтой мог появиться (другая заявка, вход через Google).
    if (userStore.findByEmail(email)) {
      sendError(response, 409, 'user_already_exists', 'Пользователь с таким email уже существует');
      return;
    }

    const user = userStore.create(email, password, name, { method: 'email', attribution });
    const { token, expiresAt } = createMockToken(user);

    // Запись Better Auth (для cookie-сессии) получает тот же пароль; посторонняя запись с этой почтой,
    // если её успели завести, перезаписывается, а её сессии отзываются.
    try {
      await syncBetterAuthCredential(betterAuthInstance, email, password, user.name);
    } catch (error) {
      console.warn('[auth] Не удалось синхронизировать Better Auth при регистрации:', error);
    }

    response.status(201).json({ user, token, expiresAt });
  });

  router.post('/signup/resend', async (request: Request, response: Response) => {
    const signupId: unknown = request.body?.signupId;
    const email = typeof signupId === 'string' ? pendingSignups.emailOf(signupId) : null;
    if (typeof signupId !== 'string' || !email) {
      sendError(
        response,
        410,
        'signup_expired',
        'Заявка на регистрацию устарела. Заполните форму регистрации ещё раз.',
      );
      return;
    }

    const waitMs = pendingSignups.resendIn(signupId);
    if (waitMs > 0) {
      tooMany(response, Math.ceil(waitMs / 1000), 'Новый код можно запросить чуть позже.');
      return;
    }
    if (codesPerEmail.isLimited(email)) {
      tooMany(
        response,
        codesPerEmail.retryAfterSec(email),
        'На эту почту уже отправлено много писем. Попробуйте позже.',
      );
      return;
    }

    const issued = pendingSignups.reissue(signupId)!;
    codesPerEmail.record(email);
    if (!(await sendSignupCode(response, issued.email, issued.code))) return;

    response.json({
      status: 'verification_required',
      email,
      codeExpiresAt: new Date(issued.codeExpiresAt).toISOString(),
      resendAfterSec: Math.ceil(SIGNUP_CODE_RESEND_MS / 1000),
    });
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

  // Выход отзывает Bearer-токен на сервере: его копия (из другой вкладки, лога, украденная)
  // больше не открывает аккаунт. Неподписанный или чужой мусор просто игнорируется.
  router.post('/logout', (request: Request, response: Response) => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      const payload = verifyMockToken(token);
      if (payload) revokedTokens.revoke(token, payload.exp);
    }
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
        { method: provider, attribution: attributionFromCookieHeader(request.headers.cookie) },
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
