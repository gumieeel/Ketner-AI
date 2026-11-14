import { requireFeature } from './product-switches.js';
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
  EMBEDDABLE_PAGE,
  isAllowedCorsOrigin,
  isPublicBetterAuthEndpoint,
  securityHeaders,
} from './middleware/security.js';
import { sendError } from './middleware/errors.js';
import { createApiRouter, describeService, type ApiDeps } from './routes/index.js';
import {
  classifyPath,
  isNonCanonicalHost,
  DISCOVERY_HOME_PRERENDER_KEY,
  renderIndexHtml,
  robotsTxt,
  sitemapXml,
  trailingSlashRedirect,
  withoutAdsTag,
  type PageLastmods,
  type PrerenderedPage,
} from './seo/pages.js';
import {
  apiKeyStore as defaultApiKeyStore,
  conversationStore,
  subscriptionStore,
  userStore,
} from './store/index.js';
import type { ApiKeyStore } from './store/api-key-store.js';
import type { AgentGateway } from './ai/agent-gateway.js';
import type { AIGateway } from './ai/gateway.js';
import type { CompareVoteStore } from './store/compare-vote-store.js';
import type { RevokedTokenStore } from './store/revoked-token-store.js';
import type { Mailer } from './services/mailer.js';
import { V1_EXPOSED_HEADERS, createV1Router } from './routes/v1.js';
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
  /** Голоса за лучший ответ в сравнении; в тестах — временный файл. */
  compareVoteStore?: CompareVoteStore;
  /** Токены входа, отозванные при выходе; в тестах — временный файл. */
  revokedTokenStore?: RevokedTokenStore;
  /** Отправка писем (коды регистрации и привязки Telegram); в тестах — перехватчик. */
  mailer?: Mailer;
  /** Платформа решений (флаг DISCOVERY_ENABLED); в тестах задаётся явно. */
  discoveryEnabled?: boolean;
  /** Подмена частей анализа задач в тестах. */
  discovery?: ApiDeps['discovery'];
  builder?: ApiDeps['builder'];
  /** Dodo Payments в тестах: клиент, продукт подписки, обязательность подписки. */
  dodo?: ApiDeps['dodo'];
}

const DEFAULT_BODY_LIMIT = '1mb';
const LARGE_BODY_LIMIT = '50mb';

/**
 * Маршруты, которым нужно большое тело запроса: ответ чата (вложения и привязанный проект),
 * запись и импорт файлов Ketner Code, прокси GitHub (коммит с содержимым файлов).
 */
