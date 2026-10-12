import { config } from '../config.js';
import { createApiKeyStore } from './api-key-store.js';
import { createConversationStore } from './conversation-store.js';
import { createSubscriptionStore } from './subscription-store.js';
import { createUserStore } from './user-store.js';

/** Хранилище диалогов по умолчанию: файл из `config.storeFile`. */
export const conversationStore = createConversationStore(config.storeFile);

/** Хранилище пользователей по умолчанию: файл из `config.userStoreFile`. */
export const userStore = createUserStore(config.userStoreFile);

/** API-ключи для программирования (CLI, IDE): файл из `config.apiKeyStoreFile`. */
export const apiKeyStore = createApiKeyStore(config.apiKeyStoreFile);
export { createApiKeyStore } from './api-key-store.js';
export type { ApiKeyStore, PublicApiKey } from './api-key-store.js';

/** Хранилище подписок по умолчанию: файл из `config.subscriptionStoreFile`. */
export const subscriptionStore = createSubscriptionStore(config.subscriptionStoreFile);

/** Хранилище счетов (СБП, Telegram Stars). */
export { invoiceStore, createInvoiceStore } from './invoice-store.js';
export type { InvoiceStore } from './invoice-store.js';

/** Хранилище использования AI и себестоимости. */
import { UsageStore } from './usage-store.js';
export { UsageStore } from './usage-store.js';
export const usageStore = new UsageStore(config.usageStoreFile);
/** Хранилище обращений в службу поддержки (Telegram Support Bot). */
export { supportStore, createSupportStore } from './support-store.js';
export type { SupportStore, SupportTicket, SupportMessage } from './support-store.js';

/** Хранилище использованных блокчейн-транзакций (защита от replay-атак). */
export { usedTxStore, createUsedTxStore } from './used-tx-store.js';
export type { UsedTxStore, UsedTxRecord } from './used-tx-store.js';

/** Хранилище пользовательских оценок (лайки/дизлайки) и аналитика эскалации моделей. */
import { FeedbackStore } from './feedback-store.js';
export { FeedbackStore, createFeedbackStore } from './feedback-store.js';
export type {
  FeedbackRecord,
  FeedbackSummary,
  FeedbackAnalytics,
  EscalationStatus,
  PromptComplexityLevel,
  RecordFeedbackInput,
} from './feedback-store.js';
export const feedbackStore = new FeedbackStore(config.feedbackStoreFile);
