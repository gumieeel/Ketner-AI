import assert from 'node:assert/strict';
import test from 'node:test';
import { setProductSwitchForTests } from '../product-switches.js';
import { codeChallengeS256, readGoogleState } from '../google/oauth.js';
import { readJson, startTestServer, type TestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import { DRIVE_FILE, FAKE_GOOGLE_SETTINGS, createFakeGoogle } from '../testing/fake-google.js';
import { LEAD_SHEET_COLUMNS } from '../google/sheets.js';
import type { AuthSession } from '../types.js';

setProductSwitchForTests('googleSheets', true);

interface Status {
  connectedAt?: string | null;
  connected: boolean;
  status: string | null;
  email: string | null;
  spreadsheetUrl: string | null;
  lastErrorCode: string | null;
}

async function setup(
  t: test.TestContext,
  settings: () => typeof FAKE_GOOGLE_SETTINGS | null = () => FAKE_GOOGLE_SETTINGS,
) {
  const google = createFakeGoogle();
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(' '));
  const server = await startTestServer(
    {},
    { googleFetch: google.fetchImpl, googleSettings: settings },
  );
  t.after(async () => {
    console.warn = originalWarn;
    await server.close();
  });
  return { server, google, logs };
}

async function signup(server: TestServer, name: string): Promise<AuthSession> {
  return readJson<AuthSession>(
    await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
        password: 'password123',
        name,
      }),
    }),
  );
}

