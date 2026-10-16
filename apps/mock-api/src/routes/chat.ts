import { Router, type Request, type Response } from 'express';
import { ERROR_MESSAGES } from '../ai/answers.js';
import { AIGateway, classifyPromptComplexity } from '../ai/gateway.js';
import type { PremiumCreditSource } from '../store/premium-credit-store.js';
import type { PlanBonusSource } from '../services/premium-quota.js';
import { DEFAULT_MODEL_ID } from '../ai/models.js';
import { modelRegistry } from '../ai/model-registry.js';
import { delay, randomBetween } from '../ai/stream.js';
import { config, isProduction, type AiConfig } from '../config.js';
import { sendError } from '../middleware/errors.js';
import { resolveGuestId } from '../middleware/guest.js';
import { RateLimiter, clientIp } from '../middleware/rate-limit.js';
import type { ConversationStore } from '../store/conversation-store.js';
import {
  usageStore as defaultUsageStore,
  feedbackStore as defaultFeedbackStore,
  type UsageStore,
  type FeedbackStore,
  type PromptComplexityLevel,
} from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { isAdminUser } from '../services/vip.js';
import { safeEqualStrings } from '../auth/safe-equal.js';
import { EntitlementService } from '../services/entitlement.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import { PayloadGuard } from '../ai/payload-guard.js';
import type { Language, IncomingMessage, MessageStatus, FeedbackRating } from '../types.js';
import type { ReasoningMode } from '../ai/gateway-types.js';

const MAX_MESSAGES = 200;
const MAX_CONTENT_LENGTH = 200000;

/** Тело запроса на генерацию. Контракт зафиксирован в docs/ai-integration-todo.md. */
export interface CompletionRequest {
  conversationId: string;
  modelId: string;
  language: Language;
  messages: IncomingMessage[];
  /** Режим размышлений: max действует только на Ultra (сервер проверяет тариф сам). */
  reasoningMode?: ReasoningMode;
}

type ParseResult = { ok: true; value: CompletionRequest } | { ok: false; message: string };

function parseCompletionRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, message: 'Тело запроса должно быть объектом JSON' };
  }

  const candidate = body as Partial<CompletionRequest>;
  if (typeof candidate.conversationId !== 'string' || candidate.conversationId === '') {
    return { ok: false, message: 'Поле conversationId обязательно' };
  }
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    return { ok: false, message: 'Поле messages должно содержать хотя бы одно сообщение' };
  }
  if (candidate.messages.length > MAX_MESSAGES) {
    return { ok: false, message: `Слишком длинная история: не больше ${MAX_MESSAGES} сообщений` };
  }

  const messages: IncomingMessage[] = [];
  for (const raw of candidate.messages) {
    if (raw.role !== 'user' && raw.role !== 'assistant') {
      return { ok: false, message: 'Роль сообщения должна быть user или assistant' };
    }
    const hasAttachments = Array.isArray(raw.attachments) && raw.attachments.length > 0;
    const content = typeof raw.content === 'string' ? raw.content : '';
    if (!hasAttachments && content.trim() === '') {
      return {
        ok: false,
        message: 'У каждого сообщения должен быть непустой content или вложения',
      };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, message: `Сообщение длиннее ${MAX_CONTENT_LENGTH} символов` };
    }
    messages.push({
      id: raw.id,
      role: raw.role,
      content,
      createdAt: raw.createdAt,
      attachments: Array.isArray(raw.attachments) ? raw.attachments : undefined,
      workspaceContext: raw.workspaceContext,
    });
  }

  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return { ok: false, message: 'Последнее сообщение должно быть от пользователя' };
  }

  return {
    ok: true,
    value: {
      conversationId: candidate.conversationId,
      modelId: typeof candidate.modelId === 'string' ? candidate.modelId : DEFAULT_MODEL_ID,
      language: candidate.language === 'en' ? 'en' : 'ru',
      messages,
      reasoningMode: candidate.reasoningMode === 'max' ? 'max' : 'standard',
    },
  };
}

