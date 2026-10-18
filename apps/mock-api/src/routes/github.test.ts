import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createGithubConnectionStore,
  decryptToken,
  encryptToken,
} from '../github/connection-store.js';
import { createState, readState, safeReturnTo, type GithubOAuthSettings } from '../github/oauth.js';
import { downloadGithubZip } from '../code/archive.js';
import { isAllowedGithubCall } from './github.js';
import {
  readJson,
  startTestServer,
  type ApiErrorBody,
  type TestServer,
} from '../testing/server.js';
import type { AuthSession } from '../types.js';

const SETTINGS: GithubOAuthSettings = {
  clientId: 'client-123',
  clientSecret: 'secret-456',
  redirectUri: 'https://ketner-ai.onrender.com/api/auth/callback/github/repos',
};

interface GithubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Поддельный GitHub: обмен кода, профиль и пара REST-методов. */
function fakeGithub(options: { scope?: string; userStatus?: number } = {}) {
  const calls: GithubCall[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>),
    );
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = JSON.parse(String(init.body)) as { code: string };
      if (body.code !== 'good-code') return Response.json({ error: 'bad_verification_code' });
      return Response.json({
        access_token: 'gho_secret_token',
        scope: options.scope ?? 'repo,read:user',
        token_type: 'bearer',
      });
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: 42,
        login: 'octo',
        avatar_url: 'https://avatars.githubusercontent.com/u/42',
      });
    }
    if (url.startsWith('https://api.github.com/user/repos')) {
      if (options.userStatus)
        return new Response('{"message":"Bad credentials"}', { status: options.userStatus });
      return Response.json([{ full_name: 'octo/private-app', private: true }], {
        headers: { link: '<next>; rel="next"' },
      });
    }
    if (url.includes('/applications/')) return new Response(null, { status: 204 });
    return new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  return { calls, impl };
}

let counter = 0;
async function signup(server: TestServer): Promise<AuthSession> {
  counter += 1;
  const response = await signupAndVerify(server.baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `gh${counter}@example.com`,
      password: 'password123',
      name: 'Dev',
    }),
  });
  return readJson<AuthSession>(response);
}

const auth = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  ...extra,
});

test('токен шифруется: в файле его нет, чужим ключом не расшифровать', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ketner-gh-')), 'github.json');
  const store = createGithubConnectionStore({ file, secret: 'one' });
  store.save(
    {
      userId: 'u1',
      githubId: 1,
      login: 'octo',
      avatarUrl: null,
      scopes: ['repo'],
      connectedAt: '2026-10-13T10:00:00.000Z',
    },
    'gho_plain_token',
  );
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('gho_plain_token'));
  assert.equal(store.tokenOf('u1'), 'gho_plain_token');
  assert.equal(
    createGithubConnectionStore({ file, secret: 'one' }).tokenOf('u1'),
    'gho_plain_token',
  );
  assert.equal(createGithubConnectionStore({ file, secret: 'two' }).tokenOf('u1'), undefined);
  const sealed = encryptToken('x', 'a');
  // Портим настоящий байт шифротекста (последний символ base64 может нести только биты выравнивания).
  const parts = sealed.split('.');
  const body = Buffer.from(parts[3]!, 'base64url');
  body[0] = body[0]! ^ 0xff;
  const tampered = [...parts.slice(0, 3), body.toString('base64url')].join('.');
  assert.equal(decryptToken(tampered, 'a'), undefined);
  assert.equal(store.remove('u1'), true);
  assert.equal(store.get('u1'), undefined);
});

test('state подписан, привязан к пользователю и истекает', () => {
  const state = createState('user-1', 'https://ketner.org/chat', 'secret', 1_000);
  assert.deepEqual(readState(state, 'secret', 2_000), {
    userId: 'user-1',
    returnTo: 'https://ketner.org/chat',
  });
  assert.equal(readState(state, 'other', 2_000), null);
  assert.equal(readState(state, 'secret', 1_000 + 11 * 60_000), null);
  const [body, sig] = state.split('.');
  const forged = Buffer.from(
    JSON.stringify({ u: 'admin', n: 'x', e: 9e15, r: 'https://ketner.org' }),
  ).toString('base64url');
  assert.equal(readState(`${forged}.${sig}`, 'secret', 2_000), null);
  assert.equal(readState(`${body}.`, 'secret', 2_000), null);
});

test('адрес возврата: только свои сайты', () => {
  assert.equal(safeReturnTo('https://ketner.org/settings#x'), 'https://ketner.org/settings');
  assert.equal(safeReturnTo('http://localhost:5173/chat'), 'http://localhost:5173/chat');
  for (const bad of [
    'https://evil.com/',
    'https://ketner.org.evil.com/',
    'javascript:alert(1)',
    'https://user:pw@ketner.org/',
    42,
    '',
  ]) {
    assert.equal(safeReturnTo(bad), null, String(bad));
  }
});

