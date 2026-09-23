import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TITLE_MAX_LENGTH, createConversationStore, deriveTitle } from './conversation-store.js';

const USER = 'demo-user';

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'ketner-store-')), 'store.json');
}

function saveGreeting(
  store: ReturnType<typeof createConversationStore>,
  conversationId: string,
): void {
  store.saveTurn({
    userId: USER,
    conversationId,
    history: [
      { id: 'message-1', role: 'user', content: 'привет', createdAt: '2026-09-23T10:00:00.000Z' },
    ],
    assistant: { content: 'ответ', modelId: 'ketner-mini', status: 'complete' },
  });
}

test('заголовок диалога берётся из первого сообщения и обрезается', () => {
  assert.equal(deriveTitle('  Привет   мир '), 'Привет мир');

  const long = deriveTitle('а'.repeat(TITLE_MAX_LENGTH + 10));
  assert.equal([...long].length, TITLE_MAX_LENGTH);
  assert.ok(long.endsWith('…'));
});

test('сообщения сохраняются с идентификаторами клиента', () => {
  const store = createConversationStore(tempFile());
  const conversation = store.create(USER, 'Первый чат');
  saveGreeting(store, conversation.id);

  const found = store.get(USER, conversation.id);
  assert.ok(found);
  assert.equal(found.messages.length, 2);
  assert.equal(found.messages[0].id, 'message-1');
  assert.equal(found.messages[0].status, 'complete');
  assert.equal(found.messages[1].role, 'assistant');
  assert.equal(found.messages[1].modelId, 'ketner-mini');
  assert.equal(found.conversation.updatedAt, found.messages[1].createdAt);
});

test('новая история заменяет сохранённую', () => {
  const store = createConversationStore(tempFile());
  const conversation = store.create(USER, 'Правка');
  saveGreeting(store, conversation.id);

  store.saveTurn({
    userId: USER,
    conversationId: conversation.id,
    history: [
      {
        id: 'message-1',
        role: 'user',
        content: 'другой вопрос',
        createdAt: '2026-09-23T10:00:00.000Z',
      },
      { role: 'assistant', content: 'первый ответ' },
      {
        id: 'message-2',
        role: 'user',
        content: 'уточнение',
        createdAt: '2026-09-23T10:05:00.000Z',
      },
    ],
    assistant: { content: 'второй ответ', modelId: 'ketner-mini', status: 'complete' },
  });

  const found = store.get(USER, conversation.id);
  assert.ok(found);
  assert.equal(found.messages.length, 4);
  assert.equal(found.messages[0].content, 'другой вопрос');
  assert.equal(found.messages[3].content, 'второй ответ');
});

test('заголовок подставляется, если диалог создали без названия', () => {
  const store = createConversationStore(tempFile());
  const conversation = store.create(USER, '');
  saveGreeting(store, conversation.id);

  const found = store.get(USER, conversation.id);
  assert.ok(found);
  assert.equal(found.conversation.title, 'привет');
});

test('список диалогов сортируется по времени обновления', () => {
  const store = createConversationStore(tempFile());
  const first = store.create(USER, 'Первый');
  store.create(USER, 'Второй');
  saveGreeting(store, first.id);

  const list = store.list(USER);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, first.id);
  assert.equal(list[0].messageCount, 2);
});

test('удаление диалога удаляет его сообщения', () => {
  const store = createConversationStore(tempFile());
  const conversation = store.create(USER, 'Временный');
  saveGreeting(store, conversation.id);

  assert.equal(store.remove(USER, conversation.id), true);
  assert.equal(store.get(USER, conversation.id), null);
  assert.equal(store.remove(USER, conversation.id), false);
  assert.equal(store.list(USER).length, 0);
});

test('данные переживают перезапуск хранилища', () => {
  const file = tempFile();
  const store = createConversationStore(file);
  const conversation = store.create(USER, 'Долгий диалог');
  saveGreeting(store, conversation.id);

  const restored = createConversationStore(file);
  const found = restored.get(USER, conversation.id);
  assert.ok(found);
  assert.equal(found.conversation.title, 'Долгий диалог');
  assert.equal(found.messages.length, 2);

  // На диске лежит читаемый JSON, а не что-то зависящее от процесса.
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { conversations: unknown[] };
  assert.equal(raw.conversations.length, 1);
});
