import { config } from '../config.js';
import { createConversationStore } from './conversation-store.js';

/** Хранилище диалогов по умолчанию: файл из `config.storeFile`. */
export const conversationStore = createConversationStore(config.storeFile);
