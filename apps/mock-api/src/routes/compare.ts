import { Router, type Request, type Response } from 'express';
import { AIGateway } from '../ai/gateway.js';
import type { ModelRegistryEntry } from '../ai/gateway-types.js';
import { modelRegistry } from '../ai/model-registry.js';
import { PayloadGuard } from '../ai/payload-guard.js';
import { safeEqualStrings } from '../auth/safe-equal.js';
import { config, type AiConfig } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { EntitlementService } from '../services/entitlement.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import { maxCompareModels, parseCompareModelIds } from '../services/compare-policy.js';
import { isAdminUser } from '../services/vip.js';
import type { PremiumCreditSource } from '../store/premium-credit-store.js';
import type { PlanBonusSource } from '../services/premium-quota.js';
import type { ConversationStore } from '../store/conversation-store.js';
import { compareRunStore, type CompareRunStore } from '../store/compare-run-store.js';
import type { CompareSlotResult } from '../store/compare-run-store.js';
import { compareVoteStore, type CompareVoteStore } from '../store/compare-vote-store.js';
import {
  usageStore as defaultUsageStore,
  feedbackStore as defaultFeedbackStore,
  type UsageStore,
  type FeedbackStore,
} from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import type { IncomingMessage, Language } from '../types.js';
import { parseCompletionRequest } from './chat.js';

/** Как часто в поток уходит комментарий-«сердцебиение»: прокси не рвёт долгое молчание модели. */
const HEARTBEAT_MS = 15_000;

export interface CompareRouterDeps {
  store: ConversationStore;
  userId: string;
  ai: AiConfig;
  subscriptionStore?: SubscriptionStore;
  userStore?: UserStore;
  usageStore?: UsageStore;
  gateway?: AIGateway;
  feedbackStore?: FeedbackStore;
  premiumCredits?: PremiumCreditSource;
  planBonus?: PlanBonusSource;
  runs?: CompareRunStore;
  votes?: CompareVoteStore;
}

/** Одна колонка сравнения до запуска. */
interface SlotPlan {
  slot: number;
  /** `auto` или id модели каталога (после разрешения псевдонимов). */
  requestedModelId: string;
  entry: ModelRegistryEntry;
}

function text(language: Language, ru: string, en: string): string {
  return language === 'en' ? en : ru;
}

/**
 * Сравнение ответов нескольких моделей на один вопрос.
 *
 * Каждая колонка — обычный запрос через тот же шлюз: те же права, лимиты модели, квота премиум-
 * запросов, бюджет тарифа и учёт расхода. Отличие одно: подмена модели запрещена (`strictModel`),
 * поэтому колонка либо отвечает выбранной моделью, либо показывает причину отказа.
 *
 * Поток SSE (события с префиксом `compare_`):
 *   compare_start       { runId, slots: [{ slot, requestedModelId, modelName }] }
 *   compare_delta       { slot, content }
 *   compare_slot_done   { slot, selectedModel, routingReason, finishReason, canContinue, usage, latencyMs, ttftMs }
 *   compare_slot_error  { slot, code, message }
 *   compare_done        { runId, savedMessageId, defaultSlot }
 *
 * При завершении в диалог сохраняется ответ первой успешной колонки; выбор лучшего ответа
 * (`POST /pick`) заменяет его выбранным. Так вопрос не теряется, даже если человек ничего не выбрал.
 */
