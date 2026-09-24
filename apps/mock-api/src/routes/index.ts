import { Router } from 'express';
import { config } from '../config.js';
import type { AiConfig } from '../config.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { ConversationStore } from '../store/conversation-store.js';
import {
  invoiceStore as defaultInvoiceStore,
  subscriptionStore as defaultSubscriptionStore,
  userStore as defaultUserStore,
} from '../store/index.js';
import type { InvoiceStore } from '../store/invoice-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { createAuthRouter } from './auth.js';
import { createBillingRouter } from './billing.js';
import { createChatRouter } from './chat.js';
import { createConversationsRouter } from './conversations.js';
import { healthRouter } from './health.js';
import { createMetaRouter } from './meta.js';
import { createTelegramRouter } from './telegram.js';

import type { defaultBetterAuth } from '../auth/better-auth.js';

/** Зависимости роутеров: подменяются в тестах. */
export interface ApiDeps {
  store: ConversationStore;
  userStore?: UserStore;
  subscriptionStore?: SubscriptionStore;
  invoiceStore?: InvoiceStore;
  ai: AiConfig;
  userId: string;
  betterAuth?: typeof defaultBetterAuth;
}

/**
 * Описание контракта API.
 *
 * Список отражает целевой набор эндпоинтов продукта. Реализованные помечены как
 * ready, остальные — как planned: они наполняются на этапах 3-4, при этом пути
 * и форматы ответов остаются неизменными при переходе на реальные сервисы.
 */
export const API_ENDPOINTS = [
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
    status: 'ready',
    description: 'Регистрация (заглушка)',
  },
  { method: 'POST', path: '/api/auth/login', status: 'ready', description: 'Вход (заглушка)' },
  { method: 'GET', path: '/api/auth/me', status: 'ready', description: 'Текущий пользователь' },
  { method: 'GET', path: '/api/plans', status: 'ready', description: 'Каталог тарифов' },
  {
    method: 'GET',
    path: '/api/billing/subscription',
    status: 'ready',
    description: 'Текущая подписка пользователя',
  },
  {
    method: 'POST',
    path: '/api/billing/checkout',
    status: 'ready',
    description: 'Оформление подписки (заглушка)',
  },
  {
    method: 'POST',
    path: '/api/billing/cancel',
    status: 'ready',
    description: 'Отмена подписки',
  },
] as const;

/**
 * Описание сервиса.
 *
 * Одинаково отдаётся на `GET /api` и на `GET /`: корень API открывают в
 * браузере по ошибке, и там уместнее подсказка, чем 404.
 */
export function describeService() {
  return {
    service: config.serviceName,
    version: config.version,
    endpoints: API_ENDPOINTS,
  };
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const activeUserStore = deps.userStore ?? defaultUserStore;
  const activeSubscriptionStore = deps.subscriptionStore ?? defaultSubscriptionStore;
  const activeInvoiceStore = deps.invoiceStore ?? defaultInvoiceStore;

  router.use(createAuthMiddleware(activeUserStore, deps.betterAuth));

  router.get('/', (_request, response) => {
    response.json(describeService());
  });

  router.use(healthRouter);
  router.use(createMetaRouter());
  router.use('/auth', createAuthRouter(activeUserStore, deps.betterAuth));
  router.use(
    createBillingRouter({
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
      invoiceStore: activeInvoiceStore,
      defaultUserId: deps.userId,
    }),
  );
  router.use(
    createTelegramRouter({
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
      invoiceStore: activeInvoiceStore,
    }),
  );
  router.use(createConversationsRouter(deps.store, deps.userId));
  router.use(
    '/chat',
    createChatRouter({
      ...deps,
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
    }),
  );

  return router;
}
