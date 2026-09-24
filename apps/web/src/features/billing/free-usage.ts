const STORAGE_KEY = 'ketner_free_usage_v1';

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

function readStorage(): StoredUsage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
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

function writeStorage(data: StoredUsage): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  } catch {
    // Игнорируем ошибки квот и приватного режима
  }
}

/** Получить текущую статистику использования бесплатного тарифа */
export function getFreeUsage(): FreeUsageInfo {
  const current = readStorage();
  return {
    count: current.count,
    limit: FREE_HOURLY_LIMIT,
    remaining: Math.max(0, FREE_HOURLY_LIMIT - current.count),
    resetAt: current.resetAt,
    isLimitReached: current.count >= FREE_HOURLY_LIMIT,
  };
}

/** Зафиксировать отправленное сообщение на бесплатном тарифе */
export function incrementFreeUsage(): FreeUsageInfo {
  const current = readStorage();
  const nextCount = current.count + 1;
  const updated: StoredUsage = {
    count: nextCount,
    resetAt: current.resetAt,
  };
  writeStorage(updated);
  return {
    count: nextCount,
    limit: FREE_HOURLY_LIMIT,
    remaining: Math.max(0, FREE_HOURLY_LIMIT - nextCount),
    resetAt: current.resetAt,
    isLimitReached: nextCount >= FREE_HOURLY_LIMIT,
  };
}

/** Проверяет, исчерпан ли часовой лимит бесплатного тарифа */
export function isFreeLimitReached(): boolean {
  return getFreeUsage().isLimitReached;
}

/** Сбросить счётчик (для тестов или ручного сброса) */
export function resetFreeUsage(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Игнорируем
  }
}
