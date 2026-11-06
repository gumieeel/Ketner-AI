/**
 * API анализа задач (платформа решений, этап 2; docs/PRODUCT_ARCHITECTURE.md, раздел 5).
 *
 *   GET  /api/analyses/offer          что доступно сейчас: бесплатный анализ, цены за кредиты
 *   POST /api/analyses                создать анализ (Idempotency-Key — повтор вернёт тот же)
 *   GET  /api/analyses                анализы владельца
 *   GET  /api/analyses/:id            статус, контекст, вопросы, отчёт
 *   PATCH /api/analyses/:id           «Сохранить анализ» (`{ saved }`, только после входа)
 *   DELETE /api/analyses/:id          удалить анализ (не во время этапа)
 *   PUT  /api/analyses/:id/answers    черновик ответов (без вызова модели)
 *   POST /api/analyses/:id/continue   ответы на вопросы и поиск возможностей; после отчёта —
 *                                     повторный поиск, только если ответы изменились (за кредиты)
 *   POST /api/analyses/:id/retry      повторить упавший этап
 *   POST /api/analyses/:id/opportunities/:oppId/plan   план внедрения возможности
 *   GET  /api/analyses/:id/plans/:planId               план
 *   PATCH /api/analyses/:id/plans/:planId/steps/:stepId статус шага `{ status }`
 *   POST /api/analyses/:id/plans/:planId/retry         повторить упавший план
 *
 * Доступно гостю с `X-Guest-Id` (весь анализ и отчёт, решение владельца) и вошедшему пользователю.
 * Чужой анализ — 404. Без включённого DISCOVERY_ENABLED маршрутов нет (404).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { AIGateway } from '../ai/gateway.js';
import { config, type AiConfig } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { readGuestId } from '../middleware/guest.js';
import { RateLimiter, clientIp } from '../middleware/rate-limit.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import { EntitlementService } from '../services/entitlement.js';
import type { CreditService } from '../services/credits.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UsageStore } from '../store/usage-store.js';
import { usageStore as defaultUsageStore } from '../store/index.js';
import type { UserStore } from '../store/user-store.js';
import type { Language } from '../types.js';
import {
  CREATES_PER_MINUTE,
  GUEST_MISSES_PER_MINUTE_PER_IP,
  hashIp,
  isYoungAccount,
} from '../discovery/limits.js';
import { getDiscoveryStores, type DiscoveryStores } from '../discovery/runtime.js';
import {
  answersBodySchema,
  answersDraftBodySchema,
  createAnalysisBodySchema,
  planStepBodySchema,
} from '../discovery/schemas.js';
import { chargedCredits, DiscoveryService, type DiscoveryCaller } from '../discovery/service.js';
import type { Analysis, Opportunity, Plan } from '../discovery/types.js';
import { CREDITS_PER_USD } from '../services/entitlement.js';

export interface AnalysesRouterDeps {
  ai: AiConfig;
  userStore?: UserStore;
  subscriptionStore?: SubscriptionStore;
  usageStore?: UsageStore;
  credits?: CreditService;
  gateway?: AIGateway;
  enabled?: boolean;
  /** Хранилища; по умолчанию — из discovery/runtime.ts. */
  stores?: () => DiscoveryStores | null;
  githubConnected?: (userId: string) => boolean;
  freeDailyUsd?: number;
  budgetTimeZone?: string;
  now?: () => Date;
  /** Готовый сервис (тесты). */
  service?: DiscoveryService;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** Публичный вид анализа: без id владельца, хеша адреса и ключа идемпотентности. */
