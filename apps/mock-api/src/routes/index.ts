import { Router, type Request, type Response } from 'express';
import { config, isProduction } from '../config.js';
import type { AiConfig } from '../config.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { ConversationStore } from '../store/conversation-store.js';
import {
  apiKeyStore as defaultApiKeyStore,
  invoiceStore as defaultInvoiceStore,
  subscriptionStore as defaultSubscriptionStore,
  userStore as defaultUserStore,
} from '../store/index.js';
import type { ApiKeyStore } from '../store/api-key-store.js';
import { githubConnectionStore as defaultGithubConnectionStore } from '../store/index.js';
import type { GithubConnectionStore } from '../github/connection-store.js';
import type { GithubOAuthSettings } from '../github/oauth.js';
import { BillingService, createBillingLedger } from '../billing/billing-service.js';
import { billingService as defaultBillingService } from '../billing/index.js';
import type { InvoiceStore } from '../store/invoice-store.js';
import type { SubscriptionStore } from '../store/subscription-store.js';
import type { UserStore } from '../store/user-store.js';
import { createApiKeysRouter } from './api-keys.js';
import { createGithubRouter } from './github.js';
import { createAuthRouter } from './auth.js';
import { createBillingRouter } from './billing.js';
import { createContactRouter } from './contact.js';
import { telegramBotService } from '../telegram/bot.js';
import type { AIGateway } from '../ai/gateway.js';
import type { CompareVoteStore } from '../store/compare-vote-store.js';
import type { RevokedTokenStore } from '../store/revoked-token-store.js';
import type { Mailer } from '../services/mailer.js';
import { createChatRouter } from './chat.js';
import { createCompareRouter } from './compare.js';
import { createReviewRouter } from './review.js';
import { createCodeRouter } from './code.js';
import { createImagesRouter } from './images.js';
import { createUsageRouter } from './usage.js';
import { createConversationsRouter } from './conversations.js';
import { healthRouter } from './health.js';
import { createMetaRouter } from './meta.js';
import { createStatusRouter } from './status.js';
import { createTelegramRouter } from './telegram.js';
import { createAdminRouter } from './admin.js';
import { createWebhookRouter } from './webhooks.js';
import { usageStore as defaultUsageStore, type UsageStore } from '../store/index.js';

import type { TelegramBotService } from '../telegram/bot.js';
import type { TelegramSupportBotService } from '../telegram/support-bot.js';
import type { SupportStore } from '../store/support-store.js';
import type { defaultBetterAuth } from '../auth/better-auth.js';

