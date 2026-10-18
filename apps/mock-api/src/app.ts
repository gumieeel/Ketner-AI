import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { defaultBetterAuth } from './auth/better-auth.js';
import { config, isProduction } from './config.js';
import type { AiConfig } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import {
  buildContentSecurityPolicy,
  isAllowedCorsOrigin,
  isPublicBetterAuthEndpoint,
  securityHeaders,
} from './middleware/security.js';
import { sendError } from './middleware/errors.js';
import { createApiRouter, describeService } from './routes/index.js';
import { classifyPath, llmsTxt, renderIndexHtml, robotsTxt, sitemapXml } from './seo/pages.js';
import {
  apiKeyStore as defaultApiKeyStore,
  conversationStore,
  subscriptionStore,
  userStore,
} from './store/index.js';
import type { ApiKeyStore } from './store/api-key-store.js';
import type { AgentGateway } from './ai/agent-gateway.js';
import type { AIGateway } from './ai/gateway.js';
import type { RevokedTokenStore } from './store/revoked-token-store.js';
import type { Mailer } from './services/mailer.js';
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
  /** Шлюз ИИ для чата; в тестах — с явно включённым шаблонным движком. */
  chatGateway?: AIGateway;
  /** Токены входа, отозванные при выходе; в тестах — временный файл. */
  revokedTokenStore?: RevokedTokenStore;
  /** Отправка писем (коды регистрации и привязки Telegram); в тестах — перехватчик. */
  mailer?: Mailer;
}

const DEFAULT_BODY_LIMIT = '1mb';
const LARGE_BODY_LIMIT = '50mb';

/**
 * Маршруты, которым нужно большое тело запроса: ответ чата (вложения и привязанный проект),
 * запись и импорт файлов Ketner Code, прокси GitHub (коммит с содержимым файлов).
 */
const LARGE_BODY_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/chat\/completions$/ },
  { method: 'PUT', pattern: /^\/api\/code\/projects\/[^/]+\/file$/ },
  { method: 'POST', pattern: /^\/api\/code\/projects\/[^/]+\/import$/ },
  { method: 'POST', pattern: /^\/api\/github\/api\// },
  { method: 'PATCH', pattern: /^\/api\/github\/api\// },
];

export function acceptsLargeBody(method: string, path: string): boolean {
  return LARGE_BODY_ROUTES.some((route) => route.method === method && route.pattern.test(path));
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

  // Express за балансировщиком Render: request.ip — адрес клиента, а не прокси (лимиты по IP, логи).
  // Число доверенных прокси задаётся TRUST_PROXY (по умолчанию 1 в production).
  const trustProxy = process.env.TRUST_PROXY ?? (isProduction ? '1' : 'loopback');
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.disable('x-powered-by');

  // index.html нужен заранее: из него считаются хеши встроенных скриптов для CSP.
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

  const readIndexHtml = (): string | null => {
    try {
      return hasWebDist ? fs.readFileSync(indexHtmlPath, 'utf8') : null;
    } catch {
      return null;
    }
  };
  const indexHtml = readIndexHtml();
  const csp = buildContentSecurityPolicy(indexHtml);
  app.use(securityHeaders(() => csp));

  // CORS: читать ответы с cookie пользователя могут только свои адреса (см. allowedCorsOrigins).
  // Чужой Origin не получает Access-Control-Allow-Origin, и браузер не отдаёт ответ странице.
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        callback(null, isAllowedCorsOrigin(origin));
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

  // Обработчик Better Auth для нативных эндпоинтов (вход через Google/GitHub, get-session и т.д.).
  // Вход по паролю напрямую в Better Auth закрыт: он обходил бы код из письма (routes/auth.ts).
  app.use((request, response, next) => {
    if (
      request.path === '/api/auth/signup' ||
      request.path.startsWith('/api/auth/signup/') ||
      request.path === '/api/auth/login' ||
      request.path.startsWith('/api/auth/login/') ||
      request.path === '/api/auth/logout' ||
      request.path === '/api/auth/me' ||
      request.path === '/api/auth/demo' ||
      request.path.startsWith('/api/auth/telegram') ||
      request.path.startsWith('/api/auth/oauth')
    ) {
      return next();
    }
    if (request.path.startsWith('/api/auth')) {
      if (!isPublicBetterAuthEndpoint(request.method, request.path)) {
        return sendError(response, 404, 'not_found', 'Маршрут не найден');
      }
      return toNodeHandler(betterAuthInstance)(request, response);
    }
    next();
  });

  // Большое тело (до 50 МБ) разбирается только там, где оно нужно; остальным маршрутам, включая
  // анонимные (вход, регистрация, вебхуки), хватает 1 МБ — иначе любой мог бы гонять серверу
  // десятки мегабайт JSON на разбор и держать их в памяти.
  const keepRawBody = (req: express.Request & { rawBody?: Buffer }, _res: unknown, buf: Buffer) => {
    req.rawBody = buf;
  };
  const largeJson = express.json({ limit: LARGE_BODY_LIMIT, verify: keepRawBody });
  const defaultJson = express.json({ limit: DEFAULT_BODY_LIMIT, verify: keepRawBody });
  app.use((request, response, next) =>
    (acceptsLargeBody(request.method, request.path) ? largeJson : defaultJson)(
      request,
      response,
      next,
    ),
  );
  app.use(express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));

  // Для поисковиков: настоящие robots.txt и sitemap.xml (раньше на эти адреса отдавалась главная).
  app.get('/robots.txt', (_request, response) => {
    response.type('text/plain; charset=utf-8').setHeader('Cache-Control', 'public, max-age=3600');
    response.send(robotsTxt());
  });
  app.get('/llms.txt', (_request, response) => {
    response.type('text/plain; charset=utf-8').setHeader('Cache-Control', 'public, max-age=3600');
    response.send(llmsTxt());
  });
  app.get('/sitemap.xml', (_request, response) => {
    response
      .type('application/xml; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=3600');
    response.send(sitemapXml());
  });

  if (hasWebDist) {
    app.use(express.static(webDistPath, { index: false, dotfiles: 'ignore' }));
  }

  // index.html со своими title/description/canonical для каждого адреса (см. seo/pages.ts).
  const pageCache = new Map<string, string>();
  const sendPage = (request: express.Request, response: express.Response): void => {
    if (!indexHtml) {
      response.sendFile(indexHtmlPath, { dotfiles: 'allow' });
      return;
    }
    const kind = classifyPath(request.path);
    const key = kind === 'public' ? request.path.replace(/\/+$/, '') || '/' : kind;
    let html = pageCache.get(key);
    if (!html) {
      html = renderIndexHtml(indexHtml, kind === 'public' ? request.path : '/__none__');
      pageCache.set(key, html);
    }
    response
      .status(kind === 'missing' ? 404 : 200)
      .type('text/html; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=0');
    response.send(html);
  };

  app.use('/api', createApiRouter(deps));

  // Корень: браузеру отдаём веб-интерфейс, при явном Accept: application/json — описание сервиса.
  app.get('/', (request, response) => {
    const wantsJson =
      Boolean(request.headers.accept?.includes('application/json')) &&
      !request.headers.accept?.includes('text/html');

    if (hasWebDist && !wantsJson) {
      return sendPage(request, response);
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
      sendPage(request, response);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
