import { Router, type NextFunction, type Request, type Response } from 'express';
import { sendError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import type { GithubConnectionStore } from '../github/connection-store.js';
import {
  GithubOAuthError,
  authorizeUrl,
  createState,
  exchangeCode,
  fallbackReturnTo,
  fetchProfile,
  githubHeaders,
  githubOAuthSettings,
  readState,
  revokeToken,
  safeReturnTo,
  withFragment,
  type GithubOAuthSettings,
} from '../github/oauth.js';

export interface GithubRouterDeps {
  store: GithubConnectionStore;
  /** Подмена настроек OAuth в тестах; по умолчанию — из переменных окружения. */
  settings?: () => GithubOAuthSettings | null;
  fetchImpl?: typeof fetch;
}

const OWNER = '[A-Za-z0-9_.-]+';
const REPO_PREFIX = `^/repos/${OWNER}/${OWNER}`;

/**
 * Что можно делать через прокси от имени пользователя: чтение репозиториев и веток, атомарный
 * коммит через Git Data API и Pull Request. Ничего административного (удаление репозиториев,
 * настройки, ключи, вебхуки) — даже если у токена есть на это право.
 */
const ALLOWED: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/user$/ },
  { method: 'GET', pattern: /^\/user\/repos$/ },
  { method: 'GET', pattern: new RegExp(`${REPO_PREFIX}$`) },
  { method: 'GET', pattern: new RegExp(`${REPO_PREFIX}/branches$`) },
  { method: 'GET', pattern: new RegExp(`${REPO_PREFIX}/git/trees/.+$`) },
  { method: 'GET', pattern: new RegExp(`${REPO_PREFIX}/git/ref/heads/.+$`) },
  { method: 'GET', pattern: new RegExp(`${REPO_PREFIX}/git/commits/[0-9a-f]{40}$`) },
  { method: 'GET', pattern: new RegExp(`${REPO_PREFIX}/contents(/.*)?$`) },
  { method: 'POST', pattern: new RegExp(`${REPO_PREFIX}/git/(blobs|trees|commits|refs)$`) },
  { method: 'PATCH', pattern: new RegExp(`${REPO_PREFIX}/git/refs/heads/.+$`) },
  { method: 'POST', pattern: new RegExp(`${REPO_PREFIX}/pulls$`) },
];

const ACCEPT_VALUES = new Set([
  'application/vnd.github+json',
  'application/vnd.github.v3+json',
  'application/vnd.github.raw+json',
  'application/vnd.github.raw',
]);

/** Сегменты пути не должны превращаться в обход каталогов после декодирования. */
function isSafePath(path: string): boolean {
  if (path.length > 1024) return false;
  for (const segment of path.split('/').slice(1)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\'))
      return false;
  }
  return true;
}

export function isAllowedGithubCall(method: string, path: string): boolean {
  return (
    isSafePath(path) && ALLOWED.some((rule) => rule.method === method && rule.pattern.test(path))
  );
}

/** Небольшой предохранитель от зацикливания клиента: запросов на пользователя за окно. */
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 600;

/**
 * Привязка аккаунта GitHub: OAuth-подключение, статус, отключение и прокси к api.github.com.
 * Токен никогда не уходит в браузер — сайт ходит в GitHub только через `/api/github/api/*`.
 */
