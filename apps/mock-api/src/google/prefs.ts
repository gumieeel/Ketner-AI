/**
 * Часовой пояс владельца для дат в Google Таблице: берётся из браузера владельца (подключение,
 * новая таблица, открытие кабинета) и хранится в `ketner_docs`, пространство `google_prefs` —
 * без миграции. Нет записи — даты пишутся в UTC с пометкой.
 */

import { DocStore } from '../store/doc-store.js';
import { validTimeZone } from './sheets.js';

export const GOOGLE_PREFS_NAMESPACE = 'google_prefs';

export interface GooglePrefsDoc {
  /** id аккаунта Ketner. */
  id: string;
  timeZone: string;
  updatedAt: string;
}

export interface GooglePrefsStore {
  readonly docs: DocStore<GooglePrefsDoc>;
  timeZoneOf(userId: string): string | null;
  /** Запомнить пояс, если он верный и изменился. Возвращает сохранённый пояс или null. */
  rememberTimeZone(userId: string, raw: unknown, now?: Date): string | null;
  remove(userId: string): Promise<boolean>;
}

export function createGooglePrefsStore(
  docs = new DocStore<GooglePrefsDoc>(GOOGLE_PREFS_NAMESPACE),
): GooglePrefsStore {
  return {
    docs,
    timeZoneOf(userId) {
      return validTimeZone(docs.get(userId)?.timeZone);
    },
    rememberTimeZone(userId, raw, now = new Date()) {
      const timeZone = validTimeZone(raw);
      if (!timeZone) return null;
      if (docs.get(userId)?.timeZone !== timeZone) {
        docs.put({ id: userId, timeZone, updatedAt: now.toISOString() });
      }
      return timeZone;
    },
    remove(userId) {
      return docs.removeDurable(userId);
    },
  };
}
