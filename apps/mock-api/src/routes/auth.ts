import { Router, type Request, type Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { attributionFromCookieHeader } from '../services/signup-attribution.js';
import type { SignupAttribution } from '../services/signup-attribution.js';
import { defaultBetterAuth } from '../auth/better-auth.js';
import { createMockToken, verifyMockToken } from '../auth/jwt.js';
import { telegramBotService } from '../telegram/bot.js';
import { telegramLinkCodes } from '../telegram/link-codes.js';
import { sendError } from '../middleware/errors.js';
import { MAX_PASSWORD_LENGTH, type UserStore } from '../store/user-store.js';
import { revokedTokenStore as defaultRevokedTokenStore } from '../store/index.js';
import type { RevokedTokenStore } from '../store/revoked-token-store.js';
import { revokeBetterAuthSessions, syncBetterAuthCredential } from '../auth/better-auth-sync.js';
import { PasswordResetGrants } from '../auth/password-reset.js';
import { isTelegramAccountEmail } from '../telegram/auth-requests.js';
import { RateLimiter, clientIp } from '../middleware/rate-limit.js';
import {
  EMAIL_CODE_RESEND_MS,
  EmailCodeChallenges,
  emailCodeMail,
  maskEmail,
  type EmailCodePurpose,
  type IssuedCode,
} from '../auth/email-codes.js';
import { mailer as defaultMailer, type Mailer } from '../services/mailer.js';

import { config, isProduction } from '../config.js';
import type { User } from '../types.js';
import { isAdminEmail, isVipEmail } from '../services/vip.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/** Заявка на регистрацию: аккаунт создаётся после кода из письма. */
interface SignupChallenge {
  email: string;
  password: string;
  name?: string;
  attribution?: SignupAttribution;
}

/** Вход: пароль уже проверен, сессия выдаётся после кода из письма. */
interface LoginChallenge {
  email: string;
  userId: string;
  /** Нужен только для cookie-сессии Better Auth после подтверждения. */
  password: string;
}

/**
 * Восстановление пароля: код приходит на почту, затем задаётся новый пароль. userId === null —
 * аккаунта с такой почтой нет: заявка ведёт себя так же, но письмо не отправляется.
 */
interface ResetChallenge {
  email: string;
  userId: string | null;
}

export interface AuthRouterOptions {
  mailer?: Mailer;
  signupChallenges?: EmailCodeChallenges<SignupChallenge>;
  loginChallenges?: EmailCodeChallenges<LoginChallenge>;
  resetChallenges?: EmailCodeChallenges<ResetChallenge>;
  resetGrants?: PasswordResetGrants;
}

/**
 * Вход и регистрация по почте — всегда в два шага, второй — 6-значный код из письма
 * (см. auth/email-codes.ts):
 *
 * - `POST /signup` → код → `POST /signup/verify` создаёт аккаунт и сессию;
 * - `POST /login` (почта и пароль) → код → `POST /login/verify` выдаёт сессию;
 * - `POST /signup/resend`, `POST /login/resend` — новый код не чаще раза в минуту;
 * - «Забыли пароль?»: `POST /password-reset` (почта) → код → `POST /password-reset/verify` выдаёт
 *   одноразовый токен → `POST /password-reset/complete` с новым паролем завершает все прежние сессии
 *   и открывает новую; `POST /password-reset/resend` — новый код.
 *
 * Сессия — Bearer-токен сайта и cookie Better Auth, которую ставит сам сервер: вход в Better Auth
 * по паролю напрямую (`/api/auth/sign-in/email`) закрыт, иначе он обходил бы код.
 */
export function createAuthRouter(
  userStore: UserStore,
  betterAuthInstance = defaultBetterAuth,
  revokedTokens: RevokedTokenStore = defaultRevokedTokenStore,
  {
    mailer = defaultMailer,
    signupChallenges = new EmailCodeChallenges<SignupChallenge>(),
    loginChallenges = new EmailCodeChallenges<LoginChallenge>(),
    resetChallenges = new EmailCodeChallenges<ResetChallenge>(),
    resetGrants = new PasswordResetGrants(),
  }: AuthRouterOptions = {},
): Router {
  const router = Router();

  // Перебор паролей и массовые регистрации ради бесплатной квоты.
  // Неудачные входы считаются и по адресу клиента, и по почте: второе не обойти сменой IP.
  const signupsPerIp = new RateLimiter(60 * 60 * 1000, 5);
  const failedLoginsPerIp = new RateLimiter(15 * 60 * 1000, 30);
  const failedLoginsPerEmail = new RateLimiter(15 * 60 * 1000, 8);
  // Письма с кодом: не больше 10 в час на один адрес (чтобы через формы нельзя было засыпать чужую
  // почту) и 30 в час с одного адреса клиента. Ввод кода ограничен и по адресу клиента
  // (у самого кода — 5 попыток).
  const codesPerEmail = new RateLimiter(60 * 60 * 1000, 10);
  // Сброс пароля можно запросить и для чужой почты, поэтому у него свой лимит на адрес: иначе
  // посторонний исчерпал бы общий, и владелец час не мог бы войти.
  const resetCodesPerEmail = new RateLimiter(60 * 60 * 1000, 5);
  const codesPerIp = new RateLimiter(60 * 60 * 1000, 30);
  const perEmail = (purpose: EmailCodePurpose): RateLimiter =>
    purpose === 'reset' ? resetCodesPerEmail : codesPerEmail;
  const verifyAttemptsPerIp = new RateLimiter(15 * 60 * 1000, 30);

  const tooMany = (response: Response, retryAfterSec: number, message: string): void => {
    response.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
    sendError(response, 429, 'too_many_requests', message);
  };

  /** Можно ли отправить ещё одно письмо с кодом; если нет — отвечает сам и возвращает false. */
  const canSendCode = (
    request: Request,
    response: Response,
    purpose: EmailCodePurpose,
    email: string,
  ): boolean => {
    if (mailer.kind === 'none') {
      sendError(
        response,
        503,
        'mail_unavailable',
        'Вход, регистрация и восстановление пароля по почте временно недоступны: не настроена отправка писем.',
      );
      return false;
    }
    const emailLimit = perEmail(purpose);
    if (emailLimit.isLimited(email)) {
      tooMany(
        response,
        emailLimit.retryAfterSec(email),
        'На эту почту уже отправлено много писем. Попробуйте позже.',
      );
      return false;
    }
    const ipKey = clientIp(request);
    if (codesPerIp.isLimited(ipKey)) {
      tooMany(
        response,
        codesPerIp.retryAfterSec(ipKey),
        'Слишком много запросов кода с этого адреса. Попробуйте позже.',
      );
      return false;
    }
    return true;
  };

  /**
   * Отправляет письмо с кодом и отвечает клиенту описанием заявки (без самого кода).
   * deliver = false — письмо не отправляется (сброс пароля для неизвестной почты), ответ тот же.
   */
  const sendCode = async (
    request: Request,
    response: Response,
    purpose: EmailCodePurpose,
    issued: IssuedCode,
    status: number,
    deliver = true,
  ): Promise<void> => {
    perEmail(purpose).record(issued.email);
    codesPerIp.record(clientIp(request));
    try {
      if (deliver) await mailer.send(emailCodeMail(purpose, issued.email, issued.code));
    } catch (error) {
      console.error(`[auth] Письмо с кодом (${purpose}) не отправлено:`, error);
      sendError(
        response,
        502,
        'mail_failed',
        'Не получилось отправить письмо с кодом. Попробуйте ещё раз через минуту.',
      );
      return;
    }
    response.status(status).json({
      status: 'verification_required',
      challengeId: issued.id,
      maskedEmail: maskEmail(issued.email),
      codeExpiresAt: new Date(issued.codeExpiresAt).toISOString(),
      resendAfterSec: Math.ceil(EMAIL_CODE_RESEND_MS / 1000),
    });
  };

  /** Проверяет код заявки; при ошибке отвечает сам и возвращает null. */
  const checkCode = <T extends { email: string }>(
    request: Request,
    response: Response,
    challenges: EmailCodeChallenges<T>,
    restartHint: string,
  ): T | null => {
    const ipKey = clientIp(request);
    if (verifyAttemptsPerIp.isLimited(ipKey)) {
      tooMany(
        response,
        verifyAttemptsPerIp.retryAfterSec(ipKey),
        'Слишком много попыток ввода кода. Подождите несколько минут.',
      );
      return null;
    }
    verifyAttemptsPerIp.record(ipKey);

    const challengeId: unknown = request.body?.challengeId;
    const code: unknown = request.body?.code;
    if (typeof challengeId !== 'string' || typeof code !== 'string' || !code.trim()) {
      sendError(response, 400, 'invalid_request', 'Введите код из письма');
      return null;
    }

    const result = challenges.check(challengeId, code);
    if (result.ok) return result.data;
    switch (result.reason) {
      case 'missing':
        sendError(response, 410, 'challenge_expired', restartHint);
        break;
      case 'expired':
        sendError(response, 400, 'code_expired', 'Срок действия кода истёк. Запросите новый код.');
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
    return null;
  };

  const resendCode = async <T extends { email: string }>(
    request: Request,
    response: Response,
    purpose: EmailCodePurpose,
    challenges: EmailCodeChallenges<T>,
    restartHint: string,
    deliver: (data: T) => boolean = () => true,
  ): Promise<void> => {
    const challengeId: unknown = request.body?.challengeId;
    const email = typeof challengeId === 'string' ? challenges.emailOf(challengeId) : null;
    if (typeof challengeId !== 'string' || !email) {
      sendError(response, 410, 'challenge_expired', restartHint);
      return;
    }
    const waitMs = challenges.resendIn(challengeId);
    if (waitMs > 0) {
      tooMany(response, Math.ceil(waitMs / 1000), 'Новый код можно запросить чуть позже.');
      return;
    }
    if (!canSendCode(request, response, purpose, email)) return;
    const data = challenges.dataOf(challengeId)!;
    await sendCode(
      request,
      response,
      purpose,
      challenges.reissue(challengeId)!,
      200,
      deliver(data),
    );
  };

  /** Требования к паролю (регистрация и новый пароль); при нарушении отвечает сам и возвращает null. */
  const acceptPassword = (response: Response, raw: unknown): string | null => {
    if (typeof raw === 'string' && raw.length > MAX_PASSWORD_LENGTH) {
      sendError(
        response,
        400,
        'invalid_password',
        `Пароль длиннее ${MAX_PASSWORD_LENGTH} символов`,
      );
      return null;
    }
    if (typeof raw !== 'string' || raw.length < MIN_PASSWORD_LENGTH) {
      sendError(
        response,
        400,
        'weak_password',
        `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`,
      );
      return null;
    }
    return raw;
  };

  /**
   * Cookie-сессия Better Auth для подтверждённого входа. Пароль записи Better Auth приводится к
   * паролю владельца (посторонняя запись с этой почтой перезаписывается, её сессии отзываются),
   * затем сервер сам входит в Better Auth и передаёт браузеру его cookie. Сбой не мешает входу:
   * Bearer-токена достаточно.
   */
  const startCookieSession = async (
    request: Request,
    response: Response,
    email: string,
    password: string,
    name?: string,
  ): Promise<void> => {
    try {
      await syncBetterAuthCredential(betterAuthInstance, email, password, name);
      const { headers } = await betterAuthInstance.api.signInEmail({
        body: { email, password },
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
      const cookies = headers.getSetCookie();
      if (cookies.length > 0) response.append('Set-Cookie', cookies);
    } catch (error) {
      console.warn('[auth] Не удалось открыть cookie-сессию Better Auth:', error);
    }
  };

  const SIGNUP_RESTART = 'Заявка на регистрацию устарела. Заполните форму регистрации ещё раз.';
  const LOGIN_RESTART = 'Попытка входа устарела. Введите почту и пароль ещё раз.';
  const RESET_RESTART = 'Запрос на сброс пароля устарел. Запросите новый код.';

  /** Токен сайта с отпечатком текущего пароля: после смены пароля он перестанет действовать. */
  const issueToken = (user: User) => createMockToken(user, userStore.credentialStamp(user.id));

  router.post('/signup', async (request: Request, response: Response) => {
    const rawEmail: unknown = request.body?.email;
    const rawPassword: unknown = request.body?.password;
    const rawName: unknown = request.body?.name;

    if (typeof rawEmail !== 'string' || !EMAIL_REGEX.test(rawEmail.trim())) {
      sendError(response, 400, 'invalid_email', 'Введите корректный адрес электронной почты');
      return;
    }

    const password = acceptPassword(response, rawPassword);
    if (password === null) return;

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

    if (userStore.findByEmail(email)) {
      sendError(response, 409, 'user_already_exists', 'Пользователь с таким email уже существует');
      return;
    }

    if (!canSendCode(request, response, 'signup', email)) return;

    signupsPerIp.record(ipKey);
    const name =
      typeof rawName === 'string' ? rawName.trim().slice(0, 100) || undefined : undefined;
    const issued = signupChallenges.create({
      email,
      password,
      name,
      attribution: attributionFromCookieHeader(request.headers.cookie),
    });
    await sendCode(request, response, 'signup', issued, 202);
  });

  router.post('/signup/verify', async (request: Request, response: Response) => {
    const data = checkCode(request, response, signupChallenges, SIGNUP_RESTART);
    if (!data) return;

    // Пока письмо шло, аккаунт с этой почтой мог появиться (другая заявка, вход через Google).
    if (userStore.findByEmail(data.email)) {
      sendError(response, 409, 'user_already_exists', 'Пользователь с таким email уже существует');
      return;
    }

    const user = userStore.create(data.email, data.password, data.name, {
      method: 'email',
      attribution: data.attribution,
    });
    const { token, expiresAt } = issueToken(user);
    await startCookieSession(request, response, data.email, data.password, user.name);
    response.status(201).json({ user, token, expiresAt });
  });

  router.post('/signup/resend', (request: Request, response: Response) =>
    resendCode(request, response, 'signup', signupChallenges, SIGNUP_RESTART),
  );

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

    if (!canSendCode(request, response, 'login', user.email)) return;
    const issued = loginChallenges.create({
      email: user.email,
      userId: user.id,
      password: rawPassword,
    });
    await sendCode(request, response, 'login', issued, 202);
  });

  router.post('/login/verify', async (request: Request, response: Response) => {
    const data = checkCode(request, response, loginChallenges, LOGIN_RESTART);
    if (!data) return;

    const user = userStore.findById(data.userId);
    if (!user) {
      sendError(response, 410, 'challenge_expired', LOGIN_RESTART);
      return;
    }
    const { token, expiresAt } = issueToken(user);
    await startCookieSession(request, response, user.email, data.password, user.name);
    response.json({ user, token, expiresAt });
  });

  router.post('/login/resend', (request: Request, response: Response) =>
    resendCode(request, response, 'login', loginChallenges, LOGIN_RESTART),
  );

  // «Забыли пароль?». Ответ не зависит от того, есть ли аккаунт с этой почтой: код уходит только
  // владельцу существующего аккаунта, а для чужой почты заявка заводится без письма.
  router.post('/password-reset', async (request: Request, response: Response) => {
    const rawEmail: unknown = request.body?.email;
    if (typeof rawEmail !== 'string' || !EMAIL_REGEX.test(rawEmail.trim())) {
      sendError(response, 400, 'invalid_email', 'Введите корректный адрес электронной почты');
      return;
    }
    const email = rawEmail.trim().toLowerCase();
    if (!canSendCode(request, response, 'reset', email)) return;

    // У аккаунтов Telegram служебная почта (tg-…@telegram.invalid): письмо до неё не дойдёт.
    const user = isTelegramAccountEmail(email) ? null : userStore.findByEmail(email);
    const issued = resetChallenges.create({ email, userId: user?.id ?? null });
    await sendCode(request, response, 'reset', issued, 202, Boolean(user));
  });

  router.post('/password-reset/verify', (request: Request, response: Response) => {
    const data = checkCode(request, response, resetChallenges, RESET_RESTART);
    if (!data) return;
    if (!data.userId) {
      // Код к заявке без аккаунта не отправлялся: угадать его — то же, что заявка устарела.
      sendError(response, 410, 'challenge_expired', RESET_RESTART);
      return;
    }
    const grant = resetGrants.issue(data.userId, data.email);
    response.json({
      status: 'code_verified',
      resetToken: grant.token,
      maskedEmail: maskEmail(data.email),
      expiresAt: new Date(grant.expiresAt).toISOString(),
    });
  });

  router.post('/password-reset/resend', (request: Request, response: Response) =>
    resendCode(request, response, 'reset', resetChallenges, RESET_RESTART, (data) =>
      Boolean(data.userId),
    ),
  );

  router.post('/password-reset/complete', async (request: Request, response: Response) => {
    const rawToken: unknown = request.body?.resetToken;
    const password = acceptPassword(response, request.body?.password);
    if (password === null) return;

    const grant = typeof rawToken === 'string' ? resetGrants.peek(rawToken) : null;
    const user = grant ? userStore.findById(grant.userId) : null;
    if (!grant || !user || user.email !== grant.email) {
      sendError(
        response,
        410,
        'reset_expired',
        'Время на смену пароля истекло. Запросите новый код.',
      );
      return;
    }

    const updated = userStore.setPassword(user.email, password) ?? user;
    resetGrants.revokeUser(user.id);
    // Прежний пароль мог знать посторонний: его токены сайта уже не действуют (отпечаток пароля
    // сменился), cookie-сессии Better Auth завершаются здесь. Неудачные входы по почте обнуляются.
    failedLoginsPerEmail.reset(user.email);
    try {
      await revokeBetterAuthSessions(betterAuthInstance, user.email);
    } catch (error) {
      console.warn('[auth] Не удалось завершить сессии Better Auth после сброса пароля:', error);
    }

    const { token, expiresAt } = issueToken(updated);
    await startCookieSession(request, response, updated.email, password, updated.name);
    response.json({ user: updated, token, expiresAt });
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

    const { token, expiresAt } = issueToken(user);
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

    const { token, expiresAt } = issueToken(user);
    response.json({ user, token, expiresAt });
  });

  return router;
}
