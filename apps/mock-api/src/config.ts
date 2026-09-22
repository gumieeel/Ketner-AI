/**
 * Конфигурация mock-API.
 *
 * Значения читаются из переменных окружения, чтобы при переходе на реальные
 * сервисы не менять код: подменяется только источник данных и ключи.
 * Пример переменных — apps/mock-api/.env.example.
 */
export const config = {
  serviceName: 'ketner-mock-api',
  version: '0.1.0',
  port: Number(process.env.PORT ?? 8787),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  /** Разрешённый origin для CORS. По умолчанию — dev-сервер Vite. */
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
} as const;
