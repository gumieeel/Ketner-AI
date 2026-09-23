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

  app.use('/api', createApiRouter(deps));

  // Корень API открывают в браузере по ошибке: объясняем, где интерфейс.
  app.get('/', (_request, response) => {
    response.json({
      ...describeService(),
      message:
        'Это mock-API прототипа: обработчики живут под /api. Интерфейс открывается отдельно.',
      webAppUrl: config.webAppUrl,
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
