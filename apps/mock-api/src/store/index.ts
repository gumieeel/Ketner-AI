import { config } from '../config.js';
import { createRevokedTokenStore } from './revoked-token-store.js';
import { createApiKeyStore } from './api-key-store.js';
import { createGithubConnectionStore } from '../github/connection-store.js';
import { createGoogleConnectionStore } from '../google/connection-store.js';
import { createGoogleVerifierStore } from '../google/verifier-store.js';
import { createGooglePrefsStore } from '../google/prefs.js';
import { accountErasure } from '../platform/account-erasure.js';
import { registerAccountErasure } from '../platform/account-erasure-setup.js';
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

/** Токены входа, отозванные при выходе из аккаунта: файл из `config.revokedTokenStoreFile`. */
export const revokedTokenStore = createRevokedTokenStore(config.revokedTokenStoreFile);
export { createRevokedTokenStore } from './revoked-token-store.js';
export type { RevokedTokenStore } from './revoked-token-store.js';

/** Привязанные аккаунты GitHub (токены зашифрованы ключом из BETTER_AUTH_SECRET). */
export const githubConnectionStore = createGithubConnectionStore({
  file: config.githubConnectionStoreFile,
  secret: config.betterAuthSecret,
});
export type { GithubConnectionStore } from '../github/connection-store.js';

/**
 * Подключения Google Таблиц (этап F): только Postgres (миграция 0016), без файла — без базы
 * подключение живёт до перезапуска. Refresh-токен зашифрован ключом из BETTER_AUTH_SECRET.
 */
export const googleConnectionStore = createGoogleConnectionStore({
  secret: config.betterAuthSecret,
});
/** PKCE verifier подключения Google: `ketner_docs`, пространство `google_oauth`. */
export const googleVerifierStore = createGoogleVerifierStore();
/** Часовой пояс владельца для дат в Google Таблице: `ketner_docs`, пространство `google_prefs`. */
export const googlePrefsStore = createGooglePrefsStore();
// Удаление аккаунта: очистка Google — первая регистрация (platform/account-erasure.ts).
registerAccountErasure(accountErasure, {
  google: { store: googleConnectionStore, verifiers: googleVerifierStore, prefs: googlePrefsStore },
});

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
