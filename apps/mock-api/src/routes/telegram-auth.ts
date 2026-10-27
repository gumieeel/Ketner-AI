import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { RateLimiter, clientIp } from '../middleware/rate-limit.js';
import type { UserStore } from '../store/user-store.js';
import { describeDevice, isTelegramAccountEmail } from '../telegram/auth-requests.js';
import type { TelegramBotService } from '../telegram/bot.js';

export interface TelegramAuthRouterDeps {
  botService: TelegramBotService;
  userStore: UserStore;
}

/**
 * Привязка Telegram к аккаунту сайта (`/api/auth/telegram/*`): сайт создаёт запрос, человек
 * подтверждает его кнопкой в боте, сайт узнаёт результат опросом; либо вводит код из кабинета.
 *
 * Входа через Telegram на сайт нет: войти можно только по почте с кодом из письма или через
 * Google / GitHub. Запросы входа (`mode: login`) и одноразовые ссылки входа из кабинета отключены.
 */
export function createTelegramAuthRouter({
  botService,
  userStore,
}: TelegramAuthRouterDeps): Router {
  const router = Router();
  const requests = botService.authRequests;
  // Запросы входа живут в памяти: без лимита их можно наплодить миллионами. Код из мини-приложения
  // короткий (6 символов) — попытки ввода ограничены, чтобы его нельзя было подобрать.
  const startsPerIp = new RateLimiter(10 * 60 * 1000, 20);
  const claimAttempts = new RateLimiter(10 * 60 * 1000, 10);
  const limited = (response: Response, limiter: RateLimiter, key: string): boolean => {
    if (!limiter.hit(key)) return false;
    response.setHeader('Retry-After', String(limiter.retryAfterSec(key)));
    sendError(
      response,
      429,
      'too_many_requests',
      'Слишком много попыток. Подождите несколько минут.',
    );
    return true;
  };

  router.post('/auth/telegram/start', (request: Request, response: Response) => {
    if (limited(response, startsPerIp, clientIp(request))) return;
    if ((request.body as { mode?: unknown } | undefined)?.mode !== 'link') {
      sendError(
        response,
        410,
        'telegram_login_disabled',
        'Вход через Telegram отключён. Войдите по почте или через Google / GitHub.',
      );
      return;
    }
    if (!request.user) {
      sendError(response, 401, 'unauthorized', 'Войдите, чтобы подключить Telegram');
      return;
    }
    const created = requests.create(
      'link',
      describeDevice(request.headers['user-agent']),
      request.user.id,
    );
    response.json({
      requestId: created.id,
      mode: 'link',
      botUrl: `https://t.me/${botService.botUsername}?start=auth_${created.code}`,
      expiresAt: new Date(created.expiresAt).toISOString(),
    });
  });

  router.get('/auth/telegram/poll/:id', (request: Request, response: Response) => {
    const result = requests.poll(String(request.params.id));
    if (result.status !== 'approved' || !result.userId) {
      response.json({ status: result.status });
      return;
    }
    const user = userStore.findById(result.userId);
    // Сессию опрос не выдаёт никогда: это только привязка.
    if (!user || result.mode !== 'link') {
      response.json({ status: 'expired' });
      return;
    }
    response.json({ status: 'approved', mode: 'link', user });
  });

  /** Код из кабинета в Telegram, введённый в настройках сайта. */
  router.post('/auth/telegram/claim', requireAuth, (request: Request, response: Response) => {
    if (
      limited(response, claimAttempts, `user:${request.user!.id}`) ||
      limited(response, claimAttempts, `ip:${clientIp(request)}`)
    )
      return;
    const code = (request.body as { code?: unknown } | undefined)?.code;
    if (typeof code !== 'string' || code.trim().length < 4) {
      sendError(response, 400, 'invalid_request', 'Введите код из Telegram');
      return;
    }
    const claim = requests.consumeClaimCode(code);
    if (!claim) {
      sendError(
        response,
        400,
        'invalid_code',
        'Код не подошёл или устарел. Получите новый в кабинете Telegram.',
      );
      return;
    }
    const previous = userStore.findByTelegramChatId(claim.telegramUserId);
    if (previous && previous.id !== request.user!.id && isTelegramAccountEmail(previous.email)) {
      sendError(
        response,
        409,
        'telegram_in_use',
        'Этот Telegram уже открывает отдельный аккаунт, созданный в Telegram. Войдите через Telegram на сайте — кредиты там.',
      );
      return;
    }
    const user = botService.linkTelegram(request.user!.id, claim.telegramUserId, claim.username);
    response.json({ user });
  });

  return router;
}
