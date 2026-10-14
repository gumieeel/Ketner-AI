import { Router, type Request, type Response } from 'express';
import { createMockToken } from '../auth/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import { BillingError, REFUND_POLICY, type PaymentRecord } from '../billing/billing-service.js';
import { getPlanItem } from '../telegram/bot.js';
import { planPriceUsd } from '../services/pricing.js';
import type { InvoiceStore } from '../store/invoice-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { STARS_PLANS, planTitle, type TelegramBotService } from '../telegram/bot.js';
import { isTelegramAccountEmail } from '../telegram/auth-requests.js';
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
 * API кабинета в Telegram (`/api/telegram/miniapp/*`). Личность подтверждается подписью initData;
 * после этого выдаётся обычный токен сессии сайта, остальные запросы идут с ним.
 */
export function createMiniAppRouter({ botService, userStore, subscriptionStore, invoiceStore }: MiniAppRouterDeps): Router {
  const router = Router();
  const billing = botService.billing;
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

  const fail = (response: Response, error: unknown) => {
    if (error instanceof BillingError) {
      sendError(response, error.status, error.code, error.message);
      return;
    }
    throw error;
  };

  const paymentView = (payment: PaymentRecord) => {
    const option = billing.refundOption(payment);
    return {
      id: payment.id,
      method: payment.method,
      planId: payment.planId,
      planTitle: planTitle(payment.planId),
      amount: payment.amount,
      currency: payment.currency,
      paidAt: payment.paidAt,
      status: payment.status,
      recurring: Boolean(payment.recurring),
      periodEnd: payment.after.renewsAt,
      bonusDays: payment.bonusDays,
      chargeId: payment.chargeId ?? null,
      refund: payment.refund ?? null,
      refundOption: option.kind === 'none' ? { kind: 'none', reason: option.reason } : { kind: option.kind },
    };
  };

  const stateOf = (user: User) => {
    const subscription = subscriptionStore.get(user.id);
    const rate = botService.rateService.rate;
    const auto = billing.starsSubscriptionOf(user.id);
    return {
      user: {
        id: user.id,
        email: isTelegramAccountEmail(user.email) ? null : user.email,
        name: user.name,
        plan: user.plan,
        isVip: Boolean(user.isVip),
        isAdmin: Boolean(user.isAdmin),
        createdAt: user.createdAt,
        telegramUsername: user.telegramUsername ?? null,
        /** Аккаунт создан через Telegram: войти можно только через него. */
        telegramOnly: isTelegramAccountEmail(user.email),
      },
      subscription,
      autoRenew: auto
        ? { planId: auto.planId, status: auto.status, stars: auto.stars, nextChargeAt: auto.nextChargeAt }
        : null,
      plans: STARS_PLANS.map((planId) => {
        const priceUsd = planPriceUsd(planId);
        const preview = billing.preview(user.id, planId);
        return {
          id: planId,
          title: planTitle(planId),
          priceUsd,
          stars: botService.rateService.quote(priceUsd),
          highlight: getPlanItem(planId)?.modelsHighlight ?? '',
          bullets: getPlanItem(planId)?.bullets.ru ?? [],
          preview,
        };
      }),
      rate,
      payments: billing.paymentsOf(user.id).map(paymentView),
      prefs: billing.prefsOf(user.id),
      refundPolicy: {
        autoHours: Math.round(REFUND_POLICY.autoWindowMs / 3600_000),
        autoMaxRequests: REFUND_POLICY.autoMaxRequests,
        requestDays: Math.round(REFUND_POLICY.requestWindowMs / 86_400_000),
      },
      pendingRefunds: user.isAdmin ? billing.pendingRefunds().length : 0,
      siteUrl: botService.siteUrl,
      botUsername: botService.botUsername,
    };
  };

  const session = (user: User) => {
    const { token, expiresAt } = createMockToken(user);
    return { linked: true as const, token, expiresAt, ...stateOf(user) };
  };

  const currentUser = (request: Request, response: Response): User | null => {
    const user = userStore.findById(request.user!.id);
    if (!user) sendError(response, 404, 'user_not_found', 'Аккаунт не найден');
    return user;
  };

  // ───────────── вход и привязка ─────────────

  router.post('/telegram/miniapp/session', (request: Request, response: Response) => {
    const tgUser = telegramUserOf(request, response);
    if (!tgUser) return;
    const user = userStore.findByTelegramChatId(tgUser.id);
    if (!user) {
      response.json({
        linked: false,
        telegram: { firstName: tgUser.first_name, username: tgUser.username ?? null },
        siteUrl: botService.siteUrl,
      });
      return;
    }
    response.json(session(user));
  });

  /** «Продолжить с Telegram»: аккаунт создаётся в одно касание. */
  router.post('/telegram/miniapp/register', (request: Request, response: Response) => {
    const tgUser = telegramUserOf(request, response);
    if (!tgUser) return;
    const user = botService.createTelegramAccount(tgUser);
    response.json(session(user));
  });

  /** Вход по почте и паролю: существующий аккаунт привязывается к этому Telegram. */
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

  /** Код для ввода на сайте — для тех, кто входит туда через Google или GitHub. */
  router.post('/telegram/miniapp/link-code', (request: Request, response: Response) => {
    const tgUser = telegramUserOf(request, response);
    if (!tgUser) return;
    response.json(botService.authRequests.issueClaimCode(tgUser.id, tgUser.username));
  });

  // ───────────── кабинет ─────────────

  router.get('/telegram/miniapp/state', requireAuth, (request: Request, response: Response) => {
    const user = currentUser(request, response);
    if (user) response.json(stateOf(user));
  });

  /** Счёт в звёздах: на 30 дней или подписка с автопродлением. */
  router.post('/telegram/miniapp/invoice', requireAuth, async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as { planId?: unknown; recurring?: unknown };
    if (typeof body.planId !== 'string' || !(STARS_PLANS as readonly string[]).includes(body.planId)) {
      sendError(response, 400, 'invalid_plan', 'Выберите тариф Plus, Pro или Ultra');
      return;
    }
    const recurring = body.recurring === true;
    const invoice = botService.createStarsInvoice(request.user!.id, body.planId as PlanId);
    const link = await botService.createInvoiceLink(invoice, recurring);
    if (!link) {
      sendError(response, 502, 'telegram_unavailable', 'Telegram не выставил счёт. Попробуйте ещё раз.');
      return;
    }
    response.json({ invoiceId: invoice.id, stars: invoice.starsAmount, link, recurring });
  });

  router.get('/telegram/miniapp/invoice/:id', requireAuth, (request: Request, response: Response) => {
    const invoice = invoiceStore.getTelegramStarsInvoice(String(request.params.id));
    if (!invoice || invoice.userId !== request.user!.id) {
      sendError(response, 404, 'invoice_not_found', 'Счёт не найден');
      return;
    }
    response.json({ status: invoice.status });
  });

  router.post('/telegram/miniapp/auto-renew', requireAuth, async (request: Request, response: Response) => {
    const enabled = (request.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== 'boolean') {
      sendError(response, 400, 'invalid_request', 'Укажите enabled: true или false');
      return;
    }
    try {
      await billing.setAutoRenew(request.user!.id, enabled);
      const user = currentUser(request, response);
      if (user) response.json(stateOf(user));
    } catch (error) {
      fail(response, error);
    }
  });

  router.post('/telegram/miniapp/payments/:id/refund', requireAuth, async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as { reason?: unknown; comment?: unknown };
    try {
      const result = await billing.requestRefund(request.user!.id, String(request.params.id), {
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        comment: typeof body.comment === 'string' ? body.comment : undefined,
      });
      const user = currentUser(request, response);
      if (user) response.json({ outcome: result.outcome, ...stateOf(user) });
    } catch (error) {
      fail(response, error);
    }
  });

  router.post('/telegram/miniapp/prefs', requireAuth, (request: Request, response: Response) => {
    const body = (request.body ?? {}) as { reminders?: unknown; receipts?: unknown };
    billing.setPrefs(request.user!.id, {
      ...(typeof body.reminders === 'boolean' ? { reminders: body.reminders } : {}),
      ...(typeof body.receipts === 'boolean' ? { receipts: body.receipts } : {}),
    });
    const user = currentUser(request, response);
    if (user) response.json(stateOf(user));
  });

  /** Одноразовая ссылка: открывает сайт уже войдя в этот аккаунт. */
  router.post('/telegram/miniapp/site-login', requireAuth, (request: Request, response: Response) => {
    const next = (request.body as { next?: unknown } | undefined)?.next;
    const path = typeof next === 'string' && /^\/[a-z0-9/_-]*$/i.test(next) ? next : '/chat';
    const token = botService.authRequests.issueMagic(request.user!.id);
    response.json({ url: `${botService.siteUrl}/auth/telegram?t=${token}&next=${encodeURIComponent(path)}` });
  });

  router.post('/telegram/miniapp/unlink', requireAuth, (request: Request, response: Response) => {
    const user = currentUser(request, response);
    if (!user) return;
    if (isTelegramAccountEmail(user.email)) {
      sendError(response, 409, 'telegram_only_account', 'Этот аккаунт создан через Telegram — без него в аккаунт не войти.');
      return;
    }
    userStore.unlinkTelegram(user.id);
    response.json({ ok: true });
  });

  // ───────────── администратор: заявки на возврат ─────────────

  const requireAdmin = (request: Request, response: Response): boolean => {
    const user = userStore.findById(request.user!.id);
    if (!user?.isAdmin) {
      sendError(response, 403, 'admin_access_denied', 'Требуются права администратора');
      return false;
    }
    return true;
  };

  router.get('/telegram/miniapp/admin/refunds', requireAuth, (request: Request, response: Response) => {
    if (!requireAdmin(request, response)) return;
    response.json({
      refunds: billing.pendingRefunds().map((payment) => {
        const owner = userStore.findById(payment.userId);
        return {
          ...paymentView(payment),
          customer: owner
            ? { name: owner.name, email: isTelegramAccountEmail(owner.email) ? null : owner.email, telegramUsername: owner.telegramUsername ?? null }
            : null,
        };
      }),
    });
  });

  router.post('/telegram/miniapp/admin/refunds/:id', requireAuth, async (request: Request, response: Response) => {
    if (!requireAdmin(request, response)) return;
    const body = (request.body ?? {}) as { approve?: unknown; note?: unknown };
    if (typeof body.approve !== 'boolean') {
      sendError(response, 400, 'invalid_request', 'Укажите approve: true или false');
      return;
    }
    try {
      const payment = await billing.decideRefund(
        String(request.params.id),
        body.approve,
        typeof body.note === 'string' ? body.note.slice(0, 300) : undefined,
      );
      response.json({ payment: paymentView(payment) });
    } catch (error) {
      fail(response, error);
    }
  });

  return router;
}