function call(
  server: TestServer,
  session: AuthSession | null,
  method: string,
  path: string,
  body?: unknown,
) {
  return fetch(`${server.baseUrl}/api/integrations/google${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** start → Google → callback: возвращает код и state из фрагмента адреса возврата. */
async function startAndCallback(server: TestServer, session: AuthSession, code = 'auth-code-1') {
  const start = await call(server, session, 'POST', '/start', {
    returnTo: 'http://localhost:5173/solutions/s1?tab=leads',
  });
  assert.equal(start.status, 200);
  const { url } = await readJson<{ url: string }>(start);
  const authorize = new URL(url);
  const state = authorize.searchParams.get('state')!;
  const callback = await fetch(
    `${server.baseUrl}/api/integrations/google/callback?code=${code}&state=${encodeURIComponent(state)}&scope=x`,
    { redirect: 'manual' },
  );
  assert.equal(callback.status, 302);
  const location = new URL(callback.headers.get('location')!);
  assert.equal(location.origin + location.pathname, 'http://localhost:5173/solutions/s1');
  assert.equal(location.search, '?tab=leads');
  const fragment = new URLSearchParams(location.hash.slice(1));
  assert.equal(fragment.get('google_code'), code);
  assert.equal(fragment.get('google_state'), state);
  return { authorize, state, code };
}

async function confirm(server: TestServer, session: AuthSession, code: string, state: string) {
  return call(server, session, 'POST', '/confirm', { code, state });
}

test('подключение: start → callback → confirm; verifier только на сервере; таблица создана', async (t) => {
  const { server, google } = await setup(t);
  const owner = await signup(server, 'owner');

  const before = await readJson<Status>(await call(server, owner, 'GET', ''));
  assert.deepEqual(before, {
    connected: false,
    status: null,
    email: null,
    spreadsheetUrl: null,
    lastErrorCode: null,
    connectedAt: null,
    pending: 0,
  });

  const { authorize, state, code } = await startAndCallback(server, owner);
  assert.equal(authorize.searchParams.get('scope'), `openid email ${DRIVE_FILE}`);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  const nonce = readGoogleState(state)!.nonce;
  // Verifier лежит на сервере под nonce; в адресе Google — только его хэш.
  assert.deepEqual(server.googleVerifierStore.idsOf(owner.user.id), [nonce]);

  const response = await confirm(server, owner, code, state);
  assert.equal(response.status, 200);
  const text = await response.text();
  const status = JSON.parse(text) as Status;
  assert.equal(status.connected, true);
  assert.equal(status.status, 'connected');
  assert.equal(status.email, 'owner@example.com');
  assert.match(
    status.spreadsheetUrl ?? '',
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/sheet1-/,
  );
  // В ответе сайту нет токенов.
  assert.ok(!text.includes('fake-refresh') && !text.includes('fake-access'));

  // В token endpoint ушёл verifier, чей S256 — тот, что был в адресе авторизации.
  assert.equal(google.tokenRequests.length, 1);
  const sentVerifier = google.tokenRequests[0]!.get('code_verifier')!;
  assert.equal(codeChallengeS256(sentVerifier), authorize.searchParams.get('code_challenge'));
  assert.equal(google.tokenRequests[0]!.get('code'), code);
  assert.deepEqual(server.googleVerifierStore.idsOf(owner.user.id), [], 'verifier израсходован');

  // Таблица: создана access-токеном, лист «Заявки», колонки по порядку, первая строка закреплена.
  assert.equal(google.sheetsCreated.length, 1);
  assert.equal(google.sheetsCreated[0]!.authorization, 'Bearer ya29.fake-access');
  const sheet = google.sheetsCreated[0]!.body as {
    properties: { title: string };
    sheets: Array<{
      properties: { title: string; gridProperties: { frozenRowCount: number } };
      data: Array<{
        rowData: Array<{ values: Array<{ userEnteredValue: { stringValue: string } }> }>;
      }>;
    }>;
  };
  assert.equal(sheet.properties.title, 'Заявки Ketner');
  assert.equal(sheet.sheets[0]!.properties.title, 'Заявки');
  assert.equal(sheet.sheets[0]!.properties.gridProperties.frozenRowCount, 1);
  assert.deepEqual(
    sheet.sheets[0]!.data[0]!.rowData[0]!.values.map((cell) => cell.userEnteredValue.stringValue),
    // Часовой пояс владельца не прислан — колонка даты подписана как UTC.
    ['Дата (UTC)', ...LEAD_SHEET_COLUMNS.slice(1)],
  );

  // Хранилище: токен зашифрован и расшифровывается только сервером.
  assert.equal(server.googleConnectionStore.refreshTokenOf(owner.user.id), '1//fake-refresh');
  assert.equal(server.googleConnectionStore.get(owner.user.id)?.googleSub, '1234567890');
  assert.ok(
    !JSON.stringify(server.googleConnectionStore.get(owner.user.id)).includes('fake-refresh'),
  );

  // Тот же state второй раз — отказ, Google не спрашиваем.
  const again = await confirm(server, owner, code, state);
  assert.equal(again.status, 400);
  assert.equal(
    (await readJson<{ error: { code: string } }>(again)).error.code,
    'google_state_invalid',
  );
  assert.equal(google.tokenRequests.length, 1);
});

test('чужая сессия не обменяет код и не израсходует verifier владельца', async (t) => {
  const { server, google } = await setup(t);
  const owner = await signup(server, 'owner');
  const stranger = await signup(server, 'stranger');
  const { state, code } = await startAndCallback(server, owner);

  const foreign = await confirm(server, stranger, code, state);
  assert.equal(foreign.status, 400);
  assert.equal(
    (await readJson<{ error: { code: string } }>(foreign)).error.code,
    'google_state_invalid',
  );
  assert.equal(google.tokenRequests.length, 0);
  assert.equal(server.googleConnectionStore.get(stranger.user.id), undefined);

  // Владелец по-прежнему может завершить своё подключение.
  assert.equal((await confirm(server, owner, code, state)).status, 200);
});

test('без входа — 401; испорченный state на колбэке — возврат с ошибкой; отказ человека — denied', async (t) => {
  const { server } = await setup(t);
  const owner = await signup(server, 'owner');
  assert.equal((await call(server, null, 'GET', '')).status, 401);
  assert.equal((await call(server, null, 'POST', '/start', {})).status, 401);
  assert.equal(
    (await call(server, null, 'POST', '/confirm', { code: 'c', state: 's' })).status,
    401,
  );

  const bad = await fetch(
    `${server.baseUrl}/api/integrations/google/callback?code=c&state=forged.sig`,
    {
      redirect: 'manual',
    },
  );
  assert.equal(bad.status, 302);
  assert.match(bad.headers.get('location')!, /#google_error=state$/);
  assert.ok(!bad.headers.get('location')!.includes('code=c'));

  const start = await readJson<{ url: string }>(await call(server, owner, 'POST', '/start', {}));
  const state = new URL(start.url).searchParams.get('state')!;
  const denied = await fetch(
    `${server.baseUrl}/api/integrations/google/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' },
  );
  assert.match(denied.headers.get('location')!, /#google_error=denied$/);
});

