import { Router, type Request, type Response } from 'express';
import { sendError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { planRank } from '../services/entitlement.js';
import {
  ApiKeyLimitError,
  ApiKeyNameError,
  type ApiKeyStore,
} from '../store/api-key-store.js';

export interface ApiKeysRouterDeps {
  apiKeyStore: ApiKeyStore;
}

/**
 * Управление API-ключами для программирования (CLI `ketner`, IDE). Авторизация сессией сайта:
 * сам API-ключ ключами управлять не может.
 */
export function createApiKeysRouter({ apiKeyStore }: ApiKeysRouterDeps): Router {
  const router = Router();

  router.get('/keys', requireAuth, (request: Request, response: Response) => {
    response.json({ keys: apiKeyStore.list(request.user!.id) });
  });

  router.post('/keys', requireAuth, (request: Request, response: Response) => {
    const user = request.user!;
    if (planRank(user.plan) < planRank('plus')) {
      sendError(
        response,
        403,
        'upgrade_required',
        'API-ключи доступны с тарифа Plus. Повысьте тариф, чтобы подключить CLI и редакторы.',
      );
      return;
    }
    const name = (request.body as { name?: unknown } | undefined)?.name;
    if (typeof name !== 'string') {
      sendError(response, 400, 'invalid_request', 'Поле name обязательно: название ключа, например «MacBook»');
      return;
    }
    try {
      const created = apiKeyStore.create(user.id, name);
      response.status(201).json({ key: created.key, secret: created.secret });
    } catch (error) {
      if (error instanceof ApiKeyNameError) {
        sendError(response, 400, 'invalid_request', error.message);
        return;
      }
      if (error instanceof ApiKeyLimitError) {
        sendError(response, 409, 'key_limit_reached', error.message);
        return;
      }
      throw error;
    }
  });

  router.delete('/keys/:id', requireAuth, (request: Request, response: Response) => {
    const id = String(request.params.id);
    if (!apiKeyStore.revoke(request.user!.id, id)) {
      sendError(response, 404, 'not_found', 'Ключ не найден или уже отозван');
      return;
    }
    response.json({ ok: true });
  });

  return router;
}
