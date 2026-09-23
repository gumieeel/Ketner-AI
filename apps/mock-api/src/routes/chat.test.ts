import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completionBody,
  createConversation,
  fetchConversation,
  postCompletion,
  readJson,
  readSseEvents,
  startTestServer,
  waitFor,
  type ApiErrorBody,
} from '../testing/server.js';

test('ответ приходит потоком, а потом сохраняется в диалоге', async () => {
  const server = await startTestServer();

  try {
    const conversation = await createConversation(server.baseUrl, 'Поток');
    const response = await postCompletion(
      server.baseUrl,
      completionBody(conversation.id, 'привет'),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');

    const events = await readSseEvents(response);
    const deltas = events.filter((event) => event.event === 'delta');
    assert.ok(deltas.length > 3, 'ответ должен прийти несколькими порциями');

    const streamed = deltas
      .map((event) => (JSON.parse(event.data) as { content: string }).content)
      .join('');
    assert.ok(streamed.includes('Ketner AI'));

    const done = events.find((event) => event.event === 'done');
    assert.ok(done);
    const payload = JSON.parse(done.data) as {
      messageId: string;
      usage: { inputTokens: number; outputTokens: number };
    };
    assert.ok(payload.messageId);
    assert.ok(payload.usage.inputTokens > 0);
    assert.ok(payload.usage.outputTokens > 0);

    const saved = await fetchConversation(server.baseUrl, conversation.id);
    assert.equal(saved.messages.length, 2);
    assert.equal(saved.messages[0].id, 'message-1');
    assert.equal(saved.messages[0].status, 'complete');
    assert.equal(saved.messages[1].id, payload.messageId);
    assert.equal(saved.messages[1].content, streamed);
    assert.equal(saved.messages[1].status, 'complete');
  } finally {
    await server.close();
  }
});

test('остановка генерации сохраняет частичный ответ', async () => {
  const server = await startTestServer({ chunkMs: [5, 5] });

  try {
    const conversation = await createConversation(server.baseUrl, 'Остановка');
    const controller = new AbortController();
    const response = await postCompletion(
      server.baseUrl,
      completionBody(conversation.id, 'Составь план запуска на 4 недели'),
      controller.signal,
    );

    const reader = response.body?.getReader();
    assert.ok(reader, 'у потокового ответа есть тело');
    await reader.read();
    controller.abort();

    const saved = await waitFor(async () => {
      const found = await fetchConversation(server.baseUrl, conversation.id);
      return found.messages.length >= 2 ? found : null;
    });

    const assistant = saved.messages[1];
    assert.equal(assistant.role, 'assistant');
    assert.equal(assistant.status, 'complete');
    assert.ok(assistant.content.length > 0, 'частичный текст должен сохраниться');
    assert.ok(assistant.content.length < 400, 'ответ должен быть остановлен на середине');
  } finally {
    await server.close();
  }
});

test('сбой модели приходит событием error с понятным текстом', async () => {
  const server = await startTestServer({ failureRate: 1 });

  try {
    const conversation = await createConversation(server.baseUrl, 'Сбой');
    const response = await postCompletion(server.baseUrl, completionBody(conversation.id));
    const events = await readSseEvents(response);

    assert.equal(events.filter((event) => event.event === 'delta').length, 0);
    const error = events.find((event) => event.event === 'error');
    assert.ok(error);
    const payload = JSON.parse(error.data) as { code: string; message: string };
    assert.equal(payload.code, 'upstream_error');
    assert.ok(payload.message.length > 0);

    const saved = await fetchConversation(server.baseUrl, conversation.id);
    assert.equal(saved.messages.length, 2);
    assert.equal(saved.messages[1].status, 'error');
  } finally {
    await server.close();
  }
});

test('некорректный запрос отклоняется с описанием ошибки', async () => {
  const server = await startTestServer();

  try {
    const conversation = await createConversation(server.baseUrl, 'Проверки');

    const withoutConversation = await postCompletion(server.baseUrl, {
      messages: [{ role: 'user', content: 'привет' }],
    });
    assert.equal(withoutConversation.status, 400);
    assert.equal((await readJson<ApiErrorBody>(withoutConversation)).error.code, 'invalid_request');

    const withoutMessages = await postCompletion(server.baseUrl, { conversationId: 'x' });
    assert.equal(withoutMessages.status, 400);

    const lastIsAssistant = await postCompletion(server.baseUrl, {
      conversationId: conversation.id,
      messages: [{ role: 'assistant', content: 'привет' }],
    });
    assert.equal(lastIsAssistant.status, 400);
    assert.match((await readJson<ApiErrorBody>(lastIsAssistant)).error.message, /пользователя/);
  } finally {
    await server.close();
  }
});

test('генерация для неизвестного диалога отвечает 404', async () => {
  const server = await startTestServer();

  try {
    const response = await postCompletion(server.baseUrl, completionBody('нет-такого-диалога'));
    assert.equal(response.status, 404);
    assert.equal((await readJson<ApiErrorBody>(response)).error.code, 'conversation_not_found');
  } finally {
    await server.close();
  }
});