test('адрес возврата: чужой сайт заменяется настройками Ketner', async (t) => {
  const { server } = await setup(t);
  const owner = await signup(server, 'owner');
  const start = await readJson<{ url: string }>(
    await call(server, owner, 'POST', '/start', { returnTo: 'https://evil.example/steal' }),
  );
  const state = readGoogleState(new URL(start.url).searchParams.get('state')!)!;
  assert.ok(!state.returnTo.startsWith('https://evil.example'));
  assert.match(state.returnTo, /\/settings$/);
});

test('лишние разрешения: отказ, токен отозван, подключения нет', async (t) => {
  const { server, google } = await setup(t);
  const owner = await signup(server, 'owner');
  google.grant = {
    scope: `openid ${DRIVE_FILE} https://www.googleapis.com/auth/drive`,
    refreshToken: '1//too-broad',
  };
  const { state, code } = await startAndCallback(server, owner);
  const response = await confirm(server, owner, code, state);
  assert.equal(response.status, 400);
  assert.equal(
    (await readJson<{ error: { code: string } }>(response)).error.code,
    'google_excess_scope',
  );
  assert.deepEqual(google.revoked, ['1//too-broad']);
  assert.equal(server.googleConnectionStore.get(owner.user.id), undefined);
  assert.equal(google.sheetsCreated.length, 0);
});

test('без drive.file: отказ с понятным текстом, токен отозван', async (t) => {
  const { server, google } = await setup(t);
  const owner = await signup(server, 'owner');
  google.grant = { scope: 'openid https://www.googleapis.com/auth/userinfo.email' };
  const { state, code } = await startAndCallback(server, owner);
  const response = await confirm(server, owner, code, state);
  assert.equal(response.status, 400);
  const body = await readJson<{ error: { code: string; message: string } }>(response);
  assert.equal(body.error.code, 'google_missing_drive_file');
  assert.match(body.error.message, /разрешения на файлы/);
  assert.deepEqual(google.revoked, ['1//fake-refresh']);
});

test('таблица не создалась: подключение сохраняется со статусом sheet_missing и кодом сбоя', async (t) => {
  const { server, google, logs } = await setup(t);
  const owner = await signup(server, 'owner');
  google.sheetStatus = 503;
  const { state, code } = await startAndCallback(server, owner);
  const status = await readJson<Status>(await confirm(server, owner, code, state));
  assert.equal(status.status, 'sheet_missing');
  assert.equal(status.connected, true);
  assert.equal(status.lastErrorCode, 'http_5xx');
  assert.equal(status.spreadsheetUrl, null);
  assert.ok(logs.some((line) => line.includes('http_5xx')));
  assert.ok(!logs.join('\n').includes('fake-refresh'), 'токен не попадает в лог');
});

