import { signupAndVerify } from '../testing/signup.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../config.js';
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
import { setProductSwitchForTests } from '../product-switches.js';

// Закрытые возможности (product-switches.ts): здесь проверяется их спящий код.
setProductSwitchForTests('chat', true);

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

test('платная модель открыта и без покупки: гостю отвечает бесплатная модель, вошедшему Free — выбранная за пробные кредиты', async () => {
  const server = await startTestServer();

  try {
    // Гость (без входа): пробных кредитов нет, отвечает бесплатная модель, ошибки доступа нет.
    const conversation = await createConversation(server.baseUrl, 'Платная модель');
    const guest = await postCompletion(server.baseUrl, {
      conversationId: conversation.id,
      modelId: 'gpt-6.1-sol',
      language: 'ru',
      messages: [{ role: 'user', content: 'Привет' }],
    });
    assert.equal(guest.status, 200);
    const guestEvents = await readSseEvents(guest);
    assert.equal(
      guestEvents.find((e) => e.event === 'error'),
      undefined,
    );
    const guestDone = JSON.parse(guestEvents.find((e) => e.event === 'done')!.data) as {
      selectedModel: { id: string };
    };
    assert.equal(guestDone.selectedModel.id, 'nemotron-ultra');

    // Вошедший пользователь на Free: пробные 200 кредитов покрывают один запрос к GPT-6.1 Sol.
    const regRes = await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'free-user@example.com',
        password: 'password123',
        name: 'Free User',
      }),
    });
    const { token } = (await regRes.json()) as { token: string };
    const authed = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const convRes = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ title: 'Free GPT-6.1 Sol' }),
    });
    const { conversation: own } = (await convRes.json()) as { conversation: { id: string } };
    const response = await fetch(`${server.baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({
        conversationId: own.id,
        modelId: 'gpt-6.1-sol',
        language: 'ru',
        messages: [{ role: 'user', content: 'Привет' }],
      }),
    });
    assert.equal(response.status, 200);
    const events = await readSseEvents(response);
    assert.equal(
      events.find((e) => e.event === 'error'),
      undefined,
      'ошибки доступа нет: модели открыты всем, ограничивают только кредиты',
    );
    const done = JSON.parse(events.find((e) => e.event === 'done')!.data) as {
      selectedModel: { id: string };
      routingReason: string;
    };
    assert.equal(done.selectedModel.id, 'gpt-6.1-sol', done.routingReason);
  } finally {
    await server.close();
  }
});

test('генерация возвращает selectedModel, routingReason и usage в событии done', async () => {
  const server = await startTestServer();

  try {
    const conversation = await createConversation(server.baseUrl, 'Метаданные ответа');
    const response = await postCompletion(server.baseUrl, {
      conversationId: conversation.id,
      modelId: 'auto',
      language: 'ru',
      messages: [{ role: 'user', content: 'Привет, как дела?' }],
    });

    assert.equal(response.status, 200);
    const events = await readSseEvents(response);
    const done = events.find((e) => e.event === 'done');
    assert.ok(done, 'должно прийти событие done');

    const payload = JSON.parse(done.data) as {
      messageId: string;
      selectedModel: { id: string; name: string };
      routingReason: string;
      usage: { inputTokens: number; outputTokens: number };
    };

    assert.ok(payload.messageId);
    assert.ok(payload.selectedModel?.id);
    assert.ok(payload.selectedModel?.name);
    assert.ok(payload.routingReason);
    assert.ok(payload.usage.inputTokens > 0);
    assert.ok(payload.usage.outputTokens > 0);
  } finally {
    await server.close();
  }
});

test('покупатель кредитов имеет доступ ко всем премиум моделям (нет per-model paywall)', async () => {
  const server = await startTestServer();

  try {
    // Регистрация и покупка пакета кредитов
    const regRes = await signupAndVerify(server.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pro-user@example.com',
        password: 'password123',
        name: 'Pro User',
      }),
    });
    const { token } = (await regRes.json()) as { token: string };

    const checkoutRes = await fetch(`${server.baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ packId: 'credits-5' }),
    });
    assert.equal(checkoutRes.status, 200);

    // Создаём диалог от имени покупателя
    const createConvRes = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: 'Pro GPT-6 Test' }),
    });
    const { conversation } = (await createConvRes.json()) as { conversation: { id: string } };

    // Запрос к флагманской модели GPT-6.1 Sol
    const gptResponse = await fetch(`${server.baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId: conversation.id,
        modelId: 'gpt-6.1-sol',
        language: 'ru',
        messages: [{ role: 'user', content: 'Тестируем флагманскую модель GPT-6' }],
      }),
    });

    assert.equal(gptResponse.status, 200);
    const events = await readSseEvents(gptResponse);
    const errorEvent = events.find((e) => e.event === 'error');
    assert.equal(errorEvent, undefined, 'покупатель не должен получать ошибку доступа');

    const doneEvent = events.find((e) => e.event === 'done');
    assert.ok(doneEvent, 'должен успешно завершиться со статусом done');
    const doneData = JSON.parse(doneEvent.data) as { selectedModel: { id: string } };
    assert.equal(doneData.selectedModel.id, 'gpt-6.1-sol');
  } finally {
    await server.close();
  }
});

test('POST /api/chat/feedback сохраняет оценку ответа и GET /api/chat/feedback/analytics отдаёт статистику', async () => {
  const server = await startTestServer();

  try {
    const conversation = await createConversation(server.baseUrl, 'Тест фидбека');
    const compResponse = await postCompletion(
      server.baseUrl,
      completionBody(conversation.id, 'Привет'),
    );
    const events = await readSseEvents(compResponse);
    const done = events.find((e) => e.event === 'done');
    const { messageId } = JSON.parse(done!.data) as { messageId: string };

    // 1. Отправляем лайк
    const likeRes = await fetch(`${server.baseUrl}/api/chat/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversation.id,
        messageId,
        rating: 'like',
        modelId: 'gpt-6.1-sol',
      }),
    });
    assert.equal(likeRes.status, 200);
    const likeData = (await likeRes.json()) as { success: boolean; rating: string };
    assert.equal(likeData.success, true);
    assert.equal(likeData.rating, 'like');

    // Проверяем, что в диалоге сообщение получило feedback: 'like'
    const convAfterLike = await fetchConversation(server.baseUrl, conversation.id);
    const msg = convAfterLike.messages.find((m) => m.id === messageId);
    assert.equal(msg?.feedback, 'like');

    // 2. Получаем аналитику
    // Аналитика маршрутизации — только для администратора
    const anonymousAnalytics = await fetch(`${server.baseUrl}/api/chat/feedback/analytics`);
    assert.equal(anonymousAnalytics.status, 403);
    const analyticsRes = await fetch(`${server.baseUrl}/api/chat/feedback/analytics`, {
      headers: { 'x-admin-key': config.adminApiKey },
    });
    assert.equal(analyticsRes.status, 200);
    const analytics = (await analyticsRes.json()) as {
      summary: { likes: number };
      escalation?: { autoEscalateActive: unknown };
    };
    assert.equal(analytics.summary.likes >= 1, true);
    assert.ok(analytics.escalation);
    assert.ok(typeof analytics.escalation.autoEscalateActive === 'boolean');
  } finally {
    await server.close();
  }
});
