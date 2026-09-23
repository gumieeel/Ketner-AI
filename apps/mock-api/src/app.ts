import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config.js';
import type { AiConfig } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createApiRouter, describeService } from './routes/index.js';
import { conversationStore, subscriptionStore, userStore } from './store/index.js';
import type { ConversationStore } from './store/conversation-store.js';
import type { SubscriptionStore } from './store/subscription-store.js';
import type { UserStore } from './store/user-store.js';

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
  ai: AiConfig;
  userId: string;
}

const defaultDeps: AppDeps = {
  store: conversationStore,
  userStore,
  subscriptionStore,
  ai: config.ai,
  userId: config.demoUserId,
};

/**
 * Собирает приложение Express.
 *
 * Вынесено отдельно от запуска сервера, чтобы приложение можно было
 * использовать в тестах без прослушивания порта.
 */
export function createApp(overrides: Partial<AppDeps> = {}): Express {
  const deps: AppDeps = { ...defaultDeps, ...overrides };
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  // Если веб-интерфейс собран (в продакшене или на Render), отдаём его статику:
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webDistPath = path.resolve(currentDir, '../../web/dist');
  const indexHtmlPath = path.join(webDistPath, 'index.html');
  const hasWebDist = fs.existsSync(indexHtmlPath);

  if (hasWebDist) {
    app.use(express.static(webDistPath, { index: false }));
  }

  app.use('/api', createApiRouter(deps));

  // Корень: браузеру с Accept: text/html отдаём веб-интерфейс, иначе — JSON-описание сервиса.
  app.get('/', (request, response) => {
    if (hasWebDist && request.headers.accept?.includes('text/html')) {
      return response.sendFile(indexHtmlPath);
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
      response.sendFile(indexHtmlPath);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
