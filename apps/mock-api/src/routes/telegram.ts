import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import {
  STARS_PLANS,
  TelegramBotService,
  encodePayload,
  type TelegramBotDeps,
  type TelegramUpdate,
} from '../telegram/bot.js';
import { createMiniAppRouter } from './telegram-miniapp.js';
import { createTelegramAuthRouter } from './telegram-auth.js';
import {
  TelegramSupportBotService,
  telegramSupportBotService as defaultSupportBotService,
} from '../telegram/support-bot.js';
import { supportStore as defaultSupportStore, type SupportStore } from '../store/index.js';
import { isAdminUser } from '../services/vip.js';
import type { PlanId } from '../types.js';

/** Сравнение секрета из заголовка с ожидаемым за постоянное время. */
function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || expected.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Вебхук принимается только от Telegram: заголовок secret_token обязателен. */
function requireTelegramSecret(expected: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!secretMatches(request.headers['x-telegram-bot-api-secret-token'], expected)) {
      sendError(response, 401, 'invalid_webhook_secret', 'Неверный секрет вебхука');
      return;
    }
    next();
  };
}

/** Отладочные эндпоинты (симуляции) существуют только вне production. */
function devOnly(_request: Request, response: Response, next: NextFunction): void {
  if (!config.enableMockBilling) {
    sendError(response, 404, 'not_found', 'Маршрут не найден');
    return;
  }
  next();
}

/** Данные обращений поддержки — только администраторам. */
function requireAdminUser(request: Request, response: Response, next: NextFunction): void {
  if (!isAdminUser(request.user)) {
    sendError(response, 403, 'admin_access_denied', 'Требуются права администратора');
    return;
  }
  next();
}

export interface TelegramRouterDeps extends TelegramBotDeps {
  botService?: TelegramBotService;
  supportBotService?: TelegramSupportBotService;
  supportStore?: SupportStore;
}

