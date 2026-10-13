import { Router, type Request, type Response } from 'express';
import { createMockToken } from '../auth/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { planPriceUsd } from '../services/pricing.js';
import type { InvoiceStore } from '../store/invoice-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { STARS_PLANS, planTitle, type TelegramBotService } from '../telegram/bot.js';
import { validateInitData, type TelegramWebAppUser } from '../telegram/webapp-auth.js';
import type { PlanId, User } from '../types.js';

export interface MiniAppRouterDeps {
  botService: TelegramBotService;
  userStore: UserStore;
  subscriptionStore: SubscriptionStore;
  invoiceStore: InvoiceStore;
}

/** Попытки входа по паролю из мини-приложения: не больше 5 за 10 минут на один Telegram. */
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LIMIT = 5;

/**
 * API мини-приложения Telegram (`/api/telegram/miniapp/*`). Личность подтверждается подписью
 * initData от Telegram; после этого выдаётся обычный токен сессии сайта, и остальные запросы
 * идут с ним, как у сайта.
 */
export function createMiniAppRouter({ botService, userStore, subscriptionStore, invoiceStore }: MiniAppRouterDeps): Router {
  const router = Router();
  const loginAttempts = new Map<number, number[]>();

  const telegramUserOf = (request: Request, response: Response): TelegramWebAppUser | null => {
    const initData = (request.body as { initData?: unknown } | undefined)?.initData;
    if (!botService.isConfigured) {
      sendError(response, 503, 'telegram_unavailable', 'Бот Telegram на сервере не настроен');
      return null;
    }
    const verified = typeof initData === 'string' ? validateInitData(initData, botService.botToken) : null;
    if (!verified) {
      sendError(response, 401, 'invalid_init_data', 'Откройте кабинет заново из Telegram');
      return null;
    }
    return verified.user;
  };

  const stateOf = (user: User) => {
    const subscription = subscriptionStore.get(user.id);
    const rate = botService.rateService.rate;
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        isVip: Boolean(user.isVip),
        telegramUsername: user.telegramUsername ?? null,
      },
      subscription,
      plans: STARS_PLANS.map((planId) => {
        const priceUsd = planPriceUsd(planId);
        return { id: planId, title: planTitle(planId), priceUsd, stars: botService.rateService.quote(priceUsd) };
      }),
      rate,
      history: invoiceStore.paidInvoicesOf?.(user.id) ?? [],
      siteUrl: botService.miniAppUrl.replace(/\/tg$/, ''),
    };
  };

  const session = (user: User) => {
    const { token, expiresAt } = createMockToken(user);
    return { linked: true as const, token, expiresAt, ...stateOf(user) };
  };

  router.post('/telegram/miniapp/session', (request: Request, response: Response) => {
    const tgUser = telegramUserOf(request, response);
    if (!tgUser) return;
    const user = userStore.findByTelegramChatId(tgUser.id);
    if (!user) {
      response.json({
        linked: false,
        telegram: { firstName: tgUser.first_name, username: tgUser.username ?? null },
        siteUrl: botService.miniAppUrl.replace(/\/tg$/, ''),
      });
      return;
    }
    response.json(session(user));
  });

  /** Вход по почте и паролю прямо в мини-приложении: аккаунт привязывается к этому Telegram. */
  router.post('/telegram/miniapp/link', (request: Request, response: Response) => {
    const tgUser = telegramUserOf(request, response);
    if (!tgUser) return;
    const now = Date.now();
    const attempts = (loginAttempts.get(tgUser.id) ?? []).filter((at) => now - at < LOGIN_WINDOW_MS);
    if (attempts.length >= LOGIN_LIMIT) {
      sendError(response, 429, 'rate_limited', 'Слишком много попыток. Попробуйте через несколько минут.');
      return;
    }
    const body = (request.body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      sendError(response, 400, 'invalid_request', 'Укажите почту и пароль');
      return;
    }
    const user = userStore.verifyPassword(body.email.trim(), body.password);
    if (!user) {
      attempts.push(now);
      loginAttempts.set(tgUser.id, attempts);
      sendError(response, 401, 'invalid_credentials', 'Неверная почта или пароль');
      return;
    }
    loginAttempts.delete(tgUser.id);
    const linked = botService.linkTelegram(user.id, tgUser.id, tgUser.username) ?? user;
    response.json(session(linked));
  });

  router.get('/telegram/miniapp/state', requireAuth, (request: Request, response: Response) => {
    const user = userStore.findById(request.user!.id);
    if (!user) {
      sendError(response, 404, 'user_not_found', 'Аккаунт не найден');
      return;
    }
    response.json(stateOf(user));
  });

  /** Счёт в звёздах и ссылка на окно оплаты для Telegram.WebApp.openInvoice. */
  router.post('/telegram/miniapp/invoice', requireAuth, async (request: Request, response: Response) => {
    const planId = (request.body as { planId?: unknown } | undefined)?.planId;
    if (typeof planId !== 'string' || !(STARS_PLANS as readonly string[]).includes(planId)) {
      sendError(response, 400, 'invalid_plan', 'Выберите тариф Plus, Pro или Ultra');
      return;
    }
    const invoice = botService.createStarsInvoice(request.user!.id, planId as PlanId);
    const link = await botService.createInvoiceLink(invoice);
    if (!link) {
      sendError(response, 502, 'telegram_unavailable', 'Telegram не выставил счёт. Попробуйте ещё раз.');
      return;
    }
    response.json({ invoiceId: invoice.id, stars: invoice.starsAmount, link });
  });

  router.get('/telegram/miniapp/invoice/:id', requireAuth, (request: Request, response: Response) => {
    const invoice = invoiceStore.getTelegramStarsInvoice(String(request.params.id));
    if (!invoice || invoice.userId !== request.user!.id) {
      sendError(response, 404, 'invoice_not_found', 'Счёт не найден');
      return;
    }
    response.json({ status: invoice.status });
  });

  router.post('/telegram/miniapp/unlink', requireAuth, (request: Request, response: Response) => {
    userStore.unlinkTelegram(request.user!.id);
    response.json({ ok: true });
  });

  return router;
}
