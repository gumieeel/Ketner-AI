/**
 * Подключение аккаунта GitHub для работы с репозиториями (включая приватные).
 *
 * Это отдельный OAuth-поток, не вход через GitHub: он просит право `repo` и сохраняет токен
 * на сервере. Колбэк живёт по адресу `<BETTER_AUTH_URL>/api/auth/callback/github/repos` —
 * это подкаталог колбэка входа, поэтому GitHub принимает его в том же OAuth-приложении.
 *
 * Состояние (`state`) подписано HMAC и привязано к пользователю: обменять код на токен можно
 * только из той же сессии, которая начала подключение (POST /api/github/confirm).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config, isProduction } from '../config.js';

export const GITHUB_REPO_SCOPES = ['repo', 'read:user'] as const;
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GithubOAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Настройки OAuth-приложения или null, если GitHub не настроен на сервере. */
export function githubOAuthSettings(): GithubOAuthSettings | null {
  const clientId = process.env.GITHUB_REPO_CLIENT_ID?.trim() || config.githubClientId;
  const clientSecret = process.env.GITHUB_REPO_CLIENT_SECRET?.trim() || config.githubClientSecret;
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    process.env.GITHUB_REPO_REDIRECT_URI?.trim() ||
    `${trimSlash(config.betterAuthUrl)}/api/auth/callback/github/repos`;
  return { clientId, clientSecret, redirectUri };
}

interface StatePayload {
  /** id пользователя Ketner, начавшего подключение. */
  u: string;
  /** Одноразовая соль, чтобы два состояния не совпадали. */
  n: string;
  /** Срок действия, мс с эпохи. */
  e: number;
  /** Куда вернуть человека после GitHub. */
  r: string;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', `ketner:github-state:${secret}`).update(body).digest('base64url');
}

export function createState(userId: string, returnTo: string, secret = config.betterAuthSecret, now = Date.now()): string {
  const payload: StatePayload = { u: userId, n: randomBytes(9).toString('base64url'), e: now + STATE_TTL_MS, r: returnTo };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function readState(
  state: string,
  secret = config.betterAuthSecret,
  now = Date.now(),
): { userId: string; returnTo: string } | null {
  const [body, signature] = state.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<StatePayload>;
    if (typeof payload.u !== 'string' || typeof payload.r !== 'string' || typeof payload.e !== 'number') return null;
    if (payload.e < now) return null;
    return { userId: payload.u, returnTo: payload.r };
  } catch {
    return null;
  }
}

/** Сайты, на которые можно вернуть человека после GitHub. */
function allowedOrigins(): Set<string> {
  const origins = new Set<string>(['https://ketner.org', 'https://www.ketner.org']);
  for (const raw of [config.webAppUrl, config.corsOrigin, config.betterAuthUrl, process.env.RENDER_EXTERNAL_URL]) {
    if (!raw) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // не адрес — пропускаем
    }
  }
  return origins;
}

/**
 * Проверяет адрес возврата: только наши сайты (и localhost в разработке), только http(s).
 * Возвращает нормализованный адрес без фрагмента или null.
 */
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!allowedOrigins().has(url.origin) && !(local && !isProduction)) return null;
  url.hash = '';
  return url.toString();
}

/** Адрес, куда отправить человека, если `state` не прочитался. */
export function fallbackReturnTo(): string {
  return `${trimSlash(config.webAppUrl || config.betterAuthUrl)}/settings`;
}

export function authorizeUrl(settings: GithubOAuthSettings, state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', settings.redirectUri);
  url.searchParams.set('scope', GITHUB_REPO_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

/** Добавляет параметры во фрагмент адреса: так код не попадает в логи сервера и Referer. */
export function withFragment(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  url.hash = new URLSearchParams(params).toString();
  return url.toString();
}

export class GithubOAuthError extends Error {
  constructor(
    readonly code: 'exchange_failed' | 'unavailable' | 'bad_scope',
    message: string,
  ) {
    super(message);
    this.name = 'GithubOAuthError';
  }
}

export interface GithubProfile {
  id: number;
  login: string;
  avatarUrl: string | null;
}

export async function exchangeCode(
  settings: GithubOAuthSettings,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; scopes: string[] }> {
  let response: Response;
  try {
    response = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'ketner-ai' },
      body: JSON.stringify({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code,
        redirect_uri: settings.redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GithubOAuthError('unavailable', 'GitHub не ответил. Попробуйте подключить ещё раз.');
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new GithubOAuthError(
      'exchange_failed',
      body.error === 'bad_verification_code'
        ? 'Ссылка подключения устарела. Нажмите «Подключить GitHub» ещё раз.'
        : 'GitHub не подтвердил подключение. Попробуйте ещё раз.',
    );
  }
  const scopes = (body.scope ?? '')
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (!scopes.includes('repo')) {
    throw new GithubOAuthError('bad_scope', 'Без доступа к репозиториям Ketner не сможет читать и менять код. Разрешите доступ при подключении.');
  }
  return { token: body.access_token, scopes };
}

export async function fetchProfile(token: string, fetchImpl: typeof fetch = fetch): Promise<GithubProfile> {
  let response: Response;
  try {
    response = await fetchImpl('https://api.github.com/user', {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GithubOAuthError('unavailable', 'GitHub не ответил. Попробуйте подключить ещё раз.');
  }
  if (!response.ok) {
    throw new GithubOAuthError('exchange_failed', 'Не удалось получить профиль GitHub. Попробуйте ещё раз.');
  }
  const user = (await response.json()) as { id?: number; login?: string; avatar_url?: string };
  if (typeof user.id !== 'number' || typeof user.login !== 'string') {
    throw new GithubOAuthError('exchange_failed', 'Не удалось получить профиль GitHub. Попробуйте ещё раз.');
  }
  return { id: user.id, login: user.login, avatarUrl: user.avatar_url ?? null };
}

/** Отзывает токен в GitHub (best effort): после отключения он больше нигде не работает. */
export async function revokeToken(
  settings: GithubOAuthSettings,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`https://api.github.com/applications/${encodeURIComponent(settings.clientId)}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'ketner-ai',
        Authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ access_token: token }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // токен всё равно удалён у нас; в GitHub его можно отозвать вручную
  }
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'ketner-ai',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
