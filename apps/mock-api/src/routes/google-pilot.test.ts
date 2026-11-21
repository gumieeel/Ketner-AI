import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GOOGLE_SHEETS_PILOT_ACCOUNTS,
  googleSheetsEnabledFor,
  googleSheetsEnabledForAnyone,
  productSwitch,
  setGoogleSheetsPilotForTests,
} from '../product-switches.js';
import { FAKE_GOOGLE_SETTINGS, createFakeGoogle } from '../testing/fake-google.js';
import { readJson, startTestServer, type TestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AuthSession } from '../types.js';

// Пилот (этап F, шаг 5a): переключатель выключен, Google Таблицы — только аккаунтам из списка.

test('пилот в коде: только владелец, список только на сервере; переключатель для всех закрыт', () => {
  assert.equal(productSwitch('googleSheets'), false);
  assert.deepEqual(GOOGLE_SHEETS_PILOT_ACCOUNTS, ['c4b78d88-6aee-4183-bd19-33a40e9ffece']);
  assert.equal(googleSheetsEnabledFor('c4b78d88-6aee-4183-bd19-33a40e9ffece'), true);
  assert.equal(googleSheetsEnabledFor('someone-else'), false);
  assert.equal(googleSheetsEnabledFor(null), false);
  assert.equal(googleSheetsEnabledForAnyone(), true);

  // Список — только на сервере: в открытый код сайта id аккаунтов не попадают.
  const web = readFileSync(
    new URL('../../../web/src/lib/product-switches.ts', import.meta.url),
    'utf8',
  );
  assert.ok(!web.includes('c4b78d88'));
});

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

test('пилот: аккаунт из списка подключает Google, остальные получают 503 — и на колбэке тоже', async (t) => {
  const google = createFakeGoogle();
  const originalLog = console.log;
  console.log = () => {};
  const server = await startTestServer(
    {},
    { googleFetch: google.fetchImpl, googleSettings: () => FAKE_GOOGLE_SETTINGS },
  );
  t.after(async () => {
    console.log = originalLog;
    setGoogleSheetsPilotForTests(null);
    await server.close();
  });
  const pilot = await signup(server, 'pilot');
  const other = await signup(server, 'other');
  setGoogleSheetsPilotForTests([pilot.user.id]);

  const call = (session: AuthSession | null, method: string, path: string, body?: unknown) =>
    fetch(`${server.baseUrl}/api/integrations/google${path}`, {
      method,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  // Остальные и гость: 503, как при закрытом переключателе.
  for (const session of [other, null]) {
    const response = await call(session, 'GET', '');
    assert.equal(response.status, 503);
    assert.equal(
      (await readJson<{ error: { code: string } }>(response)).error.code,
      'feature_unavailable',
    );
  }

  // Аккаунт пилота: статус, начало подключения, колбэк по его state и подтверждение.
  assert.equal((await call(pilot, 'GET', '')).status, 200);
  const start = await readJson<{ url: string }>(await call(pilot, 'POST', '/start', {}));
  const state = new URL(start.url).searchParams.get('state')!;
  const callback = await fetch(
    `${server.baseUrl}/api/integrations/google/callback?code=c-1&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' },
  );
  assert.equal(callback.status, 302);
  const confirm = await call(pilot, 'POST', '/confirm', { code: 'c-1', state });
  assert.equal(confirm.status, 200);
  assert.equal((await readJson<{ status: string }>(confirm)).status, 'connected');

  // Колбэк со state чужого (не пилотного) аккаунта — 503: подключить в обход списка нельзя.
  setGoogleSheetsPilotForTests([pilot.user.id, other.user.id]);
  const otherStart = await readJson<{ url: string }>(await call(other, 'POST', '/start', {}));
  setGoogleSheetsPilotForTests([pilot.user.id]);
  const otherState = new URL(otherStart.url).searchParams.get('state')!;
  const otherCallback = await fetch(
    `${server.baseUrl}/api/integrations/google/callback?code=c-2&state=${encodeURIComponent(otherState)}`,
    { redirect: 'manual' },
  );
  assert.equal(otherCallback.status, 503);
  assert.equal(
    (await call(other, 'POST', '/confirm', { code: 'c-2', state: otherState })).status,
    503,
  );
});
