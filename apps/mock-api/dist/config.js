import { fileURLToPath } from 'node:url';
/**
 * Конфигурация mock-API.
 *
 * Значения читаются из переменных окружения, чтобы при переходе на реальные
 * сервисы не менять код: подменяется только источник данных и ключи.
 * Пример переменных — apps/mock-api/.env.example.
 */
function readNumber(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}
export const config = {
    serviceName: 'ketner-mock-api',
    version: '0.1.0',
    port: readNumber('PORT', 8787),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    /** Разрешённый origin для CORS. По умолчанию — dev-сервер Vite. */
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    /** Адрес фронтенда: его подсказывает корень API, если порт открыли вручную. */
    webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:5173',
    /** Пользователь и план заглушки: реальные аккаунты появятся на этапе 3. */
    demoUserId: 'demo-user',
    demoPlan: 'free',
    /** Хранилище диалогов: файл переживает перезапуск mock-API. */
    storeFile: process.env.STORE_FILE ?? fileURLToPath(new URL('../data/store.json', import.meta.url)),
    /** Хранилище пользователей: файл переживает перезапуск mock-API. */
    userStoreFile: process.env.USER_STORE_FILE ?? fileURLToPath(new URL('../data/users.json', import.meta.url)),
    /** Хранилище подписок: файл переживает перезапуск mock-API. */
    subscriptionStoreFile: process.env.SUBSCRIPTION_STORE_FILE ??
        fileURLToPath(new URL('../data/subscriptions.json', import.meta.url)),
    ai: {
        thinkingMs: [
            readNumber('MOCK_AI_THINKING_MIN_MS', 350),
            readNumber('MOCK_AI_THINKING_MAX_MS', 900),
        ],
        chunkMs: [readNumber('MOCK_AI_CHUNK_MIN_MS', 20), readNumber('MOCK_AI_CHUNK_MAX_MS', 40)],
        failureRate: readNumber('MOCK_AI_FAILURE_RATE', 0),
        random: Math.random,
    },
};
