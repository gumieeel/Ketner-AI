import { Router } from 'express';
import { config } from '../config.js';
import type { AiConfig } from '../config.js';
import type { ConversationStore } from '../store/conversation-store.js';
import { createChatRouter } from './chat.js';
import { createConversationsRouter } from './conversations.js';
import { healthRouter } from './health.js';
import { createMetaRouter } from './meta.js';

/** Зависимости роутеров: подменяются в тестах. */
export interface ApiDeps {
  store: ConversationStore;
  ai: AiConfig;
  userId: string;
}

/**
 * Описание контракта API.
 *
 * Список отражает целевой набор эндпоинтов продукта. Реализованные помечены как
 * ready, остальные — как planned: они наполняются на этапах 3-4, при этом пути
 * и форматы ответов остаются неизменными при переходе на реальные сервисы.
 */
const ENDPOINTS = [
  { method: 'GET', path: '/api/health', status: 'ready', description: 'Проверка живости' },
  { method: 'GET', path: '/api/meta', status: 'ready', description: 'Модели и лимиты' },
  {
    method: 'POST',
    path: '/api/chat/completions',
    status: 'ready',
    description: 'Ответ ИИ (SSE)',
  },
  { method: 'GET', path: '/api/conversations', status: 'ready', description: 'Список диалогов' },
  { method: 'POST', path: '/api/conversations', status: 'ready', description: 'Создать диалог' },
  {
    method: 'GET',
    path: '/api/conversations/:id',
    status: 'ready',
    description: 'Диалог с сообщениями',
  },
  {
    method: 'PATCH',
    path: '/api/conversations/:id',
    status: 'ready',
    description: 'Переименовать диалог',
  },
  {
    method: 'DELETE',
    path: '/api/conversations/:id',
    status: 'ready',
    description: 'Удалить диалог',
  },
  {
    method: 'POST',
    path: '/api/auth/signup',
    status: 'planned',
    description: 'Регистрация (заглушка)',
  },
  { method: 'POST', path: '/api/auth/login', status: 'planned', description: 'Вход (заглушка)' },
  { method: 'GET', path: '/api/auth/me', status: 'planned', description: 'Текущий пользователь' },
  { method: 'GET', path: '/api/plans', status: 'planned', description: 'Каталог тарифов' },
  {
    method: 'POST',
    path: '/api/billing/checkout',
    status: 'planned',
    description: 'Оформление подписки (заглушка)',
  },
] as const;

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();

  router.get('/', (_request, response) => {
    response.json({
      service: config.serviceName,
      version: config.version,
      endpoints: ENDPOINTS,
    });
  });

  router.use(healthRouter);
  router.use(createMetaRouter());
  router.use(createConversationsRouter(deps.store, deps.userId));
  router.use('/chat', createChatRouter(deps));

  return router;
}
