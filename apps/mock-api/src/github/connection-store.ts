/**
 * Привязанные аккаунты GitHub. Токен доступа хранится только на сервере и только в
 * зашифрованном виде (AES-256-GCM, platform/token-crypto.ts, ключ из BETTER_AUTH_SECRET): ни в браузер,
 * ни в ответы API он не попадает.
 */

import { openToken, sealToken } from '../platform/token-crypto.js';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface GithubConnection {
  userId: string;
  githubId: number;
  login: string;
  avatarUrl: string | null;
  /** Права, которые человек выдал при подключении (например, `repo,read:user`). */
  scopes: string[];
  connectedAt: string;
}

/** Запись в хранилище: токен зашифрован. */
export interface StoredGithubConnection extends GithubConnection {
  tokenEnc: string;
}

export interface GithubConnectionDbDriver {
  upsert(record: StoredGithubConnection): Promise<void>;
  remove(userId: string): Promise<void>;
}

export interface GithubConnectionStore {
  get(userId: string): GithubConnection | undefined;
  /** Токен для запросов к GitHub от имени пользователя. */
  tokenOf(userId: string): string | undefined;
  save(connection: GithubConnection, token: string): GithubConnection;
  remove(userId: string): boolean;
  loadExternal(records: StoredGithubConnection[]): void;
  setDbDriver(driver: GithubConnectionDbDriver | null): void;
}

/** Токен GitHub: прежний ключ `ketner:github-token:` (platform/token-crypto.ts), формат не менялся. */
export function encryptToken(token: string, secret: string): string {
  return sealToken(token, secret, 'github-token');
}

export function decryptToken(value: string, secret: string): string | undefined {
  return openToken(value, secret, 'github-token');
}

function toPublic(record: StoredGithubConnection): GithubConnection {
  return {
    userId: record.userId,
    githubId: record.githubId,
    login: record.login,
    avatarUrl: record.avatarUrl,
    scopes: [...record.scopes],
    connectedAt: record.connectedAt,
  };
}

function readSnapshot(file: string): StoredGithubConnection[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      connections?: StoredGithubConnection[];
    };
    return Array.isArray(parsed.connections) ? parsed.connections : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        '[mock-api] хранилище GitHub-подключений не прочитано, начинаем с пустого:',
        error,
      );
    }
    return [];
  }
}

function writeSnapshot(file: string, connections: StoredGithubConnection[]): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ connections }, null, 2)}\n`, 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    console.error('[mock-api] Ошибка записи GitHub-подключений:', error);
  }
}

export function createGithubConnectionStore(options: {
  file?: string;
  secret: string;
}): GithubConnectionStore {
  const byUser = new Map<string, StoredGithubConnection>();
  let dbDriver: GithubConnectionDbDriver | null = null;

  if (options.file) {
    for (const record of readSnapshot(options.file)) byUser.set(record.userId, record);
  }

  const persist = (): void => {
    if (options.file) writeSnapshot(options.file, [...byUser.values()]);
  };

  return {
    get(userId) {
      const record = byUser.get(userId);
      return record ? toPublic(record) : undefined;
    },

    tokenOf(userId) {
      const record = byUser.get(userId);
      return record ? decryptToken(record.tokenEnc, options.secret) : undefined;
    },

    save(connection, token) {
      const record: StoredGithubConnection = {
        ...connection,
        tokenEnc: encryptToken(token, options.secret),
      };
      byUser.set(connection.userId, record);
      persist();
      dbDriver?.upsert({ ...record }).catch((error: unknown) => {
        console.error('[mock-api] Ошибка записи GitHub-подключения в Postgres:', error);
      });
      return toPublic(record);
    },

    remove(userId) {
      const existed = byUser.delete(userId);
      if (existed) {
        persist();
        dbDriver?.remove(userId).catch((error: unknown) => {
          console.error('[mock-api] Ошибка удаления GitHub-подключения из Postgres:', error);
        });
      }
      return existed;
    },

    loadExternal(records) {
      for (const record of records) byUser.set(record.userId, { ...record });
    },

    setDbDriver(driver) {
      dbDriver = driver;
    },
  };
}
