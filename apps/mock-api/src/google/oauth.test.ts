import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_STATE_TTL_MS,
  GoogleOAuthError,
  checkGrantedScopes,
  codeChallengeS256,
  createCodeVerifier,
  createGoogleState,
  exchangeGoogleCode,
  googleAuthorizeUrl,
  readGoogleState,
  readIdToken,
} from './oauth.js';
import { createGoogleVerifierStore } from './verifier-store.js';
import { fakeIdToken } from '../testing/fake-google.js';

const SECRET = 'test-secret-for-google-state';
const SETTINGS = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'client-secret',
  redirectUri: 'https://ketner.org/api/integrations/google/callback',
};
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

const validClaims = (now = Date.now()) => ({
  iss: 'https://accounts.google.com',
  aud: SETTINGS.clientId,
  sub: '1234567890',
  email: 'owner@example.com',
  email_verified: true,
  exp: Math.floor(now / 1000) + 3600,
});

test('state: подпись, срок, чужой ключ и подделка', () => {
  const now = 1_800_000_000_000;
  const { state, nonce, expiresAt } = createGoogleState(
    'user-1',
    'https://ketner.org/x',
    SECRET,
    now,
  );
  assert.equal(expiresAt, now + GOOGLE_STATE_TTL_MS);
  assert.deepEqual(readGoogleState(state, SECRET, now + 1000), {
    userId: 'user-1',
    nonce,
    returnTo: 'https://ketner.org/x',
    expiresAt,
  });
  // Просрочен.
  assert.equal(readGoogleState(state, SECRET, expiresAt + 1), null);
  // Другой ключ (или подпись GitHub-состояния) не подходит.
  assert.equal(readGoogleState(state, 'other-secret', now), null);
  // Подмена пользователя в теле ломает подпись.
  const [body, signature] = state.split('.');
  const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as { u: string };
  payload.u = 'user-2';
  const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
  assert.equal(readGoogleState(forged, SECRET, now), null);
  assert.equal(readGoogleState(`${state}.extra`, SECRET, now), null);
  // У двух подключений разные nonce.
  assert.notEqual(createGoogleState('user-1', 'https://ketner.org/x', SECRET, now).nonce, nonce);
});

test('PKCE: S256 по RFC 7636 (приложение B), verifier 43 символа', () => {
  assert.equal(
    codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
  const verifier = createCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(createCodeVerifier(), verifier);
});

test('адрес авторизации: только openid, email, drive.file; S256; offline; verifier не уходит', () => {
  const verifier = createCodeVerifier();
  const url = new URL(googleAuthorizeUrl(SETTINGS, 'state-1', verifier));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const params = Object.fromEntries(url.searchParams);
  assert.deepEqual(params, {
    client_id: SETTINGS.clientId,
    redirect_uri: SETTINGS.redirectUri,
    response_type: 'code',
    scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    code_challenge: codeChallengeS256(verifier),
    code_challenge_method: 'S256',
    state: 'state-1',
  });
  assert.ok(!url.toString().includes(verifier));
});

test('выданные разрешения: drive.file обязателен, всё сверх openid/email/drive.file — отказ', () => {
  assert.deepEqual(checkGrantedScopes(`openid ${EMAIL_SCOPE} ${GOOGLE_DRIVE_FILE_SCOPE}`), {
    ok: true,
    scopes: ['openid', EMAIL_SCOPE, GOOGLE_DRIVE_FILE_SCOPE],
  });
  assert.deepEqual(checkGrantedScopes(GOOGLE_DRIVE_FILE_SCOPE), {
    ok: true,
    scopes: [GOOGLE_DRIVE_FILE_SCOPE],
  });
  assert.deepEqual(checkGrantedScopes(`openid ${EMAIL_SCOPE}`), {
    ok: false,
    code: 'missing_drive_file',
  });
  assert.deepEqual(checkGrantedScopes(undefined), { ok: false, code: 'missing_drive_file' });
  for (const extra of [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.profile',
    'profile',
    'https://www.googleapis.com/auth/calendar',
  ]) {
    assert.deepEqual(
      checkGrantedScopes(`openid ${GOOGLE_DRIVE_FILE_SCOPE} ${extra}`),
      { ok: false, code: 'excess_scope' },
      extra,
    );
  }
});

test('id_token: издатель, получатель, срок и sub', () => {
  const now = Date.now();
  assert.deepEqual(readIdToken(fakeIdToken(validClaims(now)), SETTINGS.clientId, now), {
    sub: '1234567890',
    email: 'owner@example.com',
  });
  assert.equal(
    readIdToken(fakeIdToken({ ...validClaims(now), aud: 'other' }), SETTINGS.clientId, now),
    null,
  );
  assert.equal(
    readIdToken(
      fakeIdToken({ ...validClaims(now), iss: 'https://evil.example' }),
      SETTINGS.clientId,
      now,
    ),
    null,
  );
  assert.equal(
    readIdToken(
      fakeIdToken({ ...validClaims(now), exp: Math.floor(now / 1000) - 1 }),
      SETTINGS.clientId,
      now,
    ),
    null,
  );
  assert.equal(
    readIdToken(fakeIdToken({ ...validClaims(now), sub: undefined }), SETTINGS.clientId, now),
    null,
  );
  // Неподтверждённая почта не показывается, аккаунт определяется по sub.
  assert.deepEqual(
    readIdToken(
      fakeIdToken({ ...validClaims(now), email_verified: false }),
      SETTINGS.clientId,
      now,
    ),
    { sub: '1234567890', email: null },
  );
  assert.equal(readIdToken('not-a-jwt', SETTINGS.clientId, now), null);
});

interface Call {
  url: string;
  body: URLSearchParams;
}

function fakeTokenEndpoint(reply: { status?: number; body: Record<string, unknown> } | 'network') {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: new URLSearchParams(String(init?.body ?? '')) });
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: 200 });
    if (reply === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const grantBody = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'ya29.access',
  refresh_token: '1//refresh',
  scope: `openid ${EMAIL_SCOPE} ${GOOGLE_DRIVE_FILE_SCOPE}`,
  id_token: fakeIdToken(validClaims()),
  expires_in: 3599,
  token_type: 'Bearer',
  ...overrides,
});

