import assert from 'node:assert/strict';
import test from 'node:test';
import { readSseEvents, startTestServer, type SseEvent } from '../testing/server.js';
import { signupAndVerify } from '../testing/signup.js';
import type { AnswerReview } from '../types.js';

interface Account {
  userId: string;
  headers: Record<string, string>;
}

async function account(
  baseUrl: string,
  email: string,
  plan: 'plus' | 'pro' | null,
): Promise<Account> {
  const registered = await signupAndVerify(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', name: 'Review User' }),
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
  return { userId: body.user.id, headers };
}

function payloads<T>(events: SseEvent[], name: string): T[] {
  return events.filter((event) => event.event === name).map((event) => JSON.parse(event.data) as T);
}

interface StoredMessage {
  id: string;
  role: string;
  content: string;
  modelId?: string;
  review?: AnswerReview;
}

async function conversationWithAnswer(
  baseUrl: string,
  who: Account,
  modelId: string,
): Promise<{ conversationId: string; answer: StoredMessage }> {
  const created = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: who.headers,
    body: JSON.stringify({ title: 'Проверка' }),
  });
  const { conversation } = (await created.json()) as { conversation: { id: string } };
  const completion = await fetch(`${baseUrl}/api/chat/completions`, {
    method: 'POST',
    headers: who.headers,
    body: JSON.stringify({
      conversationId: conversation.id,
      modelId,
      language: 'ru',
      messages: [{ id: 'q-1', role: 'user', content: 'Какая столица Австралии?' }],
    }),
  });
  assert.equal(completion.status, 200);
  await completion.text();
  const messages = await readMessages(baseUrl, who, conversation.id);
  const answer = messages.find((message) => message.role === 'assistant');
  assert.ok(answer, 'ответ сохранён в диалоге');
  return { conversationId: conversation.id, answer };
}

async function readMessages(
  baseUrl: string,
  who: Account,
  conversationId: string,
): Promise<StoredMessage[]> {
  const stored = await fetch(`${baseUrl}/api/conversations/${conversationId}`, {
    headers: who.headers,
  });
  return ((await stored.json()) as { messages: StoredMessage[] }).messages;
}

