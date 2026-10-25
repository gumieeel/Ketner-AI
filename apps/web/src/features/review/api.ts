import { getAuthToken } from '../auth/auth-store';
import { ApiError, checkSessionInvalid } from '../chat/api';
import { readSseStream } from '../chat/sse';
import type { Language } from '../chat/types';
import { API_BASE } from '@/lib/api-config';
import type { AnswerReview, JudgeResult, ReviewQuota, ReviewerInfo } from './types';

function headers(): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallback = `Запрос завершился со статусом ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(
      body.error?.code ?? 'unknown_error',
      body.error?.message ?? fallback,
      response.status,
    );
  } catch {
    return new ApiError('unknown_error', fallback, response.status);
  }
}

/**
 * POST с ответом-потоком SSE. Ошибка до начала потока (лимит, нет доступа) — исключение
 * ApiError; ошибка внутри потока приходит событием `error` и тоже превращается в ApiError.
 */
async function postStream(
  path: string,
  body: unknown,
  onEvent: (event: string, payload: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    credentials: 'include',
    signal,
    body: JSON.stringify(body),
  });
  checkSessionInvalid(response);
  if (!response.ok) throw await toApiError(response);
  if (!response.body) {
    throw new ApiError('empty_stream', 'Сервер не вернул поток ответа', response.status);
  }
  let failure: ApiError | null = null;
  await readSseStream(response.body, (event) => {
    const payload = JSON.parse(event.data) as Record<string, unknown>;
    if (event.event === 'error') {
      failure = new ApiError(
        String(payload.code ?? 'upstream_error'),
        String(payload.message ?? ''),
        200,
      );
      return;
    }
    onEvent(event.event, payload);
  });
  if (failure) throw failure;
}

export interface ReviewStreamHandlers<T> {
  onReviewer?: (reviewer: ReviewerInfo) => void;
  onDelta?: (content: string) => void;
  onDone: (result: T, quota: ReviewQuota | null) => void;
}

function quotaOf(value: unknown): ReviewQuota | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return typeof record.limit === 'number' && typeof record.remaining === 'number'
    ? { used: Number(record.used ?? 0), limit: record.limit, remaining: record.remaining }
    : null;
}

/** Проверка ответа в чате моделью другой компании. */
export function streamAnswerReview(
  params: { conversationId: string; messageId: string; language: Language },
  handlers: ReviewStreamHandlers<AnswerReview>,
  signal?: AbortSignal,
): Promise<void> {
  return postStream(
    '/chat/review',
    params,
    (event, payload) => {
      if (event === 'review_reviewer') handlers.onReviewer?.(payload.reviewer as ReviewerInfo);
      else if (event === 'review_done')
        handlers.onDone(payload.review as AnswerReview, quotaOf(payload.quota));
    },
    signal,
  );
}

/** Судья сравнения: итоговый ответ из ответов колонок и где модели расходятся. */
export function streamJudge(
  params: { runId: string; language: Language },
  handlers: ReviewStreamHandlers<JudgeResult>,
  signal?: AbortSignal,
): Promise<void> {
  return postStream(
    '/chat/compare/judge',
    params,
    (event, payload) => {
      if (event === 'judge_reviewer') handlers.onReviewer?.(payload.reviewer as ReviewerInfo);
      else if (event === 'judge_delta')
        handlers.onDelta?.(typeof payload.content === 'string' ? payload.content : '');
      else if (event === 'judge_done')
        handlers.onDone(payload.judge as JudgeResult, quotaOf(payload.quota));
    },
    signal,
  );
}

/** Итог судьи становится ответом в диалоге. */
export async function saveJudge(
  runId: string,
): Promise<{ messageId: string | null; modelId: string }> {
  const response = await fetch(`${API_BASE}/chat/compare/judge/save`, {
    method: 'POST',
    headers: headers(),
    credentials: 'include',
    body: JSON.stringify({ runId }),
  });
  checkSessionInvalid(response);
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as { messageId: string | null; modelId: string };
}

/** Ревью правок запуска агента Ketner Code. Итог — запись ленты `kind: 'review'`. */
export function streamCodeReview<T>(
  params: { projectId: string; runId: string; language: Language },
  handlers: ReviewStreamHandlers<T>,
  signal?: AbortSignal,
): Promise<void> {
  return postStream(
    `/code/projects/${encodeURIComponent(params.projectId)}/review`,
    { runId: params.runId, language: params.language },
    (event, payload) => {
      if (event === 'review_reviewer') handlers.onReviewer?.(payload.reviewer as ReviewerInfo);
      else if (event === 'review_done') handlers.onDone(payload.item as T, quotaOf(payload.quota));
    },
    signal,
  );
}
