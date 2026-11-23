/**
 * Настройки Google Таблицы владельца в `ketner_docs`, пространство `google_prefs` — без миграции:
 *
 * - часовой пояс для дат в таблице: берётся из браузера владельца (подключение, новая таблица,
 *   открытие кабинета). Нет пояса — даты пишутся в UTC с пометкой;
 * - прежняя таблица, которую Ketner больше не может открыть: после отзыва доступа и
 *   переподключения `drive.file` её не покрывает, Ketner создаёт новую и показывает владельцу
 *   ссылку на прежнюю и кнопку «Выбрать прежнюю таблицу» (docs/STAGE_F_SHEETS.md, раздел 4.1).
 */

import { DocStore } from '../store/doc-store.js';
import { spreadsheetUrlOf, validSpreadsheetId, validTimeZone } from './sheets.js';

export const GOOGLE_PREFS_NAMESPACE = 'google_prefs';

export interface LostSheet {
  id: string;
  url: string;
  /** Когда Ketner обнаружил, что прежняя таблица недоступна. */
  at: string;
}

export interface GooglePrefsDoc {
  /** id аккаунта Ketner. */
  id: string;
  timeZone?: string;
  lostSheet?: LostSheet;
  updatedAt: string;
}

export interface GooglePrefsStore {
  readonly docs: DocStore<GooglePrefsDoc>;
  timeZoneOf(userId: string): string | null;
  /** Запомнить пояс, если он верный и изменился. Возвращает сохранённый пояс или null. */
  rememberTimeZone(userId: string, raw: unknown, now?: Date): string | null;
  /** Прежняя таблица, которую Ketner больше не может открыть, или null. */
  lostSheetOf(userId: string): LostSheet | null;
  /** Запомнить прежнюю таблицу (null — забыть: выбрана снова, «Понятно», отключение). */
  setLostSheet(
    userId: string,
    sheet: { id: string; url?: string | null } | null,
    now?: Date,
  ): Promise<void>;
  remove(userId: string): Promise<boolean>;
}

/** Адрес таблицы только с docs.google.com; иначе — собранный из id. */
function safeSheetUrl(id: string, url: string | null | undefined): string {
  return typeof url === 'string' && url.startsWith('https://docs.google.com/')
    ? url
    : spreadsheetUrlOf(id);
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
      const current = docs.get(userId);
      if (current?.timeZone !== timeZone) {
        docs.put({ ...current, id: userId, timeZone, updatedAt: now.toISOString() });
      }
      return timeZone;
    },
    lostSheetOf(userId) {
      const lost = docs.get(userId)?.lostSheet;
      return lost && validSpreadsheetId(lost.id) ? lost : null;
    },
    async setLostSheet(userId, sheet, now = new Date()) {
      const current = docs.get(userId);
      if (!sheet) {
        if (!current?.lostSheet) return;
        const { lostSheet: _dropped, ...rest } = current;
        await docs.putDurable({ ...rest, updatedAt: now.toISOString() });
        return;
      }
      if (!validSpreadsheetId(sheet.id)) return;
      await docs.putDurable({
        ...current,
        id: userId,
        lostSheet: { id: sheet.id, url: safeSheetUrl(sheet.id, sheet.url), at: now.toISOString() },
        updatedAt: now.toISOString(),
      });
    },
    remove(userId) {
      return docs.removeDurable(userId);
    },
  };
}
