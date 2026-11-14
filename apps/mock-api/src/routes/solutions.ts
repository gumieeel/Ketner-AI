/**
 * API Builder (этап 6): персональные помощники. Только после входа и при DISCOVERY_ENABLED.
 *
 *   GET    /api/solutions                          помощники пользователя
 *   GET    /api/solutions/draft-quote              цена черновика из возможности
 *   GET    /api/solutions/templates                галерея включённых инструментов
 *   POST   /api/solutions                          пустой помощник `{ name, language }` или инструмент `{ template, name? }`
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
 * Бот для клиентов (тип `customer_bot`, этап B):
 *   GET|PUT /api/solutions/:id/bot                 настройки страницы и расход за сегодня
 *   POST   /api/solutions/:id/bot/preview          проба «как клиент» `{ messages }` (за кредиты)
 *   GET    /api/solutions/:id/conversations        диалоги посетителей; GET …/conversations/:conversationId
 *   GET    /api/solutions/:id/leads                заявки; PATCH …/leads/:leadId `{ status }`
 *
 * Чужой помощник — 404.
 */

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { AIGateway } from '../ai/gateway.js';
import { botPlatformEnabled, config, type AiConfig, type BotPlatformRuntime } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { RateLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/auth.js';
import { buildAssistantInstructions, isImageRequest } from '../builder/prompt.js';
import {
  assistantConfigBodySchema,
  createSolutionBodySchema,
  draftBodySchema,
  botPreviewBodySchema,
  botSettingsBodySchema,
  leadStatusBodySchema,
  messageBodySchema,
  testCaseBodySchema,
  verdictBodySchema,
} from '../builder/schemas.js';
import { BotAgentRuntime } from '../builder/bot-agent.js';
import { AGENT_SPEC_MAX_TIMEOUT_MS } from '../platform/agent-spec.js';
import { startExecutionReaper } from '../platform/execution-reaper.js';
import { PostgresExecutionJournal } from '../platform/journal.js';
import { BotService, type BotOwner } from '../builder/bot-service.js';
import { BuilderService, CHAT_HISTORY, type BuilderCaller } from '../builder/service.js';
import type {
  BotConversation,
  BotLead,
  BotMessage,
  ChatMessage,
  Solution,
  TestRun,
} from '../builder/types.js';
import { galleryTemplates, KIND_BY_TYPE } from '../builder/templates.js';
import {
  answersBodySchema,
  AttemptService,
  createAttemptBodySchema,
  gradeBodySchema,
} from '../builder/tools/attempts.js';
import { MaterialService } from '../builder/tools/material-service.js';
import {
  publicRun as publicToolRun,
  runQuoteBodySchema,
  runStartBodySchema,
  runSummary,
  ToolExecutor,
} from '../builder/tools/executor.js';
import { extractedDocumentSchema } from '../builder/tools/materials.js';
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
import type { Mailer } from '../services/mailer.js';
import { resolveUserPlan } from '../services/user-plan.js';
import { siteUrl } from '../seo/pages.js';

export interface SolutionsRouterDeps {
  /** Флаг пути платформы для ботов (тесты); по умолчанию — config.botPlatformRuntime. */
  botPlatform?: BotPlatformRuntime;
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
  mailer?: Mailer;
  /**
   * Нужна ли подписка «Автоматизации» перед созданием автоматизации из анализа (этап E): `null` —
   * не нужна (подписка действует или не обязательна), иначе — условия для ответа 402.
   */
  subscriptionRequired?: (
    userId: string,
  ) => { priceUsd: number; trialDays: number; monthlyCredits: number; trialCredits: number } | null;
  /** Общие сервисы Builder и ботов (routes/index.ts создаёт один на оба роутера). */
  runtime?: BuilderRuntime;
}

export interface BuilderRuntime {
  builder: () => BuilderService | null;
  bots: () => BotService | null;
  /** Материалы инструментов (учебный помощник). */
  materials: () => MaterialService | null;
  /** Запуски операций инструментов. */
  tools: () => ToolExecutor | null;
  /** Попытки прохождения вопросов и прогресс. */
  attempts: () => AttemptService | null;
}

/**
 * Сервисы создаются при первом запросе: хранилища появляются после подключения к базе. Бот
 * отвечает за кредиты владельца с его действующим тарифом, заявка уходит владельцу письмом.
 */
export function createBuilderRuntime(deps: SolutionsRouterDeps): BuilderRuntime {
  const stores = deps.stores ?? getDiscoveryStores;
  const usageStore = deps.usageStore ?? defaultUsageStore;
  const gateway =
    deps.gateway ??
    new AIGateway({
      usageStore,
      aiConfig: deps.ai,
      ...(deps.credits ? { credits: deps.credits } : {}),
    });
  let builder: BuilderService | null = deps.service ?? null;
  let bots: BotService | null = null;
  const balanceUsd = (userId: string, plan: Parameters<CreditService['balance']>[1]) =>
    deps.credits?.balance(userId, plan).remainingUsd ?? 0;
  const getBuilder = (): BuilderService | null => {
    if (builder) return builder;
    const ready = stores();
    if (!ready) return null;
    builder = new BuilderService({
      store: ready.builder,
      discovery: ready.store,
      gateway,
      balanceUsd,
    });
    return builder;
  };
  const owner = (ownerId: string): BotOwner | null => {
    const user = deps.userStore?.findById(ownerId);
    if (!user || !deps.userStore) return null;
    const resolved = resolveUserPlan(user, deps.userStore, deps.subscriptionStore, deps.credits);
    return {
      userId: user.id,
      plan: EntitlementService.resolveEffectivePlan(resolved.plan, user.email, resolved.isVip),
      ...(user.email ? { email: user.email } : {}),
      isVip: resolved.isVip,
    };
  };
  const getBots = (): BotService | null => {
    if (bots) return bots;
    const ready = stores();
    const service = getBuilder();
    if (!ready || !service) return null;
    const botPlatform = deps.botPlatform ?? config.botPlatformRuntime;
    const journal = ready.journal;
    const platformRuntime =
      journal && botPlatform.mode !== 'off' ? new BotAgentRuntime({ gateway, journal }) : null;
    // Зависшие исполнения (итог не записался) закрывает reaper; порог больше максимального срока
    // прогона AgentSpec (120 с), поэтому идущий прогон он не трогает. Только для журнала в Postgres.
    if (platformRuntime && journal instanceof PostgresExecutionJournal) {
      startExecutionReaper(journal, { maxRunMs: AGENT_SPEC_MAX_TIMEOUT_MS });
    }
    bots = new BotService({
      store: ready.builder,
      builder: service,
      balanceUsd,
      owner,
      ...(platformRuntime
        ? {
            platform: {
              enabled: (solutionId: string) => botPlatformEnabled(botPlatform, solutionId),
              answer: (input: Parameters<BotAgentRuntime['answer']>[0]) =>
                platformRuntime.answer(input),
            },
          }
        : {}),
      ...(deps.mailer
        ? {
            notifyLead: async (target, solution, lead) => {
              if (!target.email) return;
              const link = `${siteUrl()}/solutions/${solution.id}`;
              const lines = [
                `Новая заявка от бота «${solution.name}».`,
                '',
                `Имя: ${lead.name}`,
                `Контакт: ${lead.contact}`,
                ...(lead.question ? [`Вопрос: ${lead.question}`] : []),
                '',
                `Все заявки и диалоги: ${link}`,
              ];
              const escape = (value: string) =>
                value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
              await deps.mailer!.send({
                to: target.email,
                subject: `Новая заявка: ${lead.name.replace(/\s+/g, ' ')}`,
                text: lines.join('\n'),
                html: lines.map((line) => `<p>${escape(line)}</p>`).join(''),
              });
            },
          }
        : {}),
    });
    return bots;
  };
  let materials: MaterialService | null = null;
  const getMaterials = (): MaterialService | null => {
    if (materials) return materials;
    const ready = stores();
    if (!ready) return null;
    materials = new MaterialService({ materials: ready.materials, solutions: ready.builder });
    return materials;
  };
  let tools: ToolExecutor | null = null;
  const getTools = (): ToolExecutor | null => {
    if (tools) return tools;
    const ready = stores();
    if (!ready) return null;
    tools = new ToolExecutor({
      runs: ready.runs,
      materials: ready.materials,
      solutions: ready.builder,
      gateway,
      balanceUsd,
      usage: usageStore,
      attempts: ready.attempts,
    });
    return tools;
  };
  let attempts: AttemptService | null = null;
  const getAttempts = (): AttemptService | null => {
    if (attempts) return attempts;
    const ready = stores();
    const executor = getTools();
    if (!ready || !executor) return null;
    attempts = new AttemptService({ attempts: ready.attempts, runs: ready.runs, executor });
    return attempts;
  };
  return {
    builder: getBuilder,
    bots: getBots,
    materials: getMaterials,
    tools: getTools,
    attempts: getAttempts,
  };
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
  // Вид решения (помощник, инструмент, процесс): по нему сайт выбирает интерфейс.
  return { ...rest, kind: KIND_BY_TYPE[solution.type] };
}

function publicMessage(message: ChatMessage) {
  const { ownerId: _owner, ...rest } = message;
  return rest;
}

function ownerConversation(item: BotConversation) {
  const { ownerId: _owner, visitorId: _visitor, ...rest } = item;
  return rest;
}

function ownerBotMessage(item: BotMessage) {
  const { ownerId: _owner, creditsUsd, ...rest } = item;
  return { ...rest, chargedCredits: charged(creditsUsd) };
}

function ownerLead(item: BotLead) {
  const { ownerId: _owner, ...rest } = item;
  return rest;
}

export function createSolutionsRouter(deps: SolutionsRouterDeps): Router {
  const router = Router();
  const enabled = deps.enabled ?? config.discoveryEnabled;
  const stores = deps.stores ?? getDiscoveryStores;
  const usageStore = deps.usageStore ?? defaultUsageStore;
  const actionLimiter = new RateLimiter(60_000, 10);
  const editLimiter = new RateLimiter(60_000, 60);
  const runtime = deps.runtime ?? createBuilderRuntime(deps);
  const getService = runtime.builder;
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
    if (view.kind !== 'assistant') {
      // Инструмент: свои настройки; материалы и запуски — своими эндпоинтами.
      response.json({
        solution: publicSolution(view.solution),
        config: view.config,
        versions: view.versions,
      });
      return;
    }
    response.json({
      solution: publicSolution(view.solution),
      config: view.config,
      versions: view.versions,
      cases: view.cases.map(({ solutionId: _s, ...item }) => item),
      run: publicRun(view.run),
      readiness: view.readiness,
      testQuote:
        view.cases.length > 0
          ? builder.testQuote(view.config, view.cases, view.solution.bot)
          : null,
    });
  };

  router.get(
    '/',
    handle(async (builder, caller, _request, response) => {
      const items = await builder.list(caller.userId);
      const bots = runtime.bots();
      // «Мои автоматизации»: у бота — расход и заявки за сегодня прямо в карточке.
      const solutions = await Promise.all(
        items.map(async (item) => ({
          ...publicSolution(item),
          today:
            item.type === 'customer_bot' && bots
              ? ((await bots.overview(caller.userId, item.id))?.today ?? null)
              : null,
        })),
      );
      // Остаток и «хватит на N дней» — когда есть хотя бы один бот (этап C).
      const runway =
        bots && items.some((item) => item.type === 'customer_bot')
          ? await bots.runway(caller.userId)
          : null;
      response.json({ solutions, runway });
    }),
  );

  // Галерея: только инструменты, которые реализованы и включены на этом сервере.
  router.get(
    '/templates',
    handle(async (_builder, caller, _request, response) => {
      response.json({
        templates: galleryTemplates().map((template) => ({
          id: template.id,
          kind: template.kind,
          label: template.label[caller.language],
          description: template.description[caller.language],
        })),
      });
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
      const who = { ...caller, language: parsed.data.language };
      const result = parsed.data.template
        ? await builder.createTool(who, parsed.data.template, { name: parsed.data.name })
        : await builder.createBlank(who, parsed.data.name ?? '');
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
      // «Приступить к автоматизации» — с подпиской (пробный месяц с картой), когда она обязательна.
      // Исключение — шаблоны с бесплатным созданием (учебный помощник): из анализа, как из галереи.
      const free = await builder.isFreeCreation(caller, parsed.data);
      const gate = free ? null : (deps.subscriptionRequired?.(caller.userId) ?? null);
      if (gate) {
        response.status(402).json({
          error: {
            code: 'subscription_required',
            message: `Автоматизации работают по подписке: первый месяц бесплатно, дальше $${gate.priceUsd} в месяц.`,
            details: gate,
          },
        });
        return;
      }
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

  // ─── Материалы инструмента ─────────────────────────────────────────────────
  // Текст документа извлекает браузер; сервер проверяет схему, размеры и владельца.

  const materialsOf = (response: Response): MaterialService | null => {
    const value = runtime.materials();
    if (!value)
      sendError(response, 503, 'builder_unavailable', 'Builder временно недоступен. Чат работает.');
    return value;
  };

  router.get(
    '/:id/materials',
    handle(async (_builder, caller, request, response) => {
      const service = materialsOf(response);
      if (!service) return;
      const result = await service.list(caller, String(request.params.id));
      if (!result.ok) return fail(response, result);
      response.json({ materials: result.materials, usage: result.usage });
    }),
  );

  router.post(
    '/:id/materials',
    handle(async (_builder, caller, request, response) => {
      if (limited(editLimiter, response, caller.userId)) return;
      const service = materialsOf(response);
      if (!service) return;
      const parsed = extractedDocumentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(
          response,
          400,
          'invalid_material',
          'Документ не прошёл проверку: проверьте файл.',
        );
        return;
      }
      const result = await service.add(caller, String(request.params.id), parsed.data);
      if (!result.ok) return fail(response, result);
      response
        .status(result.duplicate ? 200 : 201)
        .json({ material: result.material, duplicate: result.duplicate });
    }),
  );

  router.get(
    '/:id/materials/:materialId',
    handle(async (_builder, caller, request, response) => {
      const service = materialsOf(response);
      if (!service) return;
      const result = await service.get(
        caller,
        String(request.params.id),
        String(request.params.materialId),
      );
      if (!result.ok) return fail(response, result);
      const { ownerId: _owner, contentHash: _hash, ...material } = result.material;
      response.json({ material });
    }),
  );

  router.delete(
    '/:id/materials/:materialId',
    handle(async (_builder, caller, request, response) => {
      if (limited(editLimiter, response, caller.userId)) return;
      const service = materialsOf(response);
      if (!service) return;
      const result = await service.remove(
        caller,
        String(request.params.id),
        String(request.params.materialId),
      );
      if (!result.ok) return fail(response, result);
      response.status(204).end();
    }),
  );

  // ─── Запуски операций инструмента ───────────────────────────────────────────
  // Цена до запуска, подтверждение, ключ идемпотентности; списывает только AI Gateway.

  const toolsOf = (response: Response): ToolExecutor | null => {
    const value = runtime.tools();
    if (!value)
      sendError(response, 503, 'builder_unavailable', 'Builder временно недоступен. Чат работает.');
    return value;
  };

  router.post(
    '/:id/runs/quote',
    handle(async (_builder, caller, request, response) => {
      if (limited(editLimiter, response, caller.userId)) return;
      const executor = toolsOf(response);
      if (!executor) return;
      const parsed = runQuoteBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'invalid_input', 'Неверный запрос цены запуска');
        return;
      }
      const result = await executor.quote(
        caller,
        String(request.params.id),
        parsed.data.operation,
        parsed.data.input,
      );
      if (!result.ok) return fail(response, result);
      response.json({ quote: result.quote });
    }),
  );

  router.post(
    '/:id/runs',
    handle(async (_builder, caller, request, response) => {
      if (limited(actionLimiter, response, caller.userId)) return;
      const executor = toolsOf(response);
      if (!executor) return;
      const parsed = runStartBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'invalid_input', 'Неверный запрос запуска');
        return;
      }
      const result = await executor.start(caller, String(request.params.id), parsed.data);
      if (!result.ok) return fail(response, result);
      response
        .status(result.duplicate ? 200 : 202)
        .json({ run: publicToolRun(result.run, result.template), duplicate: result.duplicate });
    }),
  );

  router.get(
    '/:id/runs',
    handle(async (_builder, caller, request, response) => {
      const executor = toolsOf(response);
      if (!executor) return;
      const result = await executor.list(caller, String(request.params.id));
      if (!result.ok) return fail(response, result);
      response.json({ runs: result.runs.map((run) => runSummary(run, result.template)) });
    }),
  );

  router.get(
    '/:id/runs/:runId',
    handle(async (_builder, caller, request, response) => {
      const executor = toolsOf(response);
      if (!executor) return;
      const result = await executor.get(
        caller,
        String(request.params.id),
        String(request.params.runId),
      );
      if (!result.ok) return fail(response, result);
      response.json({ run: publicToolRun(result.run, result.template) });
    }),
  );

  router.delete(
    '/:id/runs/:runId',
    handle(async (_builder, caller, request, response) => {
      if (limited(editLimiter, response, caller.userId)) return;
      const executor = toolsOf(response);
      if (!executor) return;
      const result = await executor.remove(
        caller,
        String(request.params.id),
        String(request.params.runId),
      );
      if (!result.ok) return fail(response, result);
      response.status(204).end();
    }),
  );

  // ─── Попытки (тест, самопроверка) и прогресс ────────────────────────────────
  // Ключи ответов — только после сдачи; проверка открытых ответов — платный запуск с ценой.

  const attemptsOf = (response: Response): AttemptService | null => {
    const value = runtime.attempts();
    if (!value)
      sendError(response, 503, 'builder_unavailable', 'Builder временно недоступен. Чат работает.');
    return value;
  };

  router.post(
    '/:id/runs/:runId/attempts',
    handle(async (_builder, caller, request, response) => {
      if (limited(editLimiter, response, caller.userId)) return;
      const service = attemptsOf(response);
      if (!service) return;
      const parsed = createAttemptBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'invalid_input', 'Неверный запрос попытки');
        return;
      }
      const result = await service.create(
        caller,
        String(request.params.id),
        String(request.params.runId),
        parsed.data,
      );
      if (!result.ok) return fail(response, result);
      response.status(201).json({ attempt: result.attempt });
    }),
  );

  router.get(
    '/:id/attempts',
    handle(async (_builder, caller, request, response) => {
      const service = attemptsOf(response);
      if (!service) return;
      const runId = typeof request.query.runId === 'string' ? request.query.runId : undefined;
      const result = await service.list(caller, String(request.params.id), runId);
      if (!result.ok) return fail(response, result);
      response.json({ attempts: result.attempts });
    }),
  );

  router.get(
    '/:id/attempts/:attemptId',
    handle(async (_builder, caller, request, response) => {
      const service = attemptsOf(response);
      if (!service) return;
      const result = await service.get(
        caller,
        String(request.params.id),
        String(request.params.attemptId),
      );
      if (!result.ok) return fail(response, result);
      response.json({ attempt: result.attempt });
    }),
  );

  router.put(
    '/:id/attempts/:attemptId/answers',
    handle(async (_builder, caller, request, response) => {
      if (limited(editLimiter, response, caller.userId)) return;
      const service = attemptsOf(response);
      if (!service) return;
      const parsed = answersBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'invalid_answers', 'Неверный формат ответов');
        return;
      }
      const result = await service.saveAnswers(
        caller,
        String(request.params.id),
        String(request.params.attemptId),
        parsed.data.answers,
      );
      if (!result.ok) return fail(response, result);
      response.json({ attempt: result.attempt });
    }),
  );

  router.post(
    '/:id/attempts/:attemptId/submit',
    handle(async (_builder, caller, request, response) => {
      const service = attemptsOf(response);
      if (!service) return;
      const parsed = answersBodySchema.partial().safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'invalid_answers', 'Неверный формат ответов');
        return;
      }
      const result = await service.submit(
        caller,
        String(request.params.id),
        String(request.params.attemptId),
        parsed.data.answers,
      );
      if (!result.ok) return fail(response, result);
      response.json({ attempt: result.attempt });
    }),
  );

  router.post(
    '/:id/attempts/:attemptId/grade/quote',
    handle(async (_builder, caller, request, response) => {
      if (limited(editLimiter, response, caller.userId)) return;
      const service = attemptsOf(response);
      if (!service) return;
      const result = await service.gradeQuote(
        caller,
        String(request.params.id),
        String(request.params.attemptId),
      );
      if (!result.ok) return fail(response, result);
      response.json({ quote: result.quote });
    }),
  );

  router.post(
    '/:id/attempts/:attemptId/grade',
    handle(async (_builder, caller, request, response) => {
      if (limited(actionLimiter, response, caller.userId)) return;
      const service = attemptsOf(response);
      if (!service) return;
      const parsed = gradeBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'invalid_input', 'Неверный запрос проверки');
        return;
      }
      const result = await service.grade(
        caller,
        String(request.params.id),
        String(request.params.attemptId),
        parsed.data,
      );
      if (!result.ok) return fail(response, result);
      response.status(202).json({ attempt: result.attempt });
    }),
  );

  router.get(
    '/:id/progress',
    handle(async (_builder, caller, request, response) => {
      const service = attemptsOf(response);
      if (!service) return;
      const result = await service.progress(caller, String(request.params.id));
      if (!result.ok) return fail(response, result);
      response.json({ progress: result.progress });
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
      if (view.kind !== 'assistant') {
        sendError(response, 409, 'wrong_solution_kind', 'Чат есть только у помощников');
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
      if (active?.solution.type === 'customer_bot') {
        sendError(
          response,
          409,
          'bot_has_public_page',
          caller.language === 'en'
            ? 'A customer bot talks on its own page, not in a private chat.'
            : 'Бот для клиентов отвечает на своей странице, а не в личном чате.',
        );
        return;
      }
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

  // ─── Бот для клиентов: сторона владельца (этап B) ──────────────────────────

  const botsReady = (response: Response): BotService | null => {
    const value = runtime.bots();
    if (!value)
      sendError(response, 503, 'builder_unavailable', 'Builder временно недоступен. Чат работает.');
    return value;
  };
  const botNotFound = (response: Response) =>
    sendError(response, 404, 'not_found', 'Бот не найден');

  router.get(
    '/:id/bot',
    handle(async (_builder, caller, request, response) => {
      const bots = botsReady(response);
      if (!bots) return;
      const overview = await bots.overview(caller.userId, String(request.params.id));
      if (!overview) return botNotFound(response);
      response.json({ ...overview, publicUrl: `${siteUrl()}/b/${overview.settings.slug}` });
    }),
  );

  router.put(
    '/:id/bot',
    handle(async (_builder, caller, request, response) => {
      const bots = botsReady(response);
      if (!bots) return;
      const parsed = botSettingsBodySchema.safeParse(request.body ?? {});
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
      const patch = Object.fromEntries(
        Object.entries(parsed.data).filter(([, value]) => value !== undefined),
      );
      const result = await bots.updateSettings(caller, String(request.params.id), patch);
      if (!result.ok) return fail(response, result);
      const overview = await bots.overview(caller.userId, String(request.params.id));
      if (!overview) return botNotFound(response);
      response.json({ ...overview, publicUrl: `${siteUrl()}/b/${overview.settings.slug}` });
    }),
  );

  router.post(
    '/:id/bot/preview',
    handle(async (_builder, caller, request, response) => {
      const bots = botsReady(response);
      if (!bots) return;
      const parsed = botPreviewBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(
          response,
          400,
          'validation_failed',
          'Нужно сообщение клиента (до 1000 символов).',
        );
        return;
      }
      if (limited(actionLimiter, response, caller.userId)) return;
      const result = await bots.preview(caller, String(request.params.id), parsed.data.messages);
      if (!result.ok) return fail(response, result);
      const { ok: _ok, ...reply } = result;
      response.json({ reply });
    }),
  );

  router.get(
    '/:id/conversations',
    handle(async (_builder, caller, request, response) => {
      const bots = botsReady(response);
      if (!bots) return;
      const items = await bots.conversations(caller.userId, String(request.params.id));
      if (!items) return botNotFound(response);
      response.json({ conversations: items.map(ownerConversation) });
    }),
  );

  router.get(
    '/:id/conversations/:conversationId',
    handle(async (_builder, caller, request, response) => {
      const bots = botsReady(response);
      if (!bots) return;
      const messages = await bots.conversationMessages(
        caller.userId,
        String(request.params.id),
        String(request.params.conversationId),
      );
      if (!messages) {
        sendError(response, 404, 'not_found', 'Диалог не найден');
        return;
      }
      response.json({ messages: messages.map(ownerBotMessage) });
    }),
  );

  router.get(
    '/:id/leads',
    handle(async (_builder, caller, request, response) => {
      const bots = botsReady(response);
      if (!bots) return;
      const items = await bots.leads(caller.userId, String(request.params.id));
      if (!items) return botNotFound(response);
      response.json({ leads: items.map(ownerLead) });
    }),
  );

  router.patch(
    '/:id/leads/:leadId',
    handle(async (_builder, caller, request, response) => {
      const bots = botsReady(response);
      if (!bots) return;
      const parsed = leadStatusBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendError(response, 400, 'validation_failed', 'Ожидается { status: new | done }.');
        return;
      }
      const lead = await bots.setLeadStatus(
        caller.userId,
        String(request.params.id),
        String(request.params.leadId),
        parsed.data.status,
      );
      if (!lead) {
        sendError(response, 404, 'not_found', 'Заявка не найдена');
        return;
      }
      response.json({ lead: ownerLead(lead) });
    }),
  );

  return router;
}
