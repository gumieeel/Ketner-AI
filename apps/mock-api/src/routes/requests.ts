/**
 * Заявки на внедрение клиента (после входа):
 *
 *   GET  /api/requests              мои заявки
 *   GET  /api/requests/:id          заявка: предварительная смета (снимок) и, если отправлено,
 *                                   коммерческое предложение
 *   POST /api/requests/:id/cancel   отменить (пока работа не началась)
 *   POST /api/requests/:id/accept   принять отправленное коммерческое предложение
 *
 * Заявка создаётся из анализа: POST /api/analyses/:id/requests. Чужая заявка — 404.
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDiscoveryStores, type DiscoveryStores } from '../discovery/runtime.js';
import { pricingServiceFor } from '../pricing/runtime.js';
import type { PricingService } from '../pricing/service.js';
import { publicRequest } from '../pricing/views.js';

export interface RequestsRouterDeps {
  enabled?: boolean;
  stores?: () => DiscoveryStores | null;
}

export function createRequestsRouter(deps: RequestsRouterDeps = {}): Router {
  const router = Router();
  const enabled = deps.enabled ?? config.discoveryEnabled;
  const stores = deps.stores ?? getDiscoveryStores;

  router.use((request: Request, response: Response, next) => {
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
  router.use(requireAuth);

  const service = (response: Response): PricingService | null => {
    const found = pricingServiceFor(stores());
    if (!found) sendError(response, 503, 'pricing_unavailable', 'Заявки временно недоступны.');
    return found;
  };
  const enabledPrices = async (pricing: PricingService) => (await pricing.active()).config.enabled;

  router.get('/', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const items = await pricing.store.listRequests({ userId: request.user!.id, limit: 100 });
    const shown = await enabledPrices(pricing);
    response.json({ requests: items.map((item) => publicRequest(item, shown)) });
  });

  router.get('/:id', async (request: Request, response: Response) => {
    const pricing = service(response);
    if (!pricing) return;
    const found = await pricing.ownRequest(request.user!.id, String(request.params.id));
    if (!found) {
      sendError(response, 404, 'not_found', 'Заявка не найдена');
      return;
    }
    response.json({ request: publicRequest(found, await enabledPrices(pricing)) });
  });

  for (const action of ['cancel', 'accept'] as const) {
    router.post(`/:id/${action}`, async (request: Request, response: Response) => {
      const pricing = service(response);
      if (!pricing) return;
      const result = await pricing.customerAction(
        request.user!.id,
        String(request.params.id),
        action,
      );
      if (!result.ok) {
        sendError(response, result.status, result.code, result.message);
        return;
      }
      response.json({ request: publicRequest(result.request, await enabledPrices(pricing)) });
    });
  }

  return router;
}