export function createCompareRouter({
  store,
  userId,
  ai,
  subscriptionStore,
  userStore,
  usageStore = defaultUsageStore,
  gateway,
  feedbackStore = defaultFeedbackStore,
  premiumCredits,
  planBonus,
  runs = compareRunStore,
  votes = compareVoteStore,
}: CompareRouterDeps): Router {
  const router = Router();
  const aiGateway =
    gateway ??
    new AIGateway({
      usageStore,
      aiConfig: ai,
      feedbackStore,
      premiumCredits,
      planBonus,
    });

  /** Один запуск сравнения на человека: иначе он занял бы все параллельные запросы тарифа. */
  const activeUsers = new Set<string>();

  router.post('/', async (request: Request, response: Response): Promise<void> => {
    const parsed = parseCompletionRequest(request.body);
    if (!parsed.ok) {
      sendError(response, 400, 'invalid_request', parsed.message);
      return;
    }
    const { conversationId, language, messages, reasoningMode } = parsed.value;

    const rawIds = (request.body as { modelIds?: unknown }).modelIds;
    const idsResult = parseCompareModelIds(rawIds);
    if (!idsResult.ok) {
      sendError(response, 400, 'invalid_models', idsResult.message);
      return;
    }

    const guardResult = PayloadGuard.validate(messages, {
      language,
      workspace: messages[messages.length - 1]?.workspaceContext,
    });
    if (!guardResult.valid) {
      sendError(
        response,
        400,
        guardResult.code ?? 'payload_too_large',
        guardResult.message ?? 'Payload too large',
      );
      return;
    }

    // Сравнение — только для аккаунтов: гость делил бы один demo-user и общий бесплатный лимит.
    const sessionUser = request.user;
    if (!sessionUser) {
      sendError(
        response,
        401,
        'unauthorized',
        text(
          language,
          'Войдите в аккаунт, чтобы сравнивать ответы моделей',
          'Sign in to compare model answers',
        ),
      );
      return;
    }
    const identity = resolveChatIdentity({
      sessionUser,
      storedUser: userStore?.findById(sessionUser.id),
      subscription: subscriptionStore?.get(sessionUser.id),
      anonymousUserId: userId,
      anonymousPlan: config.demoPlan,
      allowAnonymous: false,
    });
    if (!identity.ok) {
      sendError(response, identity.status, identity.code, identity.message);
      return;
    }
    const plan = EntitlementService.resolveEffectivePlan(
      identity.plan,
      identity.email,
      identity.isVip,
    );

    const maxModels = maxCompareModels(plan);
    if (maxModels === 0) {
      sendError(
        response,
        403,
        'compare_plan_required',
        text(
          language,
          'Сравнение ответов доступно с тарифа Plus.',
          'Answer comparison is available from the Plus plan.',
        ),
      );
      return;
    }
    if (idsResult.ids.length > maxModels) {
      sendError(
        response,
        400,
        'too_many_models',
        text(
          language,
          `На вашем тарифе можно сравнивать до ${maxModels} моделей за раз.`,
          `Your plan compares up to ${maxModels} models at once.`,
        ),
      );
      return;
    }

    // Диалог ищется строго среди диалогов этого пользователя.
    if (!store.get(identity.userId, conversationId)) {
      sendError(response, 404, 'conversation_not_found', `Диалог ${conversationId} не найден`);
      return;
    }

    // Модели: существуют, включены, доступны по тарифу. Повторы после разрешения псевдонимов
    // убираются: две колонки одной модели ничего не сравнивают.
    const plans: SlotPlan[] = [];
    for (const requestedId of idsResult.ids) {
      const entry =
        requestedId === 'auto' ? modelRegistry.resolve('auto') : modelRegistry.get(requestedId);
      if (!entry || !entry.enabled) {
        sendError(
          response,
          400,
          'unknown_model',
          text(language, `Модель ${requestedId} не найдена`, `Model ${requestedId} not found`),
        );
        return;
      }
      if (plans.some((planned) => planned.entry.id === entry.id)) continue;
      if (requestedId !== 'auto') {
        const access = EntitlementService.checkModelAccess(
          entry,
          plan,
          identity.email,
          identity.isVip,
        );
        if (!access.allowed) {
          const required = access.requiredPlan ?? 'PRO';
          sendError(
            response,
            403,
            'upgrade_required',
            text(
              language,
              `Для доступа к модели ${entry.name} требуется подписка (${required} или выше).`,
              `Access to ${entry.name} requires an active subscription (${required} or higher).`,
            ),
          );
          return;
        }
      }
      plans.push({
        slot: plans.length,
        requestedModelId: requestedId === 'auto' ? 'auto' : entry.id,
        entry,
      });
    }
    if (plans.length < 2) {
      sendError(
        response,
        400,
        'invalid_models',
        text(
          language,
          'Для сравнения нужно хотя бы 2 разные модели',
          'Comparison needs at least 2 different models',
        ),
      );
      return;
    }

    if (activeUsers.has(identity.userId)) {
      sendError(
        response,
        429,
        'compare_in_progress',
        text(
          language,
          'Предыдущее сравнение ещё идёт. Дождитесь его завершения или остановите его.',
          'The previous comparison is still running. Wait for it to finish or stop it.',
        ),
      );
      return;
    }
    activeUsers.add(identity.userId);

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    let cancelled = false;
    const abort = new AbortController();
    const onClientClose = (): void => {
      // Закрытое соединение (вкладка, кнопка «Стоп») останавливает все колонки; сделанное сохраняется.
      if (!response.writableEnded) {
        cancelled = true;
        abort.abort();
      }
    };
    response.on('close', onClientClose);
    const heartbeat = setInterval(() => {
      if (!response.writableEnded && !response.destroyed) response.write(': ping\n\n');
    }, HEARTBEAT_MS);

    const write = (event: string, payload: unknown): void => {
      if (response.writableEnded || response.destroyed) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const runId = runs.newId();
    const existing = store.get(identity.userId, conversationId);
    const last = messages[messages.length - 1];
    const summaries = new Map<number, string>();

    write('compare_start', {
      runId,
      slots: plans.map((planned) => ({
        slot: planned.slot,
        requestedModelId: planned.requestedModelId,
        modelName: planned.entry.name,
      })),
    });

    const runSlot = async (planned: SlotPlan): Promise<CompareSlotResult> => {
      const startedAt = Date.now();
      let ttftMs: number | null = null;
      let content = '';
      let settled = false;
      const result: CompareSlotResult = {
        slot: planned.slot,
        requestedModelId: planned.requestedModelId,
        modelId: planned.entry.id,
        modelName: planned.entry.name,
        status: 'cancelled',
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        ttftMs: null,
      };

      try {
        await aiGateway.stream(
          {
            userId: identity.userId,
            userPlan: identity.plan,
            userEmail: identity.email,
            isVip: identity.isVip,
            isAnonymous: false,
            conversationId,
            modelId: planned.requestedModelId,
            messages: messages.map((message) => ({
              role: message.role,
              content: message.content,
              attachments: message.attachments,
              workspaceContext: message.workspaceContext,
            })),
            attachments: last?.attachments,
            workspaceContext: last?.workspaceContext,
            language,
            stream: true,
            reasoningMode,
            cachedSummary: existing?.conversation.contextSummary,
            signal: abort.signal,
            strictModel: true,
          },
          {
            onDelta: (delta) => {
              if (ttftMs === null) ttftMs = Date.now() - startedAt;
              content += delta;
              write('compare_delta', { slot: planned.slot, content: delta });
            },
            onDone: (done) => {
              settled = true;
              result.status = 'complete';
              result.modelId = done.selectedModel?.id ?? result.modelId;
              result.modelName = done.selectedModel?.name ?? result.modelName;
              result.finishReason = done.finishReason;
              result.canContinue = done.canContinue;
              result.routingReason = done.routingReason;
              result.inputTokens = done.inputTokens;
              result.outputTokens = done.outputTokens;
              if (done.contextSummary) summaries.set(planned.slot, done.contextSummary);
              write('compare_slot_done', {
                slot: planned.slot,
                selectedModel: done.selectedModel,
                routingReason: done.routingReason,
                source: done.source,
                finishReason: done.finishReason,
                canContinue: done.canContinue,
                reasoningMode: done.reasoningMode,
                usage: { inputTokens: done.inputTokens, outputTokens: done.outputTokens },
                latencyMs: Date.now() - startedAt,
                ttftMs,
              });
            },
            onError: (error) => {
              settled = true;
              result.status = 'error';
              result.errorCode = error.code;
              result.errorMessage = error.message;
              write('compare_slot_error', {
                slot: planned.slot,
                code: error.code,
                message: error.message,
              });
            },
          },
          () => cancelled,
        );
      } catch (error) {
        console.error('[compare] сбой колонки сравнения:', error);
        if (!settled) {
          result.status = 'error';
          result.errorCode = 'internal_error';
          result.errorMessage = text(
            language,
            'Внутренняя ошибка сервера',
            'Internal server error',
          );
          write('compare_slot_error', {
            slot: planned.slot,
            code: result.errorCode,
            message: result.errorMessage,
          });
        }
      }

      result.content = content;
      result.latencyMs = Date.now() - startedAt;
      result.ttftMs = ttftMs;
      return result;
    };

    try {
      const slots = await Promise.all(plans.map((planned) => runSlot(planned)));

      // В диалог уходит ответ первой колонки, у которой есть текст и нет ошибки. Если успешных нет,
      // сохраняется только вопрос (как в обычном чате при сбое), чтобы он не пропал.
      const defaultSlot = slots.find(
        (slot) => slot.status !== 'error' && slot.content.trim() !== '',
      );
      const saved = store.saveTurn({
        userId: identity.userId,
        conversationId,
        history: messages as readonly IncomingMessage[],
        assistant: defaultSlot
          ? {
              content: defaultSlot.content,
              modelId: defaultSlot.modelId,
              status: 'complete',
              finishReason: defaultSlot.finishReason,
              canContinue: defaultSlot.canContinue,
            }
          : { content: '', modelId: plans[0].entry.id, status: 'error' },
      });
      const summary = defaultSlot ? summaries.get(defaultSlot.slot) : undefined;
      if (summary) store.updateContextSummary(identity.userId, conversationId, summary);

      runs.put({
        id: runId,
        userId: identity.userId,
        conversationId,
        slots,
        savedSlot: defaultSlot ? defaultSlot.slot : null,
        savedMessageId: saved?.assistant.id ?? null,
        pickedSlot: null,
        createdAt: Date.now(),
      });

      write('compare_done', {
        runId,
        savedMessageId: saved?.assistant.id ?? null,
        defaultSlot: defaultSlot ? defaultSlot.slot : null,
      });
    } catch (error) {
      console.error('[compare] сбой сравнения:', error);
      write('error', {
        code: 'internal_error',
        message: text(language, 'Внутренняя ошибка сервера', 'Internal server error'),
      });
    } finally {
      clearInterval(heartbeat);
      activeUsers.delete(identity.userId);
      response.off('close', onClientClose);
      if (!response.writableEnded) response.end();
    }
  });

  /**
   * Выбор лучшего ответа. Текст берётся из запуска, сохранённого на сервере, а не из запроса:
   * клиент указывает только колонку. Выбор заменяет ответ в диалоге и записывает голос.
   */
  router.post('/pick', (request: Request, response: Response): void => {
    const sessionUser = request.user;
    if (!sessionUser) {
      sendError(response, 401, 'unauthorized', 'Войдите в аккаунт');
      return;
    }
    const body = request.body as { runId?: unknown; slot?: unknown };
    if (typeof body.runId !== 'string' || body.runId.trim() === '') {
      sendError(response, 400, 'invalid_request', 'Поле runId обязательно');
      return;
    }
    if (typeof body.slot !== 'number' || !Number.isInteger(body.slot) || body.slot < 0) {
      sendError(response, 400, 'invalid_request', 'Поле slot должно быть номером колонки');
      return;
    }

    const run = runs.get(body.runId.trim(), sessionUser.id);
    if (!run) {
      sendError(
        response,
        410,
        'compare_expired',
        'Результат сравнения устарел. В диалоге остался ответ, сохранённый при сравнении.',
      );
      return;
    }
    const chosen = run.slots.find((slot) => slot.slot === body.slot);
    if (!chosen || chosen.status === 'error' || chosen.content.trim() === '') {
      sendError(response, 400, 'invalid_slot', 'У этой колонки нет ответа, который можно выбрать');
      return;
    }

    if (run.savedSlot !== chosen.slot) {
      // Ответ заменяется, только пока диалог не продолжился: иначе выбор переписал бы середину.
      const conversation = store.get(sessionUser.id, run.conversationId);
      const lastMessage = conversation?.messages[conversation.messages.length - 1];
      if (
        !conversation ||
        !lastMessage ||
        lastMessage.role !== 'assistant' ||
        lastMessage.id !== run.savedMessageId
      ) {
        sendError(response, 409, 'compare_stale', 'Диалог уже продолжился: заменить ответ нельзя.');
        return;
      }
      const history: IncomingMessage[] = conversation.messages.slice(0, -1).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        attachments: message.attachments,
        workspaceContext: message.workspaceContext,
      }));
      const saved = store.saveTurn({
        userId: sessionUser.id,
        conversationId: run.conversationId,
        history,
        assistant: {
          content: chosen.content,
          modelId: chosen.modelId,
          status: 'complete',
          finishReason: chosen.finishReason,
          canContinue: chosen.canContinue,
        },
      });
      if (!saved) {
        sendError(response, 404, 'conversation_not_found', 'Диалог не найден');
        return;
      }
      run.savedSlot = chosen.slot;
      run.savedMessageId = saved.assistant.id;
    }
    run.pickedSlot = chosen.slot;

    // Голос осмыслен, только если было из чего выбирать.
    const participants = run.slots
      .filter((slot) => slot.status !== 'error' && slot.content.trim() !== '')
      .map((slot) => slot.modelId);
    if (participants.length >= 2) {
      const stored = userStore?.findById(sessionUser.id);
      votes.put({
        id: run.id,
        userId: sessionUser.id,
        conversationId: run.conversationId,
        plan: stored?.plan ?? sessionUser.plan,
        winnerModelId: chosen.modelId,
        participantModelIds: participants,
        votedAt: new Date().toISOString(),
      });
    }

    response.json({
      success: true,
      runId: run.id,
      slot: chosen.slot,
      messageId: run.savedMessageId,
      modelId: chosen.modelId,
    });
  });

  /** Победы моделей в сравнениях (только администратору): какие ответы выбирают чаще. */
  router.get('/stats', (request: Request, response: Response): void => {
    const adminKey = request.headers['x-admin-key'];
    const isAdmin =
      isAdminUser(request.user) ||
      (typeof adminKey === 'string' && safeEqualStrings(adminKey, config.adminApiKey));
    if (!isAdmin) {
      sendError(response, 403, 'admin_access_denied', 'Требуются права администратора');
      return;
    }
    response.json(votes.stats());
  });

  return router;
}
