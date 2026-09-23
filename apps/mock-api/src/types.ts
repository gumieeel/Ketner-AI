/**
 * Типы контракта mock-API.
 *
 * Совпадают по форме с docs/data-model.md: при переходе на реальную базу и
 * провайдера ИИ меняется источник данных, а не структуры.
 */

export type PlanId = 'free' | 'plus' | 'pro';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface Subscription {
  userId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  renewsAt: string | null;
}

export interface PlanItem {
  id: PlanId;
  nameKey: string;
  priceMonthly: number;
  popular?: boolean;
  bullets: Record<Language, readonly string[]>;
}

export interface User {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  createdAt: string;
}

export interface AuthSession {
  user: User;
  token: string;
  expiresAt: string;
}

export interface AuthTokenPayload {
  sub: string;
  email: string;
  name: string;
  plan: PlanId;
  iat: number;
  exp: number;
}

export type Language = 'ru' | 'en';

export type MessageRole = 'user' | 'assistant';

export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
  modelId?: string;
}

/**
 * Сообщение в запросе на генерацию.
 *
 * `id` и `createdAt` присылает клиент: сообщение показывается сразу, и после
 * перезагрузки страницы его идентификатор должен совпасть с сохранённым.
 * Реальные провайдеры эти поля игнорируют.
 */
export interface IncomingMessage {
  id?: string;
  role: MessageRole;
  content: string;
  createdAt?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** Сколько последних сообщений диалога уходит в модель. */
  contextMessages: number;
}

export interface PlanLimits {
  /** null — без ограничений. */
  messagesPerDay: number | null;
  contextMessages: number;
}

export interface ModelCatalog {
  models: ModelInfo[];
  defaultModelId: string;
  limits: Record<PlanId, PlanLimits>;
}
