/**
 * Публичный API бота для клиентов (docs/AUTOMATION_PLAN.md, этап B) — без входа, за флагом
 * DISCOVERY_ENABLED:
 *
 *   GET  /api/b/:slug                       имя, приветствие, кнопки, статус бота
 *   GET  /api/b/:slug/conversations/:conversationId?visitorId=…  история диалога посетителя
 *   POST /api/b/:slug/messages              `{ visitorId, conversationId?, content }` → ответ бота
 *   POST /api/b/:slug/leads                 `{ visitorId, conversationId?, name, contact, question? }`
 *
 * Посетитель — анонимный id из его браузера (`v_…`); чужой диалог по id не открывается. Ответы
 * бота оплачивает владелец, поэтому запросы ограничены по посетителю и адресу, а у бота есть
 * суточный потолок (builder/bot-service.ts).
 */

import { Router, type Request, type Response } from 'express';
import type { BotService } from '../builder/bot-service.js';
import { botLeadBodySchema, botMessageBodySchema, VISITOR_ID } from '../builder/schemas.js';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { RateLimiter } from '../middleware/rate-limit.js';

export interface BotsRouterDeps {
  bots: () => BotService | null;
  enabled?: boolean;
}

const TEN_MINUTES = 10 * 60_000;

export function createBotsRouter(deps: BotsRouterDeps): Router {
  const router = Router();
  const enabled = deps.enabled ?? config.discoveryEnabled;
  const perVisitor = new RateLimiter(TEN_MINUTES, 20);
  const perAddress = new RateLimiter(TEN_MINUTES, 60);
  const leadsPerAddress = new RateLimiter(60 * 60_000, 5);

  router.use((request, response, next) => {
    if (!enabled) {
      sendError(
        response,
        404,
        'not_found',
        `Эндпоинт ${request.method} ${request.originalUrl} не найден`,
      );
      return;
    }
    next();
  });

  const ready = (response: Response): BotService | null => {
    const value = deps.bots();
    if (!value) sendError(response, 503, 'bot_unavailable', 'Бот временно недоступен.');
    return value;
  };
  const address = (request: Request) => request.ip ?? 'unknown';
  const tooMany = (response: Response) =>
    sendError(
      response,
      429,
      'too_many_requests',
      'Слишком много сообщений подряд. Подождите несколько минут.',
    );

  router.get('/:slug', async (request, response) => {
    const bots = ready(response);
    if (!bots) return;
    const info = await bots.publicInfo(String(request.params.slug).toLowerCase());
    if (!info) {
      sendError(response, 404, 'bot_not_found', 'Бот не найден');
      return;
    }
    response.json({ bot: info });
  });

  router.get('/:slug/conversations/:conversationId', async (request, response) => {
    const bots = ready(response);
    if (!bots) return;
    const visitorId = String(request.query.visitorId ?? '');
    if (!VISITOR_ID.test(visitorId)) {
      sendError(response, 400, 'validation_failed', 'Некорректный посетитель.');
      return;
    }
    const messages = await bots.publicHistory(
      String(request.params.slug).toLowerCase(),
      visitorId,
      String(request.params.conversationId),
    );
    if (!messages) {
      sendError(response, 404, 'not_found', 'Диалог не найден');
      return;
    }
    response.json({ messages });
  });

  router.post('/:slug/messages', async (request, response) => {
    const bots = ready(response);
    if (!bots) return;
    const parsed = botMessageBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendError(response, 400, 'validation_failed', 'Пустое или слишком длинное сообщение.');
      return;
    }
    const slug = String(request.params.slug).toLowerCase();
    if (perVisitor.hit(`${slug}:${parsed.data.visitorId}`) || perAddress.hit(address(request))) {
      tooMany(response);
      return;
    }
    const result = await bots.send(slug, parsed.data);
    if (!result.ok) {
      response
        .status(result.status)
        .json({ error: { code: result.code, message: result.message } });
      return;
    }
    response.json({ conversationId: result.conversationId, message: result.message });
  });

  router.post('/:slug/leads', async (request, response) => {
    const bots = ready(response);
    if (!bots) return;
    const parsed = botLeadBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendError(response, 400, 'validation_failed', 'Укажите имя и телефон или мессенджер.');
      return;
    }
    if (leadsPerAddress.hit(address(request))) {
      tooMany(response);
      return;
    }
    const result = await bots.createLead(String(request.params.slug).toLowerCase(), parsed.data);
    if (!result.ok) {
      response
        .status(result.status)
        .json({ error: { code: result.code, message: result.message } });
      return;
    }
    response.status(201).json({ ok: true });
  });

  return router;
}
