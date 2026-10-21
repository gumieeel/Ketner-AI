import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { AIGateway } from '../ai/gateway.js';
import { modelRegistry } from '../ai/model-registry.js';
import { config } from '../config.js';
import {
  buildCodeReviewInput,
  buildCodeReviewPrompt,
  codeReviewTemplate,
  parseCodeReview,
  runReviewTask,
  type ReviewedChange,
} from '../services/answer-review.js';
import type { PlanBonusSource } from '../services/premium-quota.js';
import { pickReviewers } from '../services/review-policy.js';
import type { PremiumCreditSource } from '../store/premium-credit-store.js';
import { reviewQuota, sendReviewLimit } from './review.js';
import { openSse } from './sse.js';
import { sendError } from '../middleware/errors.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import { EntitlementService } from '../services/entitlement.js';
import { getCodeLimits, quotaOf, type CodeLimits } from '../services/code-limits.js';
import { usageStore as defaultUsageStore, type UsageStore } from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import type { Language, PlanId } from '../types.js';
import { AgentRunner, type AgentEvent } from '../code/agent-runner.js';
import {
  createZipWriter,
  downloadGithubZip,
  extractZipText,
  GithubImportError,
  parseGithubUrl,
} from '../code/archive.js';
import { CodeError, isSecretPath, languageOf } from '../code/path-safety.js';
import type { ProjectStore } from '../code/project-store.js';
import { getProjectStore, getSandbox } from '../code/runtime.js';
import type { SandboxRunner } from '../code/sandbox.js';
import { isTemplateId, TEMPLATE_IDS } from '../code/templates.js';
import type { ProjectMeta, ThreadItem } from '../code/types.js';

const MAX_IMPORT_FILES_PER_REQUEST = 5_000;
const HEARTBEAT_MS = 15_000;
const GITHUB_ARCHIVE_MAX_BYTES = 40 * 1024 * 1024;

export interface CodeRouterDeps {
  /** Идентификатор общего demo-пользователя для анонимного режима (только вне production). */
  userId: string;
  userStore?: UserStore;
  subscriptionStore?: SubscriptionStore;
  usageStore?: UsageStore;
  store?: ProjectStore;
  sandbox?: SandboxRunner | null;
  runner?: AgentRunner;
  allowAnonymous?: boolean;
  fetchImpl?: typeof fetch;
  /** Токен привязанного GitHub: с ним импортируются и приватные репозитории. */
  githubTokenOf?: (userId: string) => string | undefined;
  /** Шлюз чата: через него идёт ревью правок моделью другой компании. */
  gateway?: AIGateway;
  premiumCredits?: PremiumCreditSource;
  planBonus?: PlanBonusSource;
}

type ToolThreadItem = Extract<ThreadItem, { kind: 'tool' }>;

/**
 * Что сделал запуск агента: задача (реплика пользователя перед первой записью запуска), итоговая
 * реплика агента и правки файлов. Правки одного файла остаются отдельными шагами, как в ленте.
 */
export function collectRunChanges(
  thread: readonly ThreadItem[],
  runId: string,
): { task: string; summary: string; changes: ReviewedChange[]; modelId?: string } | null {
  const first = thread.findIndex((item) => 'runId' in item && item.runId === runId);
  if (first === -1) return null;
  const task =
    [...thread.slice(0, first)].reverse().find((item) => item.kind === 'user')?.text ?? '';
  const own = thread.filter((item) => 'runId' in item && item.runId === runId);
  const summary = [...own].reverse().find((item) => item.kind === 'assistant')?.text ?? '';
  const changes = own
    .filter((item): item is ToolThreadItem => item.kind === 'tool' && Boolean(item.change))
    .map((item) => item.change!)
    .map((change) => ({ ...change }));
  const runItem = own.find((item) => item.kind === 'run');
  return { task, summary, changes, modelId: runItem?.kind === 'run' ? runItem.modelId : undefined };
}

interface Caller {
  userId: string;
  plan: PlanId;
  email?: string;
  isVip: boolean;
  limits: CodeLimits;
}