/** Зависимости роутеров: подменяются в тестах. */
export interface ApiDeps {
  store: ConversationStore;
  userStore?: UserStore;
  subscriptionStore?: SubscriptionStore;
  invoiceStore?: InvoiceStore;
  usageStore?: UsageStore;
  botService?: TelegramBotService;
  supportBotService?: TelegramSupportBotService;
  supportStore?: SupportStore;
  apiKeyStore?: ApiKeyStore;
  /** Привязанные аккаунты GitHub (OAuth, токен только на сервере). */
  githubConnectionStore?: GithubConnectionStore;
  /** Запросы к GitHub; в тестах подменяется. */
  githubFetch?: typeof fetch;
  /** Настройки OAuth GitHub; в тестах подменяются. */
  githubSettings?: () => GithubOAuthSettings | null;
  /** Платежи, подписки и возвраты. */
  billingService?: BillingService;
  ai: AiConfig;
  userId: string;
  betterAuth?: typeof defaultBetterAuth;
  /** Шлюз ИИ для чата; в тестах — с явно включённым шаблонным движком. */
  chatGateway?: AIGateway;
  /** Голоса за лучший ответ в сравнении; в тестах — временный файл. */
  compareVoteStore?: CompareVoteStore;
  /** Токены входа, отозванные при выходе; в тестах — временный файл. */
  revokedTokenStore?: RevokedTokenStore;
  /** Отправка писем (коды регистрации и привязки Telegram); в тестах — перехватчик. */
  mailer?: Mailer;
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
    description: 'Регистрация: отправляет код подтверждения на почту',
  },
  {
    method: 'POST',
    path: '/api/auth/signup/verify',
    status: 'ready',
    description: 'Подтверждение регистрации кодом из письма',
  },
  {
    method: 'POST',
    path: '/api/auth/signup/resend',
    status: 'ready',
    description: 'Повторная отправка кода регистрации',
  },
  {
    method: 'POST',
    path: '/api/auth/login/verify',
    status: 'ready',
    description: 'Подтверждение входа кодом из письма',
  },
  {
    method: 'POST',
    path: '/api/auth/login/resend',
    status: 'ready',
    description: 'Повторная отправка кода входа',
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    status: 'ready',
    description: 'Вход: почта и пароль, затем код из письма',
  },
  {
    method: 'POST',
    path: '/api/auth/password-reset',
    status: 'ready',
    description: 'Забыли пароль: отправляет код сброса на почту',
  },
  {
    method: 'POST',
    path: '/api/auth/password-reset/verify',
    status: 'ready',
    description: 'Код сброса пароля: выдаёт одноразовый токен для нового пароля',
  },
  {
    method: 'POST',
    path: '/api/auth/password-reset/resend',
    status: 'ready',
    description: 'Повторная отправка кода сброса пароля',
  },
  {
    method: 'POST',
    path: '/api/auth/password-reset/complete',
    status: 'ready',
    description: 'Новый пароль: завершает прежние сессии и открывает новую',
  },
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
  {
    method: 'GET',
    path: '/api/code/capabilities',
    status: 'ready',
    description: 'Ketner Code: лимиты тарифа и возможности',
  },
  {
    method: 'GET',
    path: '/api/code/projects',
    status: 'ready',
    description: 'Ketner Code: проекты пользователя',
  },
  {
    method: 'POST',
    path: '/api/code/projects/:id/run',
    status: 'ready',
    description: 'Ketner Code: запуск агента (SSE)',
  },
  {
    method: 'GET',
    path: '/api/usage/credits',
    status: 'ready',
    description: 'Остаток кредитов, их сроки и цена запроса по моделям тарифа',
  },
  { method: 'GET', path: '/api/keys', status: 'ready', description: 'API-ключи пользователя' },
  {
    method: 'POST',
    path: '/api/keys',
    status: 'ready',
    description: 'Создать API-ключ (секрет виден один раз)',
  },
  { method: 'DELETE', path: '/api/keys/:id', status: 'ready', description: 'Отозвать API-ключ' },
  {
    method: 'GET',
    path: '/api/github/status',
    status: 'ready',
    description: 'Привязанный аккаунт GitHub',
  },
  {
    method: 'GET',
    path: '/api/github/connect-url',
    status: 'ready',
    description: 'Ссылка на подключение GitHub (OAuth)',
  },
  {
    method: 'POST',
    path: '/api/github/confirm',
    status: 'ready',
    description: 'Завершить подключение GitHub',
  },
  {
    method: 'DELETE',
    path: '/api/github/connection',
    status: 'ready',
    description: 'Отключить GitHub',
  },
  {
    method: 'GET',
    path: '/api/github/api/*',
    status: 'ready',
    description: 'Прокси к GitHub REST от имени пользователя',
  },
  {
    method: 'GET',
    path: '/v1/models',
    status: 'ready',
    description: 'Модели для агента (OpenAI-формат, ключ API)',
  },
  {
    method: 'GET',
    path: '/v1/usage',
    status: 'ready',
    description: 'Бюджет и расход по ключу API',
  },
  {
    method: 'POST',
    path: '/v1/chat/completions',
    status: 'ready',
    description: 'Чат с вызовом инструментов (OpenAI-формат, SSE, ключ API)',
  },
] as const;

/**
 * Описание сервиса.
 *
 * Одинаково отдаётся на `GET /api` и на `GET /`: корень API открывают в
 * браузере по ошибке, и там уместнее подсказка, чем 404.
 */
