import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson, startTestServer } from '../testing/server.js';
import type { AuthSession, User } from '../types.js';

test('auth: регистрация пользователя', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Ошибка при невалидном email
  const invalidEmail = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'password123' }),
  });
  assert.equal(invalidEmail.status, 400);

  // 2. Ошибка при слишком коротком пароле
  const shortPass = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'short' }),
  });
  assert.equal(shortPass.status, 400);

  // 3. Успешная регистрация
  const success = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ivan@example.com',
      password: 'strongPassword123',
      name: 'Иван Тестов',
    }),
  });
  assert.equal(success.status, 201);
  const data = await readJson<AuthSession>(success);
  assert.equal(data.user.email, 'ivan@example.com');
  assert.equal(data.user.name, 'Иван Тестов');
  assert.equal(data.user.plan, 'free');
  assert.ok(data.token.split('.').length === 3, 'Токен должен быть JWT из трёх частей');
  assert.ok(data.expiresAt, 'Должно быть поле expiresAt');

  // 4. Повторная регистрация с тем же email
  const duplicate = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ivan@example.com', password: 'anotherPassword123' }),
  });
  assert.equal(duplicate.status, 409);
});

test('auth: вход по логину и паролю', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Вход под дефолтным демо-пользователем
  const demoLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@ketner.ai', password: 'password123' }),
  });
  assert.equal(demoLogin.status, 200);
  const demoData = await readJson<AuthSession>(demoLogin);
  assert.equal(demoData.user.email, 'demo@ketner.ai');
  assert.equal(demoData.user.name, 'Ketner Demo');

  // 2. Вход с неверным паролем
  const wrongPass = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@ketner.ai', password: 'wrongPassword' }),
  });
  assert.equal(wrongPass.status, 401);

  // 3. Вход с несуществующим email
  const wrongEmail = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nonexistent@example.com', password: 'password123' }),
  });
  assert.equal(wrongEmail.status, 401);
});

test('auth: профиль текущего пользователя GET /api/auth/me и выход', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Без токена возвращается 401
  const unauth = await fetch(`${server.baseUrl}/api/auth/me`);
  assert.equal(unauth.status, 401);

  // 2. С валидным токеном возвращается профиль
  const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@ketner.ai', password: 'password123' }),
  });
  const { token } = await readJson<AuthSession>(loginRes);

  const meRes = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meRes.status, 200);
  const meData = await readJson<{ user: User }>(meRes);
  assert.equal(meData.user.email, 'demo@ketner.ai');

  // 3. Logout возвращает 204
  const logoutRes = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(logoutRes.status, 204);
});

test('auth: эмуляция OAuth', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const googleRes = await fetch(`${server.baseUrl}/api/auth/oauth/google`);
  assert.equal(googleRes.status, 200);
  const googleData = await readJson<AuthSession & { provider: string }>(googleRes);
  assert.equal(googleData.provider, 'google');
  assert.ok(googleData.user.email.includes('google'));

  const badProvider = await fetch(`${server.baseUrl}/api/auth/oauth/unsupported`);
  assert.equal(badProvider.status, 400);
});

test('auth: привязка диалогов к авторизованному пользователю', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // Регистрация нового пользователя
  const regRes = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@example.com', password: 'alicePassword123' }),
  });
  const { token } = await readJson<AuthSession>(regRes);

  // Создание диалога от лица Alice
  const createRes = await fetch(`${server.baseUrl}/api/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: 'Диалог Алисы' }),
  });
  assert.equal(createRes.status, 201);

  // Список диалогов Алисы содержит созданный диалог
  const aliceListRes = await fetch(`${server.baseUrl}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const aliceList = await readJson<{ conversations: { title: string }[] }>(aliceListRes);
  assert.equal(aliceList.conversations.length, 1);
  assert.equal(aliceList.conversations[0]?.title, 'Диалог Алисы');

  // Список диалогов гостя/демо пуст
  const guestListRes = await fetch(`${server.baseUrl}/api/conversations`);
  const guestList = await readJson<{ conversations: unknown[] }>(guestListRes);
  assert.equal(guestList.conversations.length, 0);
});

