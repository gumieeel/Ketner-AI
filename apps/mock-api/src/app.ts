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
import { conversationStore, subscriptionStore, userStore } from './store/index.js';
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

  // Обработчик Better Auth для нативных эндпоинтов (sign-up, sign-in, get-session и т.д.):
  app.use((request, response, next) => {
    if (
      request.path === '/api/auth/signup' ||
      request.path === '/api/auth/login' ||
      request.path === '/api/auth/logout' ||
      request.path === '/api/auth/me' ||
      request.path === '/api/auth/demo' ||
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
      limit: '1mb',
      verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

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
