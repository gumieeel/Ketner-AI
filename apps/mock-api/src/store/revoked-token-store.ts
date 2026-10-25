/**
 * Отозванные Bearer-токены сайта.
 *
 * Токен входа подписан и живёт 7 дней; без списка отзыва выход из аккаунта лишь стирал его в
 * браузере, а скопированный токен продолжал открывать аккаунт до конца срока. Хранится только
 * SHA-256 токена и момент его истечения: после истечения запись больше не нужна и вычищается.
 * Как и остальные хранилища: память + JSON-файл, в production — таблица Postgres (диск Render временный).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RevokedTokenRecord {
  /** SHA-256 токена в hex. */
  hash: string;
  /** Когда токен истёк бы сам (секунды Unix): позже запись удаляется. */
  expiresAt: number;
}

export interface RevokedTokenDbDriver {
  insert(record: RevokedTokenRecord): Promise<void>;
}

export interface RevokedTokenStore {
  revoke(token: string, expiresAt: number): void;
  isRevoked(token: string): boolean;
  loadExternal(records: RevokedTokenRecord[]): void;
  setDbDriver(driver: RevokedTokenDbDriver | null): void;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function readSnapshot(file: string): RevokedTokenRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { tokens?: unknown };
    return Array.isArray(parsed.tokens) ? (parsed.tokens as RevokedTokenRecord[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[mock-api] список отозванных токенов не прочитан, начинаем с пустого:', error);
    }
    return [];
  }
}

function writeSnapshot(file: string, tokens: RevokedTokenRecord[]): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ tokens }, null, 2)}\n`, 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    console.error('[mock-api] Ошибка записи списка отозванных токенов:', error);
  }
}

export function createRevokedTokenStore(file?: string): RevokedTokenStore {
  const byHash = new Map<string, number>();
  let dbDriver: RevokedTokenDbDriver | null = null;

  const add = (record: RevokedTokenRecord): void => {
    if (
      typeof record?.hash === 'string' &&
      typeof record.expiresAt === 'number' &&
      record.expiresAt > nowSeconds()
    ) {
      byHash.set(record.hash, record.expiresAt);
    }
  };

  const sweep = (): void => {
    const now = nowSeconds();
    for (const [hash, expiresAt] of byHash) if (expiresAt <= now) byHash.delete(hash);
  };

  if (file) for (const record of readSnapshot(file)) add(record);

  return {
    revoke(token, expiresAt) {
      const record = { hash: hashToken(token), expiresAt };
      if (expiresAt <= nowSeconds() || byHash.has(record.hash)) return;
      sweep();
      byHash.set(record.hash, expiresAt);
      if (file) {
        writeSnapshot(
          file,
          [...byHash].map(([hash, exp]) => ({ hash, expiresAt: exp })),
        );
      }
      dbDriver?.insert(record).catch((error: unknown) => {
        console.error('[mock-api] Ошибка записи отозванного токена в Postgres:', error);
      });
    },

    isRevoked(token) {
      const expiresAt = byHash.get(hashToken(token));
      return expiresAt !== undefined && expiresAt > nowSeconds();
    },

    loadExternal(records) {
      for (const record of records) add(record);
    },

    setDbDriver(driver) {
      dbDriver = driver;
    },
  };
}