test('auth: Better Auth нативные эндпоинты регистрации и сессии', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Регистрация через Better Auth /api/auth/sign-up/email
  const signUpRes = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: server.baseUrl,
    },
    body: JSON.stringify({
      email: 'better-auth-user@example.com',
      password: 'password123',
      name: 'Better Auth User',
    }),
  });
  assert.equal(signUpRes.status, 200);
  const signUpData = await readJson<{ user: { email: string; name: string; plan: string } }>(
    signUpRes,
  );
  assert.equal(signUpData.user.email, 'better-auth-user@example.com');
  assert.equal(signUpData.user.name, 'Better Auth User');
  assert.equal(signUpData.user.plan, 'free');

  // Cookie better-auth.session_token возвращается в заголовках
  const setCookie = signUpRes.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('better-auth.session_token'));

  // 2. Получение сессии через /api/auth/get-session с cookie
  const sessionRes = await fetch(`${server.baseUrl}/api/auth/get-session`, {
    headers: {
      Origin: server.baseUrl,
      Cookie: setCookie,
    },
  });
  assert.equal(sessionRes.status, 200);
  const sessionData = await readJson<{ user: { email: string } }>(sessionRes);
  assert.equal(sessionData.user.email, 'better-auth-user@example.com');
});

test('auth (C2): заголовки X-User-* не определяют личность и не повышают тариф', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Без токена и сессии заголовки не дают доступа (в том числе от имени админа)
  const spoofedAdmin = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: {
      'X-User-Email': 'test-admin@example.com',
      'X-User-Id': 'admin-artem-user',
      'X-User-Plan': 'ultra',
    },
  });
  assert.equal(spoofedAdmin.status, 401);

  // 2. Заголовок с email существующего пользователя тоже не работает
  const spoofedDemo = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { 'X-User-Email': 'demo@ketner.ai' },
  });
  assert.equal(spoofedDemo.status, 401);

  // 3. Админский API недоступен по спуфингу заголовков
  const spoofedAdminApi = await fetch(`${server.baseUrl}/api/admin/models`, {
    headers: { 'X-User-Email': 'test-admin@example.com' },
  });
  assert.equal(spoofedAdminApi.status, 403);

  // 4. Реальный пользователь с free-тарифом не получает ultra через X-User-Plan
  const signup = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'c2-free@example.com', password: 'strongPassword123' }),
  });
  const { token } = await readJson<AuthSession>(signup);
  const me = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}`, 'X-User-Plan': 'ultra' },
  });
  assert.equal(me.status, 200);
  const meData = await readJson<{ user: User }>(me);
  assert.equal(meData.user.plan, 'free');
});

test('auth (C3): токены с поддельной подписью отклоняются', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: 'demo-user', exp: Math.floor(Date.now() / 1000) + 3600 });

  const forgedTokens = [
    `${header}.${payload}.mock_anything`, // бывший обход: префикс mock_
    `${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`, // alg=none
    `${header}.${payload}.invalidsignature`,
  ];

  for (const forged of forgedTokens) {
    const res = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${forged}` },
    });
    assert.equal(res.status, 401, `Поддельный токен не должен приниматься: ${forged.slice(-20)}`);
  }

  // Настоящий токен с подменённым payload (другой sub) тоже отклоняется
  const login = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@ketner.ai', password: 'password123' }),
  });
  const { token } = await readJson<AuthSession>(login);
  const [realHeader, , realSignature] = token.split('.');
  const tampered = `${realHeader}.${b64({ sub: 'admin-artem-user', exp: 9999999999 })}.${realSignature}`;
  const tamperedRes = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${tampered}` },
  });
  assert.equal(tamperedRes.status, 401);
});

test('auth: Bearer-токен важнее оставшейся cookie-сессии другого аккаунта', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // Аккаунт A: вход через Better Auth, в браузере остаётся его cookie.
  const signUpA = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({ email: 'cookie-user@example.com', password: 'password123', name: 'Cookie User' }),
  });
  const cookieA = signUpA.headers.get('set-cookie') ?? '';
  assert.ok(cookieA.includes('better-auth.session_token'));

  // Аккаунт B: вход по паролю, клиент хранит его Bearer-токен.
  const signUpB = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bearer-user@example.com', password: 'password123', name: 'Bearer User' }),
  });
  const sessionB = await readJson<AuthSession>(signUpB);

  const me = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Origin: server.baseUrl, Cookie: cookieA, Authorization: `Bearer ${sessionB.token}` },
  });
  assert.equal(me.status, 200);
  assert.equal((await readJson<{ user: User }>(me)).user.email, 'bearer-user@example.com');

  // Без Bearer-токена работает cookie-сессия, а не гость.
  const cookieOnly = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Origin: server.baseUrl, Cookie: cookieA } });
  assert.equal((await readJson<{ user: User }>(cookieOnly)).user.email, 'cookie-user@example.com');
});
