/**
 * Регрессии аудита безопасности 2026-10-16: захват аккаунта через Better Auth, CORS, перебор паролей,
 * подмена чужих сообщений по id.
 */
import type { MailMessage } from './services/mailer.js';
import {
  codeFor,
  isCodeMail,
  loginAndVerify,
  rememberCodeMails,
  signupAndVerify,
} from './testing/signup.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBetterAuth, initAuthDatabase } from './auth/better-auth.js';
import { betterAuthSessionMayOpen } from './auth/better-auth-sync.js';
import { acceptsLargeBody, createApp } from './app.js';
import { createConversationStore } from './store/conversation-store.js';
import { createSubscriptionStore } from './store/subscription-store.js';
import { createUserStore, type UserStore } from './store/user-store.js';
import { UsageStore } from './store/usage-store.js';
import {
  isAllowedCorsOrigin,
  isPublicBetterAuthEndpoint,
  inlineScriptHashes,
} from './middleware/security.js';
import { RateLimiter } from './middleware/rate-limit.js';
import { setProductSwitchForTests } from './product-switches.js';

// Закрытые возможности (product-switches.ts): здесь проверяется их спящий код.
setProductSwitchForTests('chat', true);

const ORIGIN = 'http://localhost:9999';
let server: Server;
const codeMails: MailMessage[] = [];
let base = '';
let auth: ReturnType<typeof createBetterAuth>['auth'];
let userStore: UserStore;
const OLD = '2026-01-01T00:00:00.000Z';

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-sec-'));
  ({ auth } = createBetterAuth({ dbPath: join(dir, 'auth.sqlite'), baseURL: ORIGIN }));
  await initAuthDatabase(auth);
  // Аккаунты сайта, созданные давно и без записи в Better Auth (Telegram и «старые» по паролю).
  writeFileSync(
    join(dir, 'users.json'),
    JSON.stringify({
      users: [
        {
          id: 'victim-tg',
          email: 'tg-777000@telegram.invalid',
          name: 'Tg',
          plan: 'ultra',
          createdAt: OLD,
          salt: 'a'.repeat(32),
          passwordHash: 'x',
        },
        {
          id: 'victim-legacy',
          email: 'legacy@example.com',
          name: 'Legacy',
          plan: 'pro',
          createdAt: OLD,
          salt: 'b'.repeat(32),
          passwordHash: 'x',
        },
      ],
    }),
  );
  userStore = createUserStore(join(dir, 'users.json'));
  userStore.setPassword('legacy@example.com', 'victim-password-1');
  const app = createApp({
    store: createConversationStore(join(dir, 'c.json')),
    userStore,
    subscriptionStore: createSubscriptionStore(join(dir, 's.json')),
    usageStore: new UsageStore(join(dir, 'u.json')),
    betterAuth: auth,
    mailer: {
      kind: 'smtp',
      async send(message) {
        if (isCodeMail(message)) codeMails.push(message);
      },
    },
  });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  rememberCodeMails(base, codeMails);
});

after(() => {
  server.close();
});

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...extra },
  body: JSON.stringify(body),
});

/** Cookie-сессия Better Auth по паролю — так её получил бы тот, кто знает пароль записи. */
async function cookieSignIn(email: string, password: string): Promise<string | null> {
  try {
    const { headers } = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    return (headers.get('set-cookie') ?? '').split(';')[0] || null;
  } catch {
    return null;
  }
}

test('регистрация напрямую в Better Auth закрыта', async () => {
  const res = await fetch(
    `${base}/api/auth/sign-up/email`,
    json({ email: 'tg-777000@telegram.invalid', password: 'attacker-pass-123', name: 'x' }),
  );
  assert.equal(res.status, 404);
  for (const path of [
    // Вход по паролю напрямую в Better Auth обходил бы код из письма.
    '/api/auth/sign-in/email',
    '/api/auth/update-user',
    '/api/auth/change-email',
    '/api/auth/delete-user',
    '/api/auth/link-social',
  ]) {
    assert.equal((await fetch(`${base}${path}`, json({}))).status, 404, path);
  }
});

