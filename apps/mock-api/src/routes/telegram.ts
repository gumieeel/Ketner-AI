import { Router, type Request, type Response } from 'express';
import { sendError } from '../middleware/errors.js';
import { TelegramBotService, type TelegramBotDeps, type TelegramUpdate } from '../telegram/bot.js';
import {
  TelegramSupportBotService,
  telegramSupportBotService as defaultSupportBotService,
} from '../telegram/support-bot.js';
import { supportStore as defaultSupportStore, type SupportStore } from '../store/index.js';
import type { PlanId } from '../types.js';

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
  router.post('/telegram/webhook', async (request: Request, response: Response): Promise<void> => {
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
  });

  /**
   * Эмуляция оплаты через Telegram Stars (для локального тестирования и демо без реальных денег).
   */
  router.post('/telegram/simulate-payment', async (request: Request, response: Response): Promise<void> => {
    const planId = (request.body?.planId || 'plus') as PlanId;
    const userId = (request.body?.userId || 'demo-user') as string;

    const fakeUpdate: TelegramUpdate = {
      update_id: Date.now(),
      message: {
        message_id: Math.floor(Math.random() * 10000),
        chat: { id: 12345678, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        successful_payment: {
          currency: 'XTR',
          total_amount: 550,
          invoice_payload: JSON.stringify({ planId, userId }),
          telegram_payment_charge_id: `tg_charge_${Date.now()}`,
        },
      },
    };

    const result = await botService.processUpdate(fakeUpdate);
    const subscription = deps.subscriptionStore.get(userId);
    const user = deps.userStore.findById(userId);

    response.json({
      ok: true,
      result,
      subscription,
      user,
    });
  });

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
      adminChatId: supportStore.getAdminChatId(),
      openTickets: supportStore.listOpenTickets().length,
      totalTickets: supportStore.listAllTickets().length,
    });
  });

  /**
   * Официальный Webhook для Telegram Support Bot API.
   */
  router.post('/telegram/support/webhook', async (request: Request, response: Response): Promise<void> => {
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
  });

  /**
   * Список обращений (тикеты).
   */
  router.get('/telegram/support/tickets', (_request: Request, response: Response) => {
    response.json({
      openTickets: supportStore.listOpenTickets(),
      allTickets: supportStore.listAllTickets(),
    });
  });

  /**
   * Эмуляция отправки сообщения в поддержку (для тестов).
   */
  router.post('/telegram/support/simulate-message', async (request: Request, response: Response): Promise<void> => {
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
  });

  return router;
}
