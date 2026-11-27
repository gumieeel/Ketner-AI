import assert from 'node:assert/strict';
import test from 'node:test';
import { gateQuestions, missingKeyFacts, needsKeyAnswer } from './key-facts.js';
import { contextSystemPrompt } from './prompts.js';
import { contextOutputSchema } from './schemas.js';

const thin = (extra: Record<string, unknown> = {}) =>
  contextOutputSchema.parse({ domain: 'Магазин', summary: 'Продаём одежду', ...extra });

test('тонкий разбор: все четыре ключевых факта неизвестны — четыре обязательных вопроса без пропуска', () => {
  const context = thin();
  assert.deepEqual(missingKeyFacts(context), [
    'channels',
    'after_request',
    'volume',
    'data_location',
  ]);
  const questions = gateQuestions(context, 'ru');
  assert.deepEqual(
    questions.map((question) => [question.id, question.fact, question.optional]),
    [
      ['f_chan', 'channels', false],
      ['f_flow', 'after_request', false],
      ['f_vol', 'volume', false],
      ['f_data', 'data_location', false],
    ],
  );
  // Лимит в три вопроса расширяется до числа неизвестных фактов.
  assert.ok(questions.every(needsKeyAnswer));
  assert.equal(
    gateQuestions(context, 'en')[0]?.text,
    'Where do customers write to you most often?',
  );
});

test('факты известны из разбора — ключевых вопросов нет, вопросы модели как есть', () => {
  const context = thin({
    tasks: [{ id: 't1', title: 'Ответы', timesPerDay: 30, source: 'user' }],
    recurringProcesses: [{ title: 'Заявка', steps: ['Пишет', 'Отвечаю'] }],
    tools: [{ text: 'Google Таблицы', source: 'user' }],
    profile: { customerChannels: ['instagram'] },
    questions: [
      { id: 'q1', text: 'Есть ли прайс?', reason: 'Знания', optional: true, kind: 'text' },
    ],
  });
  assert.deepEqual(missingKeyFacts(context), []);
  assert.deepEqual(
    gateQuestions(context, 'ru').map((question) => [question.id, question.optional]),
    [['q1', true]],
  );
  // Объём из профиля тоже считается.
  assert.deepEqual(
    missingKeyFacts(thin({ profile: { customerChannels: ['phone'], monthlyOrders: 200 } })),
    ['after_request', 'data_location'],
  );
});

test('вопрос модели о том же факте используется вместо серверного и становится обязательным; остальные — до лимита', () => {
  const context = thin({
    profile: { customerChannels: ['whatsapp'], monthlyRequests: 900 },
    recurringProcesses: [{ title: 'Заявка', steps: ['Пишет'] }],
    questions: [
      { id: 'q1', text: 'Какие вопросы чаще?', reason: 'Знания', optional: true, kind: 'text' },
      {
        id: 'q2',
        text: 'Где лежат заказы?',
        reason: 'Интеграции',
        optional: true,
        kind: 'text',
        fact: 'data_location',
      },
      // Факт уже известен — пометка снимается, вопрос остаётся обычным.
      {
        id: 'q3',
        text: 'Куда пишут клиенты?',
        reason: 'Канал',
        optional: true,
        kind: 'text',
        fact: 'channels',
      },
    ],
  });
  const questions = gateQuestions(context, 'ru');
  assert.deepEqual(
    questions.map((question) => [question.id, question.fact ?? null, question.optional]),
    [
      ['q2', 'data_location', false],
      ['q1', null, true],
      ['q3', null, true],
    ],
  );
  assert.deepEqual(questions.map(needsKeyAnswer), [true, false, false]);
});

test('ответ модели с неизвестной пометкой факта не ломает разбор', () => {
  const parsed = contextOutputSchema.parse({
    domain: 'd',
    summary: 's',
    questions: [{ id: 'q1', text: 't', optional: false, fact: 'weather' }],
  });
  assert.equal(parsed.questions[0]?.fact, null);
});

test('промпт разбора просит помечать вопросы о ключевых фактах', () => {
  for (const language of ['ru', 'en'] as const) {
    const prompt = contextSystemPrompt(language);
    for (const fact of ['channels', 'after_request', 'volume', 'data_location']) {
      assert.ok(prompt.includes(`"${fact}"`), `${language}: ${fact}`);
    }
  }
});