test('чужая запись Better Auth с той же почтой не открывает аккаунт сайта', async () => {
  // Запись, «заведённая злоумышленником» раньше (до закрытия регистрации).
  for (const email of ['tg-777000@telegram.invalid', 'legacy@example.com']) {
    await auth.api.signUpEmail({ body: { email, password: 'attacker-pass-123', name: 'evil' } });
    const cookie = await cookieSignIn(email, 'attacker-pass-123');
    assert.ok(cookie, 'Better Auth выдал cookie');
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 401, `${email}: сессия посторонней записи не должна открывать аккаунт`);
  }
});

test('вход по паролю без кода из письма сессию не даёт', async () => {
  const login = await fetch(
    `${base}/api/auth/login`,
    json({ email: 'legacy@example.com', password: 'victim-password-1' }),
  );
  assert.equal(login.status, 202);
  const body = (await login.json()) as Record<string, unknown>;
  assert.equal(body.token, undefined);
  assert.equal(login.headers.get('set-cookie'), null);
  assert.equal(body.maskedEmail, 'l***y@example.com');
  assert.ok(!JSON.stringify(body).includes(codeFor(base, 'legacy@example.com')));
});

test('вход владельца по паролю перезаписывает посторонний пароль Better Auth', async () => {
  const login = await loginAndVerify(
    base,
    json({ email: 'legacy@example.com', password: 'victim-password-1' }),
  );
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie') ?? '', /better-auth\.session_token=/);
  assert.equal(await cookieSignIn('legacy@example.com', 'attacker-pass-123'), null);
  assert.ok(await cookieSignIn('legacy@example.com', 'victim-password-1'));
});

test('пароль хранится в scrypt, старый хеш обновляется при входе', () => {
  const stored = userStore.getAllStoredUsers?.().find((u) => u.email === 'legacy@example.com');
  assert.ok(stored?.passwordHash.startsWith('scrypt$'));
  assert.ok(userStore.verifyPassword('legacy@example.com', 'victim-password-1'));
});

test('перебор пароля упирается в лимит по почте', async () => {
  let last = 0;
  for (let i = 0; i < 10; i += 1) {
    last = (
      await fetch(
        `${base}/api/auth/login`,
        json({ email: 'legacy@example.com', password: `wrong-${i}` }),
      )
    ).status;
  }
  assert.equal(last, 429);
});

test('CORS: чужой сайт не получает доступ к ответам с cookie', async () => {
  const evil = await fetch(`${base}/api/health`, {
    headers: { Origin: 'https://evil.example.com' },
  });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const tricky = await fetch(`${base}/api/health`, {
    headers: { Origin: 'https://ketner-ai.onrender.com.evil.net' },
  });
  assert.equal(tricky.headers.get('access-control-allow-origin'), null);
  assert.equal(isAllowedCorsOrigin('https://ketner.org', true), true);
  assert.equal(isAllowedCorsOrigin('http://localhost:4444', true), false);
});

test('заголовки безопасности и отсутствие X-Powered-By', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('битый JSON — 400 без внутренних подробностей', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  });
  assert.equal(res.status, 400);
});

