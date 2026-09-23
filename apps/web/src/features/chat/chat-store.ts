import { create } from 'zustand';
import { translate } from '@/i18n';
import { usePreferences } from '@/features/preferences/preferences-store';
import * as api from './api';
import { ApiError } from './api';
import { deriveTitle } from './derive-title';
import type { ChatMeta, ConversationSummary, Message } from './types';

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
  search: string;
  draft: string;

  loadConversations: (silent?: boolean) => Promise<void>;
  openConversation: (id: string | undefined, force?: boolean) => Promise<void>;
  setSearch: (search: string) => void;
  setDraft: (draft: string) => void;
  loadMeta: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  regenerate: () => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** Генерация одна на вкладку, поэтому контроллер и таймер живут в модуле. */
let abortController: AbortController | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

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
    abortController = controller;
    set({ streaming: true });

    let buffer = '';
    const flush = (): void => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (buffer === '') {
        return;
      }
      const chunk = buffer;
      buffer = '';
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + chunk, status: 'streaming' }
            : message,
        ),
      }));
    };
    const scheduleFlush = (): void => {
      if (flushTimer === null) {
        flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
      }
    };
    const updateAssistant = (patch: Partial<Message>): void => {
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, ...patch } : message,
        ),
      }));
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
          onError: ({ message }) => {
            flush();
            console.error('[chat] ошибка генерации:', message);
            updateAssistant({
              status: 'error',
              error: translate(usePreferences.getState().language, 'chat.errorText'),
            });
          },
        },
      );

      // Поток закрылся без `done` — значит генерацию остановили: частичный текст
      // остаётся в ленте, как и в сохранённом диалоге.
      flush();
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId &&
          (message.status === 'pending' || message.status === 'streaming')
            ? { ...message, status: 'complete' }
            : message,
        ),
      }));
    } catch (error) {
      flush();
      if (isAbortError(error)) {
        // Остановка — не ошибка: показываем то, что успело прийти.
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === assistantId && message.status !== 'error'
              ? { ...message, status: 'complete' }
              : message,
          ),
        }));
      } else {
        updateAssistant({ status: 'error', error: describeError(error) });
      }
    } finally {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      abortController = null;
      set({ streaming: false });
      // Заголовок и порядок в списке считает сервер: подтягиваем их молча,
      // чтобы не показывать skeleton после каждого ответа.
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
    search: '',
    draft: '',

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
        if (abortController !== null) {
          abortController.abort();
          abortController = null;
        }
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
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
      set({ activeId: id, messages: [], messagesStatus: 'loading' });
      try {
        const { messages } = await api.fetchConversation(id);
        set({ messages, messagesStatus: 'ready' });
      } catch (error) {
        console.error('[chat] диалог не загрузился:', error);
        set({ messagesStatus: 'error' });
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

    send: async (text) => {
      const content = text.trim();
      if (content === '' || get().streaming) {
        return;
      }

      const modelId = usePreferences.getState().chatModelId;
      const userMessage: Message = {
        id: createId(),
        conversationId: get().activeId ?? '',
        role: 'user',
        content,
        createdAt: nowIso(),
        status: 'complete',
      };
      const assistant = createAssistantMessage(userMessage.conversationId, modelId);

      set((state) => ({ messages: [...state.messages, userMessage, assistant], draft: '' }));

      let conversationId = userMessage.conversationId;
      if (conversationId === '') {
        try {
          // Диалог создаётся при первом сообщении: «Новый чат» ничего не пишет на сервер.
          const conversation = await api.createConversation(deriveTitle(content));
          conversationId = conversation.id;
          set((state) => ({
            activeId: conversation.id,
            conversations: [{ ...conversation, messageCount: 1 }, ...state.conversations],
            messages: state.messages.map((message) => ({
              ...message,
              conversationId: conversation.id,
            })),
          }));
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

      // История без заглушки ассистента: её ещё только предстоит наполнить.
      await runTurn(conversationId, get().messages.slice(0, -1), assistant.id);
    },

    stop: () => {
      abortController?.abort();
    },

    regenerate: async () => {
      const { activeId, messages, streaming } = get();
      if (streaming || activeId === null) {
        return;
      }
      const index = lastAssistantIndex(messages);
      if (index < 1) {
        return;
      }

      const history = messages.slice(0, index);
      const assistant = createAssistantMessage(activeId, usePreferences.getState().chatModelId);
      set({ messages: [...history, assistant] });
      await runTurn(activeId, history, assistant.id);
    },

    editMessage: async (id, content) => {
      const { activeId, messages, streaming } = get();
      const trimmed = content.trim();
      const index = messages.findIndex((message) => message.id === id);
      if (streaming || activeId === null || trimmed === '' || index === -1) {
        return;
      }

      // Правка обрезает ленту до этого сообщения: как в ChatGPT, всё, что было
      // после, больше не относится к новому контексту.
      const edited: Message[] = [
        ...messages.slice(0, index),
        { ...messages[index], content: trimmed, createdAt: nowIso(), error: undefined },
      ];
      const assistant = createAssistantMessage(activeId, usePreferences.getState().chatModelId);
      set({ messages: [...edited, assistant] });
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
      try {
        await api.deleteConversation(id);
        set((state) => {
          const next: Partial<ChatState> = {
            conversations: state.conversations.filter((item) => item.id !== id),
          };
          if (state.activeId === id) {
            next.activeId = null;
            next.messages = [];
          }
          return next;
        });
      } catch (error) {
        console.error('[chat] диалог не удалился:', error);
      }
    },
  };
});
