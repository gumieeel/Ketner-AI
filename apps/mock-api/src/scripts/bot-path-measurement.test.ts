import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_HISTORY } from '../builder/bot-service.js';
import {
  pickConversations,
  replay,
  report,
  similarity,
  summarize,
  turnsOf,
  type Answerer,
  type RecordedConversation,
} from './bot-path-measurement.js';

const conversation = (id: string, questions: string[]): RecordedConversation => ({
  id,
  messages: questions.flatMap((q, i) => [
    { role: 'user' as const, content: q },
    { role: 'assistant' as const, content: `Ответ ${i + 1}` },
  ]),
});

test('3e: выбор диалогов и ходов — та же история для обоих путей, не длиннее BOT_HISTORY', () => {
  const empty: RecordedConversation = {
    id: 'empty',
    messages: [{ role: 'assistant', content: 'Привет' }],
  };
  const long = conversation(
    'long',
    Array.from({ length: 10 }, (_, i) => `Вопрос ${i + 1}`),
  );
  const picked = pickConversations([empty, long, conversation('b', ['Цены?'])], 20);
  assert.deepEqual(
    picked.map((c) => c.id),
    ['long', 'b'],
  );
  const turns = turnsOf(picked, 3);
  assert.deepEqual(
    turns.map((t) => [t.conversationId, t.index, t.question, t.history.length]),
    [
      ['long', 0, 'Вопрос 1', 0],
      ['long', 1, 'Вопрос 2', 2],
      ['long', 2, 'Вопрос 3', 4],
      ['b', 0, 'Цены?', 0],
    ],
  );
  const late = turnsOf([long], 10).at(-1)!;
  assert.equal(late.history.length, BOT_HISTORY);
  assert.equal(late.history.at(-1)?.content, 'Ответ 9');
  assert.equal(pickConversations([long, long, long], 2).length, 2);
});

test('3e: повтор — оба пути на каждом ходу, порядок чередуется, метка контакта снимается', async () => {
  const calls: string[] = [];
  const answer =
    (path: string, text: string, extra: Partial<Awaited<ReturnType<Answerer>>> = {}): Answerer =>
    async (turn, key) => {
      calls.push(`${path}:${turn.index}`);
      assert.ok(key.startsWith(`${path}:`));
      return {
        text,
        offerContact: false,
        costUsd: 0.002,
        creditsUsd: 0.002,
        steps: 1,
        toolCalls: 0,
        stopReason: 'answer',
        finalStep: false,
        errorCode: null,
        model: 'm',
        ...extra,
      };
    };
  const turns = turnsOf([conversation('c', ['Доставка?', 'Астана?'])], 3);
  const results = await replay(turns, {
    legacy: answer('legacy', 'Доставка по Алматы 1500 тенге.\n[[CONTACT]]'),
    platform: answer('platform', 'Доставка по Алматы 1500 тенге.', {
      costUsd: 0.005,
      creditsUsd: 0.005,
      steps: 2,
      toolCalls: 1,
      offerContact: true,
    }),
  });
  assert.deepEqual(calls, ['legacy:0', 'platform:0', 'platform:1', 'legacy:1']);
  assert.equal(results[0]!.legacy.text, 'Доставка по Алматы 1500 тенге.');
  assert.equal(results[0]!.legacy.offerContact, true, '[[CONTACT]] → форма контакта');
  assert.equal(results[0]!.similarity, 1);

  const legacy = summarize(results, 'legacy');
  const platform = summarize(results, 'platform');
  assert.deepEqual(
    [legacy.costUsd, platform.costUsd, platform.stepsMean, platform.toolCalls, platform.credits],
    [0.004, 0.01, 2, 2, 10],
  );
  const markdown = report(results, {
    solutionId: 'sol-1',
    plan: 'credits',
    conversations: 1,
    startedAt: '2026-11-14T00:00:00.000Z',
  });
  assert.match(markdown, /×2\.5/);
  assert.match(markdown, /не превышен/);
  assert.match(markdown, /\| Шагов модели: среднее \/ максимум \| 1 \/ 1 \| 2 \/ 2 \|/);
});

test('3e: сходство по словам', () => {
  assert.equal(similarity('Доставка — 1 500 ₸', 'доставка 1 500'), 1);
  assert.equal(similarity('да', 'нет'), 0);
  assert.equal(similarity('', ''), 1);
});
