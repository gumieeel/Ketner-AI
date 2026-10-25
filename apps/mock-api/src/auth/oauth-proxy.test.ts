/**
 * Вход через Google, когда сайт открыт на одном домене (ketner.org), а колбэк OAuth
 * зарегистрирован на другом (адрес Render). Здесь два «домена» — это один сервер по адресам
 * localhost (сайт) и 127.0.0.1 (колбэк); Google подменён.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';

const { createBetterAuth, initAuthDatabase } = await import('./better-auth.js');
const { createApp } = await import('../app.js');
const { createConversationStore } = await import('../store/conversation-store.js');
const { createUserStore } = await import('../store/user-store.js');
const { createSubscriptionStore } = await import('../store/subscription-store.js');
const { FAST_AI } = await import('../testing/server.js');

function unsignedJwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(payload)}.`;
}

/** Подменяет ответы Google; остальные запросы идут как обычно. */
function fakeGoogle(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return Response.json({
        access_token: 'google-access',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid email profile',
        id_token: unsignedJwt({
          sub: 'google-user-1',
          email: 'proxy-user@example.com',
          email_verified: true,
          name: 'Proxy User',
          picture: 'https://example.com/a.png',
        }),
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'ketner-oauth-proxy-'));
  // Сначала занимаем порт, чтобы знать адрес колбэка до создания Better Auth.
  const { createServer } = await import('node:http');
  const holder = createServer();
  await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = (holder.address() as AddressInfo).port;
  await new Promise<void>((resolve) => holder.close(() => resolve()));

  const productionURL = `http://127.0.0.1:${port}`;
  const { auth, db } = createBetterAuth({
    dbPath: join(dir, 'auth.sqlite'),
    baseURL: productionURL,
  });
  await initAuthDatabase(auth);
  const app = createApp({
    store: createConversationStore(join(dir, 'store.json')),
    userStore: createUserStore(join(dir, 'users.json')),
    subscriptionStore: createSubscriptionStore(join(dir, 'subs.json')),
    ai: FAST_AI,
    betterAuth: auth,
  });
  const server = app.listen(port, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return {
    productionURL,
    siteURL: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        db.close();
        server.close(() => resolve());
      }),
  };
}

test('вход через Google с другого домена создаёт сессию на домене сайта', async () => {
  const restore = fakeGoogle();
  const env = await start();
  try {
    const signIn = await fetch(`${env.siteURL}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: env.siteURL },
      body: JSON.stringify({ provider: 'google', callbackURL: `${env.siteURL}/chat` }),
    });
    assert.equal(signIn.status, 200);
    const { url } = (await signIn.json()) as { url: string };
    const google = new URL(url);
    // Google возвращает на зарегистрированный адрес колбэка, а не на домен сайта.
    assert.equal(
      google.searchParams.get('redirect_uri'),
      `${env.productionURL}/api/auth/callback/google`,
    );
    const state = google.searchParams.get('state')!;

    // Колбэк приходит на другой домен: cookie состояния там нет — раньше вход падал здесь.
    const callback = await fetch(
      `${env.productionURL}/api/auth/callback/google?code=google-code&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    assert.equal(callback.status, 302);
    const proxy = new URL(callback.headers.get('location')!);
    assert.equal(proxy.origin, env.siteURL);
    assert.equal(proxy.pathname, '/api/auth/callback/google/oauth-proxy');
    assert.ok(proxy.searchParams.get('profile'));

    // На домене сайта создаётся сессия и человек попадает в чат.
    const finish = await fetch(proxy, { redirect: 'manual' });
    assert.equal(finish.status, 302);
    assert.equal(finish.headers.get('location'), `${env.siteURL}/chat`);
    const cookies = finish.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    assert.match(cookies, /better-auth\.session_token=/);

    const session = await fetch(`${env.siteURL}/api/auth/get-session`, {
      headers: { Cookie: cookies },
    });
    const body = (await session.json()) as { user?: { email: string } } | null;
    assert.equal(body?.user?.email, 'proxy-user@example.com');

    // Зашифрованный профиль одноразовый: повторно войти по той же ссылке нельзя.
    const replay = await fetch(proxy, { redirect: 'manual' });
    assert.ok(
      !replay.headers
        .getSetCookie()
        .some((cookie) => cookie.includes('session_token=') && !cookie.includes('Max-Age=0')),
    );
  } finally {
    await env.close();
    restore();
  }
});

test('чужой сайт не может начать вход от имени Ketner', async () => {
  const env = await start();
  try {
    const response = await fetch(`${env.siteURL}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ provider: 'google', callbackURL: 'https://evil.example/steal' }),
    });
    assert.equal(response.status, 403);
  } finally {
    await env.close();
  }
});