export function createTelegramRouter(deps: TelegramRouterDeps): Router {
  const router = Router();
  const botService = deps.botService ?? new TelegramBotService(deps);
  const supportBot = deps.supportBotService ?? defaultSupportBotService;
  const supportStore = deps.supportStore ?? defaultSupportStore;

  // -------------------------------------------------------------
  // 1. ПЛАТЁЖНЫЙ БОТ (@Robo_kassa_bot)
  // -------------------------------------------------------------

  /**
   * Статус Telegram-бота оплаты.
   */
  router.get('/telegram/status', (_request: Request, response: Response) => {
    response.json({
      configured: botService.isConfigured,
      botUsername: botService.botUsername,
      botUrl: `https://t.me/${botService.botUsername}`,
    });
  });

  /**
   * Официальный Webhook для Telegram Bot API (платежи).
   */
  router.post(
    '/telegram/webhook',
    requireTelegramSecret(config.telegramWebhookSecret),
    async (request: Request, response: Response): Promise<void> => {
      const update = request.body as TelegramUpdate;
      if (!update || typeof update !== 'object') {
        sendError(response, 400, 'invalid_update', 'Некорректное тело обновления Telegram');
        return;
      }

      try {
        const result = await botService.processUpdate(update);
        response.json({ ok: true, result });
      } catch (error) {
        console.error('[Telegram Router] Ошибка обработки webhook:', error);
        response.status(500).json({ ok: false, error: 'Internal webhook error' });
      }
    },
  );

  /**
   * Эмуляция оплаты через Telegram Stars (для локального тестирования и демо без реальных денег).
   */
  router.post(
    '/telegram/simulate-payment',
    devOnly,
    async (request: Request, response: Response): Promise<void> => {
      const rawPlan = String(request.body?.planId || 'plus');
      const planId = (
        (STARS_PLANS as readonly string[]).includes(rawPlan) ? rawPlan : 'plus'
      ) as PlanId;
      const userId = String(request.body?.userId || 'demo-user');
      const invoice = botService.createStarsInvoice(userId, planId);
      const fakeUpdate: TelegramUpdate = {
        update_id: Date.now(),
        message: {
          message_id: Math.floor(Math.random() * 10000),
          chat: { id: 12345678, type: 'private' },
          date: Math.floor(Date.now() / 1000),
          successful_payment: {
            currency: 'XTR',
            total_amount: invoice.starsAmount,
            invoice_payload: encodePayload({
              planId,
              stars: invoice.starsAmount,
              invoiceId: invoice.id,
              userId,
            }),
            telegram_payment_charge_id: `tg_charge_${Date.now()}`,
          },
        },
      };
      const result = await botService.processUpdate(fakeUpdate);
      response.json({
        ok: true,
        result,
        subscription: deps.subscriptionStore.get(userId),
        user: deps.userStore.findById(userId),
      });
    },
  );

  // Вход и привязка через Telegram для сайта.
  router.use(createTelegramAuthRouter({ botService, userStore: deps.userStore }));

  // Мини-приложение Telegram: кабинет подписки.
  router.use(
    createMiniAppRouter({
      botService,
      userStore: deps.userStore,
      subscriptionStore: deps.subscriptionStore,
      invoiceStore: deps.invoiceStore,
    }),
  );

  // -------------------------------------------------------------
  // 2. SUPPORT БОТ (@ketner_support_bot)
  // -------------------------------------------------------------

  /**
   * Статус бота поддержки.
   */
  router.get('/telegram/support/status', (_request: Request, response: Response) => {
    response.json({
      configured: supportBot.isConfigured,
      botUsername: supportBot.botUsername,
      botUrl: `https://t.me/${supportBot.botUsername}`,
      adminConnected: Boolean(supportStore.getAdminChatId()),
      openTickets: supportStore.listOpenTickets().length,
      totalTickets: supportStore.listAllTickets().length,
    });
  });

  /**
   * Официальный Webhook для Telegram Support Bot API.
   */
  router.post(
    '/telegram/support/webhook',
    requireTelegramSecret(config.telegramSupportWebhookSecret),
    async (request: Request, response: Response): Promise<void> => {
      const update = request.body as TelegramUpdate;
      if (!update || typeof update !== 'object') {
        sendError(response, 400, 'invalid_update', 'Некорректное тело обновления Telegram');
        return;
      }

      try {
        const result = await supportBot.processUpdate(update);
        response.json({ ok: true, result });
      } catch (error) {
        console.error('[SupportBot Router] Ошибка обработки webhook:', error);
        response.status(500).json({ ok: false, error: 'Internal support webhook error' });
      }
    },
  );

  /**
   * Список обращений (тикеты).
   */
  router.get(
    '/telegram/support/tickets',
    requireAuth,
    requireAdminUser,
    (_request: Request, response: Response) => {
      response.json({
        openTickets: supportStore.listOpenTickets(),
        allTickets: supportStore.listAllTickets(),
      });
    },
  );

  /**
   * Эмуляция отправки сообщения в поддержку (для тестов).
   */
  router.post(
    '/telegram/support/simulate-message',
    devOnly,
    async (request: Request, response: Response): Promise<void> => {
      const text = (request.body?.text as string) || 'Тестовая жалоба от пользователя';
      const userChatId = Number(request.body?.chatId || 10000001);
      const username = (request.body?.username as string) || 'test_user';

      const fakeUpdate: TelegramUpdate = {
        update_id: Date.now(),
        message: {
          message_id: Math.floor(Math.random() * 10000),
          chat: { id: userChatId, type: 'private' },
          from: {
            id: userChatId,
            is_bot: false,
            first_name: 'Тестовый',
            username,
          },
          date: Math.floor(Date.now() / 1000),
          text,
        },
      };

      const result = await supportBot.processUpdate(fakeUpdate);
      const activeTicket = supportStore.getActiveTicketForUser(userChatId);

      response.json({
        ok: true,
        result,
        ticket: activeTicket,
      });
    },
  );

  return router;
}
