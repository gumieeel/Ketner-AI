import { config } from '../config.js';
import { createConversationStore } from './conversation-store.js';
import { createUserStore } from './user-store.js';

/** Хранилище диалогов по умолчанию: файл из `config.storeFile`. */
export const conversationStore = createConversationStore(config.storeFile);

/** Хранилище пользователей по умолчанию: файл из `config.userStoreFile`. */
export const userStore = createUserStore(config.userStoreFile);
