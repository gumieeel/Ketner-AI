import { Router, type Request, type Response } from 'express';
import { ERROR_MESSAGES } from '../ai/answers.js';
import { AIGateway } from '../ai/gateway.js';
import { canAccessModel, DEFAULT_MODEL_ID, resolveModel } from '../ai/models.js';
import { delay, randomBetween } from '../ai/stream.js';
import { type AiConfig } from '../config.js';
import { sendError } from '../middleware/errors.js';
import type { ConversationStore } from '../store/conversation-store.js';
import { usageStore as defaultUsageStore, type UsageStore } from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import type { IncomingMessage, Language, MessageStatus, PlanId } from '../types.js';
import { isVipUser, isVipEmail } from '../services/vip.js';

const MAX_MESSAGES = 200;
const MAX_CONTENT_LENGTH = 8000;

/** Тело запроса на генерацию. Контракт зафиксирован в docs/ai-integration-todo.md. */
export interface CompletionRequest {
  conversationId: string;
  modelId: string;
  language: Language;
  messages: IncomingMessage[];
  userId?: string;
  userEmail?: string;
  userPlan?: string;
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
      return { ok: false, message: 'У каждого сообщения должен быть непустой content или вложения' };
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
      userId: typeof candidate.userId === 'string' ? candidate.userId.trim() : undefined,
      userEmail: typeof candidate.userEmail === 'string' ? candidate.userEmail.trim() : undefined,
      userPlan: typeof candidate.userPlan === 'string' ? candidate.userPlan.trim() : undefined,
      messages,
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
}: ChatRouterDeps): Router {
  const router = Router();
  const aiGateway =
    gateway ??
    new AIGateway({
      usageStore,
      aiConfig: ai,
    });

  router.post('/completions', async (request: Request, response: Response): Promise<void> => {
    const parsed = parseCompletionRequest(request.body);
    if (!parsed.ok) {
      sendError(response, 400, 'invalid_request', parsed.message);
      return;
    }

    const {
      conversationId,
      modelId,
      language,
      messages,
      userId: bodyUserId,
      userEmail: bodyEmail,
      userPlan: bodyPlan,
    } = parsed.value;
    let activeUserId = request.userId ?? bodyUserId ?? userId;

    if (!store.get(activeUserId, conversationId)) {
      if (store.get(userId, conversationId)) {
        activeUserId = userId;
      } else if (bodyUserId && store.get(bodyUserId, conversationId)) {
        activeUserId = bodyUserId;
      }
    }

    if (!store.get(activeUserId, conversationId)) {
      sendError(response, 404, 'conversation_not_found', `Диалог ${conversationId} не найден`);
      return;
    }

    const model = resolveModel(modelId);

    // Определение текущего тарифа пользователя
    const currentSub = subscriptionStore?.get(activeUserId);
    const currentUser =
      userStore?.findById(activeUserId) ?? (bodyEmail ? userStore?.findByEmail(bodyEmail) : undefined);
    const VALID_PLANS: PlanId[] = ['free', 'gpt-pro', 'claude-pro', 'gemini-pro', 'ultra', 'plus', 'pro'];

    let userPlan: PlanId =
      request.user?.plan ?? currentSub?.plan ?? currentUser?.plan ?? 'free';

    if (userPlan === 'free' && bodyPlan && VALID_PLANS.includes(bodyPlan as PlanId)) {
      userPlan = bodyPlan as PlanId;
    }

    if (
      isVipUser(request.user) ||
      isVipUser(currentUser) ||
      (bodyEmail && isVipEmail(bodyEmail)) ||
      (request.user?.email && isVipEmail(request.user.email)) ||
      (currentUser?.email && isVipEmail(currentUser.email)) ||
      bodyPlan === 'ultra' ||
      userPlan === 'ultra'
    ) {
      userPlan = 'ultra';
    }

    // Проверка доступа к платным моделям
    if (model.isPro && !canAccessModel(userPlan, model)) {
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
    const onClientClose = (): void => {
      cancelled = true;
    };
    response.on('close', onClientClose);

    const writeEvent = (event: string, payload: unknown): void => {
      if (cancelled || response.writableEnded) {
        return;
      }
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const finishTurn = (
      content: string,
      status: MessageStatus,
      assistantModelId = model.id,
    ): string | null => {
      const saved = store.saveTurn({
        userId: activeUserId,
        conversationId,
        history: messages,
        assistant: { content, modelId: assistantModelId, status },
      });
      return saved?.assistant.id ?? null;
    };

    let content = '';
    try {
      const shouldFail = ai.failureRate > 0 && ai.random() < ai.failureRate;

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
          userEmail: request.user?.email ?? currentUser?.email,
          isVip: isVipUser(request.user) || isVipUser(currentUser),
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
        },
        {
          onDelta: (delta) => {
            content += delta;
            writeEvent('delta', { content: delta });
          },
          onDone: (result) => {
            const actualModelId = result.selectedModel?.id ?? model.id;
            const messageId = finishTurn(content, 'complete', actualModelId);
            if (messageId) {
              writeEvent('done', {
                messageId,
                selectedModel: result.selectedModel,
                routingReason: result.routingReason,
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

  return router;
}
