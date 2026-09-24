import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlanId } from './types.js';

// Загрузка .env файла (нативно в Node.js 20+)
const envCandidates = [
  join(process.cwd(), '.env'),
  join(process.cwd(), 'apps/mock-api/.env'),
  fileURLToPath(new URL('../.env', import.meta.url)),
];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
      break;
    } catch {
      // Игнорируем ошибки
    }
  }
}

/**
 * Конфигурация mock-API.
 *
 * Значения читаются из переменных окружения, чтобы при переходе на реальные
 * сервисы не менять код: подменяется только источник данных и ключи.
 * Пример переменных — apps/mock-api/.env.example.
 */
function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Настройки заглушки ИИ: вынесены в тип, чтобы тесты могли подставить свои. */
export interface AiConfig {
  /** Пауза перед первым чанком: интерфейс показывает «думает…». */
  thinkingMs: readonly [number, number];
  /** Пауза между чанками: имитация стриминга токенов. */
  chunkMs: readonly [number, number];
  /** Доля запросов, на которые заглушка отвечает ошибкой (0 — никогда). */
  failureRate: number;
  /** Источник случайности: в тестах заменяется детерминированным. */
  random: () => number;
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
  demoPlan: 'free' as PlanId,

  /** Хранилище диалогов: файл переживает перезапуск mock-API. */
  storeFile:
    process.env.STORE_FILE ?? fileURLToPath(new URL('../data/store.json', import.meta.url)),
  /** Хранилище пользователей: файл переживает перезапуск mock-API. */
  userStoreFile:
    process.env.USER_STORE_FILE ?? fileURLToPath(new URL('../data/users.json', import.meta.url)),
  /** Хранилище подписок: файл переживает перезапуск mock-API. */
  subscriptionStoreFile:
    process.env.SUBSCRIPTION_STORE_FILE ??
    fileURLToPath(new URL('../data/subscriptions.json', import.meta.url)),
  /** База данных Better Auth (SQLite). */
  authDbFile:
    process.env.AUTH_DB_FILE ?? fileURLToPath(new URL('../data/auth.sqlite', import.meta.url)),
  /** Секретный ключ Better Auth для подписи сессий и кук. */
  betterAuthSecret:
    process.env.BETTER_AUTH_SECRET ?? 'ketner-ai-better-auth-secret-key-32chars-minimum-safe',
  /** Базовый URL для Better Auth (включая редиректы OAuth). */
  betterAuthUrl:
    process.env.BETTER_AUTH_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    process.env.BASE_URL ??
    `http://localhost:${readNumber('PORT', 8787)}`,

  /** OAuth провайдеры (Better Auth). */
  googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || undefined,
  githubClientId: process.env.GITHUB_CLIENT_ID || undefined,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || undefined,

  /** Telegram Bot для приёма оплаты (Telegram Stars и СБП). */
  telegramBotToken:
    process.env.TELEGRAM_BOT_TOKEN || '8950856076:AAF6Id66Vc0IHWBWByV1DArttb6cs8go2DM',
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || 'Robo_kassa_bot',
  telegramPaymentProviderToken: process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN || '',
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',

  /** OpenRouter LLM провайдер. */
  openRouterApiKey:
    process.env.OPENROUTER_API_KEY ||
    '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',
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openRouterModel: process.env.OPENROUTER_MODEL || 'nex-agi/nex-n2.5-mini:free',

  ai: {
    thinkingMs: [
      readNumber('MOCK_AI_THINKING_MIN_MS', 350),
      readNumber('MOCK_AI_THINKING_MAX_MS', 900),
    ],
    chunkMs: [readNumber('MOCK_AI_CHUNK_MIN_MS', 20), readNumber('MOCK_AI_CHUNK_MAX_MS', 40)],
    failureRate: readNumber('MOCK_AI_FAILURE_RATE', 0),
    random: Math.random,
  } satisfies AiConfig,
} as const;
