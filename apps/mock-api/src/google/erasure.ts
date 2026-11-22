/**
 * Очистка Google при удалении аккаунта (первая регистрация в platform/account-erasure.ts):
 * отзыв доступа у Google и удаление строки `google_connections`.
 *
 * Отзыв — по возможности: не удался (сеть, Google, токен не расшифровать после смены ключа) —
 * строка в лог, строка подключения всё равно удаляется. Таблица в Диске владельца остаётся:
 * это его файл, Ketner его не удаляет.
 */

import type { AccountErasure } from '../platform/account-erasure.js';
import type { GoogleConnectionStore } from './connection-store.js';
import { revokeGoogleToken } from './oauth.js';
import type { GoogleVerifierStore } from './verifier-store.js';
import type { GooglePrefsStore } from './prefs.js';

export const GOOGLE_ERASURE_STEP = 'google';

export function registerGoogleErasure(
  registry: AccountErasure,
  deps: {
    store: GoogleConnectionStore;
    verifiers?: GoogleVerifierStore;
    prefs?: GooglePrefsStore;
    fetchImpl?: typeof fetch;
    log?: (message: string) => void;
  },
): void {
  const log = deps.log ?? ((message: string) => console.warn(message));
  registry.register({
    name: GOOGLE_ERASURE_STEP,

    preview(userId) {
      const connection = deps.store.get(userId);
      return [
        { what: 'строка google_connections', count: connection ? 1 : 0 },
        { what: 'отзыв доступа Google', count: deps.store.hasStoredToken(userId) ? 1 : 0 },
        {
          what: 'незавершённые подключения (google_oauth)',
          count: deps.verifiers?.idsOf(userId).length ?? 0,
        },
        { what: 'часовой пояс (google_prefs)', count: deps.prefs?.timeZoneOf(userId) ? 1 : 0 },
      ];
    },

    async erase(userId) {
      const notes: string[] = [];
      const hadToken = deps.store.hasStoredToken(userId);
      let revoked = 0;
      if (hadToken) {
        const token = deps.store.refreshTokenOf(userId);
        if (!token) {
          notes.push('токен не расшифрован (сменился ключ) — отзыв пропущен');
          log(`[erase] google: токен аккаунта ${userId} не расшифрован, отзыв пропущен`);
        } else if (await revokeGoogleToken(token, deps.fetchImpl)) {
          revoked = 1;
        } else {
          notes.push('Google не подтвердил отзыв — доступ можно снять в аккаунте Google');
          log(`[erase] google: отзыв доступа аккаунта ${userId} не удался, строка удаляется`);
        }
      }
      const removed = await deps.store.remove(userId);
      let verifiers = 0;
      for (const id of deps.verifiers?.idsOf(userId) ?? []) {
        if (await deps.verifiers!.docs.removeDurable(id)) verifiers += 1;
      }
      const prefs = (await deps.prefs?.remove(userId)) ? 1 : 0;
      return {
        items: [
          { what: 'строка google_connections', count: removed ? 1 : 0 },
          { what: 'отзыв доступа Google', count: revoked },
          { what: 'незавершённые подключения (google_oauth)', count: verifiers },
          { what: 'часовой пояс (google_prefs)', count: prefs },
        ],
        notes,
      };
    },
  });
}
