import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { AIGateway } from '../ai/gateway.js';
import { modelRegistry } from '../ai/model-registry.js';
import { config, type AiConfig } from '../config.js';
import { sendError } from '../middleware/errors.js';
import {
  answerReviewTemplate,
  buildAnswerReviewInput,
  buildAnswerReviewPrompt,
  parseAnswerReview,
  runReviewTask,
  type ReviewCaller,
} from '../services/answer-review.js';
import { resolveChatIdentity } from '../services/chat-identity.js';
import { EntitlementService } from '../services/entitlement.js';
import type { PlanBonusSource } from '../services/premium-quota.js';
import { dailyReviewLimit, pickReviewers } from '../services/review-policy.js';
import type { ConversationStore } from '../store/conversation-store.js';
import type { PremiumCreditSource } from '../store/premium-credit-store.js';
import {
  usageStore as defaultUsageStore,
  feedbackStore as defaultFeedbackStore,
  type UsageStore,
  type FeedbackStore,
} from '../store/index.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import type { AnswerReview, Language } from '../types.js';
import { openSse } from './sse.js';

export interface ReviewRouterDeps {
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
}

function text(language: Language, ru: string, en: string): string {
  return language === 'en' ? en : ru;
}

export interface ReviewQuota {
  used: number;
  limit: number;
  remaining: number;
}

