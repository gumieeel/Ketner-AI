import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { defaultBetterAuth } from './auth/better-auth.js';
import { config } from './config.js';
import type { AiConfig } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createApiRouter, describeService } from './routes/index.js';
import { apiKeyStore as defaultApiKeyStore, conversationStore, subscriptionStore, userStore } from './store/index.js';
import type { ApiKeyStore } from './store/api-key-store.js';
import type { AgentGateway } from './ai/agent-gateway.js';
import { createV1Router } from './routes/v1.js';
import { createGithubCallbackHandler } from './routes/github.js';
import type { GithubConnectionStore } from './github/connection-store.js';
import type { GithubOAuthSettings } from './github/oauth.js';
import type { InvoiceStore } from './store/invoice-store.js';
import type { BillingService } from './billing/billing-service.js';
import type { ConversationStore } from './store/conversation-store.js';
import type { SubscriptionStore } from './store/subscription-store.js';
import type { UserStore } from './store/user-store.js';

import type { TelegramBotService } from './telegram/bot.js';
import type { TelegramSupportBotService } from './telegram/support-bot.js';
import type { SupportStore } from './store/support-store.js';

import type { UsageStore } from './store/usage-store.js';
import { usageStore as defaultUsageStore } from './store/index.js';

/**
 * Зависимости приложения.
 *
 * Вынесены в параметр, чтобы тесты подставляли своё хранилище (временный файл)
 * и нулевые задержки стриминга, не трогая рабочие данные.
 */
export interface AppDeps {
  store: ConversationStore;
  userStore: UserStore;
  subscriptionStore: SubscriptionStore;
  usageStore?: UsageStore;
  ai: AiConfig;
  userId: string;
  betterAuth?: typeof defaultBetterAuth;
  botService?: TelegramBotService;
  supportBotService?: TelegramSupportBotService;
  supportStore?: SupportStore;
  /** Хранилище API-ключей для программирования (`/v1`, `/api/keys`). */
  apiKeyStore?: ApiKeyStore;
  /** Шлюз агента; в тестах подставляется с поддельным провайдером. */
  agentGateway?: AgentGateway;
  /** Привязанные аккаунты GitHub; в тестах — хранилище во временном файле. */
  githubConnectionStore?: GithubConnectionStore;
  /** Запросы к GitHub (OAuth и прокси); в тестах подменяется. */
  githubFetch?: typeof fetch;
  /** Настройки OAuth GitHub; в тестах подменяются. */
  githubSettings?: () => GithubOAuthSettings | null;
  /** Счета на оплату; в тестах — временный файл, чтобы не трогать рабочие данные. */
  invoiceStore?: InvoiceStore;
  /** Платежи, подписки и возвраты. */
  billingService?: BillingService;
}

const defaultDeps: AppDeps = {
  store: conversationStore,
  userStore,
  subscriptionStore,
  usageStore: defaultUsageStore,
  ai: config.ai,
  userId: config.demoUserId,
  betterAuth: defaultBetterAuth,
};

/**
 * Собирает приложение Express.
 *
 * Вынесено отдельно от запуска сервера, чтобы приложение можно было
 * использовать в тестах без прослушивания порта.
 */
export function createApp(overrides: Partial<AppDeps> = {}): Express {
  const deps: AppDeps = { ...defaultDeps, ...overrides };
  const betterAuthInstance = deps.betterAuth ?? defaultBetterAuth;
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          origin === config.corsOrigin ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.includes('ketner-ai') ||
          origin.includes('onrender.com') ||
          origin.includes('better-auth.com')
        ) {
          return callback(null, true);
        }
        callback(null, true);
      },
      credentials: true,
    }),
  );

  // OpenAI-совместимый API для CLI и IDE. Подключается до общего разбора JSON: у него свой лимит
  // тела (8 МБ), а авторизация идёт API-ключом, не сессией сайта.
  app.use(
    '/v1',
    createV1Router({
      apiKeyStore: deps.apiKeyStore ?? defaultApiKeyStore,
      userStore: deps.userStore,
      subscriptionStore: deps.subscriptionStore,
      usageStore: deps.usageStore ?? defaultUsageStore,
      gateway: deps.agentGateway,
    }),
  );

  // Колбэк подключения GitHub для репозиториев. Лежит под /api/auth/callback/github (подкаталог
  // колбэка входа, так его принимает то же OAuth-приложение), поэтому стоит до Better Auth.
  app.get('/api/auth/callback/github/repos', createGithubCallbackHandler());

  // Обработчик Better Auth для нативных эндпоинтов (sign-up, sign-in, get-session и т.д.):
  app.use((request, response, next) => {
    if (
      request.path === '/api/auth/signup' ||
      request.path === '/api/auth/login' ||
      request.path === '/api/auth/logout' ||
      request.path === '/api/auth/me' ||
      request.path === '/api/auth/demo' ||
      request.path.startsWith('/api/auth/telegram') ||
      request.path.startsWith('/api/auth/oauth')
    ) {
      return next();
    }
    if (request.path.startsWith('/api/auth')) {
      return toNodeHandler(betterAuthInstance)(request, response);
    }
    next();
  });

  app.use(
    express.json({
      limit: '50mb',
      verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Поиск собранного веб-интерфейса во всех возможных путях (монорепо, Render, Docker):
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateDirs = [
    path.resolve(currentDir, '../../web/dist'),
    path.resolve(currentDir, '../public'),
    path.resolve(currentDir, 'public'),
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), 'public'),
  ];

  let webDistPath = '';
  let indexHtmlPath = '';
  let hasWebDist = false;

  for (const dir of candidateDirs) {
    const candidateHtml = path.join(dir, 'index.html');
    if (fs.existsSync(candidateHtml)) {
      webDistPath = dir;
      indexHtmlPath = candidateHtml;
      hasWebDist = true;
      break;
    }
  }

  if (hasWebDist) {
    app.use(express.static(webDistPath, { index: false, dotfiles: 'allow' }));
  }

  app.use('/api', createApiRouter(deps));

  // Корень: браузеру отдаём веб-интерфейс, при явном Accept: application/json — описание сервиса.
  app.get('/', (request, response) => {
    const wantsJson =
      Boolean(request.headers.accept?.includes('application/json')) &&
      !request.headers.accept?.includes('text/html');

    if (hasWebDist && !wantsJson) {
      return response.sendFile(indexHtmlPath, { dotfiles: 'allow' });
    }
    response.json({
      ...describeService(),
      message:
        'Это mock-API прототипа: обработчики живут под /api. Интерфейс открывается отдельно.',
      webAppUrl: config.webAppUrl,
    });
  });

  // SPA fallback для клиентских маршрутов (/chat, /pricing, /login, /settings и др.)
  if (hasWebDist) {
    app.use((request, response, next) => {
      if (request.method !== 'GET' || request.path.startsWith('/api')) {
        return next();
      }
      response.sendFile(indexHtmlPath, { dotfiles: 'allow' });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
