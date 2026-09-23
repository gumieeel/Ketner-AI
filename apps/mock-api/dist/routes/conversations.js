import { Router } from 'express';
import { sendError } from '../middleware/errors.js';
/**
 * Диалоги пользователя: список, создание, чтение, переименование, удаление.
 *
 * Пользователь пока один (заглушка): реальные аккаунты и проверка владельца
 * появятся на этапе 3, см. docs/auth-integration-todo.md.
 */
export function createConversationsRouter(store, defaultUserId) {
    const router = Router();
    const getUserId = (request) => request.userId ?? defaultUserId;
    router.get('/conversations', (request, response) => {
        const userId = getUserId(request);
        response.json({ conversations: store.list(userId) });
    });
    router.post('/conversations', (request, response) => {
        const userId = getUserId(request);
        const title = typeof request.body?.title === 'string' ? request.body.title : '';
        response.status(201).json({ conversation: store.create(userId, title) });
    });
    router.get('/conversations/:id', (request, response) => {
        const userId = getUserId(request);
        const found = store.get(userId, request.params.id);
        if (!found) {
            sendError(response, 404, 'conversation_not_found', `Диалог ${request.params.id} не найден`);
            return;
        }
        response.json(found);
    });
    router.patch('/conversations/:id', (request, response) => {
        const userId = getUserId(request);
        const rawTitle = request.body?.title;
        const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
        if (!title) {
            sendError(response, 400, 'invalid_request', 'Поле title обязательно');
            return;
        }
        const conversation = store.rename(userId, request.params.id, title);
        if (!conversation) {
            sendError(response, 404, 'conversation_not_found', `Диалог ${request.params.id} не найден`);
            return;
        }
        response.json({ conversation });
    });
    router.delete('/conversations/:id', (request, response) => {
        const userId = getUserId(request);
        if (!store.remove(userId, request.params.id)) {
            sendError(response, 404, 'conversation_not_found', `Диалог ${request.params.id} не найден`);
            return;
        }
        response.status(204).end();
    });
    return router;
}