test('обмен кода: секрет клиента и verifier уходят в token endpoint, ответ проверяется', async () => {
  const { calls, fetchImpl } = fakeTokenEndpoint({ body: grantBody() });
  const grant = await exchangeGoogleCode(SETTINGS, 'code-1', 'verifier-1', fetchImpl);
  assert.deepEqual(grant, {
    accessToken: 'ya29.access',
    refreshToken: '1//refresh',
    scopes: ['openid', EMAIL_SCOPE, GOOGLE_DRIVE_FILE_SCOPE],
    identity: { sub: '1234567890', email: 'owner@example.com' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/token');
  assert.deepEqual(Object.fromEntries(calls[0]!.body), {
    code: 'code-1',
    client_id: SETTINGS.clientId,
    client_secret: SETTINGS.clientSecret,
    redirect_uri: SETTINGS.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: 'verifier-1',
  });
});

test('обмен кода: лишние разрешения, нет drive.file, нет refresh-токена — отказ и отзыв выданного', async () => {
  const cases: Array<[Record<string, unknown>, string, string]> = [
    [
      { scope: `openid ${GOOGLE_DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/drive` },
      'excess_scope',
      '1//refresh',
    ],
    [{ scope: `openid ${EMAIL_SCOPE}` }, 'missing_drive_file', '1//refresh'],
    [{ refresh_token: undefined }, 'no_refresh_token', 'ya29.access'],
    [{ id_token: fakeIdToken({ ...validClaims(), aud: 'other' }) }, 'bad_id_token', '1//refresh'],
  ];
  for (const [overrides, code, revoked] of cases) {
    const { calls, fetchImpl } = fakeTokenEndpoint({ body: grantBody(overrides) });
    await assert.rejects(
      () => exchangeGoogleCode(SETTINGS, 'code-1', 'verifier-1', fetchImpl),
      (error: unknown) => error instanceof GoogleOAuthError && error.code === code,
      code,
    );
    const revoke = calls.find((call) => call.url === 'https://oauth2.googleapis.com/revoke');
    assert.equal(revoke?.body.get('token'), revoked, code);
  }
});

test('обмен кода: invalid_grant, ошибка Google и сбой сети', async () => {
  const expired = fakeTokenEndpoint({ status: 400, body: { error: 'invalid_grant' } });
  await assert.rejects(
    () => exchangeGoogleCode(SETTINGS, 'c', 'v', expired.fetchImpl),
    (error: unknown) =>
      error instanceof GoogleOAuthError &&
      error.code === 'exchange_failed' &&
      /устарела/.test(error.message),
  );
  const rejected = fakeTokenEndpoint({ status: 401, body: { error: 'invalid_client' } });
  await assert.rejects(
    () => exchangeGoogleCode(SETTINGS, 'c', 'v', rejected.fetchImpl),
    (error: unknown) => error instanceof GoogleOAuthError && error.code === 'exchange_failed',
  );
  const offline = fakeTokenEndpoint('network');
  await assert.rejects(
    () => exchangeGoogleCode(SETTINGS, 'c', 'v', offline.fetchImpl),
    (error: unknown) => error instanceof GoogleOAuthError && error.code === 'unavailable',
  );
});

test('verifier: одноразовый, только своему пользователю, просроченный не отдаётся', async () => {
  const store = createGoogleVerifierStore();
  const now = 1_800_000_000_000;
  await store.put({ id: 'n1', userId: 'u1', verifier: 'v1', expiresAt: now + 1000 }, now);
  assert.equal(store.take('n1', 'u1', now), 'v1');
  assert.equal(store.take('n1', 'u1', now), undefined, 'второй раз — нет');

  await store.put({ id: 'n2', userId: 'u1', verifier: 'v2', expiresAt: now + 1000 }, now);
  assert.equal(store.take('n2', 'u2', now), undefined, 'чужой пользователь');
  assert.equal(store.take('n2', 'u1', now), undefined, 'запись удалена и после чужой попытки');

  await store.put({ id: 'n3', userId: 'u1', verifier: 'v3', expiresAt: now + 1000 }, now);
  assert.equal(store.take('n3', 'u1', now + 1001), undefined, 'просрочен');

  // Просроченные записи вычищаются при следующем подключении.
  await store.put({ id: 'n4', userId: 'u1', verifier: 'v4', expiresAt: now + 10 }, now);
  await store.put({ id: 'n5', userId: 'u2', verifier: 'v5', expiresAt: now + 5000 }, now + 100);
  assert.deepEqual(store.idsOf('u1'), []);
  assert.deepEqual(store.idsOf('u2'), ['n5']);
});
