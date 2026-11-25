import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GOOGLE_SHEETS_PILOT_ACCOUNTS,
  googleSheetsEnabledFor,
  googleSheetsEnabledForAnyone,
  productSwitch,
  setGoogleSheetsPilotForTests,
  setProductSwitchForTests,
} from '../product-switches.js';
import { FAKE_GOOGLE_SETTINGS, createFakeGoogle } from '../testing/fake-google.js';
import { readJson, startTestServer, type TestServer } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AuthSession } from '../types.js';
import { setTierEnforcedForTests } from '../billing/tier-usage.js';

// Правила тарифа для внешних сервисов — в routes/google-tier.test.ts; здесь — поведение Google.
setTierEnforcedForTests(false);

// Шаг 5b: Google Таблицы открыты всем, список пилота пуст. Путь «по аккаунту» остаётся: если
// переключатель снова закроют, пилот возвращается списком на сервере.

test('шаг 5b: открыто всем аккаунтам, список пилота пуст и в код сайта не попадает', () => {
  assert.equal(productSwitch('googleSheets'), true);
  assert.deepEqual(GOOGLE_SHEETS_PILOT_ACCOUNTS, []);
  assert.equal(googleSheetsEnabledFor('any-account'), true);
  assert.equal(googleSheetsEnabledForAnyone(), true);
  // Прежний id владельца из пилота больше нигде в коде переключателей нет.
  for (const file of ['../product-switches.ts', '../../../web/src/lib/product-switches.ts']) {
    assert.ok(!readFileSync(new URL(file, import.meta.url), 'utf8').includes('c4b78d88'), file);
  }
});

test('открыто всем: любой вошедший аккаунт получает статус; гость — 401, а не 503', async (t) => {
  const server = await startTestServer({}, { googleSettings: () => FAKE_GOOGLE_SETTINGS });
  t.after(() => server.close());
  const owner = await signup(server, 'anyone');
  const status = await fetch(`${server.baseUrl}/api/integrations/google`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(status.status, 200);
  assert.equal((await readJson<{ connected: boolean }>(status)).connected, false);
  assert.equal((await fetch(`${server.baseUrl}/api/integrations/google`)).status, 401);
});

test('без клиента Google (нет GOOGLE_SHEETS_CLIENT_ID / _SECRET) — по-прежнему 503 и нет карточки', async (t) => {
  const server = await startTestServer({}, { googleSettings: () => null });
  t.after(() => server.close());
  const owner = await signup(server, 'no-client');
  const response = await fetch(`${server.baseUrl}/api/integrations/google`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(response.status, 503);
  assert.equal(
    (await readJson<{ error: { code: string } }>(response)).error.code,
    'feature_unavailable',
  );
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

test('путь по аккаунту сохранён: переключатель закрыт — только аккаунты из списка, 503 и на колбэке', async (t) => {
  setProductSwitchForTests('googleSheets', false);
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
    setProductSwitchForTests('googleSheets', true);
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