export function reviewQuota(usageStore: UsageStore, userId: string, plan: string): ReviewQuota {
  const limit = dailyReviewLimit(plan);
  const used = usageStore.getReviewsLastDay(userId);
  return { used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Кто проверяет: только аккаунт (у гостей общий demo-user и общий лимит). Возвращает null, если
 * ответ с ошибкой уже отправлен.
 */
export function resolveReviewCaller(
  request: Request,
  response: Response,
  deps: Pick<ReviewRouterDeps, 'userId' | 'userStore' | 'subscriptionStore'>,
  language: Language,
): ReviewCaller | null {
  const sessionUser = request.user;
  if (!sessionUser) {
    sendError(
      response,
      401,
      'unauthorized',
      text(language, 'Войдите в аккаунт, чтобы проверять ответы', 'Sign in to review answers'),
    );
    return null;
  }
  const identity = resolveChatIdentity({
    sessionUser,
    storedUser: deps.userStore?.findById(sessionUser.id),
    subscription: deps.subscriptionStore?.get(sessionUser.id),
    anonymousUserId: deps.userId,
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
    email: identity.email,
    isVip: identity.isVip,
  };
}

/** Ответ 429 о суточном лимите проверок. */
export function sendReviewLimit(response: Response, quota: ReviewQuota, language: Language): void {
  sendError(
    response,
    429,
    'review_limit',
    text(
      language,
      `Проверки на сегодня закончились (${quota.limit} в сутки на вашем тарифе). Лимит восстанавливается постепенно, а на старших тарифах он больше.`,
      `You have used today's reviews (${quota.limit} per day on your plan). The limit restores gradually; higher plans get more.`,
    ),
  );
}

/**
 * Проверка ответа в чате моделью другой компании.
 *
 * POST /api/chat/review { conversationId, messageId, language } — поток SSE:
 *   review_start    { reviewId, quota }
 *   review_reviewer { reviewer: { modelId, modelName, developer } }
 *   review_done     { review, quota }
 *   error           { code, message }
 *
 * Итог сохраняется у сообщения (`message.review`) и виден после перезагрузки.
 */
export function createReviewRouter(deps: ReviewRouterDeps): Router {
  const router = Router();
  const usageStore = deps.usageStore ?? defaultUsageStore;
  const gateway =
    deps.gateway ??
    new AIGateway({
      usageStore,
      aiConfig: deps.ai,
      feedbackStore: deps.feedbackStore ?? defaultFeedbackStore,
      premiumCredits: deps.premiumCredits,
      planBonus: deps.planBonus,
    });
  /** Одна проверка на человека за раз: иначе пачка кликов съела бы весь лимит. */
  const activeUsers = new Set<string>();

  router.get('/quota', (request: Request, response: Response): void => {
    const caller = resolveReviewCaller(request, response, deps, 'ru');
    if (!caller) return;
    response.json(reviewQuota(usageStore, caller.userId, caller.plan));
  });

  router.post('/', async (request: Request, response: Response): Promise<void> => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const language: Language = body.language === 'en' ? 'en' : 'ru';
    if (typeof body.conversationId !== 'string' || typeof body.messageId !== 'string') {
      sendError(
        response,
        400,
        'invalid_request',
        text(
          language,
          'Нужны поля conversationId и messageId',
          'conversationId and messageId are required',
        ),
      );
      return;
    }
    const caller = resolveReviewCaller(request, response, deps, language);
    if (!caller) return;

    const conversation = deps.store.getOwned(caller.userId, body.conversationId);
    if (!conversation) {
      sendError(
        response,
        404,
        'conversation_not_found',
        text(language, 'Диалог не найден', 'Conversation not found'),
      );
      return;
    }
    const index = conversation.messages.findIndex((message) => message.id === body.messageId);
    const target = index >= 0 ? conversation.messages[index] : undefined;
    if (
      !target ||
      target.role !== 'assistant' ||
      target.content.trim() === '' ||
      target.status === 'error'
    ) {
      sendError(
        response,
        400,
        'invalid_message',
        text(
          language,
          'Проверить можно только готовый ответ ассистента',
          'Only a finished assistant answer can be reviewed',
        ),
      );
      return;
    }
    const question = [...conversation.messages.slice(0, index)]
      .reverse()
      .find((message) => message.role === 'user');

    const quota = reviewQuota(usageStore, caller.userId, caller.plan);
    if (quota.remaining <= 0) {
      sendReviewLimit(response, quota, language);
      return;
    }
    if (activeUsers.has(caller.userId)) {
      sendError(
        response,
        429,
        'review_in_progress',
        text(language, 'Предыдущая проверка ещё идёт', 'The previous review is still running'),
      );
      return;
    }

    const candidates = pickReviewers(
      caller.plan,
      target.modelId ? [target.modelId] : [],
      modelRegistry,
    );
    activeUsers.add(caller.userId);
    const sse = openSse(response);
    const reviewId = randomUUID();
    try {
      sse.write('review_start', { reviewId, quota });
      const result = await runReviewTask({
        gateway,
        caller,
        candidates,
        reviewId,
        systemPrompt: buildAnswerReviewPrompt(language),
        userContent: buildAnswerReviewInput(question?.content ?? '', target.content, language),
        templateOutput: answerReviewTemplate(target.content, language),
        language,
        conversationId: conversation.conversation.id,
        signal: sse.signal,
        onReviewer: (reviewer) => sse.write('review_reviewer', { reviewer }),
      });
      if (!result.ok) {
        sse.write('error', { code: result.code, message: result.message });
        return;
      }
      if (result.cancelled) {
        sse.write('error', {
          code: 'cancelled',
          message: text(language, 'Проверка остановлена', 'Review stopped'),
        });
        return;
      }
      const parsed = parseAnswerReview(result.text, target.content);
      const review: AnswerReview = {
        id: reviewId,
        ...parsed,
        reviewer: result.reviewer,
        ...(target.modelId ? { authorModelId: target.modelId } : {}),
        createdAt: new Date().toISOString(),
      };
      deps.store.updateMessageReview(
        caller.userId,
        conversation.conversation.id,
        target.id,
        review,
      );
      sse.write('review_done', {
        review,
        quota: reviewQuota(usageStore, caller.userId, caller.plan),
      });
    } catch (error) {
      console.error('[review] сбой проверки ответа:', error);
      sse.write('error', {
        code: 'internal_error',
        message: text(language, 'Внутренняя ошибка сервера', 'Internal server error'),
      });
    } finally {
      activeUsers.delete(caller.userId);
      sse.end();
    }
  });

  return router;
}