export interface ChatRouterDeps {
  store: ConversationStore;
  userId: string;
  ai: AiConfig;
  subscriptionStore?: SubscriptionStore;
  userStore?: UserStore;
  usageStore?: UsageStore;
  gateway?: AIGateway;
  feedbackStore?: FeedbackStore;
  /** Кредиты докупленных пакетов (тот же журнал, что у биллинга). */
  premiumCredits?: PremiumCreditSource;
  /** Бонус к квоте за оплату криптой (тот же биллинг). */
  planBonus?: PlanBonusSource;
  /**
   * Разрешить анонимные вызовы через общий demo-user. По умолчанию — только вне production
   * (config.allowAnonymousChat); в production чат без сессии отвечает 401.
   */
  allowAnonymous?: boolean;
  /** Лимит гостевых сообщений на адрес клиента (по умолчанию — в production). */
  limitGuestsByIp?: boolean;
}

/**
 * Ответ ИИ потоком через AI Gateway.
 *
 * Событий ровно три (`delta`, `done`, `error`) — столько же разбирает фронтенд.
 */
export function createChatRouter({
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
  allowAnonymous = config.allowAnonymousChat,
  limitGuestsByIp = isProduction,
}: ChatRouterDeps): Router {
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

  // Гостевой id придумывает сам браузер, поэтому лимит «на гостя» обходится сменой id.
  // Поверх него — лимит на адрес клиента: бесплатный гостевой доступ не превращается в безлимит.
  const guestPerIpHour = new RateLimiter(60 * 60 * 1000, 15);
  const guestPerIpDay = new RateLimiter(24 * 60 * 60 * 1000, 40);

  router.post('/completions', async (request: Request, response: Response): Promise<void> => {
    const parsed = parseCompletionRequest(request.body);
    if (!parsed.ok) {
      sendError(response, 400, 'invalid_request', parsed.message);
      return;
    }

    const guardResult = PayloadGuard.validate(parsed.value.messages, {
      language: parsed.value.language,
      workspace: parsed.value.messages[parsed.value.messages.length - 1]?.workspaceContext,
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

    const { conversationId, modelId, language, messages } = parsed.value;

    // Личность и тариф — только из сессии и серверных хранилищ. Поля userId / userEmail / userPlan
    // из тела запроса не читаются: клиент не вправе назваться другим пользователем или поднять тариф.
    const sessionUser = request.user;
    const guestId = sessionUser ? null : resolveGuestId(request, userId);
    if (!sessionUser && guestId === null) {
      sendError(response, 400, 'invalid_guest_id', 'Не передан корректный идентификатор гостя');
      return;
    }
    const effectiveAnonymousUserId = guestId ?? userId;

    const identity = resolveChatIdentity({
      sessionUser,
      storedUser: sessionUser ? userStore?.findById(sessionUser.id) : undefined,
      subscription: sessionUser ? subscriptionStore?.get(sessionUser.id) : undefined,
      anonymousUserId: effectiveAnonymousUserId,
      anonymousPlan: config.demoPlan,
      allowAnonymous,
    });
    if (!identity.ok) {
      sendError(response, identity.status, identity.code, identity.message);
      return;
    }
    const { userId: activeUserId, plan: userPlan, isVip } = identity;

    if (identity.anonymous && limitGuestsByIp) {
      const ip = clientIp(request);
      if (guestPerIpHour.isLimited(ip) || guestPerIpDay.isLimited(ip)) {
        response.setHeader(
          'Retry-After',
          String(Math.max(guestPerIpHour.retryAfterSec(ip), guestPerIpDay.retryAfterSec(ip))),
        );
        sendError(
          response,
          429,
          'guest_limit',
          language === 'en'
            ? 'Guest message limit reached. Sign in to keep chatting for free.'
            : 'Лимит сообщений без входа исчерпан. Войдите, чтобы продолжить бесплатно.',
        );
        return;
      }
      guestPerIpHour.record(ip);
      guestPerIpDay.record(ip);
    }

    // Диалог ищется строго среди диалогов этого пользователя: чужой id даёт 404.
    if (!store.get(activeUserId, conversationId)) {
      sendError(response, 404, 'conversation_not_found', `Диалог ${conversationId} не найден`);
      return;
    }

    // Единый каталог: любая модель реестра выбирается как есть, неизвестная — это auto.
    const requestedEntry = modelId === 'auto' ? undefined : modelRegistry.get(modelId);
    let model =
      requestedEntry && requestedEntry.enabled ? requestedEntry : modelRegistry.resolve('auto');

    // Для пользователей без аккаунта:
    // По умолчанию (auto) или при выборе бесплатной модели используется Nemotron Ultra через OpenRouter.
    if (identity.anonymous) {
      if (model.id === 'auto' || model.costClass === 'lite' || !model.isPro) {
        model = modelRegistry.resolve('nemotron-ultra');
      }
    }

    // Проверка доступа к платным моделям (то же правило, что применяет шлюз)
    const access = EntitlementService.checkModelAccess(model, userPlan, identity.email, isVip);
    if (!access.allowed) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      const requiredName = model.requiredPlan ? model.requiredPlan.toUpperCase() : 'PRO';
      const errorMsg =
        language === 'en'
          ? `Access to ${model.name} requires an active subscription (${requiredName} or Ultra). Please upgrade your plan.`
          : `Для доступа к модели ${model.name} требуется подписка (${requiredName} или Ultra). Пожалуйста, улучшите ваш тариф (Upgrade your plan).`;

      response.write(
        `event: error\ndata: ${JSON.stringify({ code: 'upgrade_required', message: errorMsg })}\n\n`,
      );
      response.end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    let cancelled = false;
    const clientAbortController = new AbortController();
    const onClientClose = (): void => {
      cancelled = true;
      clientAbortController.abort();
    };
    response.on('close', onClientClose);

    const writeEvent = (event: string, payload: unknown): void => {
      if (cancelled || response.writableEnded) {
        return;
      }
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const existingConversation = store.get(activeUserId, conversationId);

    const finishTurn = (
      content: string,
      status: MessageStatus,
      assistantModelId = model.id,
      finishReason?: 'stop' | 'length' | 'cancelled' | 'error',
      canContinue?: boolean,
    ): string | null => {
      const saved = store.saveTurn({
        userId: activeUserId,
        conversationId,
        history: messages,
        assistant: { content, modelId: assistantModelId, status, finishReason, canContinue },
      });
      return saved?.assistant.id ?? null;
    };

    let content = '';
    try {
      // Имитация сбоев существует только вне production (в production failureRate всегда 0).
      const shouldFail = !isProduction && ai.failureRate > 0 && ai.random() < ai.failureRate;

      if (shouldFail) {
        await delay(randomBetween(ai.thinkingMs, ai.random));
        writeEvent('error', { code: 'upstream_error', message: ERROR_MESSAGES[language] });
        finishTurn('', 'error');
        response.end();
        return;
      }

      await aiGateway.stream(
        {
          userId: activeUserId,
          userPlan,
          userEmail: identity.email,
          isVip,
          isAnonymous: Boolean(identity.anonymous),
          conversationId,
          modelId: model.id,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            attachments: m.attachments,
            workspaceContext: m.workspaceContext,
          })),
          attachments: messages[messages.length - 1]?.attachments,
          workspaceContext: messages[messages.length - 1]?.workspaceContext,
          language,
          stream: true,
          reasoningMode: parsed.value.reasoningMode,
          cachedSummary: existingConversation?.conversation.contextSummary,
          signal: clientAbortController.signal,
        },
        {
          onDelta: (delta) => {
            content += delta;
            writeEvent('delta', { content: delta });
          },
          onDone: (result) => {
            const actualModelId = result.selectedModel?.id ?? model.id;
            const messageId = finishTurn(
              content,
              'complete',
              actualModelId,
              result.finishReason,
              result.canContinue,
            );
            if (result.contextSummary) {
              store.updateContextSummary(activeUserId, conversationId, result.contextSummary);
            }
            if (messageId) {
              writeEvent('done', {
                messageId,
                selectedModel: result.selectedModel,
                routingReason: result.routingReason,
                source: result.source,
                finishReason: result.finishReason,
                canContinue: result.canContinue,
                reasoningMode: result.reasoningMode,
                usage: {
                  inputTokens: result.inputTokens,
                  outputTokens: result.outputTokens,
                },
              });
            }
          },
          onError: (err) => {
            finishTurn(content, 'error');
            writeEvent('error', err);
          },
        },
        () => cancelled,
      );

      // В случае остановки клиентом на середине сохраняем частичный результат
      if (cancelled && content.length > 0) {
        finishTurn(content, 'complete');
      }

      response.end();
    } catch (error) {
      console.error('[mock-api] сбой генерации:', error);
      finishTurn(content, 'error');
      writeEvent('error', { code: 'internal_error', message: ERROR_MESSAGES[language] });
      response.end();
    } finally {
      response.off('close', onClientClose);
    }
  });

  /**
   * Сбор пользовательской оценки ответа (лайк / дизлайк).
   * Сохраняет оценку в сообщении диалога и регистрирует в FeedbackStore для анализа роутинга.
   */
  router.post('/feedback', (request: Request, response: Response): void => {
    const body = request.body as {
      conversationId?: unknown;
      messageId?: unknown;
      rating?: unknown;
      reason?: unknown;
      comment?: unknown;
      modelId?: unknown;
    };

    if (typeof body.conversationId !== 'string' || !body.conversationId.trim()) {
      sendError(response, 400, 'invalid_conversation_id', 'Поле conversationId обязательно');
      return;
    }
    if (typeof body.messageId !== 'string' || !body.messageId.trim()) {
      sendError(response, 400, 'invalid_message_id', 'Поле messageId обязательно');
      return;
    }
    if (body.rating !== 'like' && body.rating !== 'dislike' && body.rating !== null) {
      sendError(
        response,
        400,
        'invalid_rating',
        'Поле rating должно быть "like", "dislike" или null',
      );
      return;
    }

    const conversationId = body.conversationId.trim();
    const messageId = body.messageId.trim();
    const rating = body.rating as FeedbackRating | null;
    if (!request.user && !allowAnonymous) {
      sendError(response, 401, 'unauthorized', 'Войдите в аккаунт, чтобы оценивать ответы');
      return;
    }
    const activeUserId = request.user?.id ?? resolveGuestId(request, userId);
    if (!activeUserId) {
      sendError(response, 400, 'invalid_guest_id', 'Не передан корректный идентификатор гостя');
      return;
    }

    // 1. Обновляем сообщение в хранилище диалогов
    const updatedMsg = store.updateMessageFeedback(activeUserId, conversationId, messageId, rating);
    if (!updatedMsg) {
      sendError(response, 404, 'message_not_found', 'Сообщение не найдено в диалоге');
      return;
    }

    // 2. Определяем сложность запроса для анализа эскалации
    const convData = store.get(activeUserId, conversationId);
    let complexityLevel: PromptComplexityLevel = 'simple';
    if (convData) {
      const msgIndex = convData.messages.findIndex((m) => m.id === messageId);
      const prevUserMsg = msgIndex > 0 ? convData.messages[msgIndex - 1] : undefined;
      if (prevUserMsg && prevUserMsg.role === 'user') {
        complexityLevel = classifyPromptComplexity(prevUserMsg.content).level;
      }
    }

    // 3. Записываем в FeedbackStore, если rating задан
    let feedbackRecord = null;
    if (rating !== null) {
      feedbackRecord = feedbackStore.recordFeedback({
        messageId,
        conversationId,
        userId: activeUserId,
        modelId:
          typeof body.modelId === 'string' && body.modelId.trim()
            ? body.modelId.trim()
            : (updatedMsg.modelId ?? 'unknown'),
        engineModelId: updatedMsg.modelId,
        complexityLevel,
        rating,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        comment: typeof body.comment === 'string' ? body.comment : undefined,
      });
    }

    response.json({
      success: true,
      messageId,
      conversationId,
      rating,
      feedback: feedbackRecord,
    });
  });

  /**
   * Получение аналитики оценок и статуса авто-эскалации лёгких моделей.
   */
  router.get('/feedback/analytics', (request: Request, response: Response): void => {
    // Аналитика маршрутизации — внутренние данные: только администратору.
    const adminKey = request.headers['x-admin-key'];
    const isAdmin =
      isAdminUser(request.user) ||
      (typeof adminKey === 'string' && safeEqualStrings(adminKey, config.adminApiKey));
    if (!isAdmin) {
      sendError(response, 403, 'admin_access_denied', 'Требуются права администратора');
      return;
    }
    const from = typeof request.query.from === 'string' ? request.query.from : undefined;
    const to = typeof request.query.to === 'string' ? request.query.to : undefined;
    const analytics = feedbackStore.getAnalytics({ from, to });
    response.json(analytics);
  });

  return router;
}
