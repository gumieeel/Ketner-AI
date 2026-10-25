import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completionBody,
  createConversation,
  readSseEvents,
  startTestServer,
  type SseEvent,
} from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import { setBalance } from '../services/credits-fixture.js';
import { maxCompareModels, parseCompareModelIds } from '../services/compare-policy.js';
import { CompareRunStore, type CompareRun } from '../store/compare-run-store.js';
import { CompareVoteStore } from '../store/compare-vote-store.js';

interface Account {
  token: string;
  userId: string;
  headers: Record<string, string>;
}

async function account(
  baseUrl: string,
  email: string,
  plan: 'plus' | 'pro' | 'ultra' | null,
): Promise<Account> {
  const registered = await signupAndVerify(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Compare User' }),
  });
  const body = (await registered.json()) as { token: string; user: { id: string } };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
  if (plan) {
    const checkout = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ planId: plan }),
    });
    assert.equal(checkout.status, 200);
  }
  return { token: body.token, userId: body.user.id, headers };
}

async function newConversation(baseUrl: string, who: Account): Promise<string> {
  const response = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: who.headers,
    body: JSON.stringify({ title: 'Сравнение' }),
  });
  const { conversation } = (await response.json()) as { conversation: { id: string } };
  return conversation.id;
}

function compare(
  baseUrl: string,
  who: Account,
  conversationId: string,
  modelIds: unknown,
  content = 'Объясни, что такое рекурсия',
): Promise<Response> {
  return fetch(`${baseUrl}/api/chat/compare`, {
    method: 'POST',
    headers: who.headers,
    body: JSON.stringify({
      conversationId,
      modelIds,
      language: 'ru',
      messages: [{ role: 'user', content }],
    }),
  });
}

function payloads<T>(events: SseEvent[], name: string): T[] {
  return events.filter((event) => event.event === name).map((event) => JSON.parse(event.data) as T);
}

test('политика: число моделей зависит от тарифа, форма списка проверяется', () => {
  assert.equal(maxCompareModels('free'), 0);
  assert.equal(maxCompareModels('plus'), 2);
  assert.equal(maxCompareModels('pro'), 3);
  assert.equal(maxCompareModels('gpt-pro'), 3, 'старые тарифы считаются как Pro');
  assert.equal(maxCompareModels('ultra'), 4);
  assert.equal(maxCompareModels(undefined), 0);

  assert.deepEqual(parseCompareModelIds(['a', ' b ', 'a']), { ok: true, ids: ['a', 'b'] });
  assert.equal(parseCompareModelIds('a').ok, false);
  assert.equal(parseCompareModelIds(['a']).ok, false);
  assert.equal(parseCompareModelIds(['a', 'a']).ok, false, 'повторы не считаются разными моделями');
  assert.equal(parseCompareModelIds(['a', 5]).ok, false);
  assert.equal(parseCompareModelIds(['a', '']).ok, false);
  assert.equal(parseCompareModelIds(['a', 'b', 'c', 'd', 'e']).ok, false);
});

test('хранилище запусков: чужой запуск не виден, срок и число на человека ограничены', () => {
  let now = 1_000;
  const runs = new CompareRunStore({ ttlMs: 100, maxPerUser: 2, now: () => now });
  const make = (id: string, userId: string): CompareRun => ({
    id,
    userId,
    conversationId: 'c',
    slots: [],
    savedSlot: null,
    savedMessageId: null,
    pickedSlot: null,
    createdAt: now,
  });
  runs.put(make('a', 'u1'));
  assert.ok(runs.get('a', 'u1'));
  assert.equal(runs.get('a', 'u2'), undefined, 'чужой id отвечает как несуществующий');

  now += 1;
  runs.put(make('b', 'u1'));
  now += 1;
  runs.put(make('c', 'u1'));
  assert.equal(runs.get('a', 'u1'), undefined, 'самый старый вытеснен по числу на человека');
  assert.ok(runs.get('c', 'u1'));

  now += 500;
  assert.equal(runs.get('c', 'u1'), undefined, 'по сроку запуск исчезает');
});

test('голоса: победы и участие считаются по моделям, смена выбора заменяет голос', () => {
  const votes = new CompareVoteStore(undefined);
  const vote = (id: string, winner: string, participants: string[]) =>
    votes.put({
      id,
      userId: 'u',
      conversationId: 'c',
      plan: 'plus',
      winnerModelId: winner,
      participantModelIds: participants,
      votedAt: new Date().toISOString(),
    });
  vote('r1', 'a', ['a', 'b']);
  vote('r2', 'a', ['a', 'b']);
  vote('r3', 'b', ['a', 'b']);
  vote('r3', 'a', ['a', 'b']); // тот же запуск: выбор изменён, голос один

  const stats = votes.stats();
  assert.equal(stats.totalVotes, 3);
  assert.deepEqual(stats.models[0], { modelId: 'a', comparisons: 3, wins: 3, winRatePct: 100 });
  assert.deepEqual(stats.models[1], { modelId: 'b', comparisons: 3, wins: 0, winRatePct: 0 });
});

