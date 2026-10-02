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


/**
 * Читает переменную окружения с безопасным fallback значением.
 */
function envWithFallback(name: string, fallback: string): string {
  const value = process.env[name];
  if (value && value.trim() !== '') return value;
  return fallback;
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

  /** Обменный курс USD к RUB для расчёта экономики тарифов и маржинальности. */
  usdToRubRate: readNumber('USD_TO_RUB_RATE', 95),

  /** Список email адресов с VIP / Ultra доступом. Настраивается через переменную VIP_EMAILS. */
  vipEmails: (process.env.VIP_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  /** Список email адресов администраторов с доступом к Admin API. Настраивается через переменную ADMIN_EMAILS. */
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

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
  /** Хранилище использования AI (usage & cost): файл переживает перезапуск. */
  usageStoreFile:
    process.env.USAGE_STORE_FILE ??
    fileURLToPath(new URL('../data/usage.json', import.meta.url)),
  /** База данных Better Auth (SQLite). */
  authDbFile:
    process.env.AUTH_DB_FILE ?? fileURLToPath(new URL('../data/auth.sqlite', import.meta.url)),
  /** Хранилище счетов (СБП, Stars, Crypto): файл переживает перезапуск. */
  invoiceStoreFile:
    process.env.INVOICE_STORE_FILE ??
    fileURLToPath(new URL('../data/invoices.json', import.meta.url)),
  /** Хранилище использованных блокчейн-транзакций (защита от повторного использования). */
  usedTxStoreFile:
    process.env.USED_TX_STORE_FILE ??
    fileURLToPath(new URL('../data/used_transactions.json', import.meta.url)),
  /** Хранилище тикетов поддержки: файл переживает перезапуск mock-API. */
  supportStoreFile:
    process.env.SUPPORT_STORE_FILE ??
    fileURLToPath(new URL('../data/support.json', import.meta.url)),

  /**
   * Секретный ключ Better Auth для подписи сессий и кук.
   * Настраивается через BETTER_AUTH_SECRET (openssl rand -base64 32).
   */
  betterAuthSecret:
    process.env.BETTER_AUTH_SECRET || 'ketner-ai-better-auth-secret-key-32chars-minimum-safe',

  /**
   * PostgreSQL / Supabase Database URL
   */
  databaseUrl: process.env.DATABASE_URL?.trim() || '',

  /**
   * Supabase Project Credentials
   */
  supabaseUrl: process.env.SUPABASE_URL || 'https://gwioimhpfulpjxzsuesy.supabase.co',
  supabaseAnonKey:
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || '',
  supabaseJwksUrl:
    process.env.SUPABASE_JWKS_URL ||
    'https://gwioimhpfulpjxzsuesy.supabase.co/auth/v1/.well-known/jwks.json',

  /**
   * Better Auth API Key для подключения к Better Auth Infra / Dashboard.
   * Настраивается через переменную BETTER_AUTH_API_KEY.
   */
  betterAuthApiKey: process.env.BETTER_AUTH_API_KEY || '',

  /** Базовый URL для Better Auth (включая редиректы OAuth). */
  betterAuthUrl:
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    process.env.BASE_URL?.trim() ||
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

  /** Telegram Support Bot для приёма жалоб и поддержки пользователей. */
  telegramSupportBotToken:
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN || '8767965681:AAFkLbcszHQe7-XIZ8-y8Q-vebuoJXBSFGo',
  telegramSupportBotUsername:
    process.env.TELEGRAM_SUPPORT_BOT_USERNAME || 'ketner_support_bot',
  supportAdminUsername:
    (process.env.SUPPORT_ADMIN_USERNAME || 'gumieeel').replace(/^@/, '').toLowerCase(),
  supportAdminChatId: process.env.SUPPORT_ADMIN_CHAT_ID
    ? Number(process.env.SUPPORT_ADMIN_CHAT_ID)
    : undefined,

  /** CryptoCloud: Приём платежей в криптовалюте */
  cryptoCloudApiKey:
    process.env.CRYPTOCLOUD_API_KEY ||
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiTVRJeU1EYzEiLCJ0eXBlIjoicHJvamVjdCIsInYiOiI4YTQ3YmNkMjU3NTgyMTJkMWZlOWY4MjI3MGMyNGVhN2M0M2U3NDBhYjc3ZDA2ZWUwZWI5YTYzOTEzYjBjNzJkIiwiZXhwIjo4ODE5MDg1MTAzMX0.T6Nog1lIMERCkle_A2XgkOd8SGPmBdTh9an_ZlhqKyQ',
  cryptoCloudShopId: process.env.CRYPTOCLOUD_SHOP_ID || 'AJyMLWkX7s5RphA4',
  cryptoCloudSecretKey:
    process.env.CRYPTOCLOUD_SECRET_KEY || 'U7Dkec32RzJFn1gJWdGcMf9TIyXMyeIvDOpK',

  /** AI Providers: OpenRouter */
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',

  /** AI Providers: OpenAI */
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',

  /** AI Providers: Anthropic */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',

  /** AI Providers: Google Gemini */
  googleApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  googleBaseUrl: process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',

  /**
   * Секрет для проверки подписи webhook-запросов.
   */
  webhookSecret: envWithFallback('WEBHOOK_SECRET', 'ketner-ai-webhook-secret-dev'),

  /**
   * Ключ доступа к Admin API.
   */
  adminApiKey: envWithFallback('ADMIN_API_KEY', 'ketner-ai-admin-key-dev'),

  /**
   * Stripe Billing Credentials & Price IDs
   */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePricePlus: process.env.STRIPE_PRICE_PLUS || '',
  stripePricePro: process.env.STRIPE_PRICE_PRO || '',
  stripePriceUltra: process.env.STRIPE_PRICE_ULTRA || '',

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
