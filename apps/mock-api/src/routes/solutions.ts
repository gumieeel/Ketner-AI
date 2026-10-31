/**
 * API Builder (этап 6): персональные помощники. Только после входа и при DISCOVERY_ENABLED.
 *
 *   GET    /api/solutions                          помощники пользователя
 *   GET    /api/solutions/draft-quote              цена черновика из возможности
 *   POST   /api/solutions                          пустой помощник `{ name, language }`
 *   POST   /api/solutions/from-opportunity         черновик моделью `{ analysisId, opportunityId, confirm }`
 *   GET    /api/solutions/:id                      настройки, версии, кейсы, прогон, готовность, цена тестов
 *   PUT    /api/solutions/:id/config               сохранить настройки (новая версия, если изменились)
 *   GET    /api/solutions/:id/versions/:number     настройки версии
 *   POST   /api/solutions/:id/versions/:number/restore  вернуть версию (как новую)
 *   POST   /api/solutions/:id/cases                добавить кейс; PUT/DELETE …/cases/:caseId
 *   POST   /api/solutions/:id/test-runs            прогон тестов `{ confirm }`
 *   PATCH  /api/solutions/:id/test-runs/:runId/cases/:caseId  вердикт вручную `{ verdict }`
 *   POST   /api/solutions/:id/activate | pause     включить (только после тестов) | выключить
 *   DELETE /api/solutions/:id
 *   GET|POST /api/solutions/:id/threads            чаты помощника
 *   GET    /api/solutions/:id/threads/:threadId/messages
 *   POST   /api/solutions/:id/threads/:threadId/messages  сообщение → SSE (delta, image, done, error)
 *
 * Чужой помощник — 404.
 */

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { AIGateway } from '../ai/gateway.js';
import { config, type AiConfig } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { RateLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/auth.js';
import { buildAssistantInstructions, isImageRequest } from '../builder/prompt.js';
import {
  assistantConfigBodySchema,
  createSolutionBodySchema,
  draftBodySchema,
  messageBodySchema,
  testCaseBodySchema,
  verdictBodySchema,
} from '../builder/schemas.js';
import { BuilderService, CHAT_HISTORY, type BuilderCaller } from '../builder/service.js';
import type { ChatMessage, Solution, TestRun } from '../builder/types.js';
import { getDiscoveryStores, type DiscoveryStores } from '../discovery/runtime.js';
import { getImageService } from '../images/runtime.js';
import { ImageServiceError, type ImageService } from '../images/service.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import type { CreditService } from '../services/credits.js';
import { CREDITS_PER_USD, EntitlementService } from '../services/entitlement.js';
import { usageStore as defaultUsageStore } from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UsageStore } from '../store/usage-store.js';
import type { UserStore } from '../store/user-store.js';

export interface SolutionsRouterDeps {
  ai: AiConfig;
  userStore?: UserStore;
  subscriptionStore?: SubscriptionStore;
  usageStore?: UsageStore;
  credits?: CreditService;
  gateway?: AIGateway;
  enabled?: boolean;
  stores?: () => DiscoveryStores | null;
  /** Готовый сервис (тесты). */
  service?: BuilderService;
  images?: ImageService;
}

const charged = (usd: number) => Math.round(usd * CREDITS_PER_USD * 10) / 10;

