/**
 * Postgres для подключений Google: таблица `google_connections` (миграция 0016) и записи
 * `ketner_docs` в пространстве `google_oauth` (PKCE verifier). Общий код сервера (db/sync.ts —
 * после применения миграций) и скрипта поддержки scripts/erase-account.ts.
 */

import type { SqlRunner } from '../code/postgres-driver.js';
import type {
  GoogleConnectionDbDriver,
  GoogleConnectionStatus,
  GoogleConnectionStore,
  StoredGoogleConnection,
} from './connection-store.js';
import {
  GOOGLE_OAUTH_NAMESPACE,
  type GoogleOAuthVerifierDoc,
  type GoogleVerifierStore,
} from './verifier-store.js';

interface GoogleConnectionRow {
  user_id: string;
  google_sub: string;
  google_email: string | null;
  scopes: string;
  refresh_token_enc: string | null;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  status: GoogleConnectionStatus;
  last_error_code: string | null;
  last_error_at: Date | string | null;
  last_ok_at: Date | string | null;
  connected_at: Date | string;
  updated_at: Date | string;
}

const iso = (value: Date | string): string => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null): string | null => (value ? iso(value) : null);

export async function loadGoogleConnections(sql: SqlRunner): Promise<StoredGoogleConnection[]> {
  const rows = await sql.query<GoogleConnectionRow>(
    `SELECT user_id, google_sub, google_email, scopes, refresh_token_enc, spreadsheet_id,
            spreadsheet_url, status, last_error_code, last_error_at, last_ok_at, connected_at,
            updated_at
     FROM google_connections`,
    [],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    googleSub: row.google_sub,
    googleEmail: row.google_email,
    scopes: row.scopes.split(' ').filter(Boolean),
    refreshTokenEnc: row.refresh_token_enc,
    spreadsheetId: row.spreadsheet_id,
    spreadsheetUrl: row.spreadsheet_url,
    status: row.status,
    lastErrorCode: row.last_error_code,
    lastErrorAt: isoOrNull(row.last_error_at),
    lastOkAt: isoOrNull(row.last_ok_at),
    connectedAt: iso(row.connected_at),
    updatedAt: iso(row.updated_at),
  }));
}

export function googleConnectionDbDriver(sql: SqlRunner): GoogleConnectionDbDriver {
  return {
    async upsert(record) {
      await sql.query(
        `INSERT INTO google_connections (
          user_id, google_sub, google_email, scopes, refresh_token_enc, spreadsheet_id,
          spreadsheet_url, status, last_error_code, last_error_at, last_ok_at, connected_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (user_id) DO UPDATE SET
          google_sub = EXCLUDED.google_sub,
          google_email = EXCLUDED.google_email,
          scopes = EXCLUDED.scopes,
          refresh_token_enc = EXCLUDED.refresh_token_enc,
          spreadsheet_id = EXCLUDED.spreadsheet_id,
          spreadsheet_url = EXCLUDED.spreadsheet_url,
          status = EXCLUDED.status,
          last_error_code = EXCLUDED.last_error_code,
          last_error_at = EXCLUDED.last_error_at,
          last_ok_at = EXCLUDED.last_ok_at,
          connected_at = EXCLUDED.connected_at,
          updated_at = EXCLUDED.updated_at`,
        [
          record.userId,
          record.googleSub,
          record.googleEmail,
          record.scopes.join(' '),
          record.refreshTokenEnc,
          record.spreadsheetId,
          record.spreadsheetUrl,
          record.status,
          record.lastErrorCode,
          record.lastErrorAt,
          record.lastOkAt,
          record.connectedAt,
          record.updatedAt,
        ],
      );
    },
    async remove(userId) {
      await sql.query('DELETE FROM google_connections WHERE user_id = $1', [userId]);
    },
  };
}

/**
 * Загружает подключения и незавершённые подключения из Postgres и переводит хранилища на запись в
 * базу. Нужны таблицы `google_connections` (миграция 0016) и `ketner_docs`.
 */
export async function attachGoogleStores(
  sql: SqlRunner,
  stores: { connections: GoogleConnectionStore; verifiers: GoogleVerifierStore },
): Promise<void> {
  stores.connections.loadExternal(await loadGoogleConnections(sql));
  stores.connections.setDbDriver(googleConnectionDbDriver(sql));
  const rows = await sql.query<{ data: GoogleOAuthVerifierDoc | string }>(
    'SELECT data FROM ketner_docs WHERE namespace = $1',
    [GOOGLE_OAUTH_NAMESPACE],
  );
  stores.verifiers.docs.loadExternal(
    rows.map((row) =>
      typeof row.data === 'string' ? (JSON.parse(row.data) as GoogleOAuthVerifierDoc) : row.data,
    ),
  );
  stores.verifiers.docs.setDbDriver({
    async upsert(namespace, doc) {
      await sql.query(
        `INSERT INTO ketner_docs (namespace, id, data, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (namespace, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [namespace, doc.id, JSON.stringify(doc)],
      );
    },
    async remove(namespace, id) {
      await sql.query('DELETE FROM ketner_docs WHERE namespace = $1 AND id = $2', [namespace, id]);
    },
  });
}