export function publicAnalysis(analysis: Analysis, opportunities: Opportunity[] = []) {
  const stage = (name: 'context' | 'discovery') => {
    const run = analysis.stages[name];
    if (!run) return null;
    return {
      status: run.status,
      model: run.model ?? null,
      attempts: run.attempts,
      error: run.error ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
    };
  };
  return {
    id: analysis.id,
    status: analysis.status,
    mode: analysis.mode,
    language: analysis.language,
    guest: analysis.guest,
    inputText: analysis.inputText,
    context: analysis.context ? { ...analysis.context, questions: undefined } : null,
    questions: analysis.questions,
    answers: analysis.answers,
    summary: analysis.summary,
    /** Карта анализа: пять областей и что в каждой нашлось (null — анализ не готов или старый). */
    coverage: analysis.coverage ?? null,
    /** Прочитанный сайт: адрес и название, без сохранённого текста страницы. */
    source: analysis.source
      ? analysis.source.ok
        ? { url: analysis.source.url, ok: true, title: analysis.source.title }
        : { url: analysis.source.url, ok: false, reason: analysis.source.reason }
      : null,
    saved: analysis.saved,
    stages: { context: stage('context'), discovery: stage('discovery') },
    opportunities: [...opportunities]
      .sort((a, b) => a.priority - b.priority)
      // У возможностей до этапа A области и рецепта нет — отдаём null, а не пропуск поля.
      .map(({ ownerId: _owner, analysisId: _analysis, ...item }) => ({
        ...item,
        area: item.area ?? null,
        recipe: item.recipe ?? null,
      })),
    cost: {
      /** Списано с кредитов пользователя (0 у бесплатного анализа). */
      chargedCredits: chargedCredits(analysis),
      /** Бесплатный анализ оплатил сервис. */
      sponsored: analysis.mode === 'free',
    },
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  };
}

