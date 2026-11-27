/**
 * Настройки клиента postgres.js — одни для сервера (db/client.ts) и для теста обрыва соединения
 * (db/connection.test.ts). Оборванное соединение postgres.js открывает заново на следующем запросе.
 */

import postgres from 'postgres';

export const QUERY_CLIENT_OPTIONS = {
  max: 10, // pool size
  idle_timeout: 30, // закрывать неиспользуемые подключения
  connect_timeout: 10,
  onnotice: () => {},
} as const;

export function createQueryClient(
  url: string,
  overrides: Partial<postgres.Options<Record<string, postgres.PostgresType>>> = {},
) {
  return postgres(url, { ...QUERY_CLIENT_OPTIONS, ...overrides });
}