test('повторное подключение: тот же аккаунт Google — прежняя таблица; другой — новая, прежний доступ отозван', async (t) => {
  const { server, google } = await setup(t);
  const owner = await signup(server, 'owner');
  const first = await startAndCallback(server, owner, 'code-a');
  const firstStatus = await readJson<Status>(await confirm(server, owner, first.code, first.state));

  google.grant = { refreshToken: '1//second' };
  const second = await startAndCallback(server, owner, 'code-b');
  const secondStatus = await readJson<Status>(
    await confirm(server, owner, second.code, second.state),
  );
  assert.equal(secondStatus.spreadsheetUrl, firstStatus.spreadsheetUrl);
  assert.equal(google.sheetsCreated.length, 1, 'новая таблица не создавалась');
  assert.deepEqual(google.revoked, ['1//fake-refresh'], 'прежний refresh-токен отозван');

  google.grant = { sub: '999', email: 'other@example.com', refreshToken: '1//third' };
  const third = await startAndCallback(server, owner, 'code-c');
  const thirdStatus = await readJson<Status>(await confirm(server, owner, third.code, third.state));
  assert.equal(thirdStatus.email, 'other@example.com');
  assert.notEqual(thirdStatus.spreadsheetUrl, firstStatus.spreadsheetUrl);
  assert.equal(google.sheetsCreated.length, 2);
  assert.deepEqual(google.revoked, ['1//fake-refresh', '1//second']);
});

test('отключение: токен стёрт и отозван, таблица остаётся у владельца; сбой отзыва — только строка в логе', async (t) => {
  const { server, google, logs } = await setup(t);
  const owner = await signup(server, 'owner');
  const { state, code } = await startAndCallback(server, owner);
  await confirm(server, owner, code, state);

  google.revokeStatus = 500;
  const response = await call(server, owner, 'DELETE', '/connection');
  assert.equal(response.status, 200);
  const status = await readJson<Status>(response);
  assert.equal(status.connected, false);
  assert.equal(status.status, 'disconnected');
  assert.match(status.spreadsheetUrl ?? '', /docs\.google\.com/);
  assert.deepEqual(google.revoked, ['1//fake-refresh']);
  assert.equal(server.googleConnectionStore.refreshTokenOf(owner.user.id), undefined);
  assert.equal(server.googleConnectionStore.hasStoredToken(owner.user.id), false);
  assert.ok(logs.some((line) => line.includes('отзыв доступа при отключении')));
});

test('переключатель включён, но клиент Google не настроен — 503 feature_unavailable', async (t) => {
  const { server } = await setup(t, () => null);
  const owner = await signup(server, 'owner');
  for (const [method, path] of [
    ['GET', ''],
    ['POST', '/start'],
    ['GET', '/callback?code=c&state=s'],
  ] as const) {
    const response = await call(server, owner, method, path, method === 'POST' ? {} : undefined);
    assert.equal(response.status, 503, `${method} ${path}`);
    const body = await readJson<{ error: { code: string; details: { feature: string } } }>(
      response,
    );
    assert.equal(body.error.code, 'feature_unavailable');
    assert.equal(body.error.details.feature, 'googleSheets');
  }
});

test('часовой пояс владельца: из браузера при подключении — таблица в его поясе, колонка «Дата»', async (t) => {
  const { server, google } = await setup(t);
  const owner = await signup(server, 'owner');
  // Кабинет открыт: пояс браузера приходит со статусом; неверный пояс не запоминается.
  await call(server, owner, 'GET', '?timeZone=Not%2FAZone');
  assert.equal(server.googlePrefsStore.timeZoneOf(owner.user.id), null);
  await call(server, owner, 'GET', '?timeZone=Asia%2FQyzylorda');
  assert.equal(server.googlePrefsStore.timeZoneOf(owner.user.id), 'Asia/Qyzylorda');

  const { state, code } = await startAndCallback(server, owner);
  const response = await call(server, owner, 'POST', '/confirm', {
    code,
    state,
    timeZone: 'Asia/Almaty',
  });
  assert.equal(response.status, 200);
  assert.equal(server.googlePrefsStore.timeZoneOf(owner.user.id), 'Asia/Almaty');
  const body = google.sheetsCreated[0]!.body as {
    properties: { timeZone?: string };
    sheets: Array<{
      data: Array<{
        rowData: Array<{ values: Array<{ userEnteredValue: { stringValue: string } }> }>;
      }>;
    }>;
  };
  assert.equal(body.properties.timeZone, 'Asia/Almaty');
  assert.equal(
    body.sheets[0]!.data[0]!.rowData[0]!.values[0]!.userEnteredValue.stringValue,
    'Дата',
  );
});
