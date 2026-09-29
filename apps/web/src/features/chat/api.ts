import { getAuthToken } from '../auth/auth-store';
import { readSseStream } from './sse';
import { API_BASE } from '@/lib/api-config';
import type { ChatMeta, Conversation, ConversationSummary, Language, Message } from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Ошибка API: код и текст приходят от сервера в едином формате. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (init?.headers) {
    Object.assign(headers, init.headers);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const body = await request<{ conversations: ConversationSummary[] }>('/conversations');
  return body.conversations;
}

export function fetchConversation(
  id: string,
): Promise<{ conversation: Conversation; messages: Message[] }> {
  return request(`/conversations/${encodeURIComponent(id)}`);
}

export async function createConversation(title: string): Promise<Conversation> {
  const body = await request<{ conversation: Conversation }>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return body.conversation;
}

export async function renameConversation(id: string, title: string): Promise<Conversation> {
  const body = await request<{ conversation: Conversation }>(
    `/conversations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ title }) },
  );
  return body.conversation;
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function fetchMeta(): Promise<ChatMeta> {
  return request<ChatMeta>('/meta');
}

export interface CompletionHandlers {
  onDelta: (content: string) => void;
  onDone: (payload: { messageId: string }) => void;
  onError: (payload: { code: string; message: string }) => void;
}

export interface CompletionRequest {
  conversationId: string;
  modelId: string;
  language: Language;
  /** История целиком: сервер приводит к ней своё состояние. */
  messages: readonly Message[];
  signal: AbortSignal;
}

/**
 * Отправляет историю и читает ответ потоком.
 *
 * Клиент разбирает ровно три события: `delta`, `done`, `error`. Провайдера
 * можно менять, не трогая этот код: контракт — docs/ai-integration-todo.md.
 */
export async function streamCompletion(
  completion: CompletionRequest,
  handlers: CompletionHandlers,
): Promise<void> {
  const token = getAuthToken();
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers,
    signal: completion.signal,
    body: JSON.stringify({
      conversationId: completion.conversationId,
      modelId: completion.modelId,
      // `language` — заглушечная замена системного промпта: у реального
      // провайдера язык ответа задаётся системным сообщением.
      language: completion.language,
      messages: completion.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
    }),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (!response.body) {
    throw new ApiError('empty_stream', 'Сервер не вернул поток ответа', response.status);
  }

  await readSseStream(response.body, (event) => {
    const payload = JSON.parse(event.data) as Record<string, unknown>;
    if (event.event === 'delta') {
      handlers.onDelta(typeof payload.content === 'string' ? payload.content : '');
    } else if (event.event === 'done') {
      handlers.onDone({ messageId: String(payload.messageId ?? '') });
    } else if (event.event === 'error') {
      handlers.onError({
        code: String(payload.code ?? 'upstream_error'),
        message: String(payload.message ?? ''),
      });
    }
  });
}