function publicRun(run: TestRun | null) {
  if (!run) return null;
  return {
    id: run.id,
    versionNumber: run.versionNumber,
    status: run.status,
    results: run.results.map(({ costUsd: _cost, creditsUsd, ...item }) => ({
      ...item,
      chargedCredits: charged(creditsUsd),
    })),
    chargedCredits: charged(run.results.reduce((sum, item) => sum + item.creditsUsd, 0)),
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}

function publicSolution(solution: Solution) {
  const { ownerId: _owner, version: _version, ...rest } = solution;
  return rest;
}

function publicMessage(message: ChatMessage) {
  const { ownerId: _owner, ...rest } = message;
  return rest;
}

export function createSolutionsRouter(deps: SolutionsRouterDeps): Router {
  const router = Router();
  const enabled = deps.enabled ?? config.discoveryEnabled;
  const stores = deps.stores ?? getDiscoveryStores;
  const usageStore = deps.usageStore ?? defaultUsageStore;
  const actionLimiter = new RateLimiter(60_000, 10);
  const editLimiter = new RateLimiter(60_000, 60);
  let service: BuilderService | null = deps.service ?? null;
  const gateway =
    deps.gateway ??
    new AIGateway({
      usageStore,
      aiConfig: deps.ai,
      ...(deps.credits ? { credits: deps.credits } : {}),
    });

  const getService = (): BuilderService | null => {
    if (service) return service;
    const ready = stores();
    if (!ready) return null;
    service = new BuilderService({
      store: ready.builder,
      discovery: ready.store,
      gateway,
      balanceUsd: (userId, plan) => deps.credits?.balance(userId, plan).remainingUsd ?? 0,
    });
    return service;
  };
  const images = (): ImageService => deps.images ?? getImageService(usageStore, deps.credits);

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
  router.use(requireAuth);

  const languageOf = (request: Request): 'ru' | 'en' => {
    const fromBody = (request.body as { language?: unknown } | undefined)?.language;
    if (fromBody === 'en' || fromBody === 'ru') return fromBody;
    return String(request.headers['accept-language'] ?? '')
      .toLowerCase()
      .startsWith('en')
      ? 'en'
      : 'ru';
  };

  /** Личность — только из сессии. */
  const callerOf = (request: Request, response: Response): BuilderCaller | null => {
    const sessionUser = request.user;
    if (!sessionUser) {
      sendError(response, 401, 'unauthorized', 'Сессия не найдена или истекла');
      return null;
    }
    const identity = resolveChatIdentity({
      sessionUser,
      storedUser: deps.userStore?.findById(sessionUser.id) ?? null,
      subscription: deps.subscriptionStore?.get(sessionUser.id),
      anonymousUserId: sessionUser.id,
      anonymousPlan: config.demoPlan,
      allowAnonymous: false,
    });
    if (!identity.ok) {
      sendError(response, identity.status, identity.code, identity.message);
      return null;
    }
    return {
      userId: identity.userId,
      plan: EntitlementService.resolveEffectivePlan(identity.plan, identity.email, identity.isVip),
      ...(identity.email ? { email: identity.email } : {}),
      isVip: identity.isVip,
      anonymous: false,
      language: languageOf(request),
    };
  };

  const ready = (response: Response): BuilderService | null => {
    const value = getService();
    if (!value)
      sendError(response, 503, 'builder_unavailable', 'Builder временно недоступен. Чат работает.');
    return value;
  };

  const fail = (
    response: Response,
    error: { status: number; code: string; message: string; details?: Record<string, unknown> },
  ) => {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  };

  const limited = (limiter: RateLimiter, response: Response, userId: string): boolean => {
    if (!limiter.hit(userId)) return false;
    sendError(
      response,
      429,
      'too_many_requests',
      'Слишком много запросов подряд. Подождите минуту.',
    );
    return true;
  };

  /** Обёртка: сервис и вызывающий есть, ошибки — в едином формате. */
  const handle =
    (
      fn: (
        service: BuilderService,
        caller: BuilderCaller,
        request: Request,
        response: Response,
      ) => Promise<void>,
    ) =>
    async (request: Request, response: Response) => {
      const builder = ready(response);
      if (!builder) return;
      const caller = callerOf(request, response);
      if (!caller) return;
      await fn(builder, caller, request, response);
    };

  const sendView = async (
    builder: BuilderService,
    caller: BuilderCaller,
    response: Response,
    id: string,
  ) => {
    const view = await builder.get(caller.userId, id);
    if (!view) {
      sendError(response, 404, 'not_found', 'Помощник не найден');
      return;
    }
    response.json({
      solution: publicSolution(view.solution),
      config: view.config,
      versions: view.versions,
      cases: view.cases.map(({ solutionId: _s, ...item }) => item),
      run: publicRun(view.run),
      readiness: view.readiness,
      testQuote: view.cases.length > 0 ? builder.testQuote(view.config, view.cases) : null,
    });
  };

  router.get(
    '/',
    handle(async (builder, caller, _request, response) => {
      const items = await builder.list(caller.userId);
      response.json({ solutions: items.map(publicSolution) });
    }),
  );

  router.get(
    '/draft-quote',
    handle(async (builder, caller, _request, response) => {
      const { capUsd: _cap, ...quote } = builder.draftQuote(caller.language);
      response.json(quote);
    }),
  );

  router.post(
    '/',
    handle(async (builder, caller, request, response) => {
      const parsed = createSolutionBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'validation_failed', 'Укажите имя помощника (до 80 символов).');
        return;
      }
      if (limited(actionLimiter, response, caller.userId)) return;
      const result = await builder.createBlank(
        { ...caller, language: parsed.data.language },
        parsed.data.name,
      );
      if (!result.ok) return fail(response, result);
      response.status(201).json({ solution: publicSolution(result.solution) });
    }),
  );

  router.post(
    '/from-opportunity',
    handle(async (builder, caller, request, response) => {
      const parsed = draftBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'validation_failed', 'Некорректный запрос.');
        return;
      }
      if (limited(actionLimiter, response, caller.userId)) return;
      const result = await builder.createFromOpportunity(caller, parsed.data);
      if (!result.ok) return fail(response, result);
      response
        .status(result.created ? 201 : 200)
        .json({ solution: publicSolution(result.solution) });
    }),
  );

  router.get(
    '/:id',
    handle(async (builder, caller, request, response) => {
      await sendView(builder, caller, response, String(request.params.id));
    }),
  );

  router.put(
    '/:id/config',
    handle(async (builder, caller, request, response) => {
      const parsed = assistantConfigBodySchema.safeParse(
        (request.body as { config?: unknown } | undefined)?.config ?? {},
      );
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        sendError(
          response,
          400,
          'validation_failed',
          `Проверьте поле ${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`.trim(),
        );
        return;
      }
      if (limited(editLimiter, response, caller.userId)) return;
      const result = await builder.updateConfig(caller, String(request.params.id), parsed.data);
      if (!result.ok) return fail(response, result);
      await sendView(builder, caller, response, String(request.params.id));
    }),
  );

  router.get(
    '/:id/versions/:number',
    handle(async (builder, caller, request, response) => {
      const version = await builder.getVersion(
        caller.userId,
        String(request.params.id),
        Number(request.params.number),
      );
      if (!version) {
        sendError(response, 404, 'not_found', 'Версия не найдена');
        return;
      }
      response.json({
        number: version.number,
        config: version.config,
        createdAt: version.createdAt,
      });
    }),
  );

  router.post(
    '/:id/versions/:number/restore',
    handle(async (builder, caller, request, response) => {
      const result = await builder.restoreVersion(
        caller,
        String(request.params.id),
        Number(request.params.number),
      );
      if (!result.ok) return fail(response, result);
      await sendView(builder, caller, response, String(request.params.id));
    }),
  );

  const saveCase = handle(async (builder, caller, request, response) => {
    const parsed = testCaseBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendError(
        response,
        400,
        'validation_failed',
        'Нужны текст сообщения и хотя бы один критерий.',
      );
      return;
    }
    if (limited(editLimiter, response, caller.userId)) return;
    const caseId = request.params.caseId ? String(request.params.caseId) : undefined;
    const result = await builder.saveCase(caller, String(request.params.id), {
      ...(caseId ? { caseId } : {}),
      ...parsed.data,
    });
    if (!result.ok) return fail(response, result);
    await sendView(builder, caller, response, String(request.params.id));
  });
  router.post('/:id/cases', saveCase);
  router.put('/:id/cases/:caseId', saveCase);

  router.delete(
    '/:id/cases/:caseId',
    handle(async (builder, caller, request, response) => {
      const removed = await builder.deleteCase(
        caller,
        String(request.params.id),
        String(request.params.caseId),
      );
      if (!removed) {
        sendError(response, 404, 'not_found', 'Кейс не найден');
        return;
      }
      await sendView(builder, caller, response, String(request.params.id));
    }),
  );

  router.post(
    '/:id/test-runs',
    handle(async (builder, caller, request, response) => {
      if (limited(actionLimiter, response, caller.userId)) return;
      const confirm = (request.body as { confirm?: unknown } | undefined)?.confirm === true;
      const result = await builder.runTests(caller, String(request.params.id), confirm);
      if (!result.ok) return fail(response, result);
      response.status(202).json({ run: publicRun(result.run) });
    }),
  );

  router.patch(
    '/:id/test-runs/:runId/cases/:caseId',
    handle(async (builder, caller, request, response) => {
      const parsed = verdictBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'validation_failed', 'Ожидается { verdict: pass | fail | null }.');
        return;
      }
      const result = await builder.setVerdict(
        caller,
        String(request.params.id),
        String(request.params.runId),
        String(request.params.caseId),
        parsed.data.verdict,
      );
      if (!result.ok) return fail(response, result);
      await sendView(builder, caller, response, String(request.params.id));
    }),
  );

  router.post(
    '/:id/activate',
    handle(async (builder, caller, request, response) => {
      const result = await builder.activate(caller, String(request.params.id));
      if (!result.ok) return fail(response, result);
      await sendView(builder, caller, response, String(request.params.id));
    }),
  );

  router.post(
    '/:id/pause',
    handle(async (builder, caller, request, response) => {
      const result = await builder.pause(caller, String(request.params.id));
      if (!result.ok) return fail(response, result);
      await sendView(builder, caller, response, String(request.params.id));
    }),
  );

  router.delete(
    '/:id',
    handle(async (builder, caller, request, response) => {
      if (!(await builder.remove(caller, String(request.params.id)))) {
        sendError(response, 404, 'not_found', 'Помощник не найден');
        return;
      }
      response.status(204).end();
    }),
  );

  // ─── Чат помощника ─────────────────────────────────────────────────────────

  const storeOf = () => stores()?.builder ?? null;

  router.get(
    '/:id/threads',
    handle(async (builder, caller, request, response) => {
      const id = String(request.params.id);
      const view = await builder.get(caller.userId, id);
      if (!view) {
        sendError(response, 404, 'not_found', 'Помощник не найден');
        return;
      }
      const threads = (await storeOf()?.listThreads(caller.userId, id)) ?? [];
      response.json({
        threads: threads.map(({ ownerId: _o, ...thread }) => thread),
      });
    }),
  );

  router.post(
    '/:id/threads',
    handle(async (builder, caller, request, response) => {
      const id = String(request.params.id);
      const active = await builder.activeConfig(caller.userId, id);
      if (!active) {
        sendError(
          response,
          409,
          'assistant_not_active',
          caller.language === 'en'
            ? 'The assistant is not on. Test it and turn it on first.'
            : 'Помощник не включён. Сначала проверьте его на тестах и включите.',
        );
        return;
      }
      const iso = new Date().toISOString();
      const thread = {
        id: randomUUID(),
        solutionId: id,
        ownerId: caller.userId,
        title: caller.language === 'en' ? 'New chat' : 'Новый чат',
        createdAt: iso,
        updatedAt: iso,
      };
      await storeOf()?.createThread(thread);
      const { ownerId: _o, ...view } = thread;
      response.status(201).json({ thread: view });
    }),
  );

  router.get(
    '/:id/threads/:threadId/messages',
    handle(async (_builder, caller, request, response) => {
      const thread = await storeOf()?.getThread(caller.userId, String(request.params.threadId));
      if (!thread || thread.solutionId !== String(request.params.id)) {
        sendError(response, 404, 'not_found', 'Чат не найден');
        return;
      }
      const messages = (await storeOf()?.listMessages(caller.userId, thread.id, 200)) ?? [];
      response.json({ messages: messages.map(publicMessage) });
    }),
  );

  router.post(
    '/:id/threads/:threadId/messages',
    handle(async (builder, caller, request, response) => {
      const store = storeOf();
      const parsed = messageBodySchema.safeParse(request.body ?? {});
      if (!parsed.success || !store) {
        sendError(response, 400, 'validation_failed', 'Пустое или слишком длинное сообщение.');
        return;
      }
      const id = String(request.params.id);
      const thread = await store.getThread(caller.userId, String(request.params.threadId));
      if (!thread || thread.solutionId !== id) {
        sendError(response, 404, 'not_found', 'Чат не найден');
        return;
      }
      const active = await builder.activeConfig(caller.userId, id);
      if (!active) {
        sendError(
          response,
          409,
          'assistant_not_active',
          caller.language === 'en' ? 'The assistant is turned off.' : 'Помощник выключен.',
        );
        return;
      }
      const content = parsed.data.content;
      const history = await store.listMessages(caller.userId, thread.id, CHAT_HISTORY);
      const now = () => new Date().toISOString();
      await store.addMessage({
        id: randomUUID(),
        threadId: thread.id,
        ownerId: caller.userId,
        role: 'user',
        content,
        model: null,
        image: null,
        status: 'complete',
        createdAt: now(),
      });
      if (history.length === 0)
        await store.touchThread(caller.userId, thread.id, now(), content.slice(0, 60));

      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      const controller = new AbortController();
      const onClose = () => controller.abort();
      response.on('close', onClose);
      const send = (event: string, payload: unknown) => {
        if (!response.writableEnded)
          response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      const save = async (
        message: Omit<ChatMessage, 'id' | 'threadId' | 'ownerId' | 'role' | 'createdAt'>,
      ) => {
        const saved: ChatMessage = {
          id: randomUUID(),
          threadId: thread.id,
          ownerId: caller.userId,
          role: 'assistant',
          createdAt: now(),
          ...message,
        };
        await store.addMessage(saved);
        await store.touchThread(caller.userId, thread.id, saved.createdAt);
        return saved;
      };

      try {
        // Просьба нарисовать — сервису изображений (у него свои модели, модерация и цена).
        if (isImageRequest(content)) {
          try {
            const result = await images().generate(
              { userId: caller.userId, plan: caller.plan, language: caller.language },
              { prompt: content },
              controller.signal,
            );
            const saved = await save({
              content: caller.language === 'en' ? 'Here is the picture.' : 'Готово — вот картинка.',
              model: { id: result.image.modelId, name: result.image.modelName },
              image: {
                id: result.image.id,
                url: result.image.url,
                downloadUrl: result.image.downloadUrl,
                modelName: result.image.modelName,
              },
              status: 'complete',
            });
            send('done', { message: publicMessage(saved) });
          } catch (error) {
            const message =
              error instanceof ImageServiceError
                ? error.message
                : caller.language === 'en'
                  ? 'Could not draw the picture.'
                  : 'Не удалось нарисовать картинку.';
            const code = error instanceof ImageServiceError ? error.code : 'image_error';
            await save({ content: message, model: null, image: null, status: 'error' });
            send('error', { code, message });
          }
          return;
        }

        const instructions = buildAssistantInstructions(active.config);
        const answer = await builder.answer(
          caller,
          null,
          `builder:chat:${thread.id}`,
          instructions,
          [
            ...history
              .filter((item) => item.status === 'complete')
              .map((item) => ({
                role: item.role,
                content: item.content,
              })),
            { role: 'user' as const, content },
          ],
          { solutionId: id },
          (delta) => send('delta', { content: delta }),
          controller.signal,
        );
        if (answer.error) {
          await save({ content: answer.text, model: answer.model, image: null, status: 'error' });
          send('error', answer.error);
          return;
        }
        const saved = await save({
          content: answer.text,
          model: answer.model,
          image: null,
          status: 'complete',
        });
        send('done', { message: publicMessage(saved), chargedCredits: charged(answer.creditsUsd) });
      } finally {
        response.off('close', onClose);
        response.end();
      }
    }),
  );

  return router;
}
