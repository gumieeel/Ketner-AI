import { fileURLToPath } from 'node:url';
import { DocStore } from './doc-store.js';

/** Обращение с формы обратной связи на сайте. */
export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
  /** Идентификатор аккаунта, если человек был авторизован. */
  userId?: string;
}

export function createContactStore(file?: string): DocStore<ContactMessage> {
  return new DocStore<ContactMessage>('contact_messages', file);
}

/** Рабочее хранилище: файл на диске плюс зеркало в Postgres (см. db/sync.ts). */
export const contactStore = createContactStore(
  process.env.CONTACT_STORE_FILE ?? fileURLToPath(new URL('../../data/contact.json', import.meta.url)),
);
