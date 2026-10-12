import { createHmac } from 'node:crypto';
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

const nodeEnv = process.env.NODE_ENV ?? 'development';

/** В production любые dev-заглушки и значения по умолчанию для секретов запрещены. */
export const isProduction = nodeEnv === 'production';

const MIN_SECRET_LENGTH = 32;

/**
 * Значения, которые когда-либо лежали в репозитории: считаются скомпрометированными
 * и не принимаются в production, даже если их задали через переменные окружения.
 */
const COMPROMISED_SECRETS: ReadonlySet<string> = new Set([
  'ketner-ai-better-auth-secret-key-32chars-minimum-safe',
  'ketner-ai-webhook-secret-dev',
  'ketner-ai-admin-key-dev',
  'ketner-mock-jwt-secret',
]);

/** Список email через запятую: нормализуется, пустые элементы отбрасываются. */
function parseEmailList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Необязательная переменная окружения: пустая строка, если не задана. */
function optionalEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

/**
 * Секрет приложения.
 *
 * В production значение обязательно, не короче 32 символов и не из списка
 * скомпрометированных; приложение не стартует с небезопасной конфигурацией.
 * Вне production допускается dev-значение по умолчанию (оно никогда не попадает в прод).
 */
function secretEnv(name: string, devFallback: string): string {
  const value = optionalEnv(name);
  if (!isProduction) {
    return value || devFallback;
  }
  if (!value) {
    throw new Error(`[config] Переменная окружения ${name} обязательна в production`);
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`[config] ${name} слишком короткий: нужно минимум ${MIN_SECRET_LENGTH} символов`);
  }
  if (COMPROMISED_SECRETS.has(value)) {
    // Осознанное исключение владельца: ключ был опубликован в репозитории, поэтому
    // любой, кто его видел, может подделать сессии. По умолчанию запуск запрещён.
    if (process.env.ALLOW_COMPROMISED_SECRETS?.trim() === 'true') {
      console.warn(
        `[config] ВНИМАНИЕ: ${name} совпадает с ранее опубликованным значением ` +
          '(ALLOW_COMPROMISED_SECRETS=true). Замените его при первой возможности.',
      );
      return value;
    }
    throw new Error(
      `[config] ${name} совпадает с ранее опубликованным значением: сгенерируйте новое ` +
        '(или временно задайте ALLOW_COMPROMISED_SECRETS=true на свой риск)',
    );
  }
  return value;
}

/** Производный ключ с доменным разделением: из одного корневого секрета разные подключи. */
function deriveSecret(rootSecret: string, label: string): string {
  return createHmac('sha256', rootSecret).update(label).digest('hex');
}

const betterAuthSecret = secretEnv(
  'BETTER_AUTH_SECRET',
  'dev-only-better-auth-secret-not-for-production-use',
);

/**
 * Ключ подписи Bearer-токенов. Если AUTH_JWT_SECRET не задан, выводится из
 * BETTER_AUTH_SECRET (HMAC с меткой), поэтому отдельного дефолта в коде нет.
 */
const authJwtSecret = optionalEnv('AUTH_JWT_SECRET')
  ? secretEnv('AUTH_JWT_SECRET', '')
  : deriveSecret(betterAuthSecret, 'ketner:auth-jwt:v1');

