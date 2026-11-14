import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson, startTestServer } from '../testing/server.js';
import { codeFor, loginAndVerify, signupAndVerify } from '../testing/signup.js';
import type { AuthSession, User } from '../types.js';
import { setProductSwitchForTests } from '../product-switches.js';

// Закрытые возможности (product-switches.ts): здесь проверяется их спящий код.
setProductSwitchForTests('chat', true);

interface CodeChallenge {
  status: string;
  challengeId: string;
  maskedEmail: string;
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
  const pending = await readJson<CodeChallenge>(start);
  assert.equal(pending.status, 'verification_required');
  assert.equal(pending.maskedEmail, 'i***n@example.com', 'Почта на экране замаскирована');
  assert.ok(pending.challengeId.length >= 20);
  assert.equal(server.codeMails.length, 1);
  assert.equal(server.codeMails[0]!.to, 'ivan@example.com');
  assert.doesNotMatch(server.codeMails[0]!.text, /Иван/, 'Имя из формы в письмо не попадает');
  const code = codeFor(server.baseUrl, 'ivan@example.com');
  assert.ok(!JSON.stringify(pending).includes(code), 'Код не отдаётся в ответе');

  const notYet = await postJson(api('/login'), {
    email: 'ivan@example.com',
    password: 'strongPassword123',
  });
  assert.equal(notYet.status, 401, 'До подтверждения аккаунта нет');

  // 3. Неверный код и чужой signupId не подходят
  const wrongDigit = code === '000000' ? '111111' : '000000';
  const wrong = await postJson(api('/signup/verify'), {
    challengeId: pending.challengeId,
    code: wrongDigit,
  });
  assert.equal(wrong.status, 400);
  assert.equal((await readJson<{ error: { code: string } }>(wrong)).error.code, 'invalid_code');
  const foreign = await postJson(api('/signup/verify'), { challengeId: 'someone-else', code });
  assert.equal(foreign.status, 410);

  // 4. Повторная отправка — не раньше чем через минуту
  const early = await postJson(api('/signup/resend'), { challengeId: pending.challengeId });
  assert.equal(early.status, 429);
  assert.ok(Number(early.headers.get('retry-after')) > 0);

  // 5. Верный код создаёт аккаунт и сессию
  const verified = await postJson(api('/signup/verify'), {
    challengeId: pending.challengeId,
    code,
  });
  assert.equal(verified.status, 201);
  const data = await readJson<AuthSession>(verified);
  assert.equal(data.user.email, 'ivan@example.com');
  assert.equal(data.user.name, 'Иван Тестов');
  assert.equal(data.user.plan, 'free');
  assert.ok(data.token.split('.').length === 3, 'Токен должен быть JWT из трёх частей');
  assert.ok(data.expiresAt, 'Должно быть поле expiresAt');