export function createGithubRouter({
  store,
  settings: injected,
  fetchImpl: injectedFetch,
}: GithubRouterDeps): Router {
  const settings = injected ?? githubOAuthSettings;
  const fetchImpl = injectedFetch ?? fetch;
  const router = Router();
  const windows = new Map<string, { start: number; count: number }>();

  const publicStatus = (userId: string) => {
    const connection = store.get(userId);
    return {
      available: settings() !== null,
      connected: Boolean(connection),
      account: connection
        ? {
            login: connection.login,
            avatarUrl: connection.avatarUrl,
            scopes: connection.scopes,
            connectedAt: connection.connectedAt,
          }
        : null,
    };
  };

  router.get('/github/status', requireAuth, (request: Request, response: Response) => {
    response.json(publicStatus(request.user!.id));
  });

  router.get('/github/connect-url', requireAuth, (request: Request, response: Response) => {
    const oauth = settings();
    if (!oauth) {
      sendError(response, 503, 'github_unavailable', 'Подключение GitHub на сервере не настроено');
      return;
    }
    const returnTo = safeReturnTo(request.query.returnTo) ?? fallbackReturnTo();
    response.json({ url: authorizeUrl(oauth, createState(request.user!.id, returnTo)) });
  });

  router.post('/github/confirm', requireAuth, async (request: Request, response: Response) => {
    const oauth = settings();
    if (!oauth) {
      sendError(response, 503, 'github_unavailable', 'Подключение GitHub на сервере не настроено');
      return;
    }
    const body = (request.body ?? {}) as { code?: unknown; state?: unknown };
    if (typeof body.code !== 'string' || typeof body.state !== 'string' || body.code.length > 200) {
      sendError(
        response,
        400,
        'invalid_request',
        'Не хватает данных от GitHub. Подключите ещё раз.',
      );
      return;
    }
    const state = readState(body.state);
    // Код обменивается только в той сессии, что начала подключение: чужую ссылку не подсунуть.
    if (!state || state.userId !== request.user!.id) {
      sendError(
        response,
        400,
        'github_state_invalid',
        'Ссылка подключения устарела или открыта в другом аккаунте. Подключите GitHub ещё раз.',
      );
      return;
    }
    try {
      const { token, scopes } = await exchangeCode(oauth, body.code, fetchImpl);
      const profile = await fetchProfile(token, fetchImpl);
      const previous = store.tokenOf(request.user!.id);
      store.save(
        {
          userId: request.user!.id,
          githubId: profile.id,
          login: profile.login,
          avatarUrl: profile.avatarUrl,
          scopes,
          connectedAt: new Date().toISOString(),
        },
        token,
      );
      if (previous && previous !== token) void revokeToken(oauth, previous, fetchImpl);
      response.json(publicStatus(request.user!.id));
    } catch (error) {
      if (error instanceof GithubOAuthError) {
        sendError(
          response,
          error.code === 'unavailable' ? 502 : 400,
          `github_${error.code}`,
          error.message,
        );
        return;
      }
      throw error;
    }
  });

  router.delete('/github/connection', requireAuth, async (request: Request, response: Response) => {
    const userId = request.user!.id;
    const token = store.tokenOf(userId);
    store.remove(userId);
    const oauth = settings();
    if (token && oauth) await revokeToken(oauth, token, fetchImpl);
    response.json(publicStatus(userId));
  });

  router.use(
    '/github/api',
    requireAuth,
    async (request: Request, response: Response, next: NextFunction) => {
      const userId = request.user!.id;
      const url = new URL(request.url, 'http://proxy.local');
      const method = request.method.toUpperCase();
      if (!isAllowedGithubCall(method, url.pathname)) {
        sendError(
          response,
          403,
          'github_call_forbidden',
          'Этот запрос к GitHub через Ketner недоступен',
        );
        return;
      }
      const token = store.tokenOf(userId);
      if (!token) {
        sendError(
          response,
          409,
          'github_not_connected',
          'Подключите GitHub в настройках, чтобы работать с репозиториями',
        );
        return;
      }

      const now = Date.now();
      const window = windows.get(userId);
      if (!window || now - window.start > WINDOW_MS) windows.set(userId, { start: now, count: 1 });
      else if (++window.count > WINDOW_LIMIT) {
        sendError(
          response,
          429,
          'rate_limited',
          'Слишком много запросов к GitHub подряд. Сделайте небольшую паузу.',
        );
        return;
      }

      const headers: Record<string, string> = githubHeaders(token);
      const accept = request.headers.accept;
      if (accept && ACCEPT_VALUES.has(accept)) headers.Accept = accept;
      const hasBody = method === 'POST' || method === 'PATCH';
      if (hasBody) headers['Content-Type'] = 'application/json';

      let upstream: globalThis.Response;
      try {
        upstream = await fetchImpl(`https://api.github.com${url.pathname}${url.search}`, {
          method,
          headers,
          body: hasBody ? JSON.stringify(request.body ?? {}) : undefined,
          redirect: 'follow',
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        sendError(response, 502, 'github_unavailable', 'GitHub не ответил. Попробуйте ещё раз.');
        return;
      }

      if (upstream.status === 401) {
        // Токен отозван в настройках GitHub: подключение больше не работает, просим подключить заново.
        store.remove(userId);
        sendError(
          response,
          409,
          'github_reauth_required',
          'Доступ к GitHub отозван. Подключите аккаунт ещё раз в настройках.',
        );
        return;
      }

      try {
        const payload = Buffer.from(await upstream.arrayBuffer());
        response.status(upstream.status);
        for (const name of ['content-type', 'link', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
          const value = upstream.headers.get(name);
          if (value) response.setHeader(name, value);
        }
        response.setHeader('Cache-Control', 'no-store');
        response.send(payload);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

/**
 * Колбэк OAuth GitHub. Подключается до обработчика Better Auth: адрес лежит под /api/auth.
 * Здесь нет сессии (колбэк может прийти на другой домен), поэтому код не обменивается, а
 * передаётся во фрагменте обратно на сайт — обмен делает POST /api/github/confirm.
 */
export function createGithubCallbackHandler() {
  return (request: Request, response: Response): void => {
    const state = typeof request.query.state === 'string' ? readState(request.query.state) : null;
    if (!state) {
      response.redirect(302, withFragment(fallbackReturnTo(), { github_error: 'state' }));
      return;
    }
    const returnTo = safeReturnTo(state.returnTo) ?? fallbackReturnTo();
    const error = typeof request.query.error === 'string' ? request.query.error : '';
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    if (error || !code) {
      response.redirect(
        302,
        withFragment(returnTo, { github_error: error === 'access_denied' ? 'denied' : 'failed' }),
      );
      return;
    }
    response.redirect(
      302,
      withFragment(returnTo, { github_code: code, github_state: String(request.query.state) }),
    );
  };
}
