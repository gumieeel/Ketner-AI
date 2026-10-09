import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { AgentGateway, type AgentFailure, type AgentSuccess } from '../ai/agent-gateway.js';
import type { AgentStreamEvent } from '../ai/agent/agent-types.js';
import {
  buildChunk,
  buildCompletionResponse,
  buildErrorBody,
  buildUsageChunk,
  newCompletionId,
  parseChatRequest,
  toOpenAiFinishReason,
  type ChunkDelta,
  type KetnerExtension,
} from '../ai/agent/openai-compat.js';
import type { PlanId, User } from '../types.js';
import { resolveUserPlan } from '../services/user-plan.js';
import type { ApiKeyStore } from '../store/api-key-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UsageStore } from '../store/usage-store.js';
import type { UserStore } from '../store/user-store.js';

/** Тело запроса не больше 8 МБ: история агента большая, но не бесконечная. */
export const V1_BODY_LIMIT = '8mb';
/** Если модель молчит дольше, поток открывается комментарием, чтобы прокси не оборвал соединение. */
const KEEPALIVE_MS = 10_000;

export interface V1RouterDeps {
  apiKeyStore: ApiKeyStore;
  userStore: UserStore;
  subscriptionStore?: SubscriptionStore;
  usageStore: UsageStore;
  gateway?: AgentGateway;
}

interface AgentCaller {
  keyId: string;
  user: User;
  plan: PlanId;
  isVip: boolean;
}

function sendOpenAiError(
  response: Response,
  status: number,
  code: string,
  message: string,
  options: { param?: string; retryAfterSec?: number } = {},
): void {
  if (options.retryAfterSec) response.setHeader('Retry-After', String(options.retryAfterSec));
  response.status(status).json(buildErrorBody(status, code, message, options.param));
}

const sendFailure = (response: Response, failure: AgentFailure): void =>
  sendOpenAiError(response, failure.status, failure.code, failure.message, {
    retryAfterSec: failure.retryAfterSec,
  });

function ketnerExtension(outcome: AgentSuccess): KetnerExtension {
  return {
    cost_usd: outcome.costUsd,
    requested_model: outcome.requestedModel,
    routing_reason: outcome.routingReason,
    budget: {
      stage: outcome.budget.stage,
      used_pct: outcome.budget.usedPct,
      premium_available: outcome.budget.premiumAvailable,
    },
  };
}

/**
 * OpenAI-совместимый API для программирования: `/v1/models`, `/v1/usage`, `/v1/chat/completions`.
 * Контракт: docs/agent-api.md. Авторизация только API-ключом (`Authorization: Bearer ketner_sk_…`).
 */
