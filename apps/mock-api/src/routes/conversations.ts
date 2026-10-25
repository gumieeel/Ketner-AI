import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import type { ConversationStore } from '../store/conversation-store.js';

/**
 * Диалоги пользователя: список, создание, чтение, переименование, удаление.
 *
 * Каждый диалог принадлежит пользователю сессии. Общий demo-user (анонимный доступ) существует
 * только вне production: в production запрос без сессии получает 401, а не чужие диалоги.
 */
export function createConversationsRouter(
  store: ConversationStore,
  defaultUserId: string,
  allowAnonymous: boolean = config.allowAnonymousChat,
): Router {
  const router = Router();

  router.use('/conversations', (request: Request, response: Response, next: NextFunction) => {
    if (!request.userId && !allowAnonymous) {
      sendError(response, 401, 'unauthorized', 'Сессия не найдена или истекла');
      return;
    }
    next();
  });

  const getUserId = (request: { userId?: string }): string => request.userId ?? defaultUserId;

  router.get('/conversations', (request: Request, response: Response) => {
    const userId = getUserId(request);
    response.json({ conversations: store.list(userId) });
  });

  router.post('/conversations', (request: Request, response: Response) => {
    const userId = getUserId(request);
    const title = typeof request.body?.title === 'string' ? request.body.title : '';
    response.status(201).json({ conversation: store.create(userId, title) });
  });

  const getParamId = (req: Request): string => {
    const raw = req.params.id;
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };

  router.get('/conversations/:id', (request: Request, response: Response) => {
    const userId = getUserId(request);
    const id = getParamId(request);
    const found = store.get(userId, id);
    if (!found) {
      sendError(response, 404, 'conversation_not_found', `Диалог ${id} не найден`);
      return;
    }
    response.json(found);
  });

  router.patch('/conversations/:id', (request: Request, response: Response) => {
    const userId = getUserId(request);
    const id = getParamId(request);
    const rawTitle: unknown = request.body?.title;
    const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
    if (!title) {
      sendError(response, 400, 'invalid_request', 'Поле title обязательно');
      return;
    }

    const conversation = store.rename(userId, id, title);
    if (!conversation) {
      sendError(response, 404, 'conversation_not_found', `Диалог ${id} не найден`);
      return;
    }
    response.json({ conversation });
  });

  router.delete('/conversations/:id', (request: Request, response: Response) => {
    const userId = getUserId(request);
    const id = getParamId(request);
    if (!store.remove(userId, id)) {
      sendError(response, 404, 'conversation_not_found', `Диалог ${id} не найден`);
      return;
    }
    response.status(204).end();
  });

  return router;
}
