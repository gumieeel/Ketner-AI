/**
 * Подключения Google (таблица `google_connections`, миграция 0016): одна строка на аккаунт.
 *
 * Refresh-токен хранится только зашифрованным (`sealToken(..., 'google-token')`, AES-256-GCM):
 * ни в ответы API, ни в логи, ни в журнал он не попадает. Access-токен не хранится вовсе.
 *
 * Запись сначала в Postgres, потом в память: сбой базы — исключение, прежнее состояние остаётся
 * (CHECK таблицы отвергнет, например, подключение без `drive.file` или открытый токен).
 */

import { openToken, sealToken } from '../platform/token-crypto.js';

export type GoogleConnectionStatus =
  'connected' | 'reconnect_required' | 'sheet_missing' | 'disconnected';

export interface GoogleConnection {
  userId: string;
  /** Постоянный id аккаунта Google (`sub` из id_token). */
  googleSub: string;
  googleEmail: string | null;
  scopes: string[];
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
  status: GoogleConnectionStatus;
  /** Только код сбоя (`invalid_grant`, `http_5xx`…), без текста ответа Google. */
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
  connectedAt: string;
  updatedAt: string;
}

/** Строка хранилища: токен зашифрован; `null` после отключения. */
export interface StoredGoogleConnection extends GoogleConnection {
  refreshTokenEnc: string | null;
}

export interface GoogleConnectionDbDriver {
  upsert(record: StoredGoogleConnection): Promise<void>;
  remove(userId: string): Promise<void>;
}

export interface ConnectGoogleInput {
  userId: string;
  googleSub: string;
  googleEmail: string | null;
  scopes: string[];
  refreshToken: string;
  spreadsheet: { id: string; url: string } | null;
  /** Код сбоя создания таблицы — тогда статус `sheet_missing`. */
  sheetErrorCode?: string | null;
}

export interface GoogleConnectionStore {
  get(userId: string): GoogleConnection | undefined;
  /** Расшифрованный refresh-токен; `undefined` — нет подключения, отключено или ключ сменился. */
  refreshTokenOf(userId: string): string | undefined;
  /** Есть ли в строке зашифрованный токен (даже если его уже не расшифровать). */
  hasStoredToken(userId: string): boolean;
  connect(input: ConnectGoogleInput, now?: Date): Promise<GoogleConnection>;
  /** Отключение: токен стирается, статус `disconnected`, таблица и строка остаются. */
  disconnect(userId: string, now?: Date): Promise<GoogleConnection | undefined>;
  /** Удаление строки целиком (удаление аккаунта). */
  remove(userId: string): Promise<boolean>;
  loadExternal(records: StoredGoogleConnection[]): void;
  setDbDriver(driver: GoogleConnectionDbDriver | null): void;
}

const ERROR_CODE = /^[a-z0-9_]{1,40}$/;

function toPublic(record: StoredGoogleConnection): GoogleConnection {
  const { refreshTokenEnc: _secret, ...rest } = record;
  return { ...rest, scopes: [...rest.scopes] };
}

export function createGoogleConnectionStore(options: { secret: string }): GoogleConnectionStore {
  const byUser = new Map<string, StoredGoogleConnection>();
  let dbDriver: GoogleConnectionDbDriver | null = null;

  const write = async (record: StoredGoogleConnection): Promise<GoogleConnection> => {
    if (dbDriver) await dbDriver.upsert({ ...record, scopes: [...record.scopes] });
    byUser.set(record.userId, record);
    return toPublic(record);
  };

  return {
    get(userId) {
      const record = byUser.get(userId);
      return record ? toPublic(record) : undefined;
    },

    refreshTokenOf(userId) {
      const sealed = byUser.get(userId)?.refreshTokenEnc;
      return sealed ? openToken(sealed, options.secret, 'google-token') : undefined;
    },

    hasStoredToken(userId) {
      return Boolean(byUser.get(userId)?.refreshTokenEnc);
    },

    async connect(input, now = new Date()) {
      const at = now.toISOString();
      const sheetError =
        input.sheetErrorCode && ERROR_CODE.test(input.sheetErrorCode) ? input.sheetErrorCode : null;
      const sheetFailed = !input.spreadsheet;
      return write({
        userId: input.userId,
        googleSub: input.googleSub,
        googleEmail: input.googleEmail,
        scopes: [...input.scopes],
        refreshTokenEnc: sealToken(input.refreshToken, options.secret, 'google-token'),
        spreadsheetId: input.spreadsheet?.id ?? null,
        spreadsheetUrl: input.spreadsheet?.url ?? null,
        status: sheetFailed ? 'sheet_missing' : 'connected',
        lastErrorCode: sheetFailed ? (sheetError ?? 'sheet_not_created') : null,
        lastErrorAt: sheetFailed ? at : null,
        lastOkAt: sheetFailed ? null : at,
        connectedAt: at,
        updatedAt: at,
      });
    },

    async disconnect(userId, now = new Date()) {
      const record = byUser.get(userId);
      if (!record) return undefined;
      return write({
        ...record,
        refreshTokenEnc: null,
        status: 'disconnected',
        updatedAt: now.toISOString(),
      });
    },

    async remove(userId) {
      if (!byUser.has(userId)) return false;
      if (dbDriver) await dbDriver.remove(userId);
      byUser.delete(userId);
      return true;
    },

    loadExternal(records) {
      for (const record of records) byUser.set(record.userId, { ...record });
    },

    setDbDriver(driver) {
      dbDriver = driver;
    },
  };
}