test('сравнение: без входа 401, на Free 403, лишние модели и неизвестная модель 400', async () => {
  const server = await startTestServer();
  try {
    const anonymousConversation = await createConversation(server.baseUrl, 'Гость');
    const guest = await fetch(`${server.baseUrl}/api/chat/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...completionBody(anonymousConversation.id),
        modelIds: ['ketner-mini', 'claude-haiku-5.5'],
      }),
    });
    assert.equal(guest.status, 401);

    const free = await account(server.baseUrl, 'free-compare@example.com', null);
    const freeConversation = await newConversation(server.baseUrl, free);
    const freeResponse = await compare(server.baseUrl, free, freeConversation, [
      'ketner-mini',
      'claude-haiku-5.5',
    ]);
    assert.equal(freeResponse.status, 403);
    assert.equal(
      ((await freeResponse.json()) as { error: { code: string } }).error.code,
      'compare_plan_required',
    );

    const plus = await account(server.baseUrl, 'plus-compare@example.com', 'plus');
    const plusConversation = await newConversation(server.baseUrl, plus);

    const tooMany = await compare(server.baseUrl, plus, plusConversation, [
      'ketner-mini',
      'claude-haiku-5.5',
      'deepseek-v4.1-flash',
    ]);
    assert.equal(tooMany.status, 400);
    assert.equal(
      ((await tooMany.json()) as { error: { code: string } }).error.code,
      'too_many_models',
    );

    const unknown = await compare(server.baseUrl, plus, plusConversation, [
      'ketner-mini',
      'нет-такой-модели',
    ]);
    assert.equal(unknown.status, 400);
    assert.equal(
      ((await unknown.json()) as { error: { code: string } }).error.code,
      'unknown_model',
    );

    const single = await compare(server.baseUrl, plus, plusConversation, ['ketner-mini']);
    assert.equal(single.status, 400);

    const premium = await compare(server.baseUrl, plus, plusConversation, [
      'ketner-mini',
      'claude-opus-5.5',
    ]);
    assert.equal(premium.status, 403, 'Opus недоступен на Plus');
    assert.equal(
      ((await premium.json()) as { error: { code: string } }).error.code,
      'upgrade_required',
    );

    const missing = await compare(server.baseUrl, plus, 'нет-диалога', [
      'ketner-mini',
      'claude-haiku-5.5',
    ]);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test('сравнение: каждая колонка отвечает своей моделью, первый ответ сохраняется в диалог', async () => {
  const server = await startTestServer();
  try {
    const plus = await account(server.baseUrl, 'plus-stream@example.com', 'plus');
    const conversationId = await newConversation(server.baseUrl, plus);

    const response = await compare(server.baseUrl, plus, conversationId, [
      'ketner-mini',
      'claude-haiku-5.5',
    ]);
    assert.equal(response.status, 200);
    const events = await readSseEvents(response);

    const [start] = payloads<{ runId: string; slots: Array<{ slot: number; modelName: string }> }>(
      events,
      'compare_start',
    );
    assert.ok(start.runId);
    assert.equal(start.slots.length, 2);

    const done = payloads<{ slot: number; selectedModel: { id: string }; latencyMs: number }>(
      events,
      'compare_slot_done',
    );
    assert.equal(done.length, 2);
    assert.deepEqual(done.map((item) => item.selectedModel.id).sort(), [
      'claude-haiku-5.5',
      'ketner-mini',
    ]);

    for (const slot of [0, 1]) {
      const text = payloads<{ slot: number; content: string }>(events, 'compare_delta')
        .filter((delta) => delta.slot === slot)
        .map((delta) => delta.content)
        .join('');
      assert.ok(text.length > 0, `колонка ${slot} получила текст`);
    }

    const [finish] = payloads<{ runId: string; savedMessageId: string; defaultSlot: number }>(
      events,
      'compare_done',
    );
    assert.equal(finish.runId, start.runId);
    assert.ok(finish.savedMessageId);

    const stored = await fetch(`${server.baseUrl}/api/conversations/${conversationId}`, {
      headers: plus.headers,
    });
    const { messages } = (await stored.json()) as {
      messages: Array<{ id: string; role: string; content: string }>;
    };
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[1].id, finish.savedMessageId);
    assert.ok(messages[1].content.length > 0);
  } finally {
    await server.close();
  }
});

test('выбор лучшего ответа заменяет сохранённый ответ и записывает голос; чужой и повторный выбор', async () => {
  const server = await startTestServer();
  try {
    const plus = await account(server.baseUrl, 'plus-pick@example.com', 'plus');
    const other = await account(server.baseUrl, 'other-pick@example.com', 'plus');
    const conversationId = await newConversation(server.baseUrl, plus);

    const events = await readSseEvents(
      await compare(server.baseUrl, plus, conversationId, ['ketner-mini', 'claude-haiku-5.5']),
    );
    const [finish] = payloads<{ runId: string; defaultSlot: number }>(events, 'compare_done');
    const otherSlot = finish.defaultSlot === 0 ? 1 : 0;
    const slotText = (slot: number) =>
      payloads<{ slot: number; content: string }>(events, 'compare_delta')
        .filter((delta) => delta.slot === slot)
        .map((delta) => delta.content)
        .join('');

    const pick = (who: Account, body: unknown) =>
      fetch(`${server.baseUrl}/api/chat/compare/pick`, {
        method: 'POST',
        headers: who.headers,
        body: JSON.stringify(body),
      });

    // Чужой пользователь не видит запуск.
    assert.equal((await pick(other, { runId: finish.runId, slot: otherSlot })).status, 410);
    assert.equal((await pick(plus, { runId: 'нет', slot: 0 })).status, 410);
    assert.equal((await pick(plus, { runId: finish.runId, slot: 'x' })).status, 400);
    assert.equal((await pick(plus, { runId: finish.runId, slot: 9 })).status, 400);

    const picked = await pick(plus, { runId: finish.runId, slot: otherSlot });
    assert.equal(picked.status, 200);
    const afterPick = server.compareVotes.stats();
    assert.equal(afterPick.totalVotes, 1, 'выбор записан как голос');
    assert.equal(
      afterPick.models.reduce((sum, model) => sum + model.wins, 0),
      1,
    );
    const pickedBody = (await picked.json()) as { messageId: string; modelId: string };

    const stored = await fetch(`${server.baseUrl}/api/conversations/${conversationId}`, {
      headers: plus.headers,
    });
    const { messages } = (await stored.json()) as {
      messages: Array<{ id: string; role: string; content: string }>;
    };
    assert.equal(messages.length, 2, 'ответ заменён, а не добавлен');
    assert.equal(messages[1].content, slotText(otherSlot));
    assert.equal(messages[1].id, pickedBody.messageId);

    // Смена выбора: возврат к первой колонке.
    const back = await pick(plus, { runId: finish.runId, slot: finish.defaultSlot });
    assert.equal(back.status, 200);
    const again = await fetch(`${server.baseUrl}/api/conversations/${conversationId}`, {
      headers: plus.headers,
    });
    const afterBack = (await again.json()) as { messages: Array<{ content: string }> };
    assert.equal(afterBack.messages[1].content, slotText(finish.defaultSlot));

    // Диалог продолжился: заменять ответ посреди истории нельзя.
    const next = await fetch(`${server.baseUrl}/api/chat/completions`, {
      method: 'POST',
      headers: plus.headers,
      body: JSON.stringify({
        conversationId,
        modelId: 'ketner-mini',
        language: 'ru',
        messages: [
          ...afterBack.messages.map((message, index) => ({
            role: index === 0 ? 'user' : 'assistant',
            content: message.content,
          })),
          { role: 'user', content: 'А теперь короче' },
        ],
      }),
    });
    assert.equal(next.status, 200);
    await readSseEvents(next);
    const stale = await pick(plus, { runId: finish.runId, slot: otherSlot });
    assert.equal(stale.status, 409);
  } finally {
    await server.close();
  }
});

test('строгий режим: если на модель не хватает кредитов, колонка получает ошибку, а не подмену', async () => {
  const server = await startTestServer();
  try {
    const plus = await account(server.baseUrl, 'plus-strict@example.com', 'plus');
    const conversationId = await newConversation(server.baseUrl, plus);

    // GPT-6.1 Sol стоит ≈ 35 кредитов за запрос, Ketner Mini — меньше двух.
    setBalance(server.credits, plus.userId, 'plus', 10);

    const events = await readSseEvents(
      await compare(server.baseUrl, plus, conversationId, ['gpt-6.1-sol', 'ketner-mini']),
    );
    const errors = payloads<{ slot: number; code: string }>(events, 'compare_slot_error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].slot, 0);
    assert.equal(errors[0].code, 'insufficient_credits');

    const done = payloads<{ slot: number; selectedModel: { id: string } }>(
      events,
      'compare_slot_done',
    );
    assert.equal(done.length, 1);
    assert.equal(done[0].selectedModel.id, 'ketner-mini');

    const [finish] = payloads<{ defaultSlot: number }>(events, 'compare_done');
    assert.equal(finish.defaultSlot, 1, 'в диалог попал ответ колонки без ошибки');
  } finally {
    await server.close();
  }
});

test('GET /api/chat/compare/stats доступен только администратору', async () => {
  const server = await startTestServer();
  try {
    const plus = await account(server.baseUrl, 'plus-stats@example.com', 'plus');
    const response = await fetch(`${server.baseUrl}/api/chat/compare/stats`, {
      headers: plus.headers,
    });
    assert.equal(response.status, 403);
  } finally {
    await server.close();
  }
});
