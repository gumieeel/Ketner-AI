import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { sendError } from '../middleware/errors.js';
import { RateLimiter, clientIp } from '../middleware/rate-limit.js';
import {
  CONTACT_TOPICS,
  contactStore as defaultStore,
  type ContactMessage,
  type ContactTopic,
} from '../store/contact-store.js';
import type { DocStore } from '../store/doc-store.js';

export interface ContactRouterDeps {
  store?: DocStore<ContactMessage>;
  /** Сообщить администраторам (Telegram); сбой уведомления не отменяет сохранённое обращение. */
  notify?: (message: ContactMessage) => Promise<void>;
  now?: () => number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

/**
 * Форма обратной связи: `POST /api/contact`. Доступна без входа, ограничена по IP и почте.
 * Тема (`topic`): bug — ошибка, idea — идея или запрос функции, payment — оплата, other — другое.
 */
export function createContactRouter(deps: ContactRouterDeps = {}): Router {
  const router = Router();
  const store = deps.store ?? defaultStore;
  const now = deps.now ?? Date.now;
  // Лимит по настоящему адресу клиента (за Cloudflare request.ip — адрес его узла, и все
  // посетители делили бы один лимит) и по почте. RateLimiter сам вычищает старые записи.
  const perIp = new RateLimiter(WINDOW_MS, MAX_PER_WINDOW, now);
  const perEmail = new RateLimiter(WINDOW_MS, MAX_PER_WINDOW, now);

  router.post('/contact', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const topic: ContactTopic = CONTACT_TOPICS.includes(body.topic as ContactTopic)
      ? (body.topic as ContactTopic)
      : 'other';
    // Скрытое поле-ловушка для ботов: люди его не видят и не заполняют.
    if (typeof body.website === 'string' && body.website.trim()) {
      response.status(202).json({ ok: true });
      return;
    }
    if (!name) return sendError(response, 400, 'invalid_request', 'Укажите имя');
    if (!EMAIL_PATTERN.test(email))
      return sendError(response, 400, 'invalid_request', 'Укажите корректную почту для ответа');
    if (message.length < 10)
      return sendError(
        response,
        400,
        'invalid_request',
        'Опишите вопрос подробнее (не менее 10 символов)',
      );
    if (message.length > 4000)
      return sendError(
        response,
        400,
        'invalid_request',
        'Сообщение слишком длинное (не более 4000 символов)',
      );
    if (perIp.hit(clientIp(request)) || perEmail.hit(email)) {
      return sendError(
        response,
        429,
        'too_many_requests',
        'Слишком много обращений. Попробуйте позже или напишите на почту.',
      );
    }

    const record: ContactMessage = {
      id: randomUUID(),
      topic,
      name,
      email,
      message,
      createdAt: new Date(now()).toISOString(),
      ...(request.userId ? { userId: request.userId } : {}),
    };
    store.put(record);
    try {
      await deps.notify?.(record);
    } catch (error) {
      console.error('[contact] Не удалось уведомить администраторов:', error);
    }
    response.status(201).json({ ok: true });
  });

  return router;
}
