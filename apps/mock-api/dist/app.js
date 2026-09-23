import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, {} from 'express';
import { toNodeHandler } from 'better-auth/node';
import { defaultBetterAuth } from './auth/better-auth.js';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { createApiRouter, describeService } from './routes/index.js';
import { conversationStore, subscriptionStore, userStore } from './store/index.js';
const defaultDeps = {
    store: conversationStore,
    userStore,
    subscriptionStore,
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
    app.disable('x-powered-by');
    app.use(cors({ origin: config.corsOrigin, credentials: true }));
    // Обработчик Better Auth для нативных эндпоинтов (sign-up, sign-in, get-session и т.д.):
    app.use((request, response, next) => {
        if (request.path === '/api/auth/signup' ||
            request.path === '/api/auth/login' ||
            request.path === '/api/auth/logout' ||
            request.path === '/api/auth/me' ||
            request.path === '/api/auth/demo' ||
            request.path.startsWith('/api/auth/oauth')) {
            return next();
        }
        if (request.path.startsWith('/api/auth')) {
            return toNodeHandler(betterAuthInstance)(request, response);
        }
        next();
    });
    app.use(express.json({ limit: '1mb' }));
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
        app.use(express.static(webDistPath, { index: false }));
    }
    app.use('/api', createApiRouter(deps));
    // Корень: браузеру отдаём веб-интерфейс, при явном Accept: application/json — описание сервиса.
    app.get('/', (request, response) => {
        const wantsJson = Boolean(request.headers.accept?.includes('application/json')) &&
            !request.headers.accept?.includes('text/html');
        if (hasWebDist && !wantsJson) {
            return response.sendFile(indexHtmlPath);
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
            response.sendFile(indexHtmlPath);
        });
    }
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
