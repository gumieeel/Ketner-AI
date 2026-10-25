import { useAuth } from '../auth/auth-store';

const DEFAULT_STORAGE_KEY = 'ketner_free_usage_v1';

/** Лимит бесплатных сообщений в час */
export const FREE_HOURLY_LIMIT = 3;

/** Окно лимита — 1 час (в миллисекундах) */
export const FREE_WINDOW_MS = 60 * 60 * 1000;

export interface FreeUsageInfo {
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
  isLimitReached: boolean;
}

interface StoredUsage {
  count: number;
  resetAt: number;
}

/**
 * Определяет ключ аккаунта для раздельного подсчёта лимитов:
 * - Для авторизованного пользователя: id или email.
 * - Для неавторизованного пользователя: 'guest'.
 */
export function getAccountKey(explicitKey?: string | null): string {
  if (explicitKey) {
    return explicitKey;
  }
  try {
    const user = useAuth.getState().user;
    if (user?.id) {
      return user.id;
    }
    if (user?.email) {
      return user.email;
    }
  } catch {
    // Резерв на случай вызова до инициализации стора
  }
  return 'guest';
}

function getStorageKey(accountKey: string): string {
  if (accountKey === 'guest') {
    return DEFAULT_STORAGE_KEY;
  }
  return `ketner_free_usage_user_${accountKey}`;
}

function readStorage(accountKey: string = getAccountKey()): StoredUsage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const key = getStorageKey(accountKey);
      let raw = window.localStorage.getItem(key);
      if (!raw && accountKey === 'guest') {
        raw = window.localStorage.getItem(DEFAULT_STORAGE_KEY);
      }
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredUsage>;
        if (typeof parsed.count === 'number' && typeof parsed.resetAt === 'number') {
          // Если окно в 1 час ещё не истекло, возвращаем текущие данные
          if (Date.now() < parsed.resetAt) {
            return {
              count: parsed.count,
              resetAt: parsed.resetAt,
            };
          }
        }
      }
    }
  } catch {
    // В случае ошибок парсинга или недоступности хранилища сбрасываем состояние
  }

  return {
    count: 0,
    resetAt: Date.now() + FREE_WINDOW_MS,
  };
}

function writeStorage(data: StoredUsage, accountKey: string = getAccountKey()): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const key = getStorageKey(accountKey);
      window.localStorage.setItem(key, JSON.stringify(data));
      if (accountKey === 'guest') {
        window.localStorage.setItem(DEFAULT_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Игнорируем ошибки квот и приватного режима
  }
}

/** Получить текущую статистику использования бесплатного тарифа для аккаунта */
export function getFreeUsage(accountKey?: string | null): FreeUsageInfo {
  const key = getAccountKey(accountKey);
  const current = readStorage(key);
  return {
    count: current.count,
    limit: FREE_HOURLY_LIMIT,
    remaining: Math.max(0, FREE_HOURLY_LIMIT - current.count),
    resetAt: current.resetAt,
    isLimitReached: current.count >= FREE_HOURLY_LIMIT,
  };
}

/** Зафиксировать отправленное сообщение на бесплатном тарифе для аккаунта */
export function incrementFreeUsage(accountKey?: string | null): FreeUsageInfo {
  const key = getAccountKey(accountKey);
  const current = readStorage(key);
  const nextCount = current.count + 1;
  const updated: StoredUsage = {
    count: nextCount,
    resetAt: current.resetAt,
  };
  writeStorage(updated, key);
  return {
    count: nextCount,
    limit: FREE_HOURLY_LIMIT,
    remaining: Math.max(0, FREE_HOURLY_LIMIT - nextCount),
    resetAt: current.resetAt,
    isLimitReached: nextCount >= FREE_HOURLY_LIMIT,
  };
}

/** Проверяет, исчерпан ли часовой лимит бесплатного тарифа для аккаунта */
export function isFreeLimitReached(accountKey?: string | null): boolean {
  try {
    const user = useAuth.getState().user;
    // Платные тарифы никогда не блокируются бесплатными лимитами
    if (
      user &&
      user.plan &&
      user.plan !== 'free' &&
      (!accountKey || accountKey === user.id || accountKey === user.email)
    ) {
      return false;
    }
  } catch {
    // ignore
  }
  return getFreeUsage(accountKey).isLimitReached;
}

/**
 * Сбрасывает / обновляет лимит для аккаунта при входе в систему.
 * Каждому аккаунту выделяется свой свежий лимит 3 сообщений на 1 час.
 */
export function refreshAccountLimit(accountKey?: string | null): FreeUsageInfo {
  const key = getAccountKey(accountKey);
  const data: StoredUsage = {
    count: 0,
    resetAt: Date.now() + FREE_WINDOW_MS,
  };
  writeStorage(data, key);
  return {
    count: 0,
    limit: FREE_HOURLY_LIMIT,
    remaining: FREE_HOURLY_LIMIT,
    resetAt: data.resetAt,
    isLimitReached: false,
  };
}

/** Сбросить счётчик (для тестов или ручного сброса) */
export function resetFreeUsage(accountKey?: string | null): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (accountKey) {
        window.localStorage.removeItem(getStorageKey(accountKey));
      } else {
        window.localStorage.removeItem(DEFAULT_STORAGE_KEY);
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && (k.startsWith('ketner_free_usage') || k === DEFAULT_STORAGE_KEY)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => window.localStorage.removeItem(k));
      }
    }
  } catch {
    // Игнорируем
  }
}
