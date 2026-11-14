import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PRODUCT_SWITCHES,
  productSwitch,
  setProductSwitchForTests,
  type ProductFeature,
} from './product-switches.js';
import { readJson, startTestServer, type ApiErrorBody } from './testing/server.js';
import { signupAndVerify } from './testing/signup.js';
import type { AuthSession } from './types.js';

test('решения владельца 14.11.2026: звёзды, чат, Code, картинки, API, проверка и сравнение закрыты', () => {
  assert.deepEqual(PRODUCT_SWITCHES, {
    stars: false,
    chat: false,
    code: false,
    images: false,
    developerApi: false,
    answerReview: false,
    modelCompare: false,
  });
});

test('сайт держит те же переключатели, что и сервер', () => {
  const web = readFileSync(
    new URL('../../web/src/lib/product-switches.ts', import.meta.url),
    'utf8',
  );
  const constants = (source: string) =>
    Object.fromEntries(
      [...source.matchAll(/^export const ([A-Z_]+_ENABLED) = (true|false);$/gm)].map((m) => [
        m[1],
        m[2],
      ]),
    );
  const server = readFileSync(new URL('./product-switches.ts', import.meta.url), 'utf8');
  assert.equal(Object.keys(constants(server)).length, Object.keys(PRODUCT_SWITCHES).length);
  assert.deepEqual(constants(web), constants(server));
});

test('переключатель для тестов не работает в production', (t) => {
  const previous = process.env.NODE_ENV;
  t.after(() => {
    process.env.NODE_ENV = previous;
  });
  process.env.NODE_ENV = 'production';
  assert.throws(() => setProductSwitchForTests('chat', true), /production/);
  assert.equal(productSwitch('chat'), false);
});

/** Закрытые адреса: сервер отказывает 503 `feature_unavailable` до входа и до обработчика. */
const CLOSED: ReadonlyArray<readonly [string, string, ProductFeature]> = [
  ['POST', '/api/chat/completions', 'chat'],
  ['POST', '/api/chat/feedback', 'chat'],
  ['GET', '/api/conversations', 'chat'],
  ['POST', '/api/conversations', 'chat'],
  ['DELETE', '/api/conversations/c1', 'chat'],
  ['POST', '/api/chat/compare', 'modelCompare'],
  ['GET', '/api/chat/compare/stats', 'modelCompare'],
  ['POST', '/api/chat/review', 'answerReview'],
  ['GET', '/api/code/projects', 'code'],
  ['POST', '/api/code/projects', 'code'],
  ['GET', '/api/images', 'images'],
  ['POST', '/api/images/generate', 'images'],
  ['GET', '/api/images/capabilities', 'images'],
  ['POST', '/api/keys', 'developerApi'],
  ['GET', '/v1/models', 'developerApi'],
  ['POST', '/v1/chat/completions', 'developerApi'],
  ['GET', '/v1/usage', 'developerApi'],
  ['POST', '/api/billing/telegram-stars/create-invoice', 'stars'],
  ['POST', '/api/telegram/miniapp/invoice', 'stars'],
];

test('закрытые возможности: 503 feature_unavailable и гостю, и вошедшему', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const session = await readJson<AuthSession>(
    await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `switch-${Date.now()}@example.com`,
        password: 'password123',
        name: 'Switch',
      }),
    }),
  );
  for (const auth of [{}, { Authorization: `Bearer ${session.token}` }]) {
    for (const [method, path, feature] of CLOSED) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...auth },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
      });
      const label = `${method} ${path}${'Authorization' in auth ? ' (вошёл)' : ''}`;
      assert.equal(response.status, 503, label);
      const body = await readJson<ApiErrorBody & { error: { details: { feature: string } } }>(
        response,
      );
      assert.equal(body.error.code, 'feature_unavailable', label);
      assert.equal(body.error.details.feature, feature, label);
      assert.ok(body.error.message.length > 0, label);
    }
  }

  // Список своих ключей и их отзыв остаются: выпустить новый нельзя, а отозвать прежний — можно.
  const keys = await fetch(`${server.baseUrl}/api/keys`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  assert.equal(keys.status, 200);
});

test('картинки закрыты, но готовые файлы отдаются и удаляются: их показывает чат помощника', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  for (const [method, path] of [
    ['GET', '/api/images/missing/file'],
    ['DELETE', '/api/images/missing'],
  ] as const) {
    const response = await fetch(`${server.baseUrl}${path}`, { method });
    assert.notEqual(response.status, 503, `${method} ${path}`);
    const body = await readJson<ApiErrorBody>(response);
    assert.notEqual(body.error.code, 'feature_unavailable', `${method} ${path}`);
  }
});

test('платформа решений не закрыта: анализ, решения, опубликованные боты, виджет и выход в Telegram', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  for (const [method, path] of [
    ['GET', '/api/analyses'],
    ['POST', '/api/analyses'],
    ['GET', '/api/solutions'],
    ['GET', '/api/b/some-bot'],
    ['POST', '/api/b/some-bot/messages'],
    ['POST', '/api/b/some-bot/leads'],
    ['GET', '/api/credits'],
    ['GET', '/api/billing/history'],
  ] as const) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    if (response.status !== 503) continue;
    const body = await readJson<ApiErrorBody>(response);
    assert.notEqual(body.error.code, 'feature_unavailable', `${method} ${path}`);
  }
});