function publicProject(meta: ProjectMeta) {
  const { userId: _owner, ...rest } = meta;
  return rest;
}

function entryJson(entry: { path: string; size: number; mtimeMs: number }) {
  return {
    path: entry.path,
    size: entry.size,
    language: languageOf(entry.path),
    modifiedAt: new Date(entry.mtimeMs).toISOString(),
  };
}

function asciiFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'project';
}

export function createCodeRouter(deps: CodeRouterDeps): Router {
  const router = Router();
  const store = deps.store ?? getProjectStore();
  const usageStore = deps.usageStore ?? defaultUsageStore;
  const sandbox = deps.sandbox !== undefined ? deps.sandbox : getSandbox();
  const runner =
    deps.runner ??
    new AgentRunner({
      store,
      usageStore,
      sandbox,
      allowSandboxNetwork: config.code.sandboxAllowNetwork,
    });
  // Гостевой чат общий для всех посетителей (один demo-user), а проекты содержат чужой код:
  // без входа в аккаунт Ketner Code недоступен, иначе гости видели бы проекты и делили лимиты друг друга.
  const allowAnonymous = deps.allowAnonymous ?? false;
  /** Запущенные агенты: один на проект. */
  const activeRuns = new Map<string, AbortController>();
  /** Идущие ревью: одно на проект. */
  const activeReviews = new Set<string>();
  const gateway =
    deps.gateway ??
    new AIGateway({
      usageStore,
      aiConfig: config.ai,
      premiumCredits: deps.premiumCredits,
      planBonus: deps.planBonus,
    });
  const runKey = (userId: string, projectId: string): string => `${userId}:${projectId}`;

  function identify(request: Request, response: Response): Caller | null {
    const sessionUser = request.user;
    const identity = resolveChatIdentity({
      sessionUser,
      storedUser: sessionUser ? deps.userStore?.findById(sessionUser.id) : undefined,
      subscription: sessionUser ? deps.subscriptionStore?.get(sessionUser.id) : undefined,
      anonymousUserId: deps.userId,
      anonymousPlan: config.demoPlan,
      allowAnonymous,
    });
    if (!identity.ok) {
      sendError(response, identity.status, identity.code, identity.message);
      return null;
    }
    const plan = EntitlementService.resolveEffectivePlan(
      identity.plan,
      identity.email,
      identity.isVip,
    );
    return {
      userId: identity.userId,
      plan,
      email: identity.email,
      isVip: identity.isVip,
      limits: getCodeLimits(plan),
    };
  }

  function fail(response: Response, error: unknown): void {
    if (error instanceof CodeError) {
      sendError(response, error.status, error.code, error.message);
      return;
    }
    console.error('[code] сбой обработчика:', error);
    sendError(response, 500, 'internal_error', 'Внутренняя ошибка сервера');
  }

  /** Обёртка: определяет пользователя и превращает ошибки модуля в ответы API. */
  const guarded =
    (handler: (caller: Caller, request: Request, response: Response) => Promise<void>) =>
    async (request: Request, response: Response): Promise<void> => {
      const caller = identify(request, response);
      if (!caller) return;
      try {
        await handler(caller, request, response);
      } catch (error) {
        if (!response.headersSent) fail(response, error);
        else {
          console.error('[code] сбой после начала ответа:', error);
          response.end();
        }
      }
    };

  async function requireProject(
    caller: Caller,
    request: Request,
    response: Response,
  ): Promise<ProjectMeta | null> {
    const id = String(request.params.id ?? '');
    const meta = await store.get(caller.userId, id);
    if (!meta) {
      sendError(response, 404, 'project_not_found', 'Проект не найден');
      return null;
    }
    return meta;
  }

  const queryPath = (request: Request): string => {
    const value = request.query.path;
    return typeof value === 'string' ? value : '';
  };

  // ───────────── возможности и тарифные лимиты ─────────────

  router.get(
    '/capabilities',
    guarded(async (caller, _request, response) => {
      const limits = caller.limits;
      const commandsAvailable = limits.commands && sandbox !== null;
      const models = modelRegistry
        .getAll()
        .filter((model) => model.id !== 'auto')
        .map((model) => ({
          id: model.id,
          name: model.name,
          costClass: model.costClass,
          locked: !EntitlementService.checkModelAccess(
            model,
            caller.plan,
            caller.email,
            caller.isVip,
          ).allowed,
        }));
      response.json({
        plan: caller.plan,
        limits,
        usage: {
          projects: await store.count(caller.userId),
          runsToday: usageStore.getAgentRunsLastDay(caller.userId),
        },
        commands: {
          available: commandsAvailable,
          reason: commandsAvailable ? null : limits.commands ? 'server_disabled' : 'plan',
          network: commandsAvailable && config.code.sandboxAllowNetwork,
        },
        templates: TEMPLATE_IDS,
        models,
        defaultModelId: 'auto',
      });
    }),
  );

  // ───────────── проекты ─────────────

  router.get(
    '/projects',
    guarded(async (caller, _request, response) => {
      const projects = await store.list(caller.userId);
      response.json({ projects: projects.map(publicProject) });
    }),
  );

  router.post(
    '/projects',
    guarded(async (caller, request, response) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const template = body.template === undefined ? 'empty' : body.template;
      if (!isTemplateId(template)) {
        sendError(response, 400, 'invalid_request', 'Неизвестный шаблон проекта');
        return;
      }
      const quota = quotaOf(caller.limits);
      const meta = await store.create(
        caller.userId,
        { name: body.name, description: body.description, template },
        { maxProjects: caller.limits.maxProjects, quota },
      );
      response.status(201).json({ project: publicProject(meta) });
    }),
  );

  router.post(
    '/projects/import-github',
    guarded(async (caller, request, response) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const target = typeof body.url === 'string' ? parseGithubUrl(body.url) : null;
      if (!target) {
        sendError(
          response,
          400,
          'invalid_request',
          'Укажите репозиторий GitHub, например https://github.com/owner/repo',
        );
        return;
      }
      if ((await store.count(caller.userId)) >= caller.limits.maxProjects) {
        sendError(
          response,
          413,
          'quota_exceeded',
          'На вашем тарифе больше проектов создать нельзя. Удалите ненужный проект или повысьте тариф.',
        );
        return;
      }
      let archive: Uint8Array;
      try {
        archive = await downloadGithubZip(target, {
          maxBytes: GITHUB_ARCHIVE_MAX_BYTES,
          fetchImpl: deps.fetchImpl,
          token: deps.githubTokenOf?.(caller.userId),
        });
      } catch (error) {
        if (error instanceof GithubImportError) {
          sendError(
            response,
            error.code === 'not_found' ? 404 : error.code === 'too_large' ? 413 : 502,
            `github_${error.code}`,
            error.message,
          );
          return;
        }
        throw error;
      }
      let extracted: ReturnType<typeof extractZipText>;
      try {
        extracted = extractZipText(archive, {
          maxFiles: caller.limits.maxFiles,
          maxFileBytes: caller.limits.maxFileBytes,
          maxTotalBytes: caller.limits.maxProjectBytes,
        });
      } catch {
        sendError(response, 422, 'invalid_archive', 'Не удалось прочитать архив репозитория');
        return;
      }
      if (extracted.files.length === 0) {
        sendError(
          response,
          422,
          'empty_import',
          'В репозитории нет текстовых файлов, которые можно импортировать',
        );
        return;
      }
      const name = typeof body.name === 'string' && body.name.trim() ? body.name : target.repo;
      const quota = quotaOf(caller.limits);
      const meta = await store.create(
        caller.userId,
        {
          name,
          source: {
            type: 'github',
            ref: `${target.owner}/${target.repo}${target.ref ? `@${target.ref}` : ''}`,
          },
        },
        { maxProjects: caller.limits.maxProjects, quota },
      );
      const result = await store.importFiles(caller.userId, meta.id, extracted.files, quota);
      const project = (await store.get(caller.userId, meta.id)) ?? meta;
      response.status(201).json({
        project: publicProject(project),
        written: result.written,
        skipped: [...extracted.skipped, ...result.skipped].slice(0, 50),
        skippedCount: extracted.skipped.length + result.skipped.length,
      });
    }),
  );

  router.get(
    '/projects/:id',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (meta)
        response.json({
          project: publicProject(meta),
          running: activeRuns.has(runKey(caller.userId, meta.id)),
        });
    }),
  );

  router.patch(
    '/projects/:id',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const updated = await store.update(caller.userId, meta.id, {
        name: body.name,
        description: body.description,
      });
      response.json({ project: publicProject(updated) });
    }),
  );

  router.delete(
    '/projects/:id',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      activeRuns.get(runKey(caller.userId, meta.id))?.abort();
      await store.remove(caller.userId, meta.id);
      response.status(204).end();
    }),
  );

  // ───────────── файлы ─────────────

  router.get(
    '/projects/:id/files',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const files = await store.listFiles(caller.userId, meta.id);
      response.json({
        files: files.map(entryJson),
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      });
    }),
  );

  router.get(
    '/projects/:id/file',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const read = await store.readText(caller.userId, meta.id, queryPath(request), {
        maxBytes: caller.limits.maxFileBytes,
      });
      const filePath = queryPath(request);
      response.json({
        path: filePath,
        content: read.content,
        size: read.size,
        language: languageOf(filePath),
      });
    }),
  );

  router.put(
    '/projects/:id/file',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body.path !== 'string' || typeof body.content !== 'string') {
        sendError(response, 400, 'invalid_request', 'Нужны поля path и content (строки)');
        return;
      }
      const written = await store.writeText(
        caller.userId,
        meta.id,
        body.path,
        body.content,
        quotaOf(caller.limits),
      );
      const project = await store.get(caller.userId, meta.id);
      response.status(written.created ? 201 : 200).json({
        file: entryJson(written.entry),
        created: written.created,
        project: project ? publicProject(project) : undefined,
      });
    }),
  );

  router.delete(
    '/projects/:id/file',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const result = await store.deletePath(caller.userId, meta.id, queryPath(request));
      response.json({ removed: result.removed });
    }),
  );

  router.post(
    '/projects/:id/move',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body.from !== 'string' || typeof body.to !== 'string') {
        sendError(response, 400, 'invalid_request', 'Нужны поля from и to (строки)');
        return;
      }
      await store.moveFile(caller.userId, meta.id, body.from, body.to);
      response.status(204).end();
    }),
  );

  /** Импорт файлов, прочитанных клиентом (папка, ZIP). Секретные файлы на сервер не принимаются. */
  router.post(
    '/projects/:id/import',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const body = (request.body ?? {}) as { files?: unknown };
      if (!Array.isArray(body.files) || body.files.length === 0) {
        sendError(response, 400, 'invalid_request', 'Поле files должно содержать список файлов');
        return;
      }
      if (body.files.length > MAX_IMPORT_FILES_PER_REQUEST) {
        sendError(
          response,
          413,
          'quota_exceeded',
          `За один запрос можно импортировать не больше ${MAX_IMPORT_FILES_PER_REQUEST} файлов`,
        );
        return;
      }
      const accepted: Array<{ path: string; content: string }> = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      for (const raw of body.files as Array<Record<string, unknown>>) {
        const filePath = typeof raw?.path === 'string' ? raw.path : '';
        if (typeof raw?.content !== 'string' || !filePath) {
          skipped.push({ path: filePath.slice(0, 120), reason: 'нужны path и content (строки)' });
        } else if (isSecretPath(filePath.replace(/\\/g, '/'))) {
          skipped.push({ path: filePath, reason: 'файл с секретами не импортируется' });
        } else {
          accepted.push({ path: filePath, content: raw.content });
        }
      }
      const result = await store.importFiles(
        caller.userId,
        meta.id,
        accepted,
        quotaOf(caller.limits),
      );
      const project = await store.get(caller.userId, meta.id);
      const allSkipped = [...skipped, ...result.skipped];
      response.json({
        written: result.written,
        skipped: allSkipped.slice(0, 50),
        skippedCount: allSkipped.length,
        project: project ? publicProject(project) : undefined,
      });
    }),
  );

  router.get(
    '/projects/:id/export.zip',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const files = await store.listFiles(caller.userId, meta.id);
      const fs = await store.fsFor(caller.userId, meta.id);
      const ascii = asciiFileName(meta.name);
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(meta.name)}.zip`,
        'Cache-Control': 'no-store',
      });
      const writer = createZipWriter((chunk) => {
        response.write(Buffer.from(chunk));
      });
      for (const file of files) {
        if (response.destroyed) return;
        try {
          writer.add(
            file.path,
            await fs.readBuffer(file.path, { maxBytes: caller.limits.maxFileBytes * 4 }),
          );
        } catch {
          // файл исчез или не читается — в архив не попадает
        }
      }
      writer.end();
      response.end();
    }),
  );

  // ───────────── лента агента ─────────────

  router.get(
    '/projects/:id/thread',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      response.json({
        items: await store.getThread(caller.userId, meta.id),
        running: activeRuns.has(runKey(caller.userId, meta.id)),
      });
    }),
  );

  router.delete(
    '/projects/:id/thread',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      if (activeRuns.has(runKey(caller.userId, meta.id))) {
        sendError(
          response,
          409,
          'run_in_progress',
          'Дождитесь завершения запуска или остановите его',
        );
        return;
      }
      await store.clearThread(caller.userId, meta.id);
      response.status(204).end();
    }),
  );

  // ───────────── запуск агента ─────────────

  router.post(
    '/projects/:id/stop',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      activeRuns.get(runKey(caller.userId, meta.id))?.abort();
      response.status(204).end();
    }),
  );

  router.post(
    '/projects/:id/run',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body.task !== 'string' || body.task.trim() === '') {
        sendError(response, 400, 'invalid_request', 'Опишите задачу для агента (поле task)');
        return;
      }
      if (body.task.length > caller.limits.maxTaskChars + 1_000) {
        sendError(
          response,
          413,
          'invalid_request',
          `Задача слишком длинная (до ${caller.limits.maxTaskChars} символов)`,
        );
        return;
      }
      const modelId = typeof body.modelId === 'string' ? body.modelId : undefined;
      const language: Language = body.language === 'en' ? 'en' : 'ru';
      const key = runKey(caller.userId, meta.id);
      if (activeRuns.has(key)) {
        sendError(response, 409, 'run_in_progress', 'В этом проекте уже выполняется запуск агента');
        return;
      }

      const controller = new AbortController();
      activeRuns.set(key, controller);

      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();

      const onClose = (): void => {
        // Закрытое соединение (вкладка, кнопка «Стоп») останавливает запуск; сделанное сохраняется.
        if (!response.writableEnded) controller.abort();
      };
      response.on('close', onClose);
      const heartbeat = setInterval(() => {
        if (!response.writableEnded && !response.destroyed) response.write(': ping\n\n');
      }, HEARTBEAT_MS);

      const write = (event: AgentEvent): void => {
        if (response.writableEnded || response.destroyed) return;
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      try {
        await runner.run(
          {
            userId: caller.userId,
            plan: caller.plan,
            email: caller.email,
            isVip: caller.isVip,
            projectId: meta.id,
            task: body.task,
            modelId,
            language,
            reasoningMode: body.reasoningMode === 'max' ? 'max' : 'standard',
            signal: controller.signal,
          },
          write,
        );
      } catch (error) {
        console.error('[code] необработанный сбой запуска:', error);
        write({ type: 'error', code: 'internal_error', message: 'Внутренняя ошибка сервера' });
      } finally {
        clearInterval(heartbeat);
        activeRuns.delete(key);
        response.off('close', onClose);
        if (!response.writableEnded) response.end();
      }
    }),
  );

  // ───────────── ревью правок моделью другой компании ─────────────

  /**
   * POST /projects/:id/review { runId, language } — поток SSE:
   *   review_start    { reviewId, quota, files }
   *   review_reviewer { reviewer }
   *   review_done     { item, quota }   — item: запись ленты kind 'review'
   *   error           { code, message }
   */
  router.post(
    '/projects/:id/review',
    guarded(async (caller, request, response) => {
      const meta = await requireProject(caller, request, response);
      if (!meta) return;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const language: Language = body.language === 'en' ? 'en' : 'ru';
      const say = (ru: string, en: string): string => (language === 'en' ? en : ru);
      if (typeof body.runId !== 'string' || body.runId.trim() === '') {
        sendError(
          response,
          400,
          'invalid_request',
          say('Поле runId обязательно', 'runId is required'),
        );
        return;
      }
      const key = runKey(caller.userId, meta.id);
      if (activeRuns.has(key)) {
        sendError(
          response,
          409,
          'run_in_progress',
          say('Дождитесь завершения запуска агента', 'Wait for the agent run to finish'),
        );
        return;
      }
      if (activeReviews.has(key)) {
        sendError(
          response,
          429,
          'review_in_progress',
          say('Ревью уже идёт', 'A review is already running'),
        );
        return;
      }
      const thread = await store.getThread(caller.userId, meta.id);
      const collected = collectRunChanges(thread, body.runId.trim());
      if (!collected) {
        sendError(
          response,
          404,
          'run_not_found',
          say('Запуск не найден в ленте', 'Run not found in the thread'),
        );
        return;
      }
      if (collected.changes.length === 0) {
        sendError(
          response,
          400,
          'nothing_to_review',
          say(
            'В этом запуске агент не менял файлы',
            'The agent did not change any files in this run',
          ),
        );
        return;
      }
      const quota = reviewQuota(usageStore, caller.userId, caller.plan);
      if (quota.remaining <= 0) {
        sendReviewLimit(response, quota, language);
        return;
      }

      activeReviews.add(key);
      const sse = openSse(response);
      const reviewId = randomUUID();
      const files = new Set(collected.changes.map((change) => change.path)).size;
      try {
        sse.write('review_start', { reviewId, quota, files });
        const result = await runReviewTask({
          gateway,
          caller,
          candidates: pickReviewers(
            caller.plan,
            collected.modelId ? [collected.modelId] : [],
            modelRegistry,
          ),
          reviewId,
          systemPrompt: buildCodeReviewPrompt(language),
          userContent: buildCodeReviewInput(
            collected.task,
            collected.summary,
            collected.changes,
            language,
          ),
          templateOutput: codeReviewTemplate(collected.changes, language),
          language,
          conversationId: `code:${meta.id}`,
          signal: sse.signal,
          onReviewer: (reviewer) => sse.write('review_reviewer', { reviewer }),
        });
        if (!result.ok || result.cancelled) {
          sse.write('error', {
            code: result.ok ? 'cancelled' : result.code,
            message: result.ok ? say('Ревью остановлено', 'Review stopped') : result.message,
          });
          return;
        }
        const parsed = parseCodeReview(result.text);
        const item: Extract<ThreadItem, { kind: 'review' }> = {
          id: reviewId,
          kind: 'review',
          runId: body.runId.trim(),
          ...parsed,
          reviewer: result.reviewer,
          ...(collected.modelId ? { authorModelId: collected.modelId } : {}),
          filesReviewed: files,
          createdAt: new Date().toISOString(),
        };
        await store.appendThread(caller.userId, meta.id, [item]);
        sse.write('review_done', {
          item,
          quota: reviewQuota(usageStore, caller.userId, caller.plan),
        });
      } catch (error) {
        console.error('[code] сбой ревью:', error);
        sse.write('error', {
          code: 'internal_error',
          message: say('Внутренняя ошибка сервера', 'Internal server error'),
        });
      } finally {
        activeReviews.delete(key);
        sse.end();
      }
    }),
  );

  return router;
}
