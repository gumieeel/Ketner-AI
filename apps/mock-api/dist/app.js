import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, {} from 'express';
import { toNodeHandler } from 'better-auth/node';
import { defaultBetterAuth } from './auth/better-auth.js';
import { config, isProduction } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { RateLimiter, clientIp } from './middleware/rate-limit.js';
import { buildContentSecurityPolicy, isAllowedCorsOrigin, isPublicBetterAuthEndpoint, securityHeaders, } from './middleware/security.js';
import { sendError } from './middleware/errors.js';
import { createApiRouter, describeService } from './routes/index.js';
import { apiKeyStore as defaultApiKeyStore, conversationStore, subscriptionStore, userStore } from './store/index.js';
import { createV1Router } from './routes/v1.js';
import { createGithubCallbackHandler } from './routes/github.js';
import { usageStore as defaultUsageStore } from './store/index.js';
const defaultDeps = {
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
export function createApp(overrides = {}) {
    const deps = { ...defaultDeps, ...overrides };
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
    const readIndexHtml = () => {
        try {
            return hasWebDist ? fs.readFileSync(indexHtmlPath, 'utf8') : null;
        }
        catch {
            return null;
        }
    };
    const indexHtml = readIndexHtml();
    const csp = buildContentSecurityPolicy(indexHtml);
    app.use(securityHeaders(() => csp));
    // CORS: читать ответы с cookie пользователя могут только свои адреса (см. allowedCorsOrigins).
    // Чужой Origin не получает Access-Control-Allow-Origin, и браузер не отдаёт ответ странице.
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin)
                return callback(null, true);
            callback(null, isAllowedCorsOrigin(origin));
        },
        credentials: true,
    }));
    // OpenAI-совместимый API для CLI и IDE. Подключается до общего разбора JSON: у него свой лимит
    // тела (8 МБ), а авторизация идёт API-ключом, не сессией сайта.
    app.use('/v1', createV1Router({
        apiKeyStore: deps.apiKeyStore ?? defaultApiKeyStore,
        userStore: deps.userStore,
        subscriptionStore: deps.subscriptionStore,
        usageStore: deps.usageStore ?? defaultUsageStore,
        gateway: deps.agentGateway,
    }));
    // Колбэк подключения GitHub для репозиториев. Лежит под /api/auth/callback/github (подкаталог
    // колбэка входа, так его принимает то же OAuth-приложение), поэтому стоит до Better Auth.
    app.get('/api/auth/callback/github/repos', createGithubCallbackHandler());
    // Вход по паролю напрямую в Better Auth: тот же предел попыток с адреса, что и у /api/auth/login.
    const betterAuthSignInPerIp = new RateLimiter(15 * 60 * 1000, 30);
    // Обработчик Better Auth для нативных эндпоинтов (sign-in, get-session и т.д.):
    app.use((request, response, next) => {
        if (request.path === '/api/auth/signup' ||
            request.path === '/api/auth/login' ||
            request.path === '/api/auth/logout' ||
            request.path === '/api/auth/me' ||
            request.path === '/api/auth/demo' ||
            request.path.startsWith('/api/auth/telegram') ||
            request.path.startsWith('/api/auth/oauth')) {
            return next();
        }
        if (request.path.startsWith('/api/auth')) {
            if (!isPublicBetterAuthEndpoint(request.method, request.path)) {
                return sendError(response, 404, 'not_found', 'Маршрут не найден');
            }
            if (request.path === '/api/auth/sign-in/email' && betterAuthSignInPerIp.hit(clientIp(request))) {
                return sendError(response, 429, 'too_many_requests', 'Слишком много попыток входа. Подождите несколько минут.');
            }
            return toNodeHandler(betterAuthInstance)(request, response);
        }
        next();
    });
    app.use(express.json({
        limit: '50mb',
        verify: (req, _res, buf) => {
            req.rawBody = buf;
        },
    }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    if (hasWebDist) {
        app.use(express.static(webDistPath, { index: false, dotfiles: 'ignore' }));
    }
    app.use('/api', createApiRouter(deps));
    // Корень: браузеру отдаём веб-интерфейс, при явном Accept: application/json — описание сервиса.
    app.get('/', (request, response) => {
        const wantsJson = Boolean(request.headers.accept?.includes('application/json')) &&
            !request.headers.accept?.includes('text/html');
        if (hasWebDist && !wantsJson) {
            return response.sendFile(indexHtmlPath, { dotfiles: 'allow' });
        }
        response.json({
            ...describeService(),
            message: 'Это mock-API прототипа: обработчики живут под /api. Интерфейс открывается отдельно.',
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
