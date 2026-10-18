import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson, startTestServer } from '../testing/server.js';
import { signupAndVerify, signupCodeFor } from '../testing/signup.js';
import type { AuthSession, User } from '../types.js';

interface SignupStart {
  status: string;
  signupId: string;
  email: string;
  codeExpiresAt: string;
  resendAfterSec: number;
}

const postJson = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('auth: регистрация с подтверждением почты кодом', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = (path: string) => `${server.baseUrl}/api/auth${path}`;

  // 1. Ошибки формы
  assert.equal(
    (await postJson(api('/signup'), { email: 'not-an-email', password: 'password123' })).status,
    400,
  );
  assert.equal(
    (await postJson(api('/signup'), { email: 'test@example.com', password: 'short' })).status,
    400,
  );

  // 2. Форма не создаёт аккаунт: на почту уходит код, браузер получает signupId
  const start = await postJson(api('/signup'), {
    email: 'Ivan@Example.com',
    password: 'strongPassword123',
    name: 'Иван Тестов',
  });
  assert.equal(start.status, 202);
  const pending = await readJson<SignupStart>(start);
  assert.equal(pending.status, 'verification_required');
  assert.equal(pending.email, 'ivan@example.com');
  assert.ok(pending.signupId.length >= 20);
  assert.equal(server.signupMails.length, 1);
  assert.equal(server.signupMails[0]!.to, 'ivan@example.com');
  assert.doesNotMatch(server.signupMails[0]!.text, /Иван/, 'Имя из формы в письмо не попадает');
  const code = signupCodeFor(server.baseUrl, 'ivan@example.com');
  assert.ok(!JSON.stringify(pending).includes(code), 'Код не отдаётся в ответе');

  const notYet = await postJson(api('/login'), {
    email: 'ivan@example.com',
    password: 'strongPassword123',
  });
  assert.equal(notYet.status, 401, 'До подтверждения аккаунта нет');

  // 3. Неверный код и чужой signupId не подходят
  const wrongDigit = code === '000000' ? '111111' : '000000';
  const wrong = await postJson(api('/signup/verify'), {
    signupId: pending.signupId,
    code: wrongDigit,
  });
  assert.equal(wrong.status, 400);
  assert.equal((await readJson<{ error: { code: string } }>(wrong)).error.code, 'invalid_code');
  const foreign = await postJson(api('/signup/verify'), { signupId: 'someone-else', code });
  assert.equal(foreign.status, 410);

  // 4. Повторная отправка — не раньше чем через минуту
  const early = await postJson(api('/signup/resend'), { signupId: pending.signupId });
  assert.equal(early.status, 429);
  assert.ok(Number(early.headers.get('retry-after')) > 0);

  // 5. Верный код создаёт аккаунт и сессию
  const verified = await postJson(api('/signup/verify'), { signupId: pending.signupId, code });
  assert.equal(verified.status, 201);
  const data = await readJson<AuthSession>(verified);
  assert.equal(data.user.email, 'ivan@example.com');
  assert.equal(data.user.name, 'Иван Тестов');
  assert.equal(data.user.plan, 'free');
  assert.ok(data.token.split('.').length === 3, 'Токен должен быть JWT из трёх частей');
  assert.ok(data.expiresAt, 'Должно быть поле expiresAt');

  // Код одноразовый, вход по паролю работает
  const reused = await postJson(api('/signup/verify'), { signupId: pending.signupId, code });
  assert.equal(reused.status, 410);
  const login = await postJson(api('/login'), {
    email: 'ivan@example.com',
    password: 'strongPassword123',
  });
  assert.equal(login.status, 200);

  // 6. Повторная регистрация с тем же email
  const duplicate = await postJson(api('/signup'), {
    email: 'ivan@example.com',
    password: 'anotherPassword123',
  });
  assert.equal(duplicate.status, 409);
});

test('auth: код регистрации сгорает после 5 неверных попыток, новый код работает', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = (path: string) => `${server.baseUrl}/api/auth${path}`;

  const start = await postJson(api('/signup'), {
    email: 'brute@example.com',
    password: 'password123',
  });
  const { signupId } = await readJson<SignupStart>(start);
  const code = signupCodeFor(server.baseUrl, 'brute@example.com');
  const wrong = code === '000000' ? '111111' : '000000';

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await postJson(api('/signup/verify'), { signupId, code: wrong });
    assert.equal((await readJson<{ error: { code: string } }>(res)).error.code, 'invalid_code');
  }
  const last = await postJson(api('/signup/verify'), { signupId, code: wrong });
  assert.equal(
    (await readJson<{ error: { code: string } }>(last)).error.code,
    'code_attempts_exceeded',
  );
  // Даже верный прежний код больше не подходит
  const burned = await postJson(api('/signup/verify'), { signupId, code });
  assert.equal(
    (await readJson<{ error: { code: string } }>(burned)).error.code,
    'code_attempts_exceeded',
  );
});

