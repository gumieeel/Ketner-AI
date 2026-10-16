import { randomUUID } from 'node:crypto';
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
import {
  STARS_PLANS,
  planStars,
  planTitle,
  paymentTitle,
  type TelegramBotService,
} from '../telegram/bot.js';
import { isTelegramAccountEmail } from '../telegram/auth-requests.js';
import { validateInitData, type TelegramWebAppUser } from '../telegram/webapp-auth.js';
import { EmailLinkCodes, EMAIL_CODE_TTL_MS } from '../telegram/email-link-codes.js';
import { RateLimiter, clientIp } from '../middleware/rate-limit.js';
import { mailer as defaultMailer, type Mailer } from '../services/mailer.js';
import type { PlanId, User } from '../types.js';

export interface MiniAppRouterDeps {
  botService: TelegramBotService;
  userStore: UserStore;
  subscriptionStore: SubscriptionStore;
  invoiceStore: InvoiceStore;
  /** Письма с кодом привязки; в тестах — перехватчик. */
  mailer?: Mailer;
  emailCodes?: EmailLinkCodes;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Экранирование для HTML-версии письма. */
function escapeMailHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Кто в Telegram запросил код: показывается в письме, чтобы владелец почты узнал чужой запрос. */
function telegramLabel(user: TelegramWebAppUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return user.username ? `@${user.username}${name ? ` (${name})` : ''}` : name || `id ${user.id}`;
}

function linkCodeMail(to: string, code: string, requester: string) {
  const minutes = Math.round(EMAIL_CODE_TTL_MS / 60_000);
  const text = [
    `Код для привязки Telegram к аккаунту Ketner AI: ${code}`,
    '',
    `Код запросили в боте Ketner AI из Telegram ${requester}. Введите его там же — Telegram`,
    `подключится к вашему аккаунту. Код действует ${minutes} минут.`,
    '',
    'Никому не сообщайте этот код: с ним чужой Telegram получит доступ к вашей подписке.',
    'Сотрудники Ketner никогда его не спрашивают.',
    '',
    'Если вы ничего не запрашивали, просто проигнорируйте письмо — без кода ничего не изменится.',
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1b1f1d">
<p>Код для привязки Telegram к аккаунту Ketner AI:</p>
<p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
<p>Код запросили в боте Ketner AI из Telegram <b>${escapeMailHtml(requester)}</b>. Введите его там же — Telegram подключится к вашему аккаунту. Код действует ${minutes} минут.</p>
<p><b>Никому не сообщайте этот код</b>: с ним чужой Telegram получит доступ к вашей подписке. Сотрудники Ketner никогда его не спрашивают.</p>
<p style="color:#5d6762">Если вы ничего не запрашивали, просто проигнорируйте письмо — без кода ничего не изменится.</p>
</div>`;
  return { to, subject: `${code} — код привязки Telegram к Ketner AI`, text, html };
}

function linkedNoticeMail(to: string, requester: string) {
  const text = [
    `К вашему аккаунту Ketner AI привязан Telegram ${requester}.`,
    '',
    'Если это сделали не вы, откройте ketner.org → Настройки → Telegram и нажмите «Отвязать»,',
    'а затем смените пароль.',
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1b1f1d">
<p>К вашему аккаунту Ketner AI привязан Telegram <b>${escapeMailHtml(requester)}</b>.</p>
<p style="color:#5d6762">Если это сделали не вы, откройте ketner.org → Настройки → Telegram и нажмите «Отвязать», а затем смените пароль.</p>
</div>`;
  return { to, subject: 'К аккаунту Ketner AI привязан Telegram', text, html };
}

/** Попытки входа по паролю из мини-приложения: не больше 5 за 10 минут на один Telegram. */
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LIMIT = 5;

/**
 * API кабинета в Telegram (`/api/telegram/miniapp/*`). Личность подтверждается подписью initData;
 * после этого выдаётся обычный токен сессии сайта, остальные запросы идут с ним.
 */
export function createMiniAppRouter({
  botService,
  userStore,
  subscriptionStore,
  invoiceStore,
  mailer = defaultMailer,
  emailCodes = new EmailLinkCodes(),
}: MiniAppRouterDeps): Router {
  const router = Router();
  // Письма с кодом: не чаще 5 в час на одну почту и 20 в час с одного адреса — почтовый ящик
  // нельзя завалить кодами, а сам код не подобрать (5 попыток на код).
  const codeMailsPerEmail = new RateLimiter(60 * 60 * 1000, 5);
  const codeMailsPerIp = new RateLimiter(60 * 60 * 1000, 20);
  const billing = botService.billing;
  const loginAttempts = new Map<number, number[]>();

  const telegramUserOf = (request: Request, response: Response): TelegramWebAppUser | null => {
    const initData = (request.body as { initData?: unknown } | undefined)?.initData;
    if (!botService.isConfigured) {
      sendError(response, 503, 'telegram_unavailable', 'Бот Telegram на сервере не настроен');
      return null;
    }
    const verified =
      typeof initData === 'string' ? validateInitData(initData, botService.botToken) : null;
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
      planTitle: paymentTitle(payment),
      ...(payment.packId ? { packId: payment.packId } : {}),
      amount: payment.amount,
      currency: payment.currency,
      paidAt: payment.paidAt,
      status: payment.status,
      recurring: Boolean(payment.recurring),
      periodEnd: payment.after.renewsAt,
      bonusDays: payment.bonusDays,
      chargeId: payment.chargeId ?? null,
      refund: payment.refund ?? null,
      refundOption:
        option.kind === 'none' ? { kind: 'none', reason: option.reason } : { kind: option.kind },
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
        ? {
            planId: auto.planId,
            status: auto.status,
            stars: auto.stars,
            nextChargeAt: auto.nextChargeAt,
          }
        : null,
      plans: STARS_PLANS.map((planId) => {
        const priceUsd = planPriceUsd(planId);
        const preview = billing.preview(user.id, planId);
        // Та же цена, что в счёте: по официальному курсу, но не ниже точки безубыточности.
        const stars = planStars(planId, botService.rateService);
        return {
          id: planId,
          title: planTitle(planId),
          priceUsd,
          stars,
          /** Сколько эти звёзды стоят по официальному курсу Telegram. */
          starsUsd: botService.rateService.toUsd(stars),
          highlight: getPlanItem(planId)?.modelsHighlight ?? '',
          bullets: getPlanItem(planId)?.bullets.ru ?? [],
          preview,
        };
      }),
      rate,
      payments: billing.paymentsOf(user.id).map(paymentView),
      prefs: billing.prefsOf(user.id),
      refundPolicy: { hours: Math.round(REFUND_POLICY.windowMs / 3600_000) },
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

  /**
   * Привязка по коду из письма, шаг 1: человек вводит почту своего аккаунта, на неё уходит код.
   * Аккаунты в Telegram больше не создаются: регистрация — только на сайте.
   * Ответ одинаковый, есть аккаунт с такой почтой или нет, — так нельзя перебирать чужие адреса.
   */
  router.post('/telegram/miniapp/email-code', async (request: Request, response: Response) => {
    const tgUser = telegramUserOf(request, response);
    if (!tgUser) return;
    const raw = (request.body as { email?: unknown } | undefined)?.email;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 320) : '';
    if (!EMAIL_PATTERN.test(email)) {
      sendError(
        response,
        400,
        'invalid_email',
        'Введите почту, с которой вы входите на ketner.org',
      );
      return;
    }
    if (mailer.kind === 'none') {
      sendError(
        response,
        503,
        'mail_unavailable',
        'Отправка писем пока не настроена. Привяжите аккаунт по паролю или кодом на сайте.',
      );
      return;
    }
    const waitMs = emailCodes.resendIn(tgUser.id);
    if (waitMs > 0) {
      response.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
      sendError(
        response,
        429,
        'too_many_requests',
        `Новый код можно запросить через ${Math.ceil(waitMs / 1000)} с.`,
      );
      return;
    }
    if (codeMailsPerIp.hit(clientIp(request)) || codeMailsPerEmail.hit(email)) {
      sendError(
        response,
        429,
        'too_many_requests',
        'Слишком много писем с кодом. Попробуйте через час.',
      );
      return;
    }

    const user = userStore.findByEmail(email);
    if (user && !isTelegramAccountEmail(user.email)) {
      const { code } = emailCodes.issue(tgUser.id, user.id);
      try {
        await mailer.send(linkCodeMail(user.email, code, telegramLabel(tgUser)));
      } catch (error) {
        console.error('[miniapp] Письмо с кодом не отправлено:', error);
        sendError(
          response,
          502,
          'mail_failed',
          'Не получилось отправить письмо. Попробуйте ещё раз через минуту.',
        );
        return;
      }
    }
    response.json({
      sent: true,
      expiresAt: Date.now() + EMAIL_CODE_TTL_MS,
      resendAfterSec: Math.round(emailCodes.resendIn(tgUser.id) / 1000) || 60,
    });
  });

  /** Привязка по коду из письма, шаг 2: верный код привязывает этот Telegram к аккаунту. */
  router.post('/telegram/miniapp/email-verify', async (request: Request, response: Response) => {
    const tgUser = telegramUserOf(request, response);
    if (!tgUser) return;
    const raw = (request.body as { code?: unknown } | undefined)?.code;
    const result = emailCodes.check(tgUser.id, typeof raw === 'string' ? raw : '');
    if (!result.ok) {
      const messages = {
        missing: 'Сначала запросите код: введите почту аккаунта.',
        expired: 'Код устарел. Запросите новый.',
        invalid: 'Код не подошёл. Проверьте цифры из письма.',
        attempts: 'Слишком много неверных попыток. Запросите новый код.',
      } as const;
      sendError(response, 400, `code_${result.reason}`, messages[result.reason]);
      return;
    }
    const user = userStore.findById(result.userId);
    if (!user) {
      sendError(response, 404, 'user_not_found', 'Аккаунт не найден');
      return;
    }
    const previous = userStore.findByTelegramChatId(tgUser.id);
    if (previous && previous.id !== user.id && isTelegramAccountEmail(previous.email)) {
      sendError(
        response,
        409,
        'telegram_in_use',
        'Этот Telegram уже открывает отдельный аккаунт, созданный в Telegram. Его подписка осталась там.',
      );
      return;
    }
    const linked = botService.linkTelegram(user.id, tgUser.id, tgUser.username) ?? user;
    // Владелец почты узнаёт о привязке: если код выманили, он сразу отвяжет чужой Telegram.
    void mailer
      .send(linkedNoticeMail(user.email, telegramLabel(tgUser)))
      .catch((error: unknown) =>
        console.error('[miniapp] Уведомление о привязке не отправлено:', error),
      );
    response.json(session(linked));
  });

  /** Вход по почте и паролю: существующий аккаунт привязывается к этому Telegram. */
  router.post('/telegram/miniapp/link', (request: Request, response: Response) => {
    const tgUser = telegramUserOf(request, response);
    if (!tgUser) return;
    const now = Date.now();
    const attempts = (loginAttempts.get(tgUser.id) ?? []).filter(
      (at) => now - at < LOGIN_WINDOW_MS,
    );
    if (attempts.length >= LOGIN_LIMIT) {
      sendError(
        response,
        429,
        'rate_limited',
        'Слишком много попыток. Попробуйте через несколько минут.',
      );
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
  router.post(
    '/telegram/miniapp/invoice',
    requireAuth,
    async (request: Request, response: Response) => {
      const body = (request.body ?? {}) as { planId?: unknown; recurring?: unknown };
      if (
        typeof body.planId !== 'string' ||
        !(STARS_PLANS as readonly string[]).includes(body.planId)
      ) {
        sendError(response, 400, 'invalid_plan', 'Выберите тариф Plus, Pro или Ultra');
        return;
      }
      const recurring = body.recurring === true;
      // TEMP: тариф Pro выдаётся сразу, без счёта и оплаты в Telegram (TG_FREE_PRO=off отключает).
      if (process.env.TG_FREE_PRO !== 'off' && body.planId === 'pro' && !recurring) {
        const freeId = `free:${randomUUID()}`;
        billing.grant(
          request.user!.id,
          'pro',
          { id: freeId, method: 'stars', amount: 0, currency: 'XTR', invoiceId: freeId },
          Date.now(),
        );
        response.json({ invoiceId: freeId, stars: 0, link: '', recurring: false, free: true });
        return;
      }
      const invoice = botService.createStarsInvoice(request.user!.id, body.planId as PlanId);
      const link = await botService.createInvoiceLink(invoice, recurring);
      if (!link) {
        sendError(
          response,
          502,
          'telegram_unavailable',
          'Telegram не выставил счёт. Попробуйте ещё раз.',
        );
        return;
      }
      response.json({ invoiceId: invoice.id, stars: invoice.starsAmount, link, recurring });
    },
  );

  router.get(
    '/telegram/miniapp/invoice/:id',
    requireAuth,
    (request: Request, response: Response) => {
      const invoice = invoiceStore.getTelegramStarsInvoice(String(request.params.id));
      if (!invoice || invoice.userId !== request.user!.id) {
        sendError(response, 404, 'invoice_not_found', 'Счёт не найден');
        return;
      }
      response.json({ status: invoice.status });
    },
  );

  router.post(
    '/telegram/miniapp/auto-renew',
    requireAuth,
    async (request: Request, response: Response) => {
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
    },
  );

  router.post(
    '/telegram/miniapp/payments/:id/refund',
    requireAuth,
    async (request: Request, response: Response) => {
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
    },
  );

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
  router.post(
    '/telegram/miniapp/site-login',
    requireAuth,
    (request: Request, response: Response) => {
      const next = (request.body as { next?: unknown } | undefined)?.next;
      const path = typeof next === 'string' && /^\/[a-z0-9/_-]*$/i.test(next) ? next : '/chat';
      const token = botService.authRequests.issueMagic(request.user!.id);
      response.json({
        url: `${botService.siteUrl}/auth/telegram?t=${token}&next=${encodeURIComponent(path)}`,
      });
    },
  );

  router.post('/telegram/miniapp/unlink', requireAuth, (request: Request, response: Response) => {
    const user = currentUser(request, response);
    if (!user) return;
    if (isTelegramAccountEmail(user.email)) {
      sendError(
        response,
        409,
        'telegram_only_account',
        'Этот аккаунт создан через Telegram — без него в аккаунт не войти.',
      );
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

  router.get(
    '/telegram/miniapp/admin/refunds',
    requireAuth,
    (request: Request, response: Response) => {
      if (!requireAdmin(request, response)) return;
      response.json({
        refunds: billing.pendingRefunds().map((payment) => {
          const owner = userStore.findById(payment.userId);
          return {
            ...paymentView(payment),
            /** Сколько раз модели ответили клиенту после оплаты: по правилам возврат — только без использования. */
            usedRequests: billing.requestsSince(payment.userId, payment.paidAt),
            customer: owner
              ? {
                  name: owner.name,
                  email: isTelegramAccountEmail(owner.email) ? null : owner.email,
                  telegramUsername: owner.telegramUsername ?? null,
                }
              : null,
          };
        }),
      });
    },
  );

  router.post(
    '/telegram/miniapp/admin/refunds/:id',
    requireAuth,
    async (request: Request, response: Response) => {
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
    },
  );

  return router;
}
