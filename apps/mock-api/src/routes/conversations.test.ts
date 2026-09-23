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
    assert.equal(meta.defaultModelId, 'ketner-mini');
    assert.equal(meta.models.length, 2);
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
    assert.equal(auth.status, 'planned');
  } finally {
    await server.close();
  }
});
