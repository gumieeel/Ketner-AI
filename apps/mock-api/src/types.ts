import type { TrybitCurrency } from './billing/trybit-currencies.js';
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
  /** Случайный id токена: два входа в одну секунду дают разные токены (выход отзывает только свой). */
  jti?: string;
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
  /** Phase 2: Сохранённая сводка контекста для стабильного prefix caching */
  contextSummary?: string;
}

export type AttachmentCategory =
  'image' | 'video' | 'audio' | 'document' | 'code' | 'archive' | 'file';

export interface MessageAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  category: AttachmentCategory;
  url?: string;
  contentPreview?: string;
  extractedText?: string;
}

export type WorkspaceType = 'local_folder' | 'git_repo';

export interface WorkspaceFile {
  path: string;
  size: number;
  content?: string;
  language?: string;
  /** Клиент передал только начало файла (кэш браузера или лимит размера). */
  truncated?: boolean;
}

export interface WorkspaceContext {
  id?: string;
  type: WorkspaceType;
  name: string;
  pathOrUrl?: string;
  branch?: string;
  filesCount?: number;
  files?: WorkspaceFile[];
  summary?: string;
  indexedAt?: string;
}

export type FeedbackRating = 'like' | 'dislike';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  status: MessageStatus;
  modelId?: string;
  attachments?: MessageAttachment[];
  workspaceContext?: WorkspaceContext;
  /** Phase 2: Причина завершения ответа */
  finishReason?: 'stop' | 'length' | 'cancelled' | 'error';
  /** Phase 2: Доступно ли продолжение генерации */
  canContinue?: boolean;
  /** Пользовательская оценка ответа: лайк / дизлайк */
  feedback?: FeedbackRating;
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
  attachments?: MessageAttachment[];
  workspaceContext?: WorkspaceContext;
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
  /** Суточная норма модели по тарифам: основа недельного пула (норма × 7). */
  dailyLimits?: Partial<Record<PlanId, number>>;
  /** Недельный пул модели по тарифам и сколько из него можно взять за сутки. */
  weeklyLimits?: Partial<Record<PlanId, { pool: number; perDay: number }>>;
  /** Фиксированная глубина размышлений (модели Pro и Ultra): обычный режим и режим Max (Ultra). */
  reasoningEffort?: { standard: string; max: string };
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
  /** Тариф счёта; для пакета премиум-квоты — тариф на момент покупки. */
  planId: PlanId;
  /** Счёт на пакет премиум-квоты (services/pricing.ts → PREMIUM_PACKS), а не на тариф. */
  packId?: string;
  priceRub: number;
  starsAmount: number;
  botUsername: string;
  botDeepLink: string;
  status: 'pending' | 'paid';
  expiresAt: string;
  createdAt: string;
  /** Ссылка на оплату в Telegram (createInvoiceLink): открывает окно оплаты звёздами. */
  invoiceLink?: string;
  /** Номер платежа Telegram — для поддержки и возвратов. */
  chargeId?: string;
  paidAt?: string;
}

export type CryptoCurrency = TrybitCurrency;

/** Комиссии Trybit по счёту (в долларах) и часть, которую платит покупатель сверх цены тарифа. */
export interface CryptoFees {
  serviceUsd: number;
  transferUsd: number;
  /** На сколько счёт дороже цены тарифа: комиссия, лежащая на покупателе. */
  payerUsd: number;
  /** Итог к оплате в долларах (цена тарифа + payerUsd). */
  totalUsd: number;
}

export interface CryptoInvoice {
  id: string;
  userId: string;
  /** Тариф счёта; для пакета премиум-квоты — тариф на момент покупки. */
  planId: PlanId;
  /** Счёт на пакет премиум-квоты (services/pricing.ts → PREMIUM_PACKS), а не на тариф. */
  packId?: string;
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
  /** Реквизиты выдал Trybit: оплата прямо на сайте, без перехода на страницу шлюза. */
  gatewayDetails?: boolean;
  /** MEMO/комментарий к переводу (сеть TON). */
  memo?: string;
  txHash?: string;
  /** Комиссии Trybit по этому счёту (приходят в ответе шлюза). */
  fees?: CryptoFees;
}
