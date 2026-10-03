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
  };
}

export interface ConversationStore {
  list(userId: string): ConversationSummary[];
  get(userId: string, conversationId: string): ConversationWithMessages | null;
  create(userId: string, title: string): Conversation;
  rename(userId: string, conversationId: string, title: string): Conversation | null;
  remove(userId: string, conversationId: string): boolean;
  saveTurn(input: SaveTurnInput): { conversation: Conversation; assistant: Message } | null;
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
      const restored: Message[] = history.map((message) => ({
        id: message.id ?? randomUUID(),
        conversationId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt ?? now,
        // На бэкенде хранится только итоговый вариант сообщения.
        status: 'complete',
        attachments: message.attachments,
        workspaceContext: message.workspaceContext,
      }));

      const assistantMessage: Message = {
        id: randomUUID(),
        conversationId,
        role: 'assistant',
        content: assistant.content,
        createdAt: now,
        status: assistant.status,
        modelId: assistant.modelId,
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

      return { conversation: { ...conversation }, assistant: assistantMessage };
    },
  };
}
