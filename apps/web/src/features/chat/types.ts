import type { Language } from '@/features/preferences/preferences-store';

/**
 * Типы контракта чата. Совпадают по форме с mock-API и docs/data-model.md:
 * при переходе на реальный бэкенд меняется источник данных, а не структуры.
 */
export type { Language };

export type PlanId = 'free' | 'gpt-pro' | 'claude-pro' | 'gemini-pro' | 'ultra' | 'plus' | 'pro';
export type MessageRole = 'user' | 'assistant';

/** `pending` и `streaming` живут только на клиенте во время генерации. */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary extends Conversation {
  messageCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
  modelId?: string;
  /** Только на клиенте: текст ошибки для сообщения со статусом `error`. */
  error?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextMessages: number;
}

export interface PlanLimits {
  messagesPerDay: number | null;
  contextMessages: number;
}

export interface ChatMeta {
  models: ModelInfo[];
  defaultModelId: string;
  limits: Record<PlanId, PlanLimits>;
}