/** Публичный вид плана: без id владельца и служебных полей запуска. */
export function publicPlan(plan: Plan) {
  return {
    id: plan.id,
    analysisId: plan.analysisId,
    opportunityId: plan.opportunityId,
    opportunityTitle: plan.opportunityTitle,
    kind: plan.kind,
    status: plan.status,
    summary: plan.summary,
    steps: plan.steps,
    risks: plan.risks,
    successCriteria: plan.successCriteria,
    model: plan.run.model ?? null,
    error: plan.run.error ?? null,
    cost: {
      chargedCredits: Math.round(plan.run.creditsUsd * CREDITS_PER_USD * 10) / 10,
      sponsored: plan.sponsored,
    },
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function languageOf(request: Request): Language {
  const fromBody = (request.body as { language?: unknown } | undefined)?.language;
  if (fromBody === 'en' || fromBody === 'ru') return fromBody;
  return String(request.headers['accept-language'] ?? '')
    .toLowerCase()
    .startsWith('en')
    ? 'en'
    : 'ru';
}

export function createAnalysesRouter(deps: AnalysesRouterDeps): Router {
  const router = Router();
  const enabled = deps.enabled ?? config.discoveryEnabled;
  const stores = deps.stores ?? getDiscoveryStores;
  const createLimiter = new RateLimiter(60_000, CREATES_PER_MINUTE);
  const actionLimiter = new RateLimiter(60_000, 20);
  const draftLimiter = new RateLimiter(60_000, 60);
  const guestMissLimiter = new RateLimiter(60_000, GUEST_MISSES_PER_MINUTE_PER_IP);

  /**
   * Перебор чужих гостевых id: промахи гостя (чужой или несуществующий анализ, пустой список)
   * считаются по адресу, и после потолка чтение с этого адреса на минуту закрыто. Обычный гость
   * почти не промахивается, поэтому опрос статуса и общий IP мобильного оператора не страдают.
   * false — ответ 429 уже отправлен.
   */
  const missKey = (caller: DiscoveryCaller) =>
    caller.guest && caller.ipHash ? `miss:${caller.ipHash}` : null;
  const allowGuestRead = (
    request: Request,
    response: Response,
    caller: DiscoveryCaller,
  ): boolean => {
    const key = missKey(caller);
    if (!key || !guestMissLimiter.isLimited(key)) return true;
    response.setHeader('Retry-After', String(guestMissLimiter.retryAfterSec(key)));
    sendError(
      response,
      429,
      'too_many_requests',
      languageOf(request) === 'en'
        ? 'Too many requests. Wait a minute.'
        : 'Слишком много запросов. Подождите минуту.',
    );
    return false;
  };
  const recordGuestMiss = (caller: DiscoveryCaller) => {
    const key = missKey(caller);
    if (key) guestMissLimiter.record(key);
  };
  let service: DiscoveryService | null = deps.service ?? null;

  const gateway =
    deps.gateway ??
    new AIGateway({
      usageStore: deps.usageStore ?? defaultUsageStore,
      aiConfig: deps.ai,
      ...(deps.credits ? { credits: deps.credits } : {}),
    });

  /** Сервис создаётся при первом запросе: хранилища появляются после подключения к базе. */
  const getService = (): DiscoveryService | null => {
    if (service) return service;
    const ready = stores();
    if (!ready) return null;
    service = new DiscoveryService({
      store: ready.store,
      budget: ready.budget,
      gateway,
      balanceUsd: (userId, plan) => deps.credits?.balance(userId, plan).remainingUsd ?? 0,
      userCapabilities: (caller) => ({
        hasPurchasedCredits: !caller.guest && (deps.credits?.hasPurchased(caller.userId) ?? false),
        githubConnected: !caller.guest && (deps.githubConnected?.(caller.userId) ?? false),
      }),
      freeDailyUsd: deps.freeDailyUsd ?? config.discovery.freeDailyUsd,
      budgetTimeZone: deps.budgetTimeZone ?? config.discovery.budgetTimeZone,
      ...(deps.now ? { now: deps.now } : {}),
    });
    return service;
  };

  router.use((request: Request, response: Response, next: NextFunction) => {
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

  /** Личность — только из сессии или гостевого id; поля тела запроса на неё не влияют. */
  const resolveCaller = (
    request: Request,
    response: Response,
  ): { caller: DiscoveryCaller; email: string | null } | null => {
    const sessionUser = request.user;
    const ip = clientIp(request);
    const ipHash = ip ? hashIp(ip, config.betterAuthSecret) : null;
    if (!sessionUser) {
      const guestId = readGuestId(request);
      if (!guestId) {
        sendError(response, 400, 'invalid_guest_id', 'Не передан корректный идентификатор гостя');
        return null;
      }
      return {
        caller: {
          userId: guestId,
          plan: 'free',
          isVip: false,
          anonymous: true,
          guest: true,
          ipHash,
          ipLimited: true,
        },
        email: null,
      };
    }
    const stored = deps.userStore?.findById(sessionUser.id) ?? null;
    const identity = resolveChatIdentity({
      sessionUser,
      storedUser: stored,
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
      caller: {
        userId: identity.userId,
        plan: EntitlementService.resolveEffectivePlan(
          identity.plan,
          identity.email,
          identity.isVip,
        ),
        ...(identity.email ? { email: identity.email } : {}),
        isVip: identity.isVip,
        anonymous: false,
        guest: false,
        ipHash,
        ipLimited: isYoungAccount(stored?.createdAt ?? sessionUser.createdAt, Date.now()),
      },
      email: identity.email ?? null,
    };
  };

  const withService = (response: Response): DiscoveryService | null => {
    const ready = getService();
    if (!ready) {
      sendError(
        response,
        503,
        'discovery_unavailable',
        'Анализ задач временно недоступен. Чат и остальные разделы работают.',
      );
    }
    return ready;
  };

  const sendServiceError = (
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

  router.get('/offer', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    const language = languageOf(request);
    response.json(await ready.offer(resolved.caller, language));
  });

  router.post('/', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    const language = languageOf(request);
    const parsed = createAnalysisBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const tooLong = issue?.message === 'text_too_long';
      const tooShort = issue?.message === 'text_too_short';
      sendError(
        response,
        tooLong ? 413 : 400,
        tooLong ? 'text_too_long' : tooShort ? 'text_too_short' : 'validation_failed',
        tooLong
          ? language === 'en'
            ? 'The description is longer than 8,000 characters.'
            : 'Описание длиннее 8 000 символов.'
          : tooShort
            ? language === 'en'
              ? 'Describe the task in at least a couple of sentences.'
              : 'Опишите задачу хотя бы парой предложений.'
            : language === 'en'
              ? 'Invalid request.'
              : 'Некорректный запрос.',
      );
      return;
    }
    const rawKey = request.headers['idempotency-key'];
    const key = typeof rawKey === 'string' && IDEMPOTENCY_KEY.test(rawKey) ? rawKey : null;
    if (rawKey !== undefined && !key) {
      sendError(
        response,
        400,
        'invalid_idempotency_key',
        'Idempotency-Key: 8–100 символов A-Z, a-z, 0-9, _ и -',
      );
      return;
    }
    const limiterKey = resolved.caller.userId;
    if (createLimiter.hit(limiterKey)) {
      response.setHeader('Retry-After', String(createLimiter.retryAfterSec(limiterKey)));
      sendError(
        response,
        429,
        'too_many_requests',
        parsed.data.language === 'en'
          ? 'Too many analyses in a row. Wait a minute.'
          : 'Слишком много анализов подряд. Подождите минуту.',
      );
      return;
    }
    const result = await ready.create({
      caller: resolved.caller,
      email: resolved.email,
      text: parsed.data.text,
      language: parsed.data.language,
      ...(parsed.data.mode ? { mode: parsed.data.mode } : {}),
      ...(parsed.data.confirm !== undefined ? { confirm: parsed.data.confirm } : {}),
      idempotencyKey: key,
    });
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response
      .status(result.duplicate ? 200 : 202)
      .json({ analysis: publicAnalysis(result.analysis) });
  });

  router.get('/', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (!allowGuestRead(request, response, resolved.caller)) return;
    // Анализы, начатые в этом браузере до входа или регистрации, переходят в аккаунт.
    if (!resolved.caller.guest)
      await ready.claimAllGuest(resolved.caller.userId, readGuestId(request));
    const items = await ready.list(resolved.caller.userId);
    if (items.length === 0) recordGuestMiss(resolved.caller);
    response.json({
      analyses: items.map((item) => ({
        id: item.id,
        status: item.status,
        mode: item.mode,
        title: item.context?.domain ?? item.inputText.slice(0, 80),
        excerpt: item.inputText.slice(0, 160),
        saved: item.saved,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  });

  router.get('/:id', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (!allowGuestRead(request, response, resolved.caller)) return;
    const id = String(request.params.id);
    // Анализ, начатый гостем в этом браузере до входа, переходит в аккаунт.
    if (!resolved.caller.guest)
      await ready.claimGuest(resolved.caller.userId, readGuestId(request), id);
    const found = await ready.get(resolved.caller.userId, id);
    if (!found) {
      recordGuestMiss(resolved.caller);
      sendError(response, 404, 'analysis_not_found', `Анализ ${id} не найден`);
      return;
    }
    response.json({
      analysis: publicAnalysis(found.analysis, found.opportunities),
      // Цена обновления анализа при изменении ответов — до запуска, как у моделей чата.
      rerun:
        found.analysis.status === 'ready' && found.analysis.questions.length > 0
          ? ready.rerunQuote(found.analysis, resolved.caller)
          : null,
      // Цена повтора упавшего этапа.
      retry: ready.retryQuote(found.analysis, resolved.caller),
      // Планы внедрения: что уже составлено и что доступно (бесплатный краткий, цена полного).
      plans:
        found.analysis.status === 'ready'
          ? {
              offer: ready.planOffer(found.analysis, resolved.caller),
              items: (await ready.plansOf(resolved.caller.userId, id)).map((plan) => ({
                id: plan.id,
                opportunityId: plan.opportunityId,
                kind: plan.kind,
                status: plan.status,
              })),
            }
          : null,
    });
  });

  router.patch('/:id', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    const saved = (request.body as { saved?: unknown } | undefined)?.saved;
    if (typeof saved !== 'boolean') {
      sendError(response, 400, 'validation_failed', 'Ожидается { saved: true | false }.');
      return;
    }
    const result = await ready.setSaved(resolved.caller, String(request.params.id), saved);
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response.json({ analysis: publicAnalysis(result.analysis) });
  });

  router.delete('/:id', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (actionLimiter.hit(resolved.caller.userId)) {
      sendError(
        response,
        429,
        'too_many_requests',
        'Слишком много запросов подряд. Подождите минуту.',
      );
      return;
    }
    const result = await ready.remove(resolved.caller, String(request.params.id));
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response.status(204).end();
  });

  router.put('/:id/answers', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    // Черновик сохраняется по мере ввода: лимит выше, чем у действий с моделью.
    if (draftLimiter.hit(resolved.caller.userId)) {
      sendError(
        response,
        429,
        'too_many_requests',
        'Слишком много запросов подряд. Подождите минуту.',
      );
      return;
    }
    const parsed = answersDraftBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendError(response, 400, 'validation_failed', 'Некорректные ответы.');
      return;
    }
    const result = await ready.saveAnswers(
      resolved.caller,
      String(request.params.id),
      parsed.data.answers,
    );
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response.json({ analysis: publicAnalysis(result.analysis) });
  });

  router.post('/:id/continue', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (actionLimiter.hit(resolved.caller.userId)) {
      sendError(
        response,
        429,
        'too_many_requests',
        'Слишком много запросов подряд. Подождите минуту.',
      );
      return;
    }
    const parsed = answersBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendError(response, 400, 'validation_failed', 'Некорректные ответы.');
      return;
    }
    const result = await ready.continue(resolved.caller, String(request.params.id), parsed.data);
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response
      .status(result.rerun ? 202 : 200)
      .json({ analysis: publicAnalysis(result.analysis), rerun: result.rerun });
  });

  router.post('/:id/retry', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (actionLimiter.hit(resolved.caller.userId)) {
      sendError(
        response,
        429,
        'too_many_requests',
        'Слишком много запросов подряд. Подождите минуту.',
      );
      return;
    }
    const confirm = (request.body as { confirm?: unknown } | undefined)?.confirm === true;
    const result = await ready.retry(resolved.caller, String(request.params.id), confirm);
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response.status(202).json({ analysis: publicAnalysis(result.analysis) });
  });

  const limited = (response: Response, userId: string): boolean => {
    if (!actionLimiter.hit(userId)) return false;
    sendError(
      response,
      429,
      'too_many_requests',
      'Слишком много запросов подряд. Подождите минуту.',
    );
    return true;
  };

  router.post('/:id/opportunities/:oppId/plan', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (limited(response, resolved.caller.userId)) return;
    const confirm = (request.body as { confirm?: unknown } | undefined)?.confirm === true;
    const result = await ready.createPlan({
      caller: resolved.caller,
      analysisId: String(request.params.id),
      opportunityId: String(request.params.oppId),
      confirm,
    });
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response.status(result.created ? 202 : 200).json({ plan: publicPlan(result.plan) });
  });

  /** План этого анализа и этого владельца; иначе 404. */
  const ownPlan = async (
    service: DiscoveryService,
    request: Request,
    response: Response,
    userId: string,
  ): Promise<Plan | null> => {
    const plan = await service.getPlan(userId, String(request.params.planId));
    if (!plan || plan.analysisId !== String(request.params.id)) {
      sendError(response, 404, 'plan_not_found', 'План не найден');
      return null;
    }
    return plan;
  };

  router.get('/:id/plans/:planId', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (!resolved.caller.guest)
      await ready.claimGuest(
        resolved.caller.userId,
        readGuestId(request),
        String(request.params.id),
      );
    const plan = await ownPlan(ready, request, response, resolved.caller.userId);
    if (!plan) return;
    response.json({
      plan: publicPlan(plan),
      retry: ready.planRetryQuote(plan, resolved.caller, languageOf(request)),
    });
  });

  router.patch('/:id/plans/:planId/steps/:stepId', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (draftLimiter.hit(resolved.caller.userId)) {
      sendError(
        response,
        429,
        'too_many_requests',
        'Слишком много запросов подряд. Подождите минуту.',
      );
      return;
    }
    const parsed = planStepBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      sendError(
        response,
        400,
        'validation_failed',
        'Ожидается { status: todo | in_progress | done | skipped }.',
      );
      return;
    }
    const plan = await ownPlan(ready, request, response, resolved.caller.userId);
    if (!plan) return;
    const result = await ready.updatePlanStep(
      resolved.caller,
      plan.id,
      String(request.params.stepId),
      parsed.data.status,
    );
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response.json({ plan: publicPlan(result.plan) });
  });

  router.post('/:id/plans/:planId/retry', async (request: Request, response: Response) => {
    const ready = withService(response);
    if (!ready) return;
    const resolved = resolveCaller(request, response);
    if (!resolved) return;
    if (limited(response, resolved.caller.userId)) return;
    const plan = await ownPlan(ready, request, response, resolved.caller.userId);
    if (!plan) return;
    const confirm = (request.body as { confirm?: unknown } | undefined)?.confirm === true;
    const result = await ready.retryPlan(resolved.caller, plan.id, confirm);
    if (!result.ok) {
      sendServiceError(response, result);
      return;
    }
    response.status(202).json({ plan: publicPlan(result.plan) });
  });

  return router;
}
