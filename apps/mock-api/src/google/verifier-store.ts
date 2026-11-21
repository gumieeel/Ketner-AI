/**
 * PKCE verifier подключения Google — только на сервере: `ketner_docs`, пространство
 * `google_oauth`, id = nonce из `state`, срок 10 минут (docs/STAGE_F_SHEETS.md, раздел 3).
 *
 * Запись одноразовая: `take` удаляет её из памяти синхронно, до любого `await`, поэтому два
 * одновременных обмена с одним `state` не получат verifier оба. Просроченные записи удаляются при
 * каждом новом подключении.
 */

import { DocStore } from '../store/doc-store.js';

export const GOOGLE_OAUTH_NAMESPACE = 'google_oauth';

export interface GoogleOAuthVerifierDoc {
  /** nonce из `state`. */
  id: string;
  userId: string;
  verifier: string;
  /** Срок, мс с эпохи. */
  expiresAt: number;
}

export interface GoogleVerifierStore {
  readonly docs: DocStore<GoogleOAuthVerifierDoc>;
  put(record: GoogleOAuthVerifierDoc, now?: number): Promise<void>;
  /** Забирает verifier и удаляет запись. `undefined` — нет, просрочен или чужой пользователь. */
  take(nonce: string, userId: string, now?: number): string | undefined;
  /** Записи пользователя (для удаления аккаунта). */
  idsOf(userId: string): string[];
}

export function createGoogleVerifierStore(
  docs = new DocStore<GoogleOAuthVerifierDoc>(GOOGLE_OAUTH_NAMESPACE),
): GoogleVerifierStore {
  return {
    docs,

    async put(record, now = Date.now()) {
      for (const stale of docs.filter((doc) => doc.expiresAt < now)) docs.remove(stale.id);
      // С ожиданием базы: после перезапуска между «начать» и «подтвердить» verifier не пропадёт.
      await docs.putDurable(record);
    },

    take(nonce, userId, now = Date.now()) {
      const record = docs.get(nonce);
      if (!record) return undefined;
      // Удаляем сразу и при любом исходе: повторить обмен с тем же state нельзя.
      docs.remove(nonce);
      if (record.userId !== userId || record.expiresAt < now) return undefined;
      return record.verifier;
    },

    idsOf(userId) {
      return docs.filter((doc) => doc.userId === userId).map((doc) => doc.id);
    },
  };
}