function review(baseUrl: string, who: Account | null, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/chat/review`, {
    method: 'POST',
    headers: who?.headers ?? { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('проверка ответа: модель другой компании, итог сохраняется у сообщения', async () => {
  const server = await startTestServer();
  try {
    const plus = await account(server.baseUrl, 'review-plus@example.com', 'plus');
    const { conversationId, answer } = await conversationWithAnswer(
      server.baseUrl,
      plus,
      'claude-haiku-5.5',
    );

    const response = await review(server.baseUrl, plus, {
      conversationId,
      messageId: answer.id,
      language: 'ru',
    });
    assert.equal(response.status, 200);
    const events = await readSseEvents(response);
    const [start] = payloads<{ reviewId: string; quota: { limit: number; remaining: number } }>(
      events,
      'review_start',
    );
    assert.ok(start.reviewId);
    assert.equal(start.quota.limit, 10);

    const [reviewer] = payloads<{ reviewer: { developer: string } }>(events, 'review_reviewer');
    assert.notEqual(reviewer.reviewer.developer, 'Anthropic', 'Claude не проверяет Claude');

    const [done] = payloads<{ review: AnswerReview; quota: { remaining: number } }>(
      events,
      'review_done',
    );
    assert.ok(done, 'проверка завершилась');
    assert.equal(done.review.verdict, 'minor');
    assert.equal(done.review.authorModelId, 'claude-haiku-5.5');
    assert.equal(done.quota.remaining, 9, 'проверка списана из суточного лимита');
    assert.ok(done.review.issues[0].quote && answer.content.includes(done.review.issues[0].quote));

    const messages = await readMessages(server.baseUrl, plus, conversationId);
    const stored = messages.find((message) => message.id === answer.id);
    assert.equal(stored?.review?.id, done.review.id, 'итог виден после перезагрузки');

    const quota = await fetch(`${server.baseUrl}/api/chat/review/quota`, { headers: plus.headers });
    assert.deepEqual(await quota.json(), { used: 1, limit: 10, remaining: 9 });
  } finally {
    await server.close();
  }
});

test('проверка ответа: гость 401, чужое и не то сообщение 404/400, суточный лимит 429', async () => {
  const server = await startTestServer();
  try {
    const free = await account(server.baseUrl, 'review-free@example.com', null);
    const other = await account(server.baseUrl, 'review-other@example.com', null);
    const { conversationId, answer } = await conversationWithAnswer(
      server.baseUrl,
      free,
      'ketner-mini',
    );
    const body = { conversationId, messageId: answer.id };

    assert.equal((await review(server.baseUrl, null, body)).status, 401);
    assert.equal((await review(server.baseUrl, other, body)).status, 404, 'чужой диалог не виден');
    assert.equal(
      (await review(server.baseUrl, free, { conversationId, messageId: 'q-1' })).status,
      400,
      'вопрос пользователя не проверяется',
    );
    assert.equal((await review(server.baseUrl, free, { conversationId })).status, 400);

    // На Free две проверки в сутки.
    for (let index = 0; index < 2; index++) {
      const events = await readSseEvents(await review(server.baseUrl, free, body));
      assert.equal(payloads(events, 'review_done').length, 1);
    }
    const limited = await review(server.baseUrl, free, body);
    assert.equal(limited.status, 429);
    assert.equal(
      ((await limited.json()) as { error: { code: string } }).error.code,
      'review_limit',
    );
  } finally {
    await server.close();
  }
});

test('консилиум: судья пишет итог по ответам колонок, итог можно сохранить в диалог', async () => {
  const server = await startTestServer();
  try {
    const plus = await account(server.baseUrl, 'judge-plus@example.com', 'plus');
    const other = await account(server.baseUrl, 'judge-other@example.com', 'plus');
    const created = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: plus.headers,
      body: JSON.stringify({ title: 'Консилиум' }),
    });
    const { conversation } = (await created.json()) as { conversation: { id: string } };
    const compareEvents = await readSseEvents(
      await fetch(`${server.baseUrl}/api/chat/compare`, {
        method: 'POST',
        headers: plus.headers,
        body: JSON.stringify({
          conversationId: conversation.id,
          modelIds: ['ketner-mini', 'claude-haiku-5.5'],
          language: 'ru',
          messages: [{ role: 'user', content: 'Объясни рекурсию' }],
        }),
      }),
    );
    const [finish] = payloads<{ runId: string }>(compareEvents, 'compare_done');

    const judge = (who: Account, runId: string) =>
      fetch(`${server.baseUrl}/api/chat/compare/judge`, {
        method: 'POST',
        headers: who.headers,
        body: JSON.stringify({ runId, language: 'ru' }),
      });
    assert.equal((await judge(other, finish.runId)).status, 410, 'чужой запуск не виден');

    const events = await readSseEvents(await judge(plus, finish.runId));
    const [reviewer] = payloads<{ reviewer: { developer: string } }>(events, 'judge_reviewer');
    assert.ok(
      !['OpenAI', 'Anthropic'].includes(reviewer.reviewer.developer),
      'судья — третья компания',
    );
    const shown = payloads<{ content: string }>(events, 'judge_delta')
      .map((delta) => delta.content)
      .join('');
    assert.ok(!shown.includes('<<<DISPUTES>>>'), 'маркер не уходит в ответ');
    const [done] = payloads<{
      judge: {
        content: string;
        disputes: unknown[];
        agreement: string;
        judge: { modelId: string };
      };
    }>(events, 'judge_done');
    assert.ok(done.judge.content.length > 0);
    assert.equal(done.judge.content, shown.trim());
    assert.equal(done.judge.disputes.length, 1);
    assert.equal(done.judge.agreement, 'partial');

    const save = await fetch(`${server.baseUrl}/api/chat/compare/judge/save`, {
      method: 'POST',
      headers: plus.headers,
      body: JSON.stringify({ runId: finish.runId }),
    });
    assert.equal(save.status, 200);
    const saved = (await save.json()) as { messageId: string; modelId: string };
    const messages = await readMessages(server.baseUrl, plus, conversation.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].id, saved.messageId);
    assert.equal(messages[1].content, done.judge.content);
    assert.equal(messages[1].modelId, done.judge.judge.modelId);

    // После итога судьи можно вернуться к ответу колонки.
    const pick = await fetch(`${server.baseUrl}/api/chat/compare/pick`, {
      method: 'POST',
      headers: plus.headers,
      body: JSON.stringify({ runId: finish.runId, slot: 0 }),
    });
    assert.equal(pick.status, 200);
    const afterPick = await readMessages(server.baseUrl, plus, conversation.id);
    assert.notEqual(afterPick[1].content, done.judge.content);
  } finally {
    await server.close();
  }
});