const supabaseUrl = optionalEnv('SUPABASE_URL');

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
  nodeEnv,
  /** Разрешённый origin для CORS. По умолчанию — dev-сервер Vite. */
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  /** Адрес фронтенда: его подсказывает корень API, если порт открыли вручную. */
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:5173',

  /** Обменный курс USD к RUB для расчёта экономики тарифов и маржинальности. */
  usdToRubRate: readNumber('USD_TO_RUB_RATE', 95),

  /**
   * Список email адресов с VIP / Ultra доступом (VIP_EMAILS через запятую).
   * По умолчанию пуст: в коде нет ни одного зашитого адреса.
   */
  vipEmails: parseEmailList(process.env.VIP_EMAILS),

  /**
   * Список email адресов администраторов (ADMIN_EMAILS через запятую).
   * По умолчанию пуст. Права админа никогда не выводятся из «похожего» адреса (admin@...).
   */
  adminEmails: parseEmailList(process.env.ADMIN_EMAILS),

  /**
   * Первичный администратор для развёртывания: создаётся при старте, если заданы оба значения.
   * Пароль не короче 12 символов. Без этих переменных админ-аккаунт не создаётся.
   */
  seedAdminEmail: optionalEnv('SEED_ADMIN_EMAIL').toLowerCase(),
  seedAdminPassword: optionalEnv('SEED_ADMIN_PASSWORD'),

  /**
   * Публичный демо-аккаунт (demo@ketner.ai). Включён вне production;
   * в production только при явном ENABLE_DEMO_ACCOUNT=true.
   */
  /**
   * Заглушки оплаты (активация тарифа без платежа: прямой checkout, СБП-«подтверждение»,
   * Stripe без ключей). Только вне production — в production их нет совсем.
   */
  enableMockBilling: !isProduction,
  /**
   * Ручное подтверждение прямого перевода на кошелёк (по TxID). В production выключено, пока
   * владелец явно не задаст ENABLE_MANUAL_CRYPTO=true; даже тогда проверяется только USDT TRC-20.
   */
  manualCryptoEnabled: !isProduction || optionalEnv('ENABLE_MANUAL_CRYPTO') === 'true',
  enableDemoAccount: !isProduction || optionalEnv('ENABLE_DEMO_ACCOUNT') === 'true',
  /**
   * Анонимный доступ к чату и диалогам через бесплатную модель OpenRouter (nvidia/nemotron-3-ultra-550b-a55b:free).
   * Разрешён по умолчанию (отключается явно через ALLOW_ANONYMOUS_CHAT=false).
   */
  allowAnonymousChat: optionalEnv('ALLOW_ANONYMOUS_CHAT') === 'false' ? false : true,

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
  /** Хранилище API-ключей для программирования (CLI, IDE): в файле только SHA-256 ключей. */
  apiKeyStoreFile:
    process.env.API_KEY_STORE_FILE ??
    fileURLToPath(new URL('../data/api-keys.json', import.meta.url)),
  /** Хранилище оценок ответов (лайки/дизлайки) для анализа роутинга и эскалации моделей. */
  feedbackStoreFile:
    process.env.FEEDBACK_STORE_FILE ??
    fileURLToPath(new URL('../data/feedback.json', import.meta.url)),

  /**
   * Секретный ключ Better Auth для подписи сессий и кук.
   * Настраивается через BETTER_AUTH_SECRET (openssl rand -base64 32).
   */
  betterAuthSecret,

  /**
   * Ключ подписи Bearer-токенов (HS256). Настраивается через AUTH_JWT_SECRET;
   * без неё выводится из BETTER_AUTH_SECRET.
   */
  authJwtSecret,

  /**
   * PostgreSQL / Supabase Database URL
   */
  databaseUrl: process.env.DATABASE_URL?.trim() || '',

  /**
   * Supabase Project Credentials
   */
  supabaseUrl,
  supabaseAnonKey: optionalEnv('SUPABASE_PUBLISHABLE_KEY') || optionalEnv('SUPABASE_ANON_KEY'),
  supabaseSecretKey: optionalEnv('SUPABASE_SECRET_KEY'),
  supabaseJwksUrl:
    optionalEnv('SUPABASE_JWKS_URL') ||
    (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json` : ''),

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
  telegramBotToken: optionalEnv('TELEGRAM_BOT_TOKEN'),
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || 'Robo_kassa_bot',
  telegramPaymentProviderToken: process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN || '',
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
  /**
   * secret_token для вебхуков Telegram: передаётся в setWebhook, Telegram присылает его в
   * заголовке X-Telegram-Bot-Api-Secret-Token. Выводится из корневого секрета (hex, 64 символа).
   */
  telegramWebhookSecret: deriveSecret(betterAuthSecret, 'ketner:telegram-webhook:payments:v1'),
  telegramSupportWebhookSecret: deriveSecret(betterAuthSecret, 'ketner:telegram-webhook:support:v1'),

  /** Telegram Support Bot для приёма жалоб и поддержки пользователей. */
  telegramSupportBotToken: optionalEnv('TELEGRAM_SUPPORT_BOT_TOKEN'),
  telegramSupportBotUsername:
    process.env.TELEGRAM_SUPPORT_BOT_USERNAME || 'ketner_support_bot',
  supportAdminUsername:
    (process.env.SUPPORT_ADMIN_USERNAME || 'gumieeel').replace(/^@/, '').toLowerCase(),
  supportAdminChatId: process.env.SUPPORT_ADMIN_CHAT_ID
    ? Number(process.env.SUPPORT_ADMIN_CHAT_ID)
    : undefined,

  /** CryptoCloud: Приём платежей в криптовалюте */
  cryptoCloudApiKey: optionalEnv('CRYPTOCLOUD_API_KEY'),
  cryptoCloudShopId: optionalEnv('CRYPTOCLOUD_SHOP_ID'),
  cryptoCloudSecretKey: optionalEnv('CRYPTOCLOUD_SECRET_KEY'),

  /**
   * ИИ: единый ключ OpenRouter для всех моделей (GPT, Claude, Grok, Gemini, DeepSeek, MiMo).
   * Прямые ключи OpenAI / Anthropic / Google не используются.
   */
  openRouterApiKey: optionalEnv('OPENROUTER_API_KEY'),
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',

  /**
   * Секрет для проверки подписи webhook-запросов.
   */
  webhookSecret: secretEnv('WEBHOOK_SECRET', 'dev-only-webhook-secret-not-for-production'),

  /**
   * Ключ доступа к Admin API.
   */
  adminApiKey: secretEnv('ADMIN_API_KEY', 'dev-only-admin-key-not-for-production'),

  /**
   * Stripe Billing Credentials & Price IDs
   */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePricePlus: process.env.STRIPE_PRICE_PLUS || '',
  stripePricePro: process.env.STRIPE_PRICE_PRO || '',
  stripePriceUltra: process.env.STRIPE_PRICE_ULTRA || '',

  /**
   * Ketner Code: серверные проекты и агент.
   * SANDBOX_MODE: off (по умолчанию, команды недоступны) | local (только для разработки) | docker.
   */
  /** Генерация изображений: Cloudflare Workers AI (FLUX). Без токена раздел показывает «недоступно». */
  images: {
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || '',
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN?.trim() || '',
    runwareApiKey: process.env.RUNWARE_API_KEY?.trim() || '',
    /** Папка для картинок без БД (локально и в тестах). С DATABASE_URL картинки хранятся в Postgres. */
    dir:
      process.env.IMAGES_DIR?.trim() ||
      fileURLToPath(new URL('../data/images', import.meta.url)),
  },

  code: {
    projectsDir:
      process.env.CODE_PROJECTS_DIR?.trim() ||
      fileURLToPath(new URL('../data/projects', import.meta.url)),
    sandboxMode: ((): 'off' | 'local' | 'docker' => {
      const raw = (process.env.SANDBOX_MODE ?? 'off').trim().toLowerCase();
      return raw === 'local' || raw === 'docker' ? raw : 'off';
    })(),
    sandboxDockerImage: process.env.SANDBOX_DOCKER_IMAGE?.trim() || '',
    sandboxAllowLocalInProduction: process.env.SANDBOX_ALLOW_LOCAL_IN_PRODUCTION === 'true',
    /** Сеть внутри команд агента (npm install). По умолчанию выключена. */
    sandboxAllowNetwork: process.env.SANDBOX_ALLOW_NETWORK === 'true',
  },

  ai: {
    thinkingMs: [
      readNumber('MOCK_AI_THINKING_MIN_MS', 350),
      readNumber('MOCK_AI_THINKING_MAX_MS', 900),
    ],
    chunkMs: [readNumber('MOCK_AI_CHUNK_MIN_MS', 20), readNumber('MOCK_AI_CHUNK_MAX_MS', 40)],
    // Имитация сбоев — только для разработки: в production ответ никогда не подменяется заглушкой.
    failureRate: isProduction ? 0 : readNumber('MOCK_AI_FAILURE_RATE', 0),
    random: Math.random,
  } satisfies AiConfig,
} as const;
