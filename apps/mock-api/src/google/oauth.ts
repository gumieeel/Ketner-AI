/**
 * Подключение Google для записи заявок в таблицу (этап F, docs/STAGE_F_SHEETS.md, раздел 3).
 *
 * Отдельный OAuth-клиент («Ketner Sheets»), не вход через Google. Просим только `openid`, `email`
 * и `drive.file`. Выданные Google разрешения проверяем в коде: `drive.file` обязателен, всё сверх
 * `openid` / `email` / `drive.file` — отказ, токен не сохраняется и отзывается.
 *
 * `state` подписан HMAC и привязан к пользователю (как github/oauth.ts, своя метка). PKCE: verifier
 * хранится только на сервере (verifier-store.ts), в `state` и в браузер он не попадает.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Что Ketner просит у Google. */
export const GOOGLE_REQUESTED_SCOPES = ['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE] as const;
/**
 * Что Google может вернуть в ответ на запрошенное: `email` приходит как `userinfo.email`. Любое
 * другое разрешение в ответе — отказ подключения.
 */
const ALLOWED_GRANTED_SCOPES = new Set<string>([
  'openid',
  'email',
  'https://www.googleapis.com/auth/userinfo.email',
  GOOGLE_DRIVE_FILE_SCOPE,
]);

export const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/**
 * Строки диагностики для пилота (этап F, шаг 5a): что Google ответил на обмен кода, обновление
 * токена и отзыв — коды ответа, наличие refresh-токена, выданные разрешения. Ни токенов, ни кода,
 * ни тела ответа целиком. Префикс `[google:diag]` — по нему их ищут в логах Render.
 */
export const googleDiagnostics = {
  log: (line: string): void => {
    console.log(`[google:diag] ${line}`);
  },
};

/** Код ошибки Google (`invalid_grant`, `invalid_token`…) — только безопасные символы. */
function errorCodeOf(value: unknown): string {
  return typeof value === 'string' && /^[a-z_]{1,40}$/.test(value) ? value : '-';
}

export interface GoogleOAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** Настройки OAuth-клиента или null, если Google Таблицы на сервере не настроены. */
export function googleOAuthSettings(): GoogleOAuthSettings | null {
  const clientId = process.env.GOOGLE_SHEETS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    process.env.GOOGLE_SHEETS_REDIRECT_URI?.trim() ||
    `${trimSlash(config.betterAuthUrl)}/api/integrations/google/callback`;
  return { clientId, clientSecret, redirectUri };
}

// --- state ----------------------------------------------------------------------------------

interface StatePayload {
  /** id пользователя Ketner, начавшего подключение. */
  u: string;
  /** Одноразовый ключ: по нему на сервере лежит PKCE verifier. */
  n: string;
  /** Срок действия, мс с эпохи. */
  e: number;
  /** Куда вернуть человека после Google. */
  r: string;
}

export interface GoogleState {
  userId: string;
  nonce: string;
  returnTo: string;
  expiresAt: number;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', `ketner:google-state:${secret}`).update(body).digest('base64url');
}

export function createGoogleState(
  userId: string,
  returnTo: string,
  secret = config.betterAuthSecret,
  now = Date.now(),
): { state: string; nonce: string; expiresAt: number } {
  const nonce = randomBytes(18).toString('base64url');
  const expiresAt = now + GOOGLE_STATE_TTL_MS;
  const payload: StatePayload = { u: userId, n: nonce, e: expiresAt, r: returnTo };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { state: `${body}.${sign(body, secret)}`, nonce, expiresAt };
}

export function readGoogleState(
  state: string,
  secret = config.betterAuthSecret,
  now = Date.now(),
): GoogleState | null {
  if (state.length > 2000) return null;
  const [body, signature, extra] = state.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as Partial<StatePayload>;
    if (
      typeof payload.u !== 'string' ||
      typeof payload.n !== 'string' ||
      typeof payload.r !== 'string' ||
      typeof payload.e !== 'number'
    )
      return null;
    if (payload.e < now) return null;
    return { userId: payload.u, nonce: payload.n, returnTo: payload.r, expiresAt: payload.e };
  } catch {
    return null;
  }
}

// --- PKCE -----------------------------------------------------------------------------------