test('прокси пускает только чтение, коммит и PR', () => {
  for (const [method, path] of [
    ['GET', '/user/repos'],
    ['GET', '/repos/acme/app'],
    ['GET', '/repos/acme/app/branches'],
    ['GET', '/repos/acme/app/git/trees/main'],
    ['GET', '/repos/acme/app/git/ref/heads/feat/x'],
    ['GET', '/repos/acme/app/contents/src/a%20b.ts'],
    ['POST', '/repos/acme/app/git/blobs'],
    ['POST', '/repos/acme/app/git/refs'],
    ['PATCH', '/repos/acme/app/git/refs/heads/main'],
    ['POST', '/repos/acme/app/pulls'],
  ]) {
    assert.equal(isAllowedGithubCall(method, path), true, `${method} ${path}`);
  }
  for (const [method, path] of [
    ['DELETE', '/repos/acme/app'],
    ['PATCH', '/repos/acme/app'],
    ['POST', '/repos/acme/app/hooks'],
    ['GET', '/repos/acme/app/keys'],
    ['PUT', '/repos/acme/app/collaborators/evil'],
    ['GET', '/repos/acme/app/contents/../../user/emails'],
    ['GET', '/repos/acme/app/contents/%2e%2e/secret'],
    ['GET', '/repos/acme/app/contents/a%2Fb'],
    ['POST', '/user/repos'],
    ['GET', '/admin/users'],
  ]) {
    assert.equal(isAllowedGithubCall(method, path), false, `${method} ${path}`);
  }
});

test('подключение GitHub: ссылка, колбэк, подтверждение своей сессией, прокси и отключение', async () => {
  const github = fakeGithub();
  const server = await startTestServer(
    {},
    { githubFetch: github.impl, githubSettings: () => SETTINGS },
  );
  try {
    const owner = await signup(server);
    const stranger = await signup(server);

    const unauth = await fetch(`${server.baseUrl}/api/github/status`);
    assert.equal(unauth.status, 401);

    const status = await readJson<{ available: boolean; connected: boolean }>(
      await fetch(`${server.baseUrl}/api/github/status`, { headers: auth(owner.token) }),
    );
    assert.deepEqual(status, { available: true, connected: false, account: null });

    // Без подключения прокси объясняет, что делать.
    const notConnected = await fetch(`${server.baseUrl}/api/github/api/user/repos`, {
      headers: auth(owner.token),
    });
    assert.equal(notConnected.status, 409);
    assert.equal((await readJson<ApiErrorBody>(notConnected)).error.code, 'github_not_connected');

    const connect = await readJson<{ url: string }>(
      await fetch(
        `${server.baseUrl}/api/github/connect-url?returnTo=${encodeURIComponent('http://localhost:5173/settings')}`,
        {
          headers: auth(owner.token),
        },
      ),
    );
    const authorize = new URL(connect.url);
    assert.equal(authorize.origin + authorize.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(authorize.searchParams.get('client_id'), 'client-123');
    assert.equal(authorize.searchParams.get('redirect_uri'), SETTINGS.redirectUri);
    assert.equal(authorize.searchParams.get('scope'), 'repo read:user');
    const state = authorize.searchParams.get('state')!;

    // Колбэк не обменивает код, а возвращает его во фрагменте на сайт.
    const callback = await fetch(
      `${server.baseUrl}/api/auth/callback/github/repos?code=good-code&state=${encodeURIComponent(state)}`,
      {
        redirect: 'manual',
      },
    );
    assert.equal(callback.status, 302);
    const location = new URL(callback.headers.get('location')!);
    assert.equal(location.origin + location.pathname, 'http://localhost:5173/settings');
    const fragment = new URLSearchParams(location.hash.slice(1));
    assert.equal(fragment.get('github_code'), 'good-code');
    assert.equal(fragment.get('github_state'), state);
    assert.equal(location.search, '');

    const denied = await fetch(
      `${server.baseUrl}/api/auth/callback/github/repos?error=access_denied&state=${encodeURIComponent(state)}`,
      {
        redirect: 'manual',
      },
    );
    assert.match(denied.headers.get('location')!, /#github_error=denied$/);

    // Чужая сессия не может завершить подключение по этой ссылке.
    const hijack = await fetch(`${server.baseUrl}/api/github/confirm`, {
      method: 'POST',
      headers: auth(stranger.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: 'good-code', state }),
    });
    assert.equal(hijack.status, 400);
    assert.equal((await readJson<ApiErrorBody>(hijack)).error.code, 'github_state_invalid');

    const badCode = await fetch(`${server.baseUrl}/api/github/confirm`, {
      method: 'POST',
      headers: auth(owner.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: 'stale', state }),
    });
    assert.equal(badCode.status, 400);

    const confirmed = await fetch(`${server.baseUrl}/api/github/confirm`, {
      method: 'POST',
      headers: auth(owner.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: 'good-code', state }),
    });
    assert.equal(confirmed.status, 200);
    const confirmedBody = await readJson<{
      connected: boolean;
      account: { login: string; scopes: string[] };
    }>(confirmed);
    assert.equal(confirmedBody.connected, true);
    assert.equal(confirmedBody.account.login, 'octo');
    assert.deepEqual(confirmedBody.account.scopes, ['repo', 'read:user']);
    assert.ok(!JSON.stringify(confirmedBody).includes('gho_secret_token'));

    // Прокси подставляет токен сам, браузер его не видит.
    const repos = await fetch(
      `${server.baseUrl}/api/github/api/user/repos?per_page=100&sort=pushed`,
      { headers: auth(owner.token) },
    );
    assert.equal(repos.status, 200);
    assert.equal(repos.headers.get('link'), '<next>; rel="next"');
    assert.deepEqual(await repos.json(), [{ full_name: 'octo/private-app', private: true }]);
    const proxied = github.calls.find((call) =>
      call.url.startsWith('https://api.github.com/user/repos'),
    )!;
    assert.equal(proxied.url, 'https://api.github.com/user/repos?per_page=100&sort=pushed');
    assert.equal(proxied.headers.Authorization, 'Bearer gho_secret_token');

    const forbidden = await fetch(`${server.baseUrl}/api/github/api/repos/octo/app`, {
      method: 'DELETE',
      headers: auth(owner.token),
    });
    assert.equal(forbidden.status, 403);
    assert.ok(
      !github.calls.some(
        (call) => call.method === 'DELETE' && call.url === 'https://api.github.com/repos/octo/app',
      ),
    );

    // Другой пользователь не получает чужой токен.
    const strangerRepos = await fetch(`${server.baseUrl}/api/github/api/user/repos`, {
      headers: auth(stranger.token),
    });
    assert.equal(strangerRepos.status, 409);

    const disconnected = await fetch(`${server.baseUrl}/api/github/connection`, {
      method: 'DELETE',
      headers: auth(owner.token),
    });
    assert.equal(((await disconnected.json()) as { connected: boolean }).connected, false);
    assert.ok(
      github.calls.some(
        (call) => call.method === 'DELETE' && call.url.includes('/applications/client-123/token'),
      ),
    );
    assert.equal(server.githubConnectionStore.tokenOf(owner.user.id), undefined);
  } finally {
    await server.close();
  }
});