test('большое тело принимают только маршруты, которым оно нужно', async () => {
  const big = JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(2 * 1024 * 1024) });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: big,
  });
  assert.equal(login.status, 413);
  assert.equal(
    ((await login.json()) as { error: { code: string } }).error.code,
    'payload_too_large',
  );

  // Ответ чата с вложениями проходит разбор тела (дальше его проверяет PayloadGuard).
  const chat = await fetch(`${base}/api/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filler: 'x'.repeat(2 * 1024 * 1024) }),
  });
  assert.notEqual(chat.status, 413);

  assert.equal(acceptsLargeBody('PUT', '/api/code/projects/abc12345/file'), true);
  assert.equal(acceptsLargeBody('POST', '/api/code/projects/abc12345/import'), true);
  assert.equal(acceptsLargeBody('POST', '/api/github/api/repos/o/r/git/blobs'), true);
  assert.equal(acceptsLargeBody('POST', '/api/contact'), false);
  assert.equal(acceptsLargeBody('POST', '/api/billing/cryptocloud/postback'), false);
  assert.equal(acceptsLargeBody('GET', '/api/chat/completions'), false);
});

test('id сообщения из чужого диалога не переиспользуется', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-conv-'));
  const store = createConversationStore(join(dir, 'c.json'));
  const a = store.create('alice', 'A');
  const b = store.create('bob', 'B');
  const savedA = store.saveTurn({
    userId: 'alice',
    conversationId: a.id,
    history: [{ id: 'msg-alice-1', role: 'user', content: 'тайна Алисы' }],
    assistant: { content: 'ok', modelId: 'm', status: 'complete' },
  });
  assert.ok(savedA);
  // Боб подставляет id сообщения Алисы в свой диалог.
  store.saveTurn({
    userId: 'bob',
    conversationId: b.id,
    history: [{ id: 'msg-alice-1', role: 'user', content: 'подмена' }],
    assistant: { content: 'ok', modelId: 'm', status: 'complete' },
  });
  const alice = store.get('alice', a.id);
  assert.equal(alice?.messages.find((m) => m.id === 'msg-alice-1')?.content, 'тайна Алисы');
  const bob = store.get('bob', b.id);
  assert.ok(bob?.messages.every((m) => m.id !== 'msg-alice-1'));
  // И чужой диалог нельзя «присвоить» по id.
  assert.equal(
    store.saveTurn({
      userId: 'bob',
      conversationId: a.id,
      history: [{ role: 'user', content: 'x' }],
      assistant: { content: 'y', modelId: 'm', status: 'complete' },
    }),
    null,
  );
  assert.equal(store.get('alice', a.id)?.conversation.userId, 'alice');
});

test('правила: список открытых эндпоинтов Better Auth, хеши CSP, сессия Better Auth', () => {
  assert.equal(isPublicBetterAuthEndpoint('POST', '/api/auth/sign-up/email'), false);
  assert.equal(isPublicBetterAuthEndpoint('POST', '/api/auth/sign-in/email'), false);
  assert.equal(isPublicBetterAuthEndpoint('POST', '/api/auth/sign-in/social'), true);
  assert.equal(isPublicBetterAuthEndpoint('GET', '/api/auth/get-session'), true);
  assert.equal(isPublicBetterAuthEndpoint('GET', '/api/auth/callback/google'), true);
  assert.deepEqual(
    inlineScriptHashes('<script>a()</script><script src="/x.js"></script>').length,
    1,
  );
  const stored = { email: 'a@b.c', createdAt: OLD };
  assert.equal(betterAuthSessionMayOpen({ email: 'a@b.c', emailVerified: true }, stored), true);
  assert.equal(
    betterAuthSessionMayOpen(
      { email: 'a@b.c', emailVerified: false, createdAt: new Date() },
      stored,
    ),
    false,
  );
  assert.equal(
    betterAuthSessionMayOpen({ email: 'a@b.c', emailVerified: false, createdAt: OLD }, stored),
    true,
  );
  assert.equal(
    betterAuthSessionMayOpen({ email: 'tg-1@telegram.invalid', emailVerified: true }, stored),
    false,
  );
});

test('RateLimiter: окно и сброс', () => {
  let now = 0;
  const limiter = new RateLimiter(1000, 2, () => now);
  assert.equal(limiter.hit('k'), false);
  assert.equal(limiter.hit('k'), false);
  assert.equal(limiter.hit('k'), true);
  now = 1500;
  assert.equal(limiter.hit('k'), false);
});

test('чужой диалог нельзя забрать по id: get не переназначает, перенос — только своего гостевого', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-claim-'));
  const store = createConversationStore(join(dir, 'c.json'));
  const alice = store.create('alice', 'A');
  const guest = store.create('guest_browser_one', 'G');

  // Боб знает id диалога Алисы: ни чтение, ни «перенос» не отдают его.
  assert.equal(store.get('bob', alice.id), null);
  assert.equal(store.claimGuestConversation('bob', alice.id, 'alice'), false);
  assert.equal(store.claimGuestConversation('bob', alice.id, 'guest_browser_one'), false);
  assert.equal(store.get('alice', alice.id)?.conversation.userId, 'alice');

  // Чужой гость не забирает гостевой диалог; гость не забирает его у гостя.
  assert.equal(store.claimGuestConversation('bob', guest.id, 'guest_browser_two'), false);
  assert.equal(
    store.claimGuestConversation('guest_browser_two', guest.id, 'guest_browser_one'),
    false,
  );
  assert.equal(store.get('guest_browser_one', guest.id)?.conversation.userId, 'guest_browser_one');

  // Свой гостевой диалог (тот же браузер) после входа переходит в аккаунт, один раз.
  assert.equal(store.claimGuestConversation('carol', guest.id, 'guest_browser_one'), true);
  assert.equal(store.get('carol', guest.id)?.conversation.userId, 'carol');
  assert.equal(store.get('guest_browser_one', guest.id), null);
  assert.equal(store.claimGuestConversation('dave', guest.id, 'guest_browser_one'), false);
});

test('HTTP: чужой диалог по id — 404, свой гостевой переносится в аккаунт после входа', async () => {
  const signup = async (email: string, guestId?: string) => {
    const response = await signupAndVerify(
      base,
      json(
        { email, password: 'password123', name: 'Test' },
        guestId ? { 'X-Guest-Id': guestId } : {},
      ),
    );
    assert.equal(response.status, 201);
    return ((await response.json()) as { token: string }).token;
  };
  const owner = await signup('conv-owner@example.com');
  const thief = await signup('conv-thief@example.com');
  const auth = (token: string, guestId = 'guest_thief_browser') => ({
    Authorization: `Bearer ${token}`,
    'X-Guest-Id': guestId,
    Origin: ORIGIN,
  });

  const created = await fetch(`${base}/api/conversations`, {
    ...json({ title: 'Секрет владельца' }, { Authorization: `Bearer ${owner}` }),
  });
  assert.equal(created.status, 201);
  const ownerConversation = ((await created.json()) as { conversation: { id: string } })
    .conversation.id;

  const stolen = await fetch(`${base}/api/conversations/${ownerConversation}`, {
    headers: auth(thief),
  });
  assert.equal(stolen.status, 404);
  const stillOwned = await fetch(`${base}/api/conversations/${ownerConversation}`, {
    headers: auth(owner, 'guest_owner_browser'),
  });
  assert.equal(stillOwned.status, 200);

  // Гость начал диалог, потом зарегистрировался в том же браузере.
  const guestId = 'guest_new_user_browser';
  const guestCreated = await fetch(`${base}/api/conversations`, {
    ...json({ title: 'До входа' }, { 'X-Guest-Id': guestId }),
  });
  assert.equal(guestCreated.status, 201);
  const guestConversation = ((await guestCreated.json()) as { conversation: { id: string } })
    .conversation.id;

  // Другой аккаунт с чужим гостевым id его не получает.
  const foreign = await fetch(`${base}/api/conversations/${guestConversation}`, {
    headers: auth(thief),
  });
  assert.equal(foreign.status, 404);

  const newcomer = await signup('conv-newcomer@example.com', guestId);
  const claimed = await fetch(`${base}/api/conversations/${guestConversation}`, {
    headers: auth(newcomer, guestId),
  });
  assert.equal(claimed.status, 200);
  const list = await fetch(`${base}/api/conversations`, { headers: auth(newcomer, guestId) });
  const ids = ((await list.json()) as { conversations: Array<{ id: string }> }).conversations.map(
    (item) => item.id,
  );
  assert.ok(ids.includes(guestConversation));
});
