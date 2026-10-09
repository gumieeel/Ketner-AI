/**
 * Хранилище API-ключей для программирования через CLI и IDE.
 *
 * Секрет `ketner_sk_<64 hex>` показывается один раз при создании, в файле лежит только его SHA-256.
 * Ключ в 256 бит случайных данных нельзя подобрать перебором, поэтому быстрого хэша достаточно
 * (медленный хэш пароля тут не нужен, а проверка идёт на каждый запрос агента).
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const API_KEY_PREFIX = 'ketner_sk_';
/** Сколько символов ключа показывается в списке для опознания (`ketner_sk_` + 4 символа). */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 14;
export const MAX_ACTIVE_API_KEYS_PER_USER = 10;
export const MAX_API_KEY_NAME_LENGTH = 60;
/** Как часто время последнего использования сбрасывается на диск (по ключу). */
const TOUCH_PERSIST_INTERVAL_MS = 60_000;

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  /** SHA-256 секрета в hex. */
  hash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Что видит пользователь в списке: без хэша и без секрета. */
export interface PublicApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export class ApiKeyLimitError extends Error {
  constructor() {
    super(`Не больше ${MAX_ACTIVE_API_KEYS_PER_USER} действующих ключей: отзовите ненужный`);
    this.name = 'ApiKeyLimitError';
  }
}

export class ApiKeyNameError extends Error {
  constructor() {
    super(`Имя ключа: от 1 до ${MAX_API_KEY_NAME_LENGTH} символов`);
    this.name = 'ApiKeyNameError';
  }
}

export function hashApiKeySecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Быстрая проверка формата до обращения к хранилищу. */
export function looksLikeApiKey(secret: string): boolean {
  return /^ketner_sk_[0-9a-f]{64}$/.test(secret);
}

function toPublic(record: ApiKeyRecord): PublicApiKey {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

export interface ApiKeyStore {
  /** Создаёт ключ. Секрет возвращается только здесь. */
  create(userId: string, name: string): { key: PublicApiKey; secret: string };
  /** Действующие ключи пользователя, новые первыми. */
  list(userId: string): PublicApiKey[];
  /** Отзывает ключ пользователя. false — такого действующего ключа нет. */
  revoke(userId: string, id: string): boolean;
  /** Находит действующий ключ по секрету. Отозванный или неизвестный ключ — undefined. */
  verify(secret: string): ApiKeyRecord | undefined;
  /** Отмечает использование ключа (на диск пишется не чаще раза в минуту). */
  touch(id: string): void;
}

interface Snapshot {
  keys: ApiKeyRecord[];
}

function readSnapshot(file: string): Snapshot {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Snapshot>;
    return { keys: Array.isArray(parsed.keys) ? parsed.keys : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[mock-api] хранилище API-ключей не прочитано, начинаем с пустого:', error);
    }
    return { keys: [] };
  }
}

function writeSnapshot(file: string, snapshot: Snapshot): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    console.error('[mock-api] Ошибка записи хранилища API-ключей:', error);
  }
}

export function createApiKeyStore(file?: string): ApiKeyStore {
  const byId = new Map<string, ApiKeyRecord>();
  const byHash = new Map<string, string>();
  const lastPersistedTouch = new Map<string, number>();

  if (file) {
    for (const record of readSnapshot(file).keys) {
      byId.set(record.id, record);
      byHash.set(record.hash, record.id);
    }
  }

  const persist = (): void => {
    if (file) writeSnapshot(file, { keys: [...byId.values()] });
  };

  const activeOf = (userId: string): ApiKeyRecord[] =>
    [...byId.values()].filter((r) => r.userId === userId && r.revokedAt === null);

  return {
    create(userId, rawName) {
      const name = rawName.trim();
      if (name.length < 1 || name.length > MAX_API_KEY_NAME_LENGTH) {
        throw new ApiKeyNameError();
      }
      if (activeOf(userId).length >= MAX_ACTIVE_API_KEYS_PER_USER) {
        throw new ApiKeyLimitError();
      }
      const secret = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
      const record: ApiKeyRecord = {
        id: randomUUID(),
        userId,
        name,
        prefix: secret.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
        hash: hashApiKeySecret(secret),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      };
      byId.set(record.id, record);
      byHash.set(record.hash, record.id);
      persist();
      return { key: toPublic(record), secret };
    },

    list(userId) {
      return activeOf(userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toPublic);
    },

    revoke(userId, id) {
      const record = byId.get(id);
      if (!record || record.userId !== userId || record.revokedAt !== null) return false;
      record.revokedAt = new Date().toISOString();
      persist();
      return true;
    },

    verify(secret) {
      if (!looksLikeApiKey(secret)) return undefined;
      const id = byHash.get(hashApiKeySecret(secret));
      const record = id ? byId.get(id) : undefined;
      return record && record.revokedAt === null ? record : undefined;
    },

    touch(id) {
      const record = byId.get(id);
      if (!record) return;
      const now = Date.now();
      record.lastUsedAt = new Date(now).toISOString();
      if (now - (lastPersistedTouch.get(id) ?? 0) >= TOUCH_PERSIST_INTERVAL_MS) {
        lastPersistedTouch.set(id, now);
        persist();
      }
    },
  };
}