test('подключение без права repo отклоняется; отозванный в GitHub токен снимает подключение', async () => {
  const narrow = fakeGithub({ scope: 'read:user' });
  const server = await startTestServer(
    {},
    { githubFetch: narrow.impl, githubSettings: () => SETTINGS },
  );
  try {
    const owner = await signup(server);
    const state = createState(owner.user.id, 'https://ketner.org/settings');
    const response = await fetch(`${server.baseUrl}/api/github/confirm`, {
      method: 'POST',
      headers: auth(owner.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code: 'good-code', state }),
    });
    assert.equal(response.status, 400);
    assert.equal((await readJson<ApiErrorBody>(response)).error.code, 'github_bad_scope');
  } finally {
    await server.close();
  }

  const revoked = fakeGithub({ userStatus: 401 });
  const second = await startTestServer(
    {},
    { githubFetch: revoked.impl, githubSettings: () => SETTINGS },
  );
  try {
    const owner = await signup(second);
    second.githubConnectionStore.save(
      {
        userId: owner.user.id,
        githubId: 1,
        login: 'octo',
        avatarUrl: null,
        scopes: ['repo'],
        connectedAt: new Date().toISOString(),
      },
      'gho_revoked',
    );
    const response = await fetch(`${second.baseUrl}/api/github/api/user/repos`, {
      headers: auth(owner.token),
    });
    assert.equal(response.status, 409);
    assert.equal((await readJson<ApiErrorBody>(response)).error.code, 'github_reauth_required');
    assert.equal(second.githubConnectionStore.get(owner.user.id), undefined);
  } finally {
    await second.close();
  }
});

test('GitHub без настроек на сервере: статус недоступен, ссылки нет', async () => {
  const server = await startTestServer({}, { githubSettings: () => null });
  try {
    const owner = await signup(server);
    const status = await readJson<{ available: boolean }>(
      await fetch(`${server.baseUrl}/api/github/status`, { headers: auth(owner.token) }),
    );
    assert.equal(status.available, false);
    const connect = await fetch(`${server.baseUrl}/api/github/connect-url`, {
      headers: auth(owner.token),
    });
    assert.equal(connect.status, 503);
  } finally {
    await server.close();
  }
});

test('импорт в Ketner Code берёт токен привязанного GitHub', async () => {
  let seen = '';
  await downloadGithubZip(
    { owner: 'octo', repo: 'private-app' },
    {
      maxBytes: 10_000,
      token: 'gho_import',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        seen = (init.headers as Record<string, string>).Authorization ?? '';
        return new Response(new Uint8Array([1, 2, 3]));
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(seen, 'Bearer gho_import');
});