const LARGE_BODY_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/chat\/completions$/ },
  { method: 'POST', pattern: /^\/api\/chat\/compare$/ },
  { method: 'PUT', pattern: /^\/api\/code\/projects\/[^/]+\/file$/ },
  { method: 'POST', pattern: /^\/api\/code\/projects\/[^/]+\/import$/ },
  { method: 'POST', pattern: /^\/api\/github\/api\// },
  { method: 'PATCH', pattern: /^\/api\/github\/api\// },
];

export function acceptsLargeBody(method: string, path: string): boolean {
  return LARGE_BODY_ROUTES.some((route) => route.method === method && route.pattern.test(path));
}

/**
 * Загрузка материала инструмента: извлечённый текст до 200 000 символов (лимит проверяет сервис).
 * 2 МБ хватает с запасом на экранирование JSON; 50 МБ этому маршруту не нужны.
 */
const MATERIAL_BODY_LIMIT = '2mb';
const MATERIAL_ROUTE = /^\/api\/solutions\/[^/]+\/materials$/;

export function acceptsMaterialBody(method: string, path: string): boolean {
  return method === 'POST' && MATERIAL_ROUTE.test(path);
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
  // Разметка открытых страниц, отрисованная при сборке сайта (apps/web/scripts/prerender.mjs).
  const { pages: prerendered, lastmods } = readPrerenderedPages(webDistPath, hasWebDist);
  app.use(securityHeaders(() => csp));

  // CORS для /v1 открыт любому сайту: авторизация там только API-ключом в заголовке, cookie не
  // читаются и не разрешаются, так что чужая страница может лишь то, что даёт ей сам ключ.
  const v1Cors = cors({
    origin: '*',
    credentials: false,
    // allowedHeaders не задан: разрешаются заголовки из preflight (SDK OpenAI шлёт свои x-stainless-*).
    exposedHeaders: V1_EXPOSED_HEADERS,
    maxAge: 86_400,
  });
  // CORS сайта: читать ответы с cookie пользователя могут только свои адреса (см. allowedCorsOrigins).
  // Чужой Origin не получает Access-Control-Allow-Origin, и браузер не отдаёт ответ странице.
  const siteCors = cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
  });
  app.use((request, response, next) => {
    const isV1 = request.path === '/v1' || request.path.startsWith('/v1/');
    (isV1 ? v1Cors : siteCors)(request, response, next);
  });

  // OpenAI-совместимый API для CLI и IDE. Подключается до общего разбора JSON: у него свой лимит
  // тела (8 МБ), а авторизация идёт API-ключом, не сессией сайта.
  app.use(
    '/v1',
    requireFeature('developerApi'),
    createV1Router({
      apiKeyStore: deps.apiKeyStore ?? defaultApiKeyStore,
      userStore: deps.userStore,
      subscriptionStore: deps.subscriptionStore,
      usageStore: deps.usageStore ?? defaultUsageStore,
      gateway: deps.agentGateway,
      ...(deps.billingService ? { credits: deps.billingService.credits } : {}),
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
      request.path === '/api/auth/password-reset' ||
      request.path.startsWith('/api/auth/password-reset/') ||
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
  const materialJson = express.json({ limit: MATERIAL_BODY_LIMIT });
  app.use((request, response, next) =>
    (acceptsLargeBody(request.method, request.path)
      ? largeJson
      : acceptsMaterialBody(request.method, request.path)
        ? materialJson
        : defaultJson)(request, response, next),
  );
  app.use(express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));

  // Для поисковиков: настоящие robots.txt и sitemap.xml (раньше на эти адреса отдавалась главная).
  app.get('/robots.txt', (_request, response) => {
    response.type('text/plain; charset=utf-8').setHeader('Cache-Control', 'public, max-age=3600');
    response.send(robotsTxt());
  });
  app.get('/sitemap.xml', (_request, response) => {
    response
      .type('application/xml; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=3600');
    response.send(sitemapXml(lastmods));
  });

  if (hasWebDist) {
    // /index.html — тот же файл, что и «/», но без canonical: отдаём один адрес вместо дубля главной.
    app.get('/index.html', (_request, response) => response.redirect(301, '/'));
    // /pricing/ → /pricing: у открытой страницы один адрес.
    app.use((request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      const target = trailingSlashRedirect(request.path);
      if (!target) return next();
      const queryAt = request.originalUrl.indexOf('?');
      response.redirect(301, target + (queryAt === -1 ? '' : request.originalUrl.slice(queryAt)));
    });
    app.use(express.static(webDistPath, { index: false, dotfiles: 'ignore' }));
  }

  // index.html со своими title/description/canonical для каждого адреса (см. seo/pages.ts).
  const pageCache = new Map<string, string>();
  const siteFeatures = {
    discovery: deps.discoveryEnabled ?? config.discoveryEnabled,
    cardPayments: deps.dodo
      ? deps.dodo.client !== null && deps.dodo.productId !== ''
      : config.dodo.apiKey !== '' && config.dodo.productId !== '',
  };
  const sendPage = (request: express.Request, response: express.Response): void => {
    if (!indexHtml) {
      response.sendFile(indexHtmlPath, { dotfiles: 'allow' });
      return;
    }
    const kind = classifyPath(request.path);
    // Страница бота для клиентов открывается у посетителей бизнеса и на чужих сайтах: рекламный
    // тег Ketner там не загружается.
    const botPage = EMBEDDABLE_PAGE.test(request.path);
    const key = botPage
      ? 'bot'
      : kind === 'public'
        ? request.path.replace(/\/+$/, '') || '/'
        : kind;
    let html = pageCache.get(key);
    if (!html && botPage) {
      html = withoutAdsTag(renderIndexHtml(indexHtml, '/__none__', undefined, siteFeatures));
      pageCache.set(key, html);
    }
    if (!html) {
      // Главная при включённой платформе решений — свой вариант разметки (собирается заранее).
      const prerenderedPage =
        key === '/' && siteFeatures.discovery
          ? (prerendered.get(DISCOVERY_HOME_PRERENDER_KEY) ?? prerendered.get(key))
          : prerendered.get(key);
      html =
        kind === 'public'
          ? renderIndexHtml(indexHtml, request.path, prerenderedPage, siteFeatures)
          : renderIndexHtml(indexHtml, '/__none__', undefined, siteFeatures);
      pageCache.set(key, html);
    }
    response
      .status(kind === 'missing' ? 404 : 200)
      .type('text/html; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=0');
    // Копия сайта на адресе Render не должна попасть в выдачу рядом с ketner.org.
    if (isNonCanonicalHost(request.headers.host)) response.setHeader('X-Robots-Tag', 'noindex');
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
      // HEAD — как GET без тела: роботы и проверки ссылок часто спрашивают так, раньше получали 404.
      const readsPage = request.method === 'GET' || request.method === 'HEAD';
      if (!readsPage || request.path.startsWith('/api')) {
        return next();
      }
      sendPage(request, response);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Читает dist/.prerender.json: { pages: { "/pricing": { html, head } }, lastmods: { "/changelog": "2026-10-18" } }.
 * Нет файла — страницы отдаются без разметки, а sitemap — без <lastmod>.
 */
function readPrerenderedPages(
  dir: string,
  enabled: boolean,
): { pages: Map<string, PrerenderedPage>; lastmods: PageLastmods } {
  const pages = new Map<string, PrerenderedPage>();
  const lastmods: Record<string, string> = {};
  if (!enabled) return { pages, lastmods };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, '.prerender.json'), 'utf8')) as {
      pages?: Record<string, PrerenderedPage>;
      lastmods?: Record<string, string>;
    };
    for (const [pagePath, page] of Object.entries(raw.pages ?? {})) {
      if (page && typeof page.html === 'string') pages.set(pagePath, page);
    }
    for (const [pagePath, date] of Object.entries(raw.lastmods ?? {})) {
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) lastmods[pagePath] = date;
    }
  } catch {
    // файла нет (сайт собран без предварительной отрисовки) — это не ошибка
  }
  return { pages, lastmods };
}