/** Verifier PKCE: 32 случайных байта → 43 символа base64url (RFC 7636: 43–128). */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** `code_challenge` для метода S256: base64url(sha256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function googleAuthorizeUrl(
  settings: GoogleOAuthSettings,
  state: string,
  verifier: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', settings.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_REQUESTED_SCOPES.join(' '));
  // offline + consent — чтобы Google выдал refresh-токен и при повторном подключении.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  // Разрешения, выданные этому клиенту раньше, не подмешиваются: проверяем ровно запрошенное.
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('code_challenge', codeChallengeS256(verifier));
  // По умолчанию Google считает метод `plain` — S256 указываем явно.
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}

// --- обмен кода ------------------------------------------------------------------------------

export type GoogleOAuthErrorCode =
  | 'unavailable'
  | 'exchange_failed'
  | 'excess_scope'
  | 'missing_drive_file'
  | 'no_refresh_token'
  | 'bad_id_token'
  | 'invalid_grant';

const MESSAGES: Record<GoogleOAuthErrorCode, string> = {
  unavailable: 'Google не ответил. Попробуйте подключить ещё раз.',
  exchange_failed: 'Google не подтвердил подключение. Попробуйте ещё раз.',
  excess_scope:
    'Google выдал больше разрешений, чем нужно Ketner. Подключение отменено, доступ отозван. Попробуйте ещё раз.',
  missing_drive_file:
    'Без разрешения на файлы Ketner не сможет записывать заявки в таблицу. Подключите ещё раз и оставьте это разрешение включённым.',
  no_refresh_token: 'Google не выдал постоянный доступ. Попробуйте подключить ещё раз.',
  bad_id_token: 'Не удалось определить аккаунт Google. Попробуйте подключить ещё раз.',
  invalid_grant: 'Доступ к Google отозван. Подключите таблицу снова.',
};

export class GoogleOAuthError extends Error {
  constructor(
    readonly code: GoogleOAuthErrorCode,
    message = MESSAGES[code],
  ) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

/**
 * Разбирает строку `scope` из ответа Google. Отказ, если есть что-то сверх разрешённого
 * (`excess_scope`) или нет `drive.file` (`missing_drive_file`).
 */
export function checkGrantedScopes(
  raw: unknown,
): { ok: true; scopes: string[] } | { ok: false; code: 'excess_scope' | 'missing_drive_file' } {
  const scopes = typeof raw === 'string' ? [...new Set(raw.split(/\s+/).filter(Boolean))] : [];
  if (scopes.some((scope) => !ALLOWED_GRANTED_SCOPES.has(scope))) {
    return { ok: false, code: 'excess_scope' };
  }
  if (!scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) return { ok: false, code: 'missing_drive_file' };
  return { ok: true, scopes };
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
}

/**
 * Данные аккаунта из `id_token`. Токен получен прямо из token endpoint Google по TLS, поэтому
 * подпись не проверяем (OpenID Connect Core 1.0, п. 3.1.3.7, шаг 6); издателя, получателя и срок —
 * проверяем.
 */
export function readIdToken(
  idToken: unknown,
  clientId: string,
  now = Date.now(),
): GoogleIdentity | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      iss?: unknown;
      aud?: unknown;
      sub?: unknown;
      email?: unknown;
      email_verified?: unknown;
      exp?: unknown;
    };
    if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(clientId)) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
    if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub)) return null;
    const email =
      typeof claims.email === 'string' &&
      claims.email_verified !== false &&
      claims.email.length <= 320
        ? claims.email
        : null;
    return { sub: claims.sub, email };
  } catch {
    return null;
  }
}

export interface GoogleGrant {
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  identity: GoogleIdentity;
}

/**
 * Обменивает код на токены (с секретом клиента и PKCE verifier) и проверяет ответ. При отказе по
 * разрешениям или без refresh-токена выданный доступ отзывается: Ketner его не хранит.
 */
export async function exchangeGoogleCode(
  settings: GoogleOAuthSettings,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<GoogleGrant> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uri: settings.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoogleOAuthError('unavailable');
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    refresh_token?: unknown;
    scope?: unknown;
    id_token?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) {
    googleDiagnostics.log(
      `обмен кода: HTTP ${response.status}, ошибка: ${errorCodeOf(body.error)}`,
    );
    throw new GoogleOAuthError(
      'exchange_failed',
      body.error === 'invalid_grant'
        ? 'Ссылка подключения устарела. Нажмите «Подключить Google Таблицу» ещё раз.'
        : undefined,
    );
  }
  const accessToken = body.access_token;
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
  googleDiagnostics.log(
    `обмен кода: HTTP ${response.status}, refresh_token: ${refreshToken ? 'есть' : 'нет'}, ` +
      `scope: ${typeof body.scope === 'string' ? body.scope : '-'}`,
  );
  // Отзыв refresh-токена снимает и выданный доступ; без него — отзываем access-токен.
  const revokeGranted = () => revokeGoogleToken(refreshToken || accessToken, fetchImpl);

  const granted = checkGrantedScopes(body.scope);
  if (!granted.ok) {
    await revokeGranted();
    throw new GoogleOAuthError(granted.code);
  }
  if (!refreshToken) {
    await revokeGranted();
    throw new GoogleOAuthError('no_refresh_token');
  }
  const identity = readIdToken(body.id_token, settings.clientId, now);
  if (!identity) {
    await revokeGranted();
    throw new GoogleOAuthError('bad_id_token');
  }
  return { accessToken, refreshToken, scopes: granted.scopes, identity };
}

/**
 * Новый access-токен по refresh-токену (живёт около часа; хранится только в памяти процесса).
 * `invalid_grant` — доступ отозван или токен недействителен: нужно подключить Google снова.
 */
export async function refreshGoogleAccessToken(
  settings: GoogleOAuthSettings,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresInSec: number }> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoogleOAuthError('unavailable');
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
  };
  const refreshed = response.ok && typeof body.access_token === 'string' && body.access_token;
  googleDiagnostics.log(
    refreshed
      ? `обновление токена: HTTP ${response.status}, expires_in: ${String(body.expires_in ?? '-')}`
      : `обновление токена: HTTP ${response.status}, ошибка: ${errorCodeOf(body.error)}`,
  );
  if (body.error === 'invalid_grant') throw new GoogleOAuthError('invalid_grant');
  if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) {
    throw new GoogleOAuthError(response.status >= 500 ? 'unavailable' : 'exchange_failed');
  }
  const expiresInSec =
    typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
  return { accessToken: body.access_token, expiresInSec };
}

/**
 * Отзывает доступ (RFC 7009, `POST oauth2.googleapis.com/revoke`). Best effort: никогда не
 * бросает, возвращает, удался ли отзыв, — вызывающий пишет строку в лог.
 */
export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    googleDiagnostics.log(
      `отзыв: HTTP ${response.status}${response.ok ? '' : `, ошибка: ${errorCodeOf(body.error)}`}`,
    );
    return response.ok;
  } catch {
    googleDiagnostics.log('отзыв: Google не ответил');
    return false;
  }
}

/** Добавляет параметры во фрагмент адреса: так код не попадает в логи сервера и Referer. */
export function withFragment(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  url.hash = new URLSearchParams(params).toString();
  return url.toString();
}