export function describeService() {
  // Карта API в production не публикуется: она только облегчает разведку.
  if (isProduction) {
    return { service: 'ketner-api', version: config.version };
  }
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
  const activeUsageStore = deps.usageStore ?? defaultUsageStore;
  // Журнал платежей работает с теми же хранилищами, что и роутеры (в тестах — с временными).
  const activeBilling =
    deps.billingService ??
    (activeUserStore === defaultUserStore && activeSubscriptionStore === defaultSubscriptionStore
      ? defaultBillingService
      : new BillingService({
          userStore: activeUserStore,
          subscriptionStore: activeSubscriptionStore,
          usageStore: activeUsageStore,
          ledger: createBillingLedger(),
        }));

  router.use(
    createAuthMiddleware(
      activeUserStore,
      deps.betterAuth,
      activeSubscriptionStore,
      deps.revokedTokenStore,
    ),
  );

  router.get('/', (_request: Request, response: Response) => {
    response.json(describeService());
  });

  router.use(healthRouter);
  router.use(createStatusRouter());
  router.use(createMetaRouter());
  router.use(
    '/auth',
    createAuthRouter(activeUserStore, deps.betterAuth, deps.revokedTokenStore, {
      mailer: deps.mailer,
    }),
  );
  router.use(
    createContactRouter({
      notify: (message) =>
        (deps.botService ?? telegramBotService).notifyAdminsAboutContact(message),
    }),
  );
  router.use(
    createBillingRouter({
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
      invoiceStore: activeInvoiceStore,
      billingService: activeBilling,
    }),
  );
  router.use(
    createTelegramRouter({
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
      invoiceStore: activeInvoiceStore,
      botService: deps.botService,
      billingService: activeBilling,
      supportBotService: deps.supportBotService,
      supportStore: deps.supportStore,
      mailer: deps.mailer,
    }),
  );
  router.use(
    '/webhooks',
    createWebhookRouter({
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
    }),
  );
  router.use(
    '/admin',
    createAdminRouter({
      usageStore: activeUsageStore,
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
    }),
  );
  router.use(createApiKeysRouter({ apiKeyStore: deps.apiKeyStore ?? defaultApiKeyStore }));
  const activeGithubStore = deps.githubConnectionStore ?? defaultGithubConnectionStore;
  router.use(
    createGithubRouter({
      store: activeGithubStore,
      fetchImpl: deps.githubFetch,
      settings: deps.githubSettings,
    }),
  );
  router.use(createConversationsRouter(deps.store, deps.userId));
  router.use(
    '/code',
    createCodeRouter({
      userId: deps.userId,
      userStore: activeUserStore,
      subscriptionStore: activeSubscriptionStore,
      usageStore: activeUsageStore,
      gateway: deps.chatGateway,
      credits: activeBilling.credits,
      githubTokenOf: (userId) => activeGithubStore.tokenOf(userId),
      fetchImpl: deps.githubFetch,
    }),
  );
  router.use(
    '/usage',
    createUsageRouter({
      usageStore: activeUsageStore,
      userStore: activeUserStore,
      subscriptionStore: activeSubscriptionStore,
      credits: activeBilling.credits,
    }),
  );
  router.use(
    '/images',
    createImagesRouter({
      userId: deps.userId,
      userStore: activeUserStore,
      subscriptionStore: activeSubscriptionStore,
      usageStore: activeUsageStore,
      credits: activeBilling.credits,
    }),
  );
  // Сравнение ответов моделей: монтируется раньше /chat, чтобы путь не попал в общий роутер чата.
  router.use(
    '/chat/compare',
    createCompareRouter({
      ...deps,
      votes: deps.compareVoteStore,
      gateway: deps.chatGateway,
      credits: activeBilling.credits,
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
      usageStore: activeUsageStore,
    }),
  );
  // Проверка ответа моделью другой компании: тоже раньше общего роутера чата.
  router.use(
    '/chat/review',
    createReviewRouter({
      ...deps,
      gateway: deps.chatGateway,
      credits: activeBilling.credits,
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
      usageStore: activeUsageStore,
    }),
  );
  router.use(
    '/chat',
    createChatRouter({
      ...deps,
      gateway: deps.chatGateway,
      credits: activeBilling.credits,
      subscriptionStore: activeSubscriptionStore,
      userStore: activeUserStore,
      usageStore: activeUsageStore,
    }),
  );

  return router;
}
