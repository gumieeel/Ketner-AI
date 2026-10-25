import { create } from 'zustand';
import { translate } from '@/i18n';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useAuth } from '@/features/auth/auth-store';
import { reasoningModeFor } from '@/features/chat/reasoning-mode';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { canAccessModel, findModel, getRequiredPlanName } from './can-access-model';
import * as api from './api';
import { ApiError } from './api';
import { deriveTitle } from './derive-title';
import { useCompare, type CompareSlotView } from './compare-store';
import { maxCompareModels, sanitizeCompareModelIds } from './compare-policy';
import type {
  ChatMeta,
  ConversationSummary,
  Message,
  MessageAttachment,
  WorkspaceContext,
  WorkspaceFile,
} from './types';
import { useWorkspace } from './workspace-store';
import { isSensitivePath } from './file-operations/path-safety';
import { saveJudge as saveJudgeAnswer, streamJudge } from '@/features/review/api';
import { useReview } from '@/features/review/review-store';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Порция стрима попадает в состояние не чаще, чем раз в этот интервал.
 * Чанки приходят каждые 20-40 мс, а перерисовывать markdown на каждый из них
 * незачем — интерфейс дёргался бы и грел процессор.
 */
const STREAM_FLUSH_MS = 60;

interface ChatState {
  conversations: ConversationSummary[];
  conversationsStatus: LoadStatus;
  activeId: string | null;
  messages: Message[];
  messagesStatus: LoadStatus;
  meta: ChatMeta | null;
  streaming: boolean;
  streamingConversations: Record<string, boolean>;
  conversationMessages: Record<string, Message[]>;
  search: string;
  draft: string;
  attachedFiles: MessageAttachment[];

