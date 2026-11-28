import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { startTestServer } from '../testing/server.js';
import { OLD_HOSTS, oldHostRedirect } from './old-host-redirect.js';

/** Запрос с нужным заголовком Host: fetch его не позволяет задать. */
function send(
  base: string,
  method: string,
  path: string,
  host: string,
): Promise<{ status: number; location: string | undefined }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, method, path, headers: { Host: host } },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, location: res.headers.location }),
        );
      },
    );
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

test('старый адрес: страницы — 301 на ketner.org с тем же путём и запросом', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  assert.deepEqual(OLD_HOSTS, ['ketner-ai.onrender.com']);
  for (const path of ['/', '/analyses/a57d7078?from=mail', '/pricing', '/b/lisa', '/robots.txt']) {
    const response = await send(server.baseUrl, 'GET', path, 'ketner-ai.onrender.com');
    assert.equal(response.status, 301, path);
    assert.equal(response.location, `https://ketner.org${path}`, path);
  }
  const head = await send(server.baseUrl, 'HEAD', '/about', 'ketner-ai.onrender.com:443');
  assert.deepEqual([head.status, head.location], [301, 'https://ketner.org/about']);
});

test('старый адрес: API, вебхуки, OAuth, /v1, widget.js, файлы сборки и не-GET — без переадресации', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  for (const [method, path] of [
    ['GET', '/api/health'],
    ['GET', '/api/auth/callback/google?code=x&state=y'],
    ['GET', '/api/integrations/google/callback?code=x'],
    ['POST', '/api/telegram/webhook'],
    ['POST', '/api/webhooks'],
    ['GET', '/v1/models'],
    ['GET', '/widget.js'],
    ['GET', '/assets/index.js'],
    ['POST', '/pricing'],
  ] as const) {
    const response = await send(server.baseUrl, method, path, 'ketner-ai.onrender.com');
    // Свой ответ маршрута (колбэк OAuth сам может переадресовать на ошибку), но не на ketner.org.
    assert.notEqual(response.status, 301, `${method} ${path}`);
    assert.ok(!response.location?.startsWith('https://ketner.org'), `${method} ${path}`);
  }
  // Основной адрес и локальная разработка не перенаправляются.
  for (const host of ['ketner.org', 'localhost']) {
    const response = await send(server.baseUrl, 'GET', '/pricing', host);
    assert.notEqual(response.status, 301, host);
  }
});

test('промежуточный слой сам по себе: цель — адрес сайта без лишнего слэша', () => {
  const calls: Array<[number, string]> = [];
  let passed = 0;
  const middleware = oldHostRedirect(() => 'https://ketner.org/');
  const run = (method: string, path: string, host: string) =>
    middleware(
      { method, path, originalUrl: path, headers: { host } } as never,
      { redirect: (status: number, url: string) => calls.push([status, url]) } as never,
      () => {
        passed += 1;
      },
    );
  run('GET', '/x?y=1', 'KETNER-AI.onrender.com');
  run('GET', '/api/me', 'ketner-ai.onrender.com');
  run('DELETE', '/x', 'ketner-ai.onrender.com');
  assert.deepEqual(calls, [[301, 'https://ketner.org/x?y=1']]);
  assert.equal(passed, 2);
});
