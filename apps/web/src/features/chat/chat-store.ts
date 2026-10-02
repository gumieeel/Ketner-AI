import { create } from 'zustand';
import { translate } from '@/i18n';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useAuth } from '@/features/auth/auth-store';
import { incrementFreeUsage, isFreeLimitReached } from '@/features/billing/free-usage';
import { useUpgradeModal } from '@/features/billing/upgrade-modal-store';
import { canAccessModel, findModel, getRequiredPlanName } from './can-access-model';
import * as api from './api';
import { ApiError } from './api';
import { deriveTitle } from './derive-title';
import type { ChatMeta, ConversationSummary, Message, MessageAttachment } from './types';
import { useWorkspace } from './workspace-store';

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
  send: (text?: string, attachmentsOverride?: MessageAttachment[]) => Promise<void>;
  stop: (id?: string) => void;
  regenerate: () => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
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
  if (error instanceof ApiError && error.code === 'conversation_not_found') {
    console.error('[chat] диалог не найден:', error);
    return translate(language, 'chat.errorNotFound');
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
        },
        {
          onDelta: (delta) => {
            buffer += delta;
            scheduleFlush();
          },
          onDone: ({ messageId }) => {
            flush();
            updateAssistant({ id: messageId === '' ? assistantId : messageId, status: 'complete' });
          },
          onError: ({ code, message }) => {
            flush();
            console.error('[chat] ошибка генерации:', code, message);
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

      const authUser = useAuth.getState().user;
      const isFree = !authUser || !authUser.plan || authUser.plan === 'free';
      if (isFree && isFreeLimitReached()) {
        useUpgradeModal.getState().open({ reason: 'free_limit' });
      }
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
      set((state) => ({ attachedFiles: state.attachedFiles.filter((f) => f.id !== id) })),

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
        set({ meta: await api.fetchMeta() });
      } catch (error) {
        // Без каталога чат работает на модели по умолчанию: это не блокирует работу.
        console.error('[chat] каталог моделей не загрузился:', error);
      }
    },

    send: async (text = '', attachmentsOverride?: MessageAttachment[]) => {
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
      const modelId = usePreferences.getState().chatModelId;
      const currentModel = findModel(get().meta?.models, modelId);
      const isFree = !authUser || !authUser.plan || authUser.plan === 'free';

      if (!canAccessModel(authUser?.plan, currentModel)) {
        useUpgradeModal.getState().open({
          reason: 'paid_model',
          modelName: currentModel.name,
          requiredPlan: getRequiredPlanName(currentModel),
        });
      }

      if (isFree) {
        if (isFreeLimitReached(authUser?.id)) {
          useUpgradeModal.getState().open({ reason: 'free_limit' });
          return;
        }
        incrementFreeUsage(authUser?.id);
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
        workspaceContext: activeWs
          ? {
              name: activeWs.name,
              type: activeWs.type,
              pathOrUrl: activeWs.pathOrUrl,
              filesCount: activeWs.filesCount,
            }
          : undefined,
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
      await runTurn(conversationId, historyToSend, assistant.id);
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
      const isFree = !authUser || !authUser.plan || authUser.plan === 'free';

      if (!canAccessModel(authUser?.plan, currentModel)) {
        useUpgradeModal.getState().open({
          reason: 'paid_model',
          modelName: currentModel.name,
          requiredPlan: getRequiredPlanName(currentModel),
        });
      }
      if (isFree && isFreeLimitReached(authUser?.id)) {
        useUpgradeModal.getState().open({ reason: 'free_limit' });
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
      const isFree = !authUser || !authUser.plan || authUser.plan === 'free';

      if (!canAccessModel(authUser?.plan, currentModel)) {
        useUpgradeModal.getState().open({
          reason: 'paid_model',
          modelName: currentModel.name,
          requiredPlan: getRequiredPlanName(currentModel),
        });
      }
      if (isFree && isFreeLimitReached(authUser?.id)) {
        useUpgradeModal.getState().open({ reason: 'free_limit' });
        return;
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
  };
});
