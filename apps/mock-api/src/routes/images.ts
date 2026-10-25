/**
 * /api/images — генерация картинок (страница «Изображения»).
 * Только для вошедших пользователей: галерея личная, лимиты считаются на аккаунт.
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import { EntitlementService } from '../services/entitlement.js';
import { usageStore as defaultUsageStore, type UsageStore } from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { getImageService } from '../images/runtime.js';
import { ImageServiceError, type ImageCaller, type ImageService } from '../images/service.js';
import type { ImageStore } from '../images/image-store.js';
import { getImageStore } from '../images/runtime.js';
import type { CreditLedger } from '../services/credits.js';

export interface ImagesRouterDeps {
  userId: string;
  userStore?: UserStore;
  subscriptionStore?: SubscriptionStore;
  usageStore?: UsageStore;
  /** Кредиты пользователей; в тестах — свои на каждый сервер. */
  credits?: CreditLedger;
  service?: ImageService;
  store?: ImageStore;
}

export function createImagesRouter(deps: ImagesRouterDeps): Router {
  const router = Router();
  const usageStore = deps.usageStore ?? defaultUsageStore;
  const service = deps.service ?? getImageService(usageStore, deps.credits);
  const store = deps.store ?? getImageStore();

  function identify(request: Request, response: Response): ImageCaller | null {
    const sessionUser = request.user;
    const identity = resolveChatIdentity({
      sessionUser,
      storedUser: sessionUser ? deps.userStore?.findById(sessionUser.id) : undefined,
      subscription: sessionUser ? deps.subscriptionStore?.get(sessionUser.id) : undefined,
      anonymousUserId: deps.userId,
      anonymousPlan: config.demoPlan,
      allowAnonymous: false,
    });
    if (!identity.ok) {
      sendError(response, identity.status, identity.code, identity.message);
      return null;
    }
    const language = request.headers['accept-language']?.toString().toLowerCase().startsWith('en')
      ? 'en'
      : 'ru';
    return {
      userId: identity.userId,
      plan: EntitlementService.resolveEffectivePlan(identity.plan, identity.email, identity.isVip),
      language:
        typeof request.body?.language === 'string'
          ? request.body.language === 'en'
            ? 'en'
            : 'ru'
          : language,
    };
  }

  const guarded =
    (handler: (caller: ImageCaller, request: Request, response: Response) => Promise<void>) =>
    async (request: Request, response: Response): Promise<void> => {
      const caller = identify(request, response);
      if (!caller) return;
      try {
        await handler(caller, request, response);
      } catch (error) {
        if (error instanceof ImageServiceError) {
          sendError(response, error.status, error.code, error.message);
          return;
        }
        console.error('[images] сбой обработчика:', error);
        sendError(response, 500, 'internal_error', 'Внутренняя ошибка сервера');
      }
    };

  // Файл по подписанной ссылке: открывается в <img> и скачивается без заголовка авторизации.
  router.get('/:id/file', async (request: Request, response: Response) => {
    const id = String(request.params.id ?? '');
    const exp = Number(request.query.exp);
    const sig = typeof request.query.sig === 'string' ? request.query.sig : '';
    if (!service.verify(id, exp, sig)) {
      sendError(response, 403, 'forbidden', 'Ссылка недействительна или устарела');
      return;
    }
    const found = await store.getById(id);
    if (!found) {
      sendError(response, 404, 'not_found', 'Картинка не найдена');
      return;
    }
    const ext = found.meta.mime === 'image/png' ? 'png' : 'jpg';
    response.setHeader('Content-Type', found.meta.mime);
    response.setHeader('Cache-Control', 'private, max-age=21600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.query.download === '1') {
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="ketner-${id.slice(0, 8)}.${ext}"`,
      );
    }
    response.end(found.bytes);
  });

  router.get(
    '/capabilities',
    guarded(async (caller, _request, response) => {
      response.json({ plan: caller.plan, ...service.capabilities(caller) });
    }),
  );

  router.get(
    '/',
    guarded(async (caller, _request, response) => {
      response.json({ images: await service.list(caller) });
    }),
  );

  router.post(
    '/generate',
    guarded(async (caller, request, response) => {
      const controller = new AbortController();
      const onClose = (): void => {
        if (!response.writableEnded) controller.abort();
      };
      response.on('close', onClose);
      try {
        const result = await service.generate(caller, request.body ?? {}, controller.signal);
        response.status(201).json(result);
      } finally {
        response.off('close', onClose);
      }
    }),
  );

  router.delete(
    '/:id',
    guarded(async (caller, request, response) => {
      const removed = await store.remove(caller.userId, String(request.params.id ?? ''));
      if (!removed) {
        sendError(response, 404, 'not_found', 'Картинка не найдена');
        return;
      }
      response.status(204).end();
    }),
  );

  return router;
}