  addAttachments: (files: MessageAttachment[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;

  loadConversations: (silent?: boolean) => Promise<void>;
  openConversation: (id: string | undefined, force?: boolean) => Promise<void>;
  setSearch: (search: string) => void;
  setDraft: (draft: string) => void;
  loadMeta: () => Promise<void>;
  send: (
    text?: string,
    attachmentsOverride?: MessageAttachment[],
    /** false — служебная реплика («продолжи»): в режиме сравнения она уходит одной моделью. */
    allowCompare?: boolean,
  ) => Promise<void>;
  stop: (id?: string) => void;
  regenerate: () => Promise<void>;
  /** Просит модель дописать ответ, оборванный лимитом длины или таймаутом. */
  continueReply: () => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  sendFeedback: (messageId: string, rating: 'like' | 'dislike') => Promise<void>;
  /** Выбрать лучший ответ сравнения: он заменяет ответ, сохранённый в диалоге. */
  pickCompare: (slot: number) => Promise<void>;
  /** Свернуть колонки сравнения: в ленте остаётся сохранённый ответ. */
  dismissCompare: () => void;
  /** Консилиум: модель другой компании собирает итог из ответов колонок. */
  runJudge: () => Promise<void>;
  /** Итог консилиума становится ответом в диалоге. */
  saveJudge: () => Promise<void>;
}

/** Контроллеры отмены и таймеры сброса буфера живут per-conversation. */
const abortControllers = new Map<string, AbortController>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `local-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Отмена генерации приходит разными объектами: `AbortError` из fetch и
 * `DOMException` из потока. Второй не всегда наследует `Error`, поэтому
 * проверяем имя, а не тип.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** Текст для пользователя: технические детали сбоя уходят в консоль. */
function describeError(error: unknown): string {
  const language = usePreferences.getState().language;
  if (error instanceof ApiError) {
    if (error.code === 'conversation_not_found') {
      console.error('[chat] диалог не найден:', error);
      return translate(language, 'chat.errorNotFound');
    }
    if (error.message && error.message !== 'unknown_error') {
      console.error('[chat] ошибка API:', error);
      return error.message;
    }
  }
  console.error('[chat] сбой запроса:', error);
  return translate(language, 'chat.errorText');
}

function createAssistantMessage(conversationId: string, modelId: string): Message {
  return {
    id: createId(),
    conversationId,
    role: 'assistant',
    content: '',
    createdAt: nowIso(),
    status: 'pending',
    modelId,
  };
}

function lastAssistantIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return index;
    }
  }
  return -1;
}

function prepareWorkspaceForSending(ws: WorkspaceContext | null): Message['workspaceContext'] {
  if (!ws) return undefined;

  let totalChars = 0;
  const MAX_TOTAL_CHARS = 300000;

  const sanitizedFiles = (ws.files || []).map((file: WorkspaceFile) => {
    let content = file.content;
    let truncated = file.truncated === true;
    if (isSensitivePath(file.path)) {
      // Секреты (.env, ключи) не покидают браузер.
      content = undefined;
    } else if (content && content.length > 0) {
      if (totalChars < MAX_TOTAL_CHARS) {
        if (content.length > 25000) {
          content = content.slice(0, 25000);
          truncated = true;
        }
        totalChars += content.length;
      } else {
        content = undefined;
      }
    }
    return {
      path: file.path,
      size: file.size,
      language: file.language,
      content,
      ...(truncated && content !== undefined ? { truncated: true } : {}),
    };
  });

  return {
    name: ws.name,
    type: ws.type,
    pathOrUrl: ws.pathOrUrl,
    branch: ws.branch,
    filesCount: ws.filesCount,
    files: sanitizedFiles,
  };
}

/**
 * Состояние чата.
 *
 * Источник правды о диалогах — mock-API: клиент отправляет историю целиком, а
 * сервер приводит к ней своё состояние. Поэтому правка сообщения, повторная
 * генерация и остановка работают без отдельных эндпоинтов.
 */
export const useChat = create<ChatState>((set, get) => {
  /** Просит сервер сгенерировать ответ и показывает его порциями. */
  async function runTurn(
    conversationId: string,
    history: Message[],
    assistantId: string,
  ): Promise<void> {
    const controller = new AbortController();
    abortControllers.set(conversationId, controller);
    // Новый ответ делает прежнее сравнение неактуальным: колонки сворачиваются.
    useCompare.getState().clearRun(conversationId);

    set((state) => ({
      streamingConversations: { ...state.streamingConversations, [conversationId]: true },
      streaming: state.activeId === conversationId ? true : state.streaming,
    }));

    let buffer = '';

    const flush = (): void => {
      const timer = flushTimers.get(conversationId);
      if (timer) {
        clearTimeout(timer);
        flushTimers.delete(conversationId);
      }
      if (buffer === '') {
        return;
      }
      const chunk = buffer;
      buffer = '';

      set((state) => {
        const existing =
          state.conversationMessages[conversationId] ??
          (state.activeId === conversationId ? state.messages : []);
        const updated: Message[] = existing.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + chunk, status: 'streaming' as const }
            : message,
        );
        const next: Partial<ChatState> = {
          conversationMessages: {
            ...state.conversationMessages,
            [conversationId]: updated,
          },
        };
        if (state.activeId === conversationId) {
          next.messages = updated;
        }
        return next;
      });
    };

    const scheduleFlush = (): void => {
      // Во вкладках в фоне браузеры замедляют setTimeout — сбрасываем сразу
      if (typeof document !== 'undefined' && (document.hidden || buffer.length >= 40)) {
        flush();
      } else if (!flushTimers.has(conversationId)) {
        const timer = setTimeout(flush, STREAM_FLUSH_MS);
        flushTimers.set(conversationId, timer);
      }
    };

    const updateAssistant = (patch: Partial<Message>): void => {
      set((state) => {
        const existing =
          state.conversationMessages[conversationId] ??
          (state.activeId === conversationId ? state.messages : []);
        const updated = existing.map((message) =>
          message.id === assistantId ? { ...message, ...patch } : message,
        );
        const next: Partial<ChatState> = {
          conversationMessages: {
            ...state.conversationMessages,
            [conversationId]: updated,
          },
        };
        if (state.activeId === conversationId) {
          next.messages = updated;
        }
        return next;
      });
    };

    try {
      await api.streamCompletion(
        {
          conversationId,
          modelId: usePreferences.getState().chatModelId,
          language: usePreferences.getState().language,
          messages: history,
          signal: controller.signal,
          reasoningMode: reasoningModeFor(
            useAuth.getState().user,
            usePreferences.getState().maxMode,
          ),
        },
        {
          onDelta: (delta) => {
            buffer += delta;
            scheduleFlush();
          },
          onDone: ({ messageId, finishReason, canContinue, selectedModelId }) => {
            flush();
            updateAssistant({
              id: messageId === '' ? assistantId : messageId,
              status: 'complete',
              finishReason,
              canContinue,
              // Показываем модель, которая реально ответила, а не ту, что выбрана в переключателе.
              ...(selectedModelId ? { modelId: selectedModelId } : {}),
            });
          },
          onError: ({ code, message }) => {
            flush();
            console.error('[chat] ошибка генерации:', code, message);
            // Лимиты считает сервер. Когда он отказал бесплатному аккаунту, предлагаем перейти на платный тариф.
            const refusedUser = useAuth.getState().user;
            if (
              (code === 'rate_limited' || code === 'fair_use_exceeded') &&
              (!refusedUser || !refusedUser.plan || refusedUser.plan === 'free')
            ) {
              useUpgradeModal.getState().open({ reason: 'free_limit' });
            }
            updateAssistant({
              status: 'error',
              error: message || translate(usePreferences.getState().language, 'chat.errorText'),
              errorCode: code,
            });
          },
        },
      );

      flush();
      set((state) => {
        const existing =
          state.conversationMessages[conversationId] ??
          (state.activeId === conversationId ? state.messages : []);
        const updated: Message[] = existing.map((message) =>
          message.id === assistantId &&
          (message.status === 'pending' || message.status === 'streaming')
            ? { ...message, status: 'complete' as const }
            : message,
        );
        const next: Partial<ChatState> = {
          conversationMessages: {
            ...state.conversationMessages,
            [conversationId]: updated,
          },
        };
        if (state.activeId === conversationId) {
          next.messages = updated;
        }
        return next;
      });
    } catch (error) {
      flush();
      if (isAbortError(error)) {
        set((state) => {
          const existing =
            state.conversationMessages[conversationId] ??
            (state.activeId === conversationId ? state.messages : []);
          const updated: Message[] = existing.map((message) =>
            message.id === assistantId && message.status !== 'error'
              ? { ...message, status: 'complete' as const }
              : message,
          );
          const next: Partial<ChatState> = {
            conversationMessages: {
              ...state.conversationMessages,
              [conversationId]: updated,
            },
          };
          if (state.activeId === conversationId) {
            next.messages = updated;
          }
          return next;
        });
      } else {
        if (
          error instanceof ApiError &&
          (error.code === 'rate_limited' || error.code === 'fair_use_exceeded')
        ) {
          const refusedUser = useAuth.getState().user;
          if (!refusedUser || !refusedUser.plan || refusedUser.plan === 'free') {
            useUpgradeModal.getState().open({ reason: 'free_limit' });
          }
        }
        updateAssistant({ status: 'error', error: describeError(error) });
      }
    } finally {
      const timer = flushTimers.get(conversationId);
      if (timer) {
        clearTimeout(timer);
        flushTimers.delete(conversationId);
      }
      abortControllers.delete(conversationId);
      set((state) => {
        const nextStreaming = { ...state.streamingConversations };
        delete nextStreaming[conversationId];
        return {
          streamingConversations: nextStreaming,
          streaming: state.activeId === conversationId ? false : state.streaming,
        };
      });
      void get().loadConversations(true);
    }
  }

  /** Правит сообщение диалога и в активной ленте, и в кэше диалогов. */
  function patchMessage(conversationId: string, messageId: string, patch: Partial<Message>): void {
    set((state) => {
      const existing =
        state.conversationMessages[conversationId] ??
        (state.activeId === conversationId ? state.messages : []);
      const updated = existing.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message,
      );
      const next: Partial<ChatState> = {
        conversationMessages: { ...state.conversationMessages, [conversationId]: updated },
      };
      if (state.activeId === conversationId) {
        next.messages = updated;
      }
      return next;
    });
  }

  /**
   * Сравнение ответов: один вопрос уходит нескольким моделям, колонки стримятся параллельно.
   * Сервер сам сохраняет в диалог ответ первой успешной колонки; выбор лучшего (`pickCompare`)
   * его заменяет. Пока колонки на экране, сообщение ассистента в ленте скрыто (см. MessageList).
   */
  async function runCompareTurn(
    conversationId: string,
    history: Message[],
    assistantId: string,
    modelIds: string[],
  ): Promise<void> {
    const controller = new AbortController();
    abortControllers.set(conversationId, controller);
    const compare = useCompare.getState();

    set((state) => ({
      streamingConversations: { ...state.streamingConversations, [conversationId]: true },
      streaming: state.activeId === conversationId ? true : state.streaming,
    }));

    const catalog = get().meta?.models ?? [];
    compare.putRun({
      conversationId,
      assistantId,
      runId: '',
      status: 'streaming',
      savedSlot: null,
      pickedSlot: null,
      picking: false,
      slots: modelIds.map((id, slot) => ({
        slot,
        requestedModelId: id,
        modelId: id,
        modelName: catalog.find((model) => model.id === id)?.name ?? id,
        content: '',
        status: 'streaming' as const,
      })),
    });

    const pending = new Map<number, string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (pending.size === 0) return;
      const chunks = new Map(pending);
      pending.clear();
      useCompare.getState().appendContent(conversationId, chunks);
    };
    const scheduleFlush = (): void => {
      if (typeof document !== 'undefined' && document.hidden) flush();
      else if (!timer) timer = setTimeout(flush, STREAM_FLUSH_MS);
    };

    let streamError: { code: string; message: string } | null = null;

    try {
      await api.streamCompare(
        {
          conversationId,
          modelIds,
          language: usePreferences.getState().language,
          messages: history,
          signal: controller.signal,
          reasoningMode: reasoningModeFor(
            useAuth.getState().user,
            usePreferences.getState().maxMode,
          ),
        },
        {
          onStart: ({ runId, slots }) => {
            useCompare.getState().patchRun(conversationId, { runId });
            for (const info of slots) {
              useCompare.getState().patchSlot(conversationId, info.slot, {
                modelName: info.modelName,
              });
            }
          },
          onDelta: (slot, content) => {
            pending.set(slot, (pending.get(slot) ?? '') + content);
            scheduleFlush();
          },
          onSlotDone: (done) => {
            flush();
            useCompare.getState().patchSlot(conversationId, done.slot, {
              status: 'done',
              ...(done.selectedModelId ? { modelId: done.selectedModelId } : {}),
              ...(done.modelName ? { modelName: done.modelName } : {}),
              routingReason: done.routingReason,
              inputTokens: done.inputTokens,
              outputTokens: done.outputTokens,
              latencyMs: done.latencyMs,
              ttftMs: done.ttftMs,
            });
          },
          onSlotError: ({ slot, code, message }) => {
            flush();
            useCompare.getState().patchSlot(conversationId, slot, {
              status: 'error',
              errorCode: code,
              errorMessage: message,
            });
          },
          onDone: ({ savedMessageId, defaultSlot }) => {
            flush();
            const run = useCompare.getState().runs[conversationId];
            const saved: CompareSlotView | undefined =
              defaultSlot === null
                ? undefined
                : run?.slots.find((slot) => slot.slot === defaultSlot);
            if (saved) {
              const id = savedMessageId ?? assistantId;
              patchMessage(conversationId, assistantId, {
                id,
                content: saved.content,
                modelId: saved.modelId,
                status: 'complete',
              });
              useCompare.getState().patchRun(conversationId, {
                status: 'done',
                assistantId: id,
                savedSlot: saved.slot,
              });
            } else {
              const reason = run?.slots.find((slot) => slot.errorMessage)?.errorMessage;
              patchMessage(conversationId, assistantId, {
                status: 'error',
                error: reason || translate(usePreferences.getState().language, 'chat.errorText'),
              });
              useCompare.getState().patchRun(conversationId, { status: 'failed' });
            }
          },
          onError: (payload) => {
            streamError = payload;
          },
        },
      );
      flush();
      if (streamError !== null) {
        const failure: { code: string; message: string } = streamError;
        console.error('[chat] ошибка сравнения:', failure.code, failure.message);
        useCompare.getState().clearRun(conversationId);
        patchMessage(conversationId, assistantId, {
          status: 'error',
          error: failure.message || translate(usePreferences.getState().language, 'chat.errorText'),
          errorCode: failure.code,
        });
      }
    } catch (error) {
      flush();
      const run = useCompare.getState().runs[conversationId];
      useCompare.getState().clearRun(conversationId);
      if (isAbortError(error)) {
        // Остановка: в ленте остаётся то, что успело прийти от первой колонки с текстом.
        const partial = run?.slots.find((slot) => slot.content.trim() !== '');
        patchMessage(conversationId, assistantId, {
          content: partial?.content ?? '',
          modelId: partial?.modelId,
          status: 'complete',
        });
      } else {
        if (error instanceof ApiError && error.code === 'compare_plan_required') {
          useUpgradeModal.getState().open({ reason: 'compare', requiredPlan: 'PLUS' });
        }
        patchMessage(conversationId, assistantId, {
          status: 'error',
          error: describeError(error),
          errorCode: error instanceof ApiError ? error.code : undefined,
        });
      }
    } finally {
      if (timer) clearTimeout(timer);
      abortControllers.delete(conversationId);
      set((state) => {
        const nextStreaming = { ...state.streamingConversations };
        delete nextStreaming[conversationId];
        return {
          streamingConversations: nextStreaming,
          streaming: state.activeId === conversationId ? false : state.streaming,
        };
      });
      void get().loadConversations(true);
    }
  }

  return {
    conversations: [],
    conversationsStatus: 'idle',
    activeId: null,
    messages: [],
    messagesStatus: 'idle',
    meta: null,
    streaming: false,
    streamingConversations: {},
    conversationMessages: {},
    search: '',
    draft: '',
    attachedFiles: [],

    addAttachments: (files) =>
      set((state) => ({ attachedFiles: [...state.attachedFiles, ...files] })),

    removeAttachment: (id) =>
      set((state) => {
        // Вложение ещё не отправлено: его blob-URL больше нигде не показывается, память освобождаем.
        const removed = state.attachedFiles.find((f) => f.id === id);
        if (removed?.url.startsWith('blob:')) URL.revokeObjectURL(removed.url);
        return { attachedFiles: state.attachedFiles.filter((f) => f.id !== id) };
      }),

    clearAttachments: () => set({ attachedFiles: [] }),

    loadConversations: async (silent = false) => {
      if (!silent) {
        set({ conversationsStatus: 'loading' });
      }
      try {
        const conversations = await api.fetchConversations();
        set({ conversations, conversationsStatus: 'ready' });
      } catch (error) {
        console.error('[chat] история не загрузилась:', error);
        if (!silent) {
          set({ conversationsStatus: 'error' });
        }
      }
    },

    openConversation: async (id, force = false) => {
      if (id === undefined) {
        // «Новый чат»: очищает только активный экран, НЕ прерывая генерации в других чатах!
        set({
          activeId: null,
          messages: [],
          messagesStatus: 'ready',
          streaming: false,
          draft: '',
        });
        return;
      }
      // Диалог уже открыт: повторный запрос затёр бы стримингсящий ответ.
      if (!force && get().activeId === id) {
        return;
      }

      const cached = get().conversationMessages[id];
      const isStreamingThis = !!get().streamingConversations[id];

      if (cached && cached.length > 0) {
        set({
          activeId: id,
          messages: cached,
          messagesStatus: 'ready',
          streaming: isStreamingThis,
        });
        // Если в этом диалоге прямо сейчас идёт генерация, не затираем её данными с сервера
        if (isStreamingThis) {
          return;
        }
      } else {
        set({
          activeId: id,
          messages: [],
          messagesStatus: 'loading',
          streaming: isStreamingThis,
        });
      }

      try {
        const { messages } = await api.fetchConversation(id);
        if (!get().streamingConversations[id]) {
          set((state) => {
            const currentCached = state.conversationMessages[id] ?? [];
            const resolvedMessages =
              messages.length >= currentCached.length ? messages : currentCached;
            const next: Partial<ChatState> = {
              conversationMessages: {
                ...state.conversationMessages,
                [id]: resolvedMessages,
              },
            };
            if (state.activeId === id) {
              next.messages = resolvedMessages;
              next.messagesStatus = 'ready';
            }
            return next;
          });
        }
      } catch (error) {
        if (!cached) {
          console.error('[chat] диалог не загрузился:', error);
          set((state) => (state.activeId === id ? { messagesStatus: 'error' } : {}));
        }
      }
    },

    setSearch: (search) => set({ search }),
    setDraft: (draft) => set({ draft }),

    loadMeta: async () => {
      try {
        const meta = await api.fetchMeta();
        set({ meta });
        // Сохранённый в браузере выбор модели, которой нет в каталоге (например, сделанный до его
        // обновления), в списке выглядел бы как Auto, а запрос уходил бы со старым идентификатором.
        const preferences = usePreferences.getState();
        if (
          meta.models.length > 0 &&
          !meta.models.some((model) => model.id === preferences.chatModelId)
        ) {
          preferences.setChatModelId(meta.defaultModelId);
        }
      } catch (error) {
        // Без каталога чат работает на модели по умолчанию: это не блокирует работу.
        console.error('[chat] каталог моделей не загрузился:', error);
      }
    },

    send: async (text = '', attachmentsOverride?: MessageAttachment[], allowCompare = true) => {
      const content = text.trim();
      const currentActiveId = get().activeId;
      const attachmentsToSend = attachmentsOverride ?? get().attachedFiles;

      if (content === '' && attachmentsToSend.length === 0) {
        return;
      }
      if (currentActiveId && get().streamingConversations[currentActiveId]) {
        return;
      }

      const authUser = useAuth.getState().user;
      let modelId = usePreferences.getState().chatModelId;
      const currentModel = findModel(get().meta?.models, modelId);

      // Режим сравнения: вопрос уходит нескольким моделям. Остальные тарифы получают предложение
      // перейти на Plus; модель из переключателя в этом режиме не участвует.
      let compareIds: string[] | null = null;
      if (allowCompare && useCompare.getState().enabled) {
        if (maxCompareModels(authUser?.plan) === 0) {
          useUpgradeModal.getState().open({ reason: 'compare', requiredPlan: 'PLUS' });
          return;
        }
        const ids = sanitizeCompareModelIds(
          useCompare.getState().modelIds,
          get().meta?.models ?? [],
          authUser?.plan,
        );
        if (ids.length < 2) {
          return;
        }
        compareIds = ids;
        modelId = ids[0];
      } else if (!canAccessModel(authUser?.plan, currentModel)) {
        // Модель недоступна на тарифе: сообщение не отправляется, предлагаем улучшить тариф.
        useUpgradeModal.getState().open({
          reason: 'paid_model',
          modelName: currentModel.name,
          requiredPlan: getRequiredPlanName(currentModel),
        });
        return;
      }

      const activeWs = useWorkspace.getState().activeWorkspace;

      const userMessage: Message = {
        id: createId(),
        conversationId: currentActiveId ?? '',
        role: 'user',
        content,
        createdAt: nowIso(),
        status: 'complete',
        attachments: attachmentsToSend.length > 0 ? [...attachmentsToSend] : undefined,
        workspaceContext: prepareWorkspaceForSending(activeWs),
      };
      const assistant = createAssistantMessage(userMessage.conversationId, modelId);

      set((state) => {
        const nextMessages = [...state.messages, userMessage, assistant];
        const nextConvMessages = currentActiveId
          ? { ...state.conversationMessages, [currentActiveId]: nextMessages }
          : state.conversationMessages;
        return {
          messages: nextMessages,
          conversationMessages: nextConvMessages,
          draft: '',
          attachedFiles: [],
        };
      });

      let conversationId = userMessage.conversationId;
      if (conversationId === '') {
        try {
          // Диалог создаётся при первом сообщении: «Новый чат» ничего не пишет на сервер.
          const titleBasis =
            content !== ''
              ? content
              : attachmentsToSend[0]?.name
                ? `Файл: ${attachmentsToSend[0].name}`
                : activeWs?.name
                  ? `Проект: ${activeWs.name}`
                  : 'Новый диалог';
          const conversation = await api.createConversation(deriveTitle(titleBasis));
          conversationId = conversation.id;
          set((state) => {
            const updatedMessages = state.messages.map((message) => ({
              ...message,
              conversationId: conversation.id,
            }));
            return {
              activeId: conversation.id,
              conversations: [{ ...conversation, messageCount: 1 }, ...state.conversations],
              messages: updatedMessages,
              conversationMessages: {
                ...state.conversationMessages,
                [conversation.id]: updatedMessages,
              },
            };
          });
        } catch (error) {
          const message = describeError(error);
          set((state) => ({
            messages: state.messages.map((item) =>
              item.id === assistant.id
                ? { ...item, status: 'error', error: message }
                : item.id === userMessage.id
                  ? { ...item, status: 'error' }
                  : item,
            ),
          }));
          return;
        }
      }

      const historyToSend = (get().conversationMessages[conversationId] ?? get().messages).slice(
        0,
        -1,
      );
      if (compareIds) {
        await runCompareTurn(conversationId, historyToSend, assistant.id, compareIds);
      } else {
        await runTurn(conversationId, historyToSend, assistant.id);
      }
    },

    stop: (id?: string) => {
      const targetId = id ?? get().activeId;
      if (targetId && abortControllers.has(targetId)) {
        abortControllers.get(targetId)?.abort();
      }
    },

    regenerate: async () => {
      const { activeId, messages, streamingConversations } = get();
      if (activeId === null || streamingConversations[activeId]) {
        return;
      }

      const authUser = useAuth.getState().user;
      const modelId = usePreferences.getState().chatModelId;
      const currentModel = findModel(get().meta?.models, modelId);

      if (!canAccessModel(authUser?.plan, currentModel)) {
        // Модель недоступна на тарифе: сообщение не отправляется, предлагаем улучшить тариф.
        useUpgradeModal.getState().open({
          reason: 'paid_model',
          modelName: currentModel.name,
          requiredPlan: getRequiredPlanName(currentModel),
        });
        return;
      }

      const index = lastAssistantIndex(messages);
      if (index < 1) {
        return;
      }

      const history = messages.slice(0, index);
      const assistant = createAssistantMessage(activeId, usePreferences.getState().chatModelId);
      const nextMessages = [...history, assistant];
      set((state) => ({
        messages: nextMessages,
        conversationMessages: {
          ...state.conversationMessages,
          [activeId]: nextMessages,
        },
      }));
      await runTurn(activeId, history, assistant.id);
    },

    continueReply: async () => {
      const { activeId, streamingConversations } = get();
      if (activeId === null || streamingConversations[activeId]) {
        return;
      }
      // Вложения черновика к служебной реплике не прикрепляются.
      await get().send(
        translate(usePreferences.getState().language, 'chat.continuePrompt'),
        [],
        false,
      );
    },

    editMessage: async (id, content) => {
      const { activeId, messages, streamingConversations } = get();
      const trimmed = content.trim();
      const index = messages.findIndex((message) => message.id === id);
      if (activeId === null || streamingConversations[activeId] || trimmed === '' || index === -1) {
        return;
      }

      const authUser = useAuth.getState().user;
      const modelId = usePreferences.getState().chatModelId;
      const currentModel = findModel(get().meta?.models, modelId);

      if (!canAccessModel(authUser?.plan, currentModel)) {
        useUpgradeModal.getState().open({
          reason: 'paid_model',
          modelName: currentModel.name,
          requiredPlan: getRequiredPlanName(currentModel),
        });
      }

      // Правка обрезает ленту до этого сообщения: как в ChatGPT, всё, что было
      // после, больше не относится к новому контексту.
      const edited: Message[] = [
        ...messages.slice(0, index),
        { ...messages[index], content: trimmed, createdAt: nowIso(), error: undefined },
      ];
      const assistant = createAssistantMessage(activeId, usePreferences.getState().chatModelId);
      const nextMessages = [...edited, assistant];
      set((state) => ({
        messages: nextMessages,
        conversationMessages: {
          ...state.conversationMessages,
          [activeId]: nextMessages,
        },
      }));
      await runTurn(activeId, edited, assistant.id);
    },

    rename: async (id, title) => {
      const trimmed = title.trim();
      if (trimmed === '') {
        return;
      }
      try {
        const conversation = await api.renameConversation(id, trimmed);
        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === id ? { ...item, ...conversation } : item,
          ),
        }));
      } catch (error) {
        console.error('[chat] диалог не переименовался:', error);
      }
    },

    remove: async (id) => {
      useCompare.getState().clearRun(id);
      if (abortControllers.has(id)) {
        abortControllers.get(id)?.abort();
        abortControllers.delete(id);
      }
      try {
        await api.deleteConversation(id);
        set((state) => {
          const nextConvMessages = { ...state.conversationMessages };
          delete nextConvMessages[id];
          const nextStreaming = { ...state.streamingConversations };
          delete nextStreaming[id];
          const next: Partial<ChatState> = {
            conversations: state.conversations.filter((item) => item.id !== id),
            conversationMessages: nextConvMessages,
            streamingConversations: nextStreaming,
          };
          if (state.activeId === id) {
            next.activeId = null;
            next.messages = [];
            next.streaming = false;
          }
          return next;
        });
      } catch (error) {
        console.error('[chat] диалог не удалился:', error);
      }
    },

    sendFeedback: async (messageId: string, rating: 'like' | 'dislike') => {
      const state = get();
      const conversationId = state.activeId;
      if (!conversationId) return;

      const targetMessage = state.messages.find((m) => m.id === messageId);
      if (!targetMessage) return;

      // Toggle: клик по уже активной оценке сбрасывает её
      const newRating = targetMessage.feedback === rating ? null : rating;

      set((s) => {
        const updatedMessages = s.messages.map((m) =>
          m.id === messageId ? { ...m, feedback: newRating ?? undefined } : m,
        );
        const updatedConvMessages = { ...s.conversationMessages };
        if (updatedConvMessages[conversationId]) {
          updatedConvMessages[conversationId] = updatedConvMessages[conversationId].map((m) =>
            m.id === messageId ? { ...m, feedback: newRating ?? undefined } : m,
          );
        }
        return { messages: updatedMessages, conversationMessages: updatedConvMessages };
      });

      try {
        await api.sendFeedback({
          conversationId,
          messageId,
          rating: newRating,
          modelId: targetMessage.modelId,
        });
      } catch (error) {
        console.error('[chat] сбой отправки фидбека:', error);
      }
    },

    pickCompare: async (slot) => {
      const conversationId = get().activeId;
      if (conversationId === null) return;
      const compare = useCompare.getState();
      const run = compare.runs[conversationId];
      if (!run || run.status !== 'done' || run.picking || run.runId === '') return;
      const chosen = run.slots.find((item) => item.slot === slot);
      if (!chosen || chosen.status !== 'done' || chosen.content.trim() === '') return;
      if (run.pickedSlot === slot) return;

      compare.patchRun(conversationId, { picking: true, pickError: undefined });
      try {
        const result = await api.pickCompareAnswer(run.runId, slot);
        const id = result.messageId ?? run.assistantId;
        patchMessage(conversationId, run.assistantId, {
          id,
          content: chosen.content,
          modelId: chosen.modelId,
          status: 'complete',
        });
        useCompare.getState().patchRun(conversationId, {
          assistantId: id,
          savedSlot: slot,
          pickedSlot: slot,
          picking: false,
        });
        if (useCompare.getState().runs[conversationId]?.judge?.saved) {
          useCompare.getState().patchJudge(conversationId, { saved: false });
        }
      } catch (error) {
        useCompare.getState().patchRun(conversationId, {
          picking: false,
          pickError: describeError(error),
        });
      }
    },

    dismissCompare: () => {
      const conversationId = get().activeId;
      if (conversationId !== null) useCompare.getState().clearRun(conversationId);
    },

    runJudge: async () => {
      const conversationId = get().activeId;
      if (conversationId === null) return;
      const compare = useCompare.getState();
      const run = compare.runs[conversationId];
      if (!run || run.status !== 'done' || run.runId === '') return;
      if (run.judge?.status === 'streaming') return;
      const answered = run.slots.filter(
        (item) => item.status === 'done' && item.content.trim() !== '',
      );
      if (answered.length < 2) return;

      compare.patchJudge(conversationId, null);
      compare.patchJudge(conversationId, { status: 'streaming', content: '' });
      let buffer = '';
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (buffer === '') return;
        const chunk = buffer;
        buffer = '';
        const current = useCompare.getState().runs[conversationId]?.judge;
        useCompare
          .getState()
          .patchJudge(conversationId, { content: (current?.content ?? '') + chunk });
      };
      try {
        await streamJudge(
          { runId: run.runId, language: usePreferences.getState().language },
          {
            onReviewer: (reviewer) =>
              useCompare.getState().patchJudge(conversationId, { reviewer }),
            onDelta: (content) => {
              buffer += content;
              timer ??= setTimeout(flush, STREAM_FLUSH_MS);
            },
            onDone: (result, quota) => {
              if (timer) clearTimeout(timer);
              flush();
              useCompare.getState().patchJudge(conversationId, {
                status: 'done',
                content: result.content,
                reviewer: result.judge,
                result,
              });
              if (quota) useReview.getState().setQuota(quota);
            },
          },
        );
      } catch (error) {
        if (timer) clearTimeout(timer);
        useCompare.getState().patchJudge(conversationId, {
          status: 'error',
          error: describeError(error),
          errorCode: error instanceof ApiError ? error.code : undefined,
        });
      }
    },

    saveJudge: async () => {
      const conversationId = get().activeId;
      if (conversationId === null) return;
      const run = useCompare.getState().runs[conversationId];
      const judge = run?.judge;
      if (!run || !judge?.result || judge.saving || judge.saved) return;
      useCompare.getState().patchJudge(conversationId, { saving: true, saveError: undefined });
      try {
        const result = await saveJudgeAnswer(run.runId);
        const id = result.messageId ?? run.assistantId;
        patchMessage(conversationId, run.assistantId, {
          id,
          content: judge.result.content,
          modelId: result.modelId,
          status: 'complete',
        });
        useCompare.getState().patchRun(conversationId, {
          assistantId: id,
          savedSlot: null,
          pickedSlot: null,
        });
        useCompare.getState().patchJudge(conversationId, { saving: false, saved: true });
      } catch (error) {
        useCompare
          .getState()
          .patchJudge(conversationId, { saving: false, saveError: describeError(error) });
      }
    },
  };
});
