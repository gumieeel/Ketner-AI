import { Router } from 'express';
import { ERROR_MESSAGES, pickAnswer } from '../ai/answers.js';
import { DEFAULT_MODEL_ID, resolveModel } from '../ai/models.js';
import { delay, randomBetween, streamText } from '../ai/stream.js';
import type { AiConfig } from '../config.js';
import { sendError } from '../middleware/errors.js';
import type { ConversationStore } from '../store/conversation-store.js';
import type { IncomingMessage, Language, MessageStatus } from '../types.js';

const MAX_MESSAGES = 200;
const MAX_CONTENT_LENGTH = 8000;

/** Тело запроса на генерацию. Контракт зафиксирован в docs/ai-integration-todo.md. */
export interface CompletionRequest {
  conversationId: string;
  modelId: string;
  language: Language;
  messages: IncomingMessage[];
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
    if (typeof raw.content !== 'string' || raw.content.trim() === '') {
      return { ok: false, message: 'У каждого сообщения должен быть непустой content' };
    }
    if (raw.content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, message: `Сообщение длиннее ${MAX_CONTENT_LENGTH} символов` };
    }
    messages.push({ id: raw.id, role: raw.role, content: raw.content, createdAt: raw.createdAt });
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
    },
  };
}

/** Оценка токенов без токенизатора: примерно четыре символа на токен. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

export interface ChatRouterDeps {
  store: ConversationStore;
  userId: string;
  ai: AiConfig;
}

/**
 * Ответ ИИ потоком.
 *
 * Событий ровно три (`delta`, `done`, `error`) — столько же разбирает фронтенд.
 * При подключении реального провайдера меняется только начинка обработчика.
 */
export function createChatRouter({ store, userId, ai }: ChatRouterDeps): Router {
  const router = Router();

  router.post('/completions', async (request, response) => {
    const parsed = parseCompletionRequest(request.body);
    if (!parsed.ok) {
      sendError(response, 400, 'invalid_request', parsed.message);
      return;
    }

    const { conversationId, modelId, language, messages } = parsed.value;

    if (!store.get(userId, conversationId)) {
      sendError(response, 404, 'conversation_not_found', `Диалог ${conversationId} не найден`);
      return;
    }

    const model = resolveModel(modelId);
    // В модель уходит только хвост истории: так же будет вести себя реальный провайдер.
    const context = messages.slice(-model.contextMessages);
    const prompt =
      [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    let cancelled = false;
    // Закрытие соединения останавливает генерацию: кнопка «Стоп» не имитация.
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

    const finishTurn = (content: string, status: MessageStatus): string | null => {
      const saved = store.saveTurn({
        userId,
        conversationId,
        history: messages,
        assistant: { content, modelId: model.id, status },
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

      await streamText(pickAnswer(prompt, language, ai.random), {
        thinkingMs: ai.thinkingMs,
        chunkMs: ai.chunkMs,
        random: ai.random,
        isCancelled: () => cancelled,
        onDelta: (delta) => {
          content += delta;
          writeEvent('delta', { content: delta });
        },
      });

      // Остановленный на середине ответ сохраняется: после перезагрузки страницы
      // пользователь увидит тот же текст.
      const messageId = finishTurn(content, 'complete');
      if (messageId) {
        writeEvent('done', {
          messageId,
          usage: {
            inputTokens: estimateTokens(context.map((message) => message.content).join(' ')),
            outputTokens: estimateTokens(content),
          },
        });
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