test('auth: заявка с чужой почтой не перехватывает регистрацию владельца', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = (path: string) => `${server.baseUrl}/api/auth${path}`;

  // Посторонний отправляет форму с почтой владельца и своим паролем
  const attacker = await postJson(api('/signup'), {
    email: 'owner@example.com',
    password: 'attackerPassword1',
  });
  const attackerSignup = await readJson<SignupStart>(attacker);

  // Владелец регистрируется сам; его код к заявке постороннего не подходит
  const owner = await postJson(api('/signup'), {
    email: 'owner@example.com',
    password: 'ownerPassword123',
  });
  const ownerSignup = await readJson<SignupStart>(owner);
  const ownerCode = signupCodeFor(server.baseUrl, 'owner@example.com');
  const hijack = await postJson(api('/signup/verify'), {
    signupId: attackerSignup.signupId,
    code: ownerCode,
  });
  assert.equal(hijack.status, 400);

  const verified = await postJson(api('/signup/verify'), {
    signupId: ownerSignup.signupId,
    code: ownerCode,
  });
  assert.equal(verified.status, 201);
  const attackerLogin = await postJson(api('/login'), {
    email: 'owner@example.com',
    password: 'attackerPassword1',
  });
  assert.equal(attackerLogin.status, 401);
});

test('auth: без настроенной почты регистрация честно недоступна', async (t) => {
  const server = await startTestServer(
    {},
    {
      mailer: {
        kind: 'none',
        async send() {
          throw new Error('SMTP не настроен');
        },
      },
    },
  );
  t.after(() => server.close());

  const res = await postJson(`${server.baseUrl}/api/auth/signup`, {
    email: 'nomail@example.com',
    password: 'password123',
  });
  assert.equal(res.status, 503);
  assert.equal((await readJson<{ error: { code: string } }>(res)).error.code, 'mail_unavailable');
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

  // Второй вход (другое устройство) в ту же секунду получает свой токен.
  const otherLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@ketner.ai', password: 'password123' }),
  });
  const { token: otherToken } = await readJson<AuthSession>(otherLogin);
  assert.notEqual(otherToken, token);

  // 3. Logout возвращает 204
  const logoutRes = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(logoutRes.status, 204);

  // 4. Токен после выхода отозван на сервере: его копия больше не открывает аккаунт.
  const afterLogout = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(afterLogout.status, 401);
  assert.equal(afterLogout.headers.get('x-session-invalid'), '1');

  // 5. Токен другого устройства продолжает работать.
  const otherMe = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(otherMe.status, 200);
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
  const regRes = await signupAndVerify(server.baseUrl, {
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

test('auth: регистрация напрямую в Better Auth закрыта, вход и сессия работают', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Регистрация в обход сайта (/api/auth/sign-up/email) закрыта: она позволяла завести запись
  //    Better Auth с чужой почтой и войти в чужой аккаунт.
  const signUpRes = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({
      email: 'better-auth-user@example.com',
      password: 'password123',
      name: 'Better Auth User',
    }),
  });
  assert.equal(signUpRes.status, 404);

  // 2. Регистрация через сайт создаёт и запись Better Auth с тем же паролем.
  const siteSignup = await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'better-auth-user@example.com',
      password: 'password123',
      name: 'Better Auth User',
    }),
  });
  assert.equal(siteSignup.status, 201);

  // 3. Вход в Better Auth (cookie) и сессия.
  const signInRes = await fetch(`${server.baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({ email: 'better-auth-user@example.com', password: 'password123' }),
  });
  assert.equal(signInRes.status, 200);
  const setCookie = signInRes.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('better-auth.session_token'));

  const sessionRes = await fetch(`${server.baseUrl}/api/auth/get-session`, {
    headers: { Origin: server.baseUrl, Cookie: setCookie },
  });
  assert.equal(sessionRes.status, 200);
  const sessionData = await readJson<{ user: { email: string } }>(sessionRes);
  assert.equal(sessionData.user.email, 'better-auth-user@example.com');

  // 4. Cookie-сессия открывает тот же аккаунт сайта (запись создана вместе с ним).
  const me = await fetch(`${server.baseUrl}/api/auth/me`, { headers: { Cookie: setCookie } });
  assert.equal(me.status, 200);
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
  const signup = await signupAndVerify(server.baseUrl, {
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

  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
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

  // Аккаунт A: регистрация на сайте и вход через Better Auth, в браузере остаётся его cookie.
  await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'cookie-user@example.com',
      password: 'password123',
      name: 'Cookie User',
    }),
  });
  const signInA = await fetch(`${server.baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({ email: 'cookie-user@example.com', password: 'password123' }),
  });
  const cookieA = signInA.headers.get('set-cookie') ?? '';
  assert.ok(cookieA.includes('better-auth.session_token'));

  // Аккаунт B: вход по паролю, клиент хранит его Bearer-токен.
  const signUpB = await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'bearer-user@example.com',
      password: 'password123',
      name: 'Bearer User',
    }),
  });
  const sessionB = await readJson<AuthSession>(signUpB);

  const me = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Origin: server.baseUrl, Cookie: cookieA, Authorization: `Bearer ${sessionB.token}` },
  });
  assert.equal(me.status, 200);
  assert.equal((await readJson<{ user: User }>(me)).user.email, 'bearer-user@example.com');

  // Без Bearer-токена работает cookie-сессия, а не гость.
  const cookieOnly = await fetch(`${server.baseUrl}/api/auth/me`, {
    headers: { Origin: server.baseUrl, Cookie: cookieA },
  });
  assert.equal((await readJson<{ user: User }>(cookieOnly)).user.email, 'cookie-user@example.com');
});
