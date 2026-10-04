import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Conversation, IncomingMessage, Message, MessageStatus } from '../types.js';

/** Длина автоматического заголовка диалога: см. docs/data-model.md. */
export const TITLE_MAX_LENGTH = 60;

export interface ConversationSummary extends Conversation {
  messageCount: number;
}

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: Message[];
}

export interface SaveTurnInput {
  userId: string;
  conversationId: string;
  /** Полная история из запроса: она же становится состоянием диалога. */
  history: readonly IncomingMessage[];
  assistant: {
    content: string;
    modelId: string;
    status: MessageStatus;
    /** Phase 2: причина завершения генерации (для кнопки «Продолжить»). */
    finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
    /** Phase 2: можно ли продолжить генерацию. */
    canContinue?: boolean;
  };
}

export interface ConversationStore {
  list(userId: string): ConversationSummary[];
  get(userId: string, conversationId: string): ConversationWithMessages | null;
  create(userId: string, title: string): Conversation;
  rename(userId: string, conversationId: string, title: string): Conversation | null;
  remove(userId: string, conversationId: string): boolean;
  saveTurn(input: SaveTurnInput): { conversation: Conversation; assistant: Message } | null;
  /**
   * Phase 2: сохранить сводку контекста для стабильного prefix caching.
   * Вызывается шлюзом после генерации новой сводки.
   */
  updateContextSummary(userId: string, conversationId: string, summary: string): void;
  /**
   * Обновить оценку (лайк/дизлайк) для конкретного сообщения.
   */
  updateMessageFeedback(
    userId: string,
    conversationId: string,
    messageId: string,
    feedback: import('../types.js').FeedbackRating | null,
  ): Message | null;
  /** Загрузить диалоги и сообщения из внешнего источника (БД). */
  loadExternalSnapshot?(conversations: Conversation[], messages: Message[]): void;
  /** Установить драйвер персистентности в БД. */
  setDbDriver?(driver: ConversationDbDriver | null): void;
  /** Получить текущий снимок в памяти. */
  getAllSnapshot?(): { conversations: Conversation[]; messages: Message[] };
}

export interface ConversationDbDriver {
  onConversationCreated?: (conversation: Conversation) => Promise<void> | void;
  onConversationRenamed?: (conversation: Conversation) => Promise<void> | void;
  onConversationRemoved?: (userId: string, conversationId: string) => Promise<void> | void;
  onTurnSaved?: (
    conversation: Conversation,
    messages: Message[],
    assistant: Message,
  ) => Promise<void> | void;
  onContextSummaryUpdated?: (
    userId: string,
    conversationId: string,
    summary: string,
  ) => Promise<void> | void;
  onMessageFeedbackUpdated?: (
    userId: string,
    conversationId: string,
    messageId: string,
    feedback: import('../types.js').FeedbackRating | null,
  ) => Promise<void> | void;
}

interface Snapshot {
  conversations: Conversation[];
  messages: Message[];
}

/**
 * Заголовок диалога по первому сообщению.
 *
 * Считаем именно символы, а не код-юниты: иначе обрезка разорвёт эмодзи.
 */
export function deriveTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const characters = [...flat];
  if (characters.length <= TITLE_MAX_LENGTH) {
    return flat;
  }
  return `${characters
    .slice(0, TITLE_MAX_LENGTH - 1)
    .join('')
    .trimEnd()}…`;
}

function readSnapshot(file: string): Snapshot {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Snapshot>;
    return {
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[mock-api] хранилище не прочитано, начинаем с пустого:', error);
    }
    return { conversations: [], messages: [] };
  }
}

/** Запись через временный файл: прерванный процесс не оставит битый JSON. */
function writeSnapshot(file: string, snapshot: Snapshot): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

/**
 * Хранилище диалогов и сообщений на файле.
 *
 * Данных мало, поэтому пишем синхронно и целиком: так проще гарантировать, что
 * состояние на диске совпадает с ответом API. На реальной базе эти же методы
 * заменяются запросами без изменения контракта (см. docs/data-model.md).
 */
