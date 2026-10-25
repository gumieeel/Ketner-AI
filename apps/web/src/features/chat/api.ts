import { storage } from '@/lib/storage';
import { getAuthToken, useAuth } from '../auth/auth-store';
import { readSseStream } from './sse';
import { API_BASE } from '@/lib/api-config';
import type { ChatMeta, Conversation, ConversationSummary, Language, Message } from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const GUEST_ID_KEY = 'ketner_guest_id';

/**
 * Сервер не принял Bearer-токен (устарел, сменился ключ при деплое): запрос ушёл как гостевой.
 * Пересверяем сессию: устаревшая сбрасывается, и интерфейс просит войти заново.
 */
export function checkSessionInvalid(response: Response): void {
  if (
    response.headers.get('X-Session-Invalid') === '1' &&
    useAuth.getState().status === 'authenticated'
  ) {
    void useAuth.getState().restoreSession();
  }
}

export function getGuestId(): string {
  let guestId = storage.get(GUEST_ID_KEY);
  if (!guestId) {
    guestId = `guest_${Math.random().toString(36).substring(2, 11)}_${Date.now().toString(36)}`;
    storage.set(GUEST_ID_KEY, guestId);
  }
  return guestId;
}

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
  } else {
    headers['X-Guest-Id'] = getGuestId();
  }
  if (init?.headers) {
    Object.assign(headers, init.headers);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  checkSessionInvalid(response);

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

function readSelectedModelId(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === 'string' && id !== '' ? id : undefined;
  }
  return undefined;
}

export interface CompletionHandlers {
  onDelta: (content: string) => void;
  onDone: (payload: {
    messageId: string;
    finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
    canContinue?: boolean;
    /** Модель, которая реально ответила (при Auto, замене по квоте или сбое она отличается от выбранной). */
    selectedModelId?: string;
  }) => void;
  onError: (payload: { code: string; message: string }) => void;
}

export interface CompletionRequest {
  conversationId: string;
  modelId: string;
  language: Language;
  /** История целиком: сервер приводит к ней своё состояние. */
  messages: readonly Message[];
  signal: AbortSignal;
  /** Режим размышлений: max действует только на Ultra (сервер проверяет тариф сам). */
  reasoningMode?: 'standard' | 'max';
}

/**
 * Отправляет историю и читает ответ потоком.
 *
 * Клиент разбирает ровно три события: `delta`, `done`, `error`. Провайдера
 * можно менять, не трогая этот код: контракт — docs/api.md (раздел «Чат (SSE)»).
 */
export async function streamCompletion(
  completion: CompletionRequest,
  handlers: CompletionHandlers,
): Promise<void> {
  const token = getAuthToken();
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    headers['X-Guest-Id'] = getGuestId();
  }
  // Личность и тариф определяет сервер по сессии; клиент их не присылает.
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers,
    credentials: 'include',
    signal: completion.signal,
    body: JSON.stringify({
      conversationId: completion.conversationId,
      modelId: completion.modelId,
      ...(completion.reasoningMode === 'max' ? { reasoningMode: 'max' } : {}),
      // `language` — заглушечная замена системного промпта: у реального
      // провайдера язык ответа задаётся системным сообщением.
      language: completion.language,
      messages: completion.messages.map((message, idx) => {
        const isLatest = idx === completion.messages.length - 1;
        let wsContext = message.workspaceContext;
        if (wsContext && !isLatest && wsContext.files) {
          wsContext = {
            name: wsContext.name,
            type: wsContext.type,
            pathOrUrl: wsContext.pathOrUrl,
            branch: wsContext.branch,
            filesCount: wsContext.filesCount,
          };
        }
        return {
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          attachments: message.attachments,
          workspaceContext: wsContext,
        };
      }),
    }),
  });
  checkSessionInvalid(response);

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
      const reason = payload.finishReason;
      handlers.onDone({
        messageId: String(payload.messageId ?? ''),
        finishReason:
          reason === 'stop' || reason === 'length' || reason === 'cancelled' || reason === 'error'
            ? reason
            : undefined,
        canContinue: payload.canContinue === true,
        selectedModelId: readSelectedModelId(payload.selectedModel),
      });
    } else if (event.event === 'error') {
      handlers.onError({
        code: String(payload.code ?? 'upstream_error'),
        message: String(payload.message ?? ''),
      });
    }
  });
}

export interface SendFeedbackParams {
  conversationId: string;
  messageId: string;
  rating: 'like' | 'dislike' | null;
  modelId?: string;
  reason?: string;
  comment?: string;
}