  // Код одноразовый, вход по паролю работает
  const reused = await postJson(api('/signup/verify'), { challengeId: pending.challengeId, code });
  assert.equal(reused.status, 410);
  const login = await postJson(api('/login'), {
    email: 'ivan@example.com',
    password: 'strongPassword123',
  });
  assert.equal(login.status, 202, 'Пароль верный — дальше код на почту');

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
  const { challengeId } = await readJson<CodeChallenge>(start);
  const code = codeFor(server.baseUrl, 'brute@example.com');
  const wrong = code === '000000' ? '111111' : '000000';

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await postJson(api('/signup/verify'), { challengeId, code: wrong });
    assert.equal((await readJson<{ error: { code: string } }>(res)).error.code, 'invalid_code');
  }
  const last = await postJson(api('/signup/verify'), { challengeId, code: wrong });
  assert.equal(
    (await readJson<{ error: { code: string } }>(last)).error.code,
    'code_attempts_exceeded',
  );
  // Даже верный прежний код больше не подходит
  const burned = await postJson(api('/signup/verify'), { challengeId, code });
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
  const attackerSignup = await readJson<CodeChallenge>(attacker);

  // Владелец регистрируется сам; его код к заявке постороннего не подходит
  const owner = await postJson(api('/signup'), {
    email: 'owner@example.com',
    password: 'ownerPassword123',
  });
  const ownerSignup = await readJson<CodeChallenge>(owner);
  const ownerCode = codeFor(server.baseUrl, 'owner@example.com');
  const hijack = await postJson(api('/signup/verify'), {
    challengeId: attackerSignup.challengeId,
    code: ownerCode,
  });
  assert.equal(hijack.status, 400);

  const verified = await postJson(api('/signup/verify'), {
    challengeId: ownerSignup.challengeId,
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

test('auth: вход — пароль, затем код из письма', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = (path: string) => `${server.baseUrl}/api/auth${path}`;

  // 1. Неверный пароль и несуществующая почта — 401, письма нет
  const wrongPass = await postJson(api('/login'), {
    email: 'demo@ketner.ai',
    password: 'wrongPassword',
  });
  assert.equal(wrongPass.status, 401);
  const wrongEmail = await postJson(api('/login'), {
    email: 'nonexistent@example.com',
    password: 'password123',
  });
  assert.equal(wrongEmail.status, 401);
  assert.equal(server.codeMails.length, 0);

  // 2. Верный пароль: сессии ещё нет, код ушёл на почту
  const start = await postJson(api('/login'), {
    email: 'Demo@Ketner.ai',
    password: 'password123',
  });
  assert.equal(start.status, 202);
  const challenge = await readJson<CodeChallenge & { token?: string }>(start);
  assert.equal(challenge.token, undefined);
  assert.equal(challenge.maskedEmail, 'd***o@ketner.ai');
  assert.equal(start.headers.get('set-cookie'), null);
  assert.equal(server.codeMails.at(-1)!.to, 'demo@ketner.ai');
  assert.match(server.codeMails.at(-1)!.subject, /код входа/);
  const code = codeFor(server.baseUrl, 'demo@ketner.ai');

  // 3. Неверный код не входит; верный выдаёт токен и cookie-сессию
  const wrong = await postJson(api('/login/verify'), {
    challengeId: challenge.challengeId,
    code: code === '000000' ? '111111' : '000000',
  });
  assert.equal(wrong.status, 400);
  const verified = await postJson(api('/login/verify'), {
    challengeId: challenge.challengeId,
    code,
  });
  assert.equal(verified.status, 200);
  const session = await readJson<AuthSession>(verified);
  assert.equal(session.user.email, 'demo@ketner.ai');
  assert.equal(session.user.name, 'Ketner Demo');
  assert.match(verified.headers.get('set-cookie') ?? '', /better-auth\.session_token=/);

  // Код одноразовый
  const reused = await postJson(api('/login/verify'), {
    challengeId: challenge.challengeId,
    code,
  });
  assert.equal(reused.status, 410);

  // 4. Повторная отправка кода входа — не раньше чем через минуту
  const again = await readJson<CodeChallenge>(
    await postJson(api('/login'), { email: 'demo@ketner.ai', password: 'password123' }),
  );
  const early = await postJson(api('/login/resend'), { challengeId: again.challengeId });
  assert.equal(early.status, 429);
});

test('auth: восстановление пароля — код из письма, новый пароль, прежние сессии завершены', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = (path: string) => `${server.baseUrl}/api/auth${path}`;
  const me = (headers: Record<string, string>) => fetch(api('/me'), { headers });

  const signup = await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'oldPassword123' }),
  });
  const oldSession = await readJson<AuthSession>(signup);
  const oldCookie = (signup.headers.get('set-cookie') ?? '').split(';')[0]!;
  assert.equal((await me({ Cookie: oldCookie })).status, 200);

  // 1. Почта → код на почту; сессии нет, код в ответ не попадает
  assert.equal((await postJson(api('/password-reset'), { email: 'not-an-email' })).status, 400);
  const start = await postJson(api('/password-reset'), { email: 'Owner@Example.com' });
  assert.equal(start.status, 202);
  const challenge = await readJson<CodeChallenge>(start);
  assert.equal(challenge.maskedEmail, 'o***r@example.com');
  assert.equal(server.codeMails.at(-1)!.to, 'owner@example.com');
  assert.match(server.codeMails.at(-1)!.subject, /код сброса пароля/);
  const code = codeFor(server.baseUrl, 'owner@example.com');
  assert.ok(!JSON.stringify(challenge).includes(code));

  // 2. Неверный код не подходит, новый код — не раньше чем через минуту
  const wrong = await postJson(api('/password-reset/verify'), {
    challengeId: challenge.challengeId,
    code: code === '000000' ? '111111' : '000000',
  });
  assert.equal((await readJson<{ error: { code: string } }>(wrong)).error.code, 'invalid_code');
  const early = await postJson(api('/password-reset/resend'), {
    challengeId: challenge.challengeId,
  });
  assert.equal(early.status, 429);

  // 3. Верный код — одноразовый токен для нового пароля, но ещё не вход
  const verified = await postJson(api('/password-reset/verify'), {
    challengeId: challenge.challengeId,
    code,
  });
  assert.equal(verified.status, 200);
  const grant = await readJson<{ resetToken: string; token?: string }>(verified);
  assert.ok(grant.resetToken.length >= 20);
  assert.equal(grant.token, undefined);
  const reused = await postJson(api('/password-reset/verify'), {
    challengeId: challenge.challengeId,
    code,
  });
  assert.equal(reused.status, 410);

  // 4. Слабый пароль не принимается и токен не расходует; чужой токен не подходит
  const weak = await postJson(api('/password-reset/complete'), {
    resetToken: grant.resetToken,
    password: 'short',
  });
  assert.equal((await readJson<{ error: { code: string } }>(weak)).error.code, 'weak_password');
  const forged = await postJson(api('/password-reset/complete'), {
    resetToken: 'forged-token',
    password: 'newPassword456',
  });
  assert.equal(forged.status, 410);

  // 5. Новый пароль: вход открыт, прежние токен и cookie-сессия больше не действуют
  const done = await postJson(api('/password-reset/complete'), {
    resetToken: grant.resetToken,
    password: 'newPassword456',
  });
  assert.equal(done.status, 200);
  const session = await readJson<AuthSession>(done);
  assert.equal(session.user.email, 'owner@example.com');
  assert.match(done.headers.get('set-cookie') ?? '', /better-auth\.session_token=/);
  assert.equal((await me({ Authorization: `Bearer ${session.token}` })).status, 200);
  const oldToken = await me({ Authorization: `Bearer ${oldSession.token}` });
  assert.equal(oldToken.status, 401);
  assert.equal(oldToken.headers.get('x-session-invalid'), '1');
  assert.equal((await me({ Cookie: oldCookie })).status, 401);

  const again = await postJson(api('/password-reset/complete'), {
    resetToken: grant.resetToken,
    password: 'anotherPassword789',
  });
  assert.equal(again.status, 410, 'Токен сброса одноразовый');

  const oldLogin = await postJson(api('/login'), {
    email: 'owner@example.com',
    password: 'oldPassword123',
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await loginAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'newPassword456' }),
  });
  assert.equal(newLogin.status, 200);
});