export function createConversationStore(file: string): ConversationStore {
  const snapshot = readSnapshot(file);
  let dbDriver: ConversationDbDriver | null = null;

  const persist = (): void => writeSnapshot(file, snapshot);

  const findConversation = (userId: string, conversationId: string): Conversation | undefined =>
    snapshot.conversations.find(
      (conversation) => conversation.id === conversationId && conversation.userId === userId,
    );

  /**
   * Сообщения диалога в том порядке, в котором их сохранили.
   *
   * Порядок берётся из запроса, а не из `createdAt`: часы клиента и сервера
   * расходятся, и сортировка по времени переставила бы реплики местами.
   */
  const messagesOf = (conversationId: string): Message[] =>
    snapshot.messages.filter((message) => message.conversationId === conversationId);

  return {
    list(userId) {
      return snapshot.conversations
        .filter((conversation) => conversation.userId === userId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((conversation) => ({
          ...conversation,
          messageCount: snapshot.messages.filter(
            (message) => message.conversationId === conversation.id,
          ).length,
        }));
    },

    get(userId, conversationId) {
      let conversation = findConversation(userId, conversationId);
      if (!conversation) {
        conversation = snapshot.conversations.find((c) => c.id === conversationId);
        if (conversation && userId) {
          conversation.userId = userId;
          persist();
          dbDriver?.onConversationCreated?.({ ...conversation })?.catch?.((err) =>
            console.error('[db] Error persisting assigned conversation:', err),
          );
        }
      }
      if (!conversation) {
        return null;
      }
      return { conversation: { ...conversation }, messages: messagesOf(conversationId) };
    },

    create(userId, title) {
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id: randomUUID(),
        userId,
        title: deriveTitle(title),
        createdAt: now,
        updatedAt: now,
      };
      snapshot.conversations.push(conversation);
      persist();
      dbDriver?.onConversationCreated?.({ ...conversation })?.catch?.((err) =>
        console.error('[db] Error persisting created conversation:', err),
      );
      return { ...conversation };
    },

    rename(userId, conversationId, title) {
      const conversation = findConversation(userId, conversationId);
      if (!conversation) {
        return null;
      }
      conversation.title = deriveTitle(title);
      conversation.updatedAt = new Date().toISOString();
      persist();
      dbDriver?.onConversationRenamed?.({ ...conversation })?.catch?.((err) =>
        console.error('[db] Error persisting renamed conversation:', err),
      );
      return { ...conversation };
    },

    remove(userId, conversationId) {
      const conversation = findConversation(userId, conversationId);
      if (!conversation) {
        return false;
      }
      snapshot.conversations = snapshot.conversations.filter(
        (candidate) => candidate !== conversation,
      );
      // Удаление диалога каскадно удаляет его сообщения.
      snapshot.messages = snapshot.messages.filter(
        (message) => message.conversationId !== conversationId,
      );
      persist();
      dbDriver?.onConversationRemoved?.(userId, conversationId)?.catch?.((err) =>
        console.error('[db] Error persisting removed conversation:', err),
      );
      return true;
    },

    saveTurn({ userId, conversationId, history, assistant }) {
      let conversation = findConversation(userId, conversationId);
      if (!conversation) {
        conversation = snapshot.conversations.find((c) => c.id === conversationId);
        if (conversation) {
          conversation.userId = userId;
        } else {
          const now = new Date().toISOString();
          const firstUserMsg = history.find((m) => m.role === 'user');
          const title = deriveTitle(firstUserMsg?.content || 'Новый диалог');
          conversation = {
            id: conversationId,
            userId,
            title,
            createdAt: now,
            updatedAt: now,
          };
          snapshot.conversations.push(conversation);
        }
        persist();
      }

      const now = new Date().toISOString();
      const restored: Message[] = history.map((message) => {
        const existing = message.id
          ? snapshot.messages.find((m) => m.id === message.id && m.conversationId === conversationId)
          : undefined;
        return {
          id: message.id ?? randomUUID(),
          conversationId,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt ?? now,
          // На бэкенде хранится только итоговый вариант сообщения.
          status: 'complete',
          attachments: message.attachments,
          workspaceContext: message.workspaceContext,
          feedback: existing?.feedback,
        };
      });

      const assistantMessage: Message = {
        id: randomUUID(),
        conversationId,
        role: 'assistant',
        content: assistant.content,
        createdAt: now,
        status: assistant.status,
        modelId: assistant.modelId,
        finishReason: assistant.finishReason,
        canContinue: assistant.canContinue,
      };

      // История из запроса заменяет сохранённую: так работают правка сообщения,
      // повторная генерация и остановка на середине ответа.
      snapshot.messages = [
        ...snapshot.messages.filter((message) => message.conversationId !== conversationId),
        ...restored,
        assistantMessage,
      ];

      if (!conversation.title) {
        const firstUserMessage = restored.find((message) => message.role === 'user');
        if (firstUserMessage) {
          conversation.title = deriveTitle(firstUserMessage.content);
        }
      }
      conversation.updatedAt = now;
      persist();

      dbDriver?.onTurnSaved?.({ ...conversation }, restored, { ...assistantMessage })?.catch?.((err) =>
        console.error('[db] Error persisting turn:', err),
      );

      return { conversation: { ...conversation }, assistant: assistantMessage };
    },

    updateContextSummary(userId, conversationId, summary) {
      let conversation = findConversation(userId, conversationId);
      if (!conversation) {
        conversation = snapshot.conversations.find((c) => c.id === conversationId);
      }
      if (conversation) {
        conversation.contextSummary = summary;
        conversation.updatedAt = new Date().toISOString();
        persist();
        dbDriver?.onContextSummaryUpdated?.(userId, conversationId, summary)?.catch?.((err) =>
          console.error('[db] Error persisting context summary:', err),
        );
      }
    },

    updateMessageFeedback(userId, conversationId, messageId, feedback) {
      let conversation = findConversation(userId, conversationId);
      if (!conversation) {
        conversation = snapshot.conversations.find((c) => c.id === conversationId);
      }
      if (!conversation) {
        return null;
      }
      const message = snapshot.messages.find(
        (m) => m.id === messageId && m.conversationId === conversationId,
      );
      if (!message) {
        return null;
      }
      message.feedback = feedback ?? undefined;
      conversation.updatedAt = new Date().toISOString();
      persist();
      dbDriver?.onMessageFeedbackUpdated?.(userId, conversationId, messageId, feedback)?.catch?.((err) =>
        console.error('[db] Error persisting message feedback:', err),
      );
      return { ...message };
    },

    loadExternalSnapshot(conversations, messages) {
      for (const inc of conversations) {
        const idx = snapshot.conversations.findIndex((c) => c.id === inc.id);
        if (idx >= 0) {
          snapshot.conversations[idx] = inc;
        } else {
          snapshot.conversations.push(inc);
        }
      }
      for (const msg of messages) {
        const idx = snapshot.messages.findIndex((m) => m.id === msg.id);
        if (idx >= 0) {
          snapshot.messages[idx] = msg;
        } else {
          snapshot.messages.push(msg);
        }
      }
      try {
        persist();
      } catch {
        // ignore in memory/readonly environments
      }
    },

    setDbDriver(driver) {
      dbDriver = driver;
    },

    getAllSnapshot() {
      return {
        conversations: [...snapshot.conversations],
        messages: [...snapshot.messages],
      };
    },
  };
}
