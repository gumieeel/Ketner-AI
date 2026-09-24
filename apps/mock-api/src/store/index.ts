import { config } from '../config.js';
import { createConversationStore } from './conversation-store.js';
import { createSubscriptionStore } from './subscription-store.js';
import { createUserStore } from './user-store.js';

/** Хранилище диалогов по умолчанию: файл из `config.storeFile`. */
export const conversationStore = createConversationStore(config.storeFile);

/** Хранилище пользователей по умолчанию: файл из `config.userStoreFile`. */
export const userStore = createUserStore(config.userStoreFile);

/** Хранилище подписок по умолчанию: файл из `config.subscriptionStoreFile`. */
export const subscriptionStore = createSubscriptionStore(config.subscriptionStoreFile);

/** Хранилище счетов (СБП, Telegram Stars). */
export { invoiceStore, createInvoiceStore } from './invoice-store.js';
export type { InvoiceStore } from './invoice-store.js';
