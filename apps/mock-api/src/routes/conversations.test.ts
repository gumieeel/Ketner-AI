import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createConversation,
  readJson,
  startTestServer,
  type ApiErrorBody,
} from '../testing/server.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

test('диалоги создаются, читаются, переименовываются и удаляются', async () => {
  const server = await startTestServer();

  try {
    const empty = await readJson<{ conversations: unknown[] }>(
      await fetch(`${server.baseUrl}/api/conversations`),
    );
    assert.deepEqual(empty, { conversations: [] });

    const created = await createConversation(server.baseUrl, 'Первый чат');
    assert.ok(created.id);
    assert.equal(created.title, 'Первый чат');

    const found = await readJson<{ conversation: { id: string }; messages: unknown[] }>(
      await fetch(`${server.baseUrl}/api/conversations/${created.id}`),
    );
    assert.equal(found.conversation.id, created.id);
    assert.deepEqual(found.messages, []);

    const listed = await readJson<{ conversations: { messageCount: number }[] }>(
      await fetch(`${server.baseUrl}/api/conversations`),
    );
    assert.equal(listed.conversations.length, 1);
    assert.equal(listed.conversations[0].messageCount, 0);

    const renamed = await readJson<{ conversation: { title: string } }>(
      await fetch(`${server.baseUrl}/api/conversations/${created.id}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: 'Новое имя' }),
      }),
    );
    assert.equal(renamed.conversation.title, 'Новое имя');

    const withoutTitle = await fetch(`${server.baseUrl}/api/conversations/${created.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    assert.equal(withoutTitle.status, 400);
    assert.equal((await readJson<ApiErrorBody>(withoutTitle)).error.code, 'invalid_request');

    const removed = await fetch(`${server.baseUrl}/api/conversations/${created.id}`, {
      method: 'DELETE',
    });
    assert.equal(removed.status, 204);

    const missing = await fetch(`${server.baseUrl}/api/conversations/${created.id}`);
    assert.equal(missing.status, 404);
    assert.equal((await readJson<ApiErrorBody>(missing)).error.code, 'conversation_not_found');
  } finally {
    await server.close();
  }
});

test('каталог моделей и описание контракта отдаются по API', async () => {
  const server = await startTestServer();

  try {
    const meta = await readJson<{
      defaultModelId: string;
      models: unknown[];
      limits: { free: { messagesPerDay: number | null }; plus: { messagesPerDay: number | null } };
    }>(await fetch(`${server.baseUrl}/api/meta`));
    assert.equal(meta.defaultModelId, 'auto');
    assert.ok(meta.models.length >= 5);
    assert.equal(meta.limits.free.messagesPerDay, 10);
    assert.equal(meta.limits.plus.messagesPerDay, null);

    const contract = await readJson<{ endpoints: { path: string; status: string }[] }>(
      await fetch(`${server.baseUrl}/api`),
    );
    const completions = contract.endpoints.find(
      (endpoint) => endpoint.path === '/api/chat/completions',
    );
    assert.ok(completions, 'генерация описана в контракте');
    assert.equal(completions.status, 'ready');
    const auth = contract.endpoints.find((endpoint) => endpoint.path === '/api/auth/login');
    assert.ok(auth, 'вход описан в контракте');
    assert.equal(auth.status, 'ready');
    const billing = contract.endpoints.find(
      (endpoint) => endpoint.path === '/api/billing/checkout',
    );
    assert.ok(billing, 'биллинг описан в контракте');
    assert.equal(billing.status, 'ready');
  } finally {
    await server.close();
  }
});

test('недействительный Bearer-токен помечается заголовком X-Session-Invalid, а действующий — нет', async () => {
  const server = await startTestServer();
  try {
    const stale = await fetch(`${server.baseUrl}/api/conversations`, {
      headers: { Authorization: 'Bearer stale.jwt.token' },
    });
    assert.equal(stale.headers.get('x-session-invalid'), '1');

    const guest = await fetch(`${server.baseUrl}/api/conversations`);
    assert.equal(guest.headers.get('x-session-invalid'), null, 'гость без токена не помечается');
  } finally {
    await server.close();
  }
});

test('гость не может назваться другим пользователем через заголовки', async () => {
  const server = await startTestServer();
  try {
    const owner = { ...JSON_HEADERS, 'X-Guest-Id': 'guest_owner12345_abc' };
    const created = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: owner,
      body: JSON.stringify({ title: 'Личное' }),
    });
    assert.equal(created.status, 201);

    // Чужой гостевой id и X-User-Id не открывают диалоги владельца
    const other = await readJson<{ conversations: unknown[] }>(
      await fetch(`${server.baseUrl}/api/conversations`, {
        headers: { 'X-Guest-Id': 'guest_other67890_xyz' },
      }),
    );
    assert.deepEqual(other.conversations, []);
    const spoof = await readJson<{ conversations: unknown[] }>(
      await fetch(`${server.baseUrl}/api/conversations`, {
        headers: { 'X-User-Id': 'guest_owner12345_abc' },
      }),
    );
    assert.deepEqual(spoof.conversations, []);

    // Идентификатор, не похожий на гостевой, не принимается как личность
    const forged = await readJson<{ conversations: unknown[] }>(
      await fetch(`${server.baseUrl}/api/conversations`, {
        headers: { 'X-Guest-Id': 'admin-artem-user' },
      }),
    );
    assert.deepEqual(forged.conversations, []);
  } finally {
    await server.close();
  }
});
