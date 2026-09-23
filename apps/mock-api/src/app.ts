import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config.js';
import type { AiConfig } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createApiRouter } from './routes/index.js';
import { conversationStore } from './store/index.js';
import type { ConversationStore } from './store/conversation-store.js';

/**
 * Зависимости приложения.
 *
 * Вынесены в параметр, чтобы тесты подставляли своё хранилище (временный файл)
 * и нулевые задержки стриминга, не трогая рабочие данные.
 */
export interface AppDeps {
  store: ConversationStore;
  ai: AiConfig;
  userId: string;
}

const defaultDeps: AppDeps = {
  store: conversationStore,
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