export function createV1Router(deps: V1RouterDeps): Router {
  const router = Router();
  const gateway = deps.gateway ?? new AgentGateway({ usageStore: deps.usageStore });

  const authenticate = (request: Request, response: Response, next: NextFunction): void => {
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
    if (!match) {
      sendOpenAiError(
        response,
        401,
        'invalid_api_key',
        'Укажите API-ключ в заголовке Authorization: Bearer ketner_sk_…',
      );
      return;
    }
    const record = deps.apiKeyStore.verify(match[1]);
    const user = record ? deps.userStore.findById(record.userId) : null;
    if (!record || !user) {
      sendOpenAiError(response, 401, 'invalid_api_key', 'Ключ не найден или отозван. Создайте новый в разделе API.');
      return;
    }
    const { plan, isVip } = resolveUserPlan(user, deps.userStore, deps.subscriptionStore);
    deps.apiKeyStore.touch(record.id);
    response.locals.caller = { keyId: record.id, user, plan, isVip } satisfies AgentCaller;
    next();
  };

  router.get('/models', authenticate, (_request: Request, response: Response) => {
    const caller = response.locals.caller as AgentCaller;
    response.json({
      object: 'list',
      data: gateway.describeModels(caller.plan).map((model) => ({
        id: model.id,
        object: 'model',
        created: 1_760_000_000,
        owned_by: 'ketner',
        name: model.name,
        context_window: model.context_window,
        max_output_tokens: model.max_output_tokens,
        cost_class: model.cost_class,
        requires_plan: model.requires_plan,
        available: model.available,
      })),
    });
  });

  router.get('/usage', authenticate, (_request: Request, response: Response) => {
    const caller = response.locals.caller as AgentCaller;
    response.json(gateway.summarizeUsage(caller.user.id, caller.plan));
  });

  router.post(
    '/chat/completions',
    authenticate,
    express.json({ limit: V1_BODY_LIMIT }),
    async (request: Request, response: Response): Promise<void> => {
      const caller = response.locals.caller as AgentCaller;
      const parsed = parseChatRequest(request.body);
      if (!parsed.ok) {
        sendOpenAiError(response, 400, 'invalid_request_error', parsed.message, { param: parsed.param });
        return;
      }
      const body = parsed.value;

      // Клиент закрыл соединение: прекращаем генерацию, чтобы не платить за ответ, который никто не прочтёт.
      const abort = new AbortController();
      let finished = false;
      const onClose = (): void => {
        if (!finished) abort.abort();
      };
      response.on('close', onClose);

      const id = newCompletionId();
      const created = Math.floor(Date.now() / 1000);
      let started = false;
      let roleSent = false;
      let streamedModel = '';
      let streamedContent = false;
      let streamedToolCalls = false;
      let keepAlive: NodeJS.Timeout | undefined;

      const writeData = (payload: unknown): void => {
        if (!response.writableEnded && !response.destroyed) {
          response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
        }
      };
      const startStream = (): void => {
        if (started) return;
        started = true;
        response.status(200);
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        response.flushHeaders();
      };
      const sendDelta = (delta: ChunkDelta): void => {
        writeData(buildChunk({ id, created, model: streamedModel, delta }));
      };
      const ensureRole = (modelId: string): void => {
        startStream();
        if (roleSent) return;
        roleSent = true;
        streamedModel = modelId;
        sendDelta({ role: 'assistant', content: '' });
      };

      if (body.stream) {
        keepAlive = setInterval(() => {
          startStream();
          if (!response.writableEnded && !response.destroyed) response.write(': keepalive\n\n');
        }, KEEPALIVE_MS);
      }

      const forward = (event: AgentStreamEvent, modelId: string): void => {
        if (!body.stream) return;
        ensureRole(modelId);
        if (event.kind === 'content') {
          streamedContent = true;
          sendDelta({ content: event.text });
        } else if (event.kind === 'reasoning') {
          sendDelta({ reasoning_content: event.text });
        } else {
          streamedToolCalls = true;
          sendDelta({
            tool_calls: [
              {
                index: event.index,
                ...(event.id ? { id: event.id, type: 'function' as const } : {}),
                function: {
                  ...(event.name ? { name: event.name } : {}),
                  ...(event.argumentsDelta !== undefined
                    ? { arguments: event.argumentsDelta }
                    : event.name
                      ? { arguments: '' }
                      : {}),
                },
              },
            ],
          });
        }
      };

      try {
        const outcome = await gateway.run(
          {
            userId: caller.user.id,
            userPlan: caller.plan,
            userEmail: caller.user.email,
            isVip: caller.isVip,
            keyId: caller.keyId,
            model: body.model,
            messages: body.messages,
            tools: body.tools,
            toolChoice: body.toolChoice,
            maxTokens: body.maxTokens,
            temperature: body.temperature,
            reasoningEffort: body.reasoningEffort,
            signal: abort.signal,
          },
          { onEvent: (event, info) => forward(event, info.model.id) },
        );

        if (abort.signal.aborted) return;

        if (outcome.kind === 'error') {
          if (!started) {
            sendFailure(response, outcome);
            return;
          }
          writeData(buildErrorBody(outcome.status, outcome.code, outcome.message));
          writeData('[DONE]');
          response.end();
          return;
        }

        if (!body.stream) {
          response.json(
            buildCompletionResponse({
              id,
              created,
              model: outcome.model.id,
              content: outcome.content,
              toolCalls: outcome.toolCalls,
              finishReason: toOpenAiFinishReason(outcome.finishReason),
              usage: outcome.usage,
              ketner: ketnerExtension(outcome),
            }),
          );
          return;
        }

        // Провайдер мог вернуть ответ, не присылая фрагментов: досылаем его целиком.
        ensureRole(outcome.model.id);
        if (!streamedContent && outcome.content) sendDelta({ content: outcome.content });
        if (!streamedToolCalls && outcome.toolCalls.length > 0) {
          sendDelta({
            tool_calls: outcome.toolCalls.map((call, index) => ({
              index,
              id: call.id,
              type: 'function' as const,
              function: { name: call.function.name, arguments: call.function.arguments },
            })),
          });
        }
        if (outcome.finishReason === 'error') {
          writeData(buildErrorBody(502, 'upstream_error', 'Ответ модели оборвался. Повторите запрос.'));
        } else {
          writeData(
            buildChunk({
              id,
              created,
              model: streamedModel,
              delta: {},
              finishReason: toOpenAiFinishReason(outcome.finishReason),
            }),
          );
        }
        writeData(
          buildUsageChunk({
            id,
            created,
            model: streamedModel,
            usage: outcome.usage,
            ketner: ketnerExtension(outcome),
          }),
        );
        writeData('[DONE]');
        response.end();
      } finally {
        finished = true;
        if (keepAlive) clearInterval(keepAlive);
        response.off('close', onClose);
      }
    },
  );

  // Всё остальное под /v1 и ошибки разбора тела отвечают в формате OpenAI.
  router.use((request: Request, response: Response) => {
    sendOpenAiError(response, 404, 'not_found', `Эндпоинт ${request.method} ${request.originalUrl} не найден`);
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.too.large') {
      sendOpenAiError(response, 413, 'request_too_large', 'Тело запроса больше 8 МБ: сожмите историю диалога.');
      return;
    }
    if (type === 'entity.parse.failed') {
      sendOpenAiError(response, 400, 'invalid_request_error', 'Тело запроса не является корректным JSON');
      return;
    }
    console.error('[v1] необработанная ошибка:', error);
    if (response.headersSent) {
      response.end();
      return;
    }
    sendOpenAiError(response, 500, 'internal_error', 'Внутренняя ошибка сервера');
  });

  return router;
}
