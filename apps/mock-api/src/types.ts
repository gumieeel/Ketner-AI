/**
 * Типы контракта mock-API.
 *
 * Совпадают по форме с docs/data-model.md: при переходе на реальную базу и
 * провайдера ИИ меняется источник данных, а не структуры.
 */

export type PlanId = 'free' | 'gpt-pro' | 'claude-pro' | 'gemini-pro' | 'ultra' | 'plus' | 'pro';

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
  limitBadge?: Record<Language, string>;
  modelsHighlight?: string;
  bullets: Record<Language, readonly string[]>;
}

export interface User {
  id: string;
  email: string;
  name: string;
  plan: PlanId;
  createdAt: string;
  isVip?: boolean;
  isAdmin?: boolean;
  telegramChatId?: number | string;
  telegramUsername?: string;
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
  /** Является ли модель платной (PRO). */
  isPro?: boolean;
  /** Требуемый тариф для доступа. */
  requiredPlan?: PlanId;
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

export interface SbpInvoice {
  id: string;
  userId: string;
  planId: PlanId;
  amount: number;
  currency: 'RUB';
  status: 'pending' | 'paid' | 'expired';
  qrPayload: string;
  deepLink: string;
  expiresAt: string;
  createdAt: string;
}

export interface TelegramStarsInvoice {
  id: string;
  userId: string;
  planId: PlanId;
  priceRub: number;
  starsAmount: number;
  botUsername: string;
  botDeepLink: string;
  status: 'pending' | 'paid';
  expiresAt: string;
  createdAt: string;
}

export type CryptoCurrency = 'USDT_TRC20' | 'USDT_TON' | 'TON' | 'BTC';

export interface CryptoInvoice {
  id: string;
  userId: string;
  planId: PlanId;
  currency: CryptoCurrency;
  amount: number;
  amountUsd: number;
  address: string;
  qrPayload: string;
  status: 'pending' | 'confirming' | 'paid' | 'expired';
  expiresAt: string;
  createdAt: string;
  network: string;
  cryptoCloudUrl?: string;
  cryptoCloudInvoiceId?: string;
  txHash?: string;
}

