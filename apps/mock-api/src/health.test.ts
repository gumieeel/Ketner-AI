import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './app.js';

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
