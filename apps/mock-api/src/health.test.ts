import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './app.js';
import { config } from './config.js';
import { readJson } from './testing/server.js';

/** Smoke-тест: сервис поднимается и отвечает по контракту. */
test('GET /api/health отвечает status=ok', async () => {
  const server = createApp().listen(0);
  const address = server.address();

  try {
    assert.ok(address && typeof address === 'object', 'сервер должен слушать порт');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const body = (await response.json()) as { status: string; service: string };

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'ketner-mock-api');
  } finally {
    server.close();
  }
});

test('неизвестный эндпоинт отвечает 404 в едином формате', async () => {
  const server = createApp().listen(0);
  const address = server.address();

  try {
    assert.ok(address && typeof address === 'object', 'сервер должен слушать порт');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/unknown`);
    const body = (await response.json()) as { error: { code: string } };

    assert.equal(response.status, 404);
    assert.equal(body.error.code, 'not_found');
  } finally {
    server.close();
  }
});

test('GET / подсказывает, где открыть интерфейс', async () => {
  const server = createApp().listen(0);
  const address = server.address();

  try {
    assert.ok(address && typeof address === 'object', 'сервер должен слушать порт');
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      headers: { Accept: 'application/json' },
    });
    const body = await readJson<{
      service: string;
      message: string;
      webAppUrl: string;
      endpoints: { path: string }[];
    }>(response);

    assert.equal(response.status, 200);
    assert.equal(body.service, 'ketner-mock-api');
    assert.equal(body.webAppUrl, config.webAppUrl);
    assert.match(body.message, /Интерфейс/);
    // Контракт перечислен так же, как на GET /api.
    assert.ok(body.endpoints.some((endpoint) => endpoint.path === '/api/chat/completions'));
  } finally {
    server.close();
  }
});

test('GET / и клиентские маршруты отдают HTML при наличии сборки web', async () => {
  const server = createApp().listen(0);
  const address = server.address();

  try {
    assert.ok(address && typeof address === 'object', 'сервер должен слушать порт');
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const text = await response.text();
    assert.match(text, /Ketner AI/);

    const spaResponse = await fetch(`http://127.0.0.1:${address.port}/chat`);
    assert.equal(spaResponse.status, 200);
    assert.match(spaResponse.headers.get('content-type') ?? '', /text\/html/);
  } finally {
    server.close();
  }
});