test('auth: сброс пароля не показывает, есть ли аккаунт с этой почтой', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = (path: string) => `${server.baseUrl}/api/auth${path}`;

  for (const email of ['nobody@example.com', 'tg-123@telegram.invalid']) {
    const start = await postJson(api('/password-reset'), { email });
    assert.equal(start.status, 202, 'Ответ такой же, как для существующего аккаунта');
    const challenge = await readJson<CodeChallenge>(start);
    assert.equal(challenge.status, 'verification_required');
    assert.ok(challenge.challengeId.length >= 20);

    const verify = await postJson(api('/password-reset/verify'), {
      challengeId: challenge.challengeId,
      code: '123456',
    });
    assert.equal((await readJson<{ error: { code: string } }>(verify)).error.code, 'invalid_code');
  }
  assert.equal(server.codeMails.length, 0, 'Письма на чужую почту не уходят');
});

test('auth: запросы сброса пароля на чужую почту не блокируют владельцу вход', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const api = (path: string) => `${server.baseUrl}/api/auth${path}`;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await postJson(api('/password-reset'), { email: 'demo@ketner.ai' });
    assert.equal(res.status, 202);
  }
  const limited = await postJson(api('/password-reset'), { email: 'demo@ketner.ai' });
  assert.equal(limited.status, 429);

  // У входа свой лимит писем: владелец по-прежнему получает код
  const login = await postJson(api('/login'), {
    email: 'demo@ketner.ai',
    password: 'password123',
  });
  assert.equal(login.status, 202);
  assert.match(server.codeMails.at(-1)!.subject, /код входа/);
});

test('auth: профиль текущего пользователя GET /api/auth/me и выход', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  // 1. Без токена возвращается 401
  const unauth = await fetch(`${server.baseUrl}/api/auth/me`);
  assert.equal(unauth.status, 401);

  // 2. С валидным токеном возвращается профиль
  const loginRes = await loginAndVerify(server.baseUrl, {
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
  const otherLogin = await loginAndVerify(server.baseUrl, {
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

  // 3. Вход по паролю напрямую в Better Auth закрыт (обходил бы код), cookie-сессию ставит сайт
  //    после подтверждения кодом.
  const signInRes = await fetch(`${server.baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: server.baseUrl },
    body: JSON.stringify({ email: 'better-auth-user@example.com', password: 'password123' }),
  });
  assert.equal(signInRes.status, 404);
  const setCookie = (siteSignup.headers.get('set-cookie') ?? '').split(';')[0]!;
  assert.ok(setCookie.includes('better-auth.session_token'));

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
  const login = await loginAndVerify(server.baseUrl, {
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

  // Аккаунт A: регистрация на сайте, в браузере остаётся его cookie-сессия Better Auth.
  const signUpA = await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'cookie-user@example.com',
      password: 'password123',
      name: 'Cookie User',
    }),
  });
  const cookieA = (signUpA.headers.get('set-cookie') ?? '').split(';')[0]!;
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