export function sendFeedback(params: SendFeedbackParams): Promise<{ success: boolean }> {
  return request('/chat/feedback', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export interface CompareSlotInfo {
  slot: number;
  requestedModelId: string;
  modelName: string;
}

export interface CompareSlotDone {
  slot: number;
  selectedModelId?: string;
  modelName?: string;
  routingReason?: string;
  finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
  canContinue?: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  ttftMs: number | null;
}

export interface CompareHandlers {
  onStart: (payload: { runId: string; slots: CompareSlotInfo[] }) => void;
  onDelta: (slot: number, content: string) => void;
  onSlotDone: (payload: CompareSlotDone) => void;
  onSlotError: (payload: { slot: number; code: string; message: string }) => void;
  onDone: (payload: {
    runId: string;
    savedMessageId: string | null;
    defaultSlot: number | null;
  }) => void;
  /** Ошибка всего запроса (сбой сервера уже после начала потока). */
  onError: (payload: { code: string; message: string }) => void;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Сравнение ответов нескольких моделей на последний вопрос истории: одна колонка на модель.
 * Контракт событий — docs/api.md (раздел «Сравнение ответов»).
 */
export async function streamCompare(
  request: Omit<CompletionRequest, 'modelId'> & { modelIds: readonly string[] },
  handlers: CompareHandlers,
): Promise<void> {
  const token = getAuthToken();
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  else headers['X-Guest-Id'] = getGuestId();

  const response = await fetch(`${API_BASE}/chat/compare`, {
    method: 'POST',
    headers,
    credentials: 'include',
    signal: request.signal,
    body: JSON.stringify({
      conversationId: request.conversationId,
      modelIds: request.modelIds,
      language: request.language,
      ...(request.reasoningMode === 'max' ? { reasoningMode: 'max' } : {}),
      messages: request.messages.map((message, idx) => {
        const isLatest = idx === request.messages.length - 1;
        let wsContext = message.workspaceContext;
        if (wsContext && !isLatest && wsContext.files) {
          wsContext = {
            name: wsContext.name,
            type: wsContext.type,
            pathOrUrl: wsContext.pathOrUrl,
            branch: wsContext.branch,
            filesCount: wsContext.filesCount,
          };
        }
        return {
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          attachments: message.attachments,
          workspaceContext: wsContext,
        };
      }),
    }),
  });
  checkSessionInvalid(response);

  if (!response.ok) throw await toApiError(response);
  if (!response.body) {
    throw new ApiError('empty_stream', 'Сервер не вернул поток ответа', response.status);
  }

  await readSseStream(response.body, (event) => {
    const payload = JSON.parse(event.data) as Record<string, unknown>;
    const slot = numberOr(payload.slot, -1);
    switch (event.event) {
      case 'compare_start':
        handlers.onStart({
          runId: String(payload.runId ?? ''),
          slots: Array.isArray(payload.slots) ? (payload.slots as CompareSlotInfo[]) : [],
        });
        break;
      case 'compare_delta':
        handlers.onDelta(slot, typeof payload.content === 'string' ? payload.content : '');
        break;
      case 'compare_slot_done': {
        const usage = (payload.usage ?? {}) as Record<string, unknown>;
        const selected = payload.selectedModel as { id?: unknown; name?: unknown } | undefined;
        const reason = payload.finishReason;
        handlers.onSlotDone({
          slot,
          selectedModelId: readSelectedModelId(selected),
          modelName: typeof selected?.name === 'string' ? selected.name : undefined,
          routingReason:
            typeof payload.routingReason === 'string' ? payload.routingReason : undefined,
          finishReason:
            reason === 'stop' || reason === 'length' || reason === 'cancelled' || reason === 'error'
              ? reason
              : undefined,
          canContinue: payload.canContinue === true,
          inputTokens: numberOr(usage.inputTokens, 0),
          outputTokens: numberOr(usage.outputTokens, 0),
          latencyMs: numberOr(payload.latencyMs, 0),
          ttftMs: typeof payload.ttftMs === 'number' ? payload.ttftMs : null,
        });
        break;
      }
      case 'compare_slot_error':
        handlers.onSlotError({
          slot,
          code: String(payload.code ?? 'upstream_error'),
          message: String(payload.message ?? ''),
        });
        break;
      case 'compare_done':
        handlers.onDone({
          runId: String(payload.runId ?? ''),
          savedMessageId:
            typeof payload.savedMessageId === 'string' ? payload.savedMessageId : null,
          defaultSlot: typeof payload.defaultSlot === 'number' ? payload.defaultSlot : null,
        });
        break;
      case 'error':
        handlers.onError({
          code: String(payload.code ?? 'upstream_error'),
          message: String(payload.message ?? ''),
        });
        break;
      default:
        break;
    }
  });
}

/** Выбор лучшего ответа: сервер берёт текст из сохранённого запуска, клиент называет только колонку. */
export function pickCompareAnswer(
  runId: string,
  slot: number,
): Promise<{ messageId: string | null; modelId: string }> {
  return request('/chat/compare/pick', {
    method: 'POST',
    body: JSON.stringify({ runId, slot }),
  });
}
