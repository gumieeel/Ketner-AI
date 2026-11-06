import assert from 'node:assert/strict';
import test from 'node:test';
import type { Attempt, AnswerResult } from '../attempt-store.js';
import type { RunSource } from '../operations.js';
import { computeProgress, PROGRESS_RULES, type RunQuestions } from './progress.js';
import type { Question } from './questions.js';

const SOURCES: RunSource[] = [
  { ref: 'S1', materialId: 'm1', materialName: 'Биология.pdf', sectionId: 's1', label: 'Стр. 1' },
  { ref: 'S2', materialId: 'm1', materialName: 'Биология.pdf', sectionId: 's2', label: 'Стр. 2' },
];

const question = (id: string, topic: string, ref = 'S1'): Question => ({
  id,
  type: 'choice',
  question: `Вопрос ${id}`,
  options: ['a', 'b'],
  correctIndex: 0,
  explanation: 'e',
  topic,
  evidence: 'x',
  sources: [ref],
});

const RUN: RunQuestions = {
  title: 'Клетка',
  sources: SOURCES,
  set: {
    title: 'Клетка',
    rejected: 0,
    questions: [
      question('q1', 'Ядро', 'S2'),
      question('q2', 'Ядро', 'S2'),
      question('q3', 'ядро ', 'S2'),
      question('q4', 'Мембрана'),
      question('q5', 'Митохондрии'),
      question('q6', 'Митохондрии'),
      question('q7', 'Митохондрии'),
    ],
  },
};

let seq = 0;
function attempt(
  results: Array<[string, AnswerResult['verdict']]>,
  patch: Partial<Attempt> = {},
): Attempt {
  seq += 1;
  const at = `2026-11-0${Math.min(9, seq)}T10:00:00.000Z`;
  const scored = results.map(([questionId, verdict]): AnswerResult => ({
    questionId,
    verdict,
    score: verdict === 'correct' ? 1 : verdict === 'partial' ? 0.5 : 0,
  }));
  return {
    id: `a${seq}`,
    runId: 'r1',
    solutionId: 's1',
    ownerId: 'alice',
    kind: 'quiz',
    status: results.some(([, verdict]) => verdict === 'pending') ? 'submitted' : 'graded',
    questionIds: results.map(([id]) => id),
    answers: {},
    results: scored,
    score: scored.reduce((sum, item) => sum + item.score, 0),
    maxScore: results.length,
    retryOf: null,
    gradeRunId: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    submittedAt: at,
    gradedAt: at,
    ...patch,
  };
}

const runs = new Map([['r1', RUN]]);

test('без попыток — предложение начать, никаких выводов о темах', () => {
  const progress = computeProgress([], runs);
  assert.deepEqual(progress.topics, []);
  assert.deepEqual(progress.recommendations, [{ kind: 'start' }]);
  assert.equal(progress.totals.accuracy, null);
});

test('мало ответов по теме — «мало данных», даже если все верны', () => {
  const progress = computeProgress(
    [
      attempt([
        ['q4', 'correct'],
        ['q5', 'correct'],
        ['q6', 'correct'],
      ]),
    ],
    runs,
  );
  const membrane = progress.topics.find((topic) => topic.topic === 'Мембрана')!;
  assert.equal(membrane.level, 'insufficient');
  assert.equal(membrane.answered, 1);
  assert.equal(
    progress.topics.find((topic) => topic.topic === 'Митохондрии')?.level,
    'insufficient',
  );
  assert.ok(!progress.topics.some((topic) => topic.level === 'strong'));
});

test('слабая тема — по настоящим ошибкам: точность, что перечитать, из какой попытки повторить', () => {
  const first = attempt([
    ['q1', 'incorrect'],
    ['q2', 'partial'],
    ['q3', 'correct'],
    ['q4', 'correct'],
  ]);
  const progress = computeProgress([first], runs);
  const nucleus = progress.topics[0]!;
  // «Ядро» и «ядро » — одна тема.
  assert.equal(nucleus.topic, 'Ядро');
  assert.equal(nucleus.answered, 3);
  assert.equal(nucleus.accuracy, 0.5);
  assert.equal(nucleus.level, 'weak');
  assert.deepEqual(
    nucleus.sources.map((source) => source.label),
    ['Стр. 2'],
  );
  assert.equal(nucleus.retryAttemptId, first.id);
  assert.deepEqual(progress.recommendations[0], {
    kind: 'retry_mistakes',
    topic: 'Ядро',
    attemptId: first.id,
    wrong: 2,
    answered: 3,
    sources: [SOURCES[1]],
  });
});

test('«стабильно верно» — только при достаточных данных: ответы, попытки и верный последний ответ', () => {
  const one = attempt([
    ['q5', 'correct'],
    ['q6', 'correct'],
    ['q7', 'correct'],
  ]);
  const two = attempt([
    ['q5', 'correct'],
    ['q6', 'correct'],
  ]);
  const strong = computeProgress([one, two], runs).topics.find(
    (topic) => topic.topic === 'Митохондрии',
  )!;
  assert.equal(strong.answered, 5);
  assert.equal(strong.attempts, 2);
  assert.equal(strong.level, 'strong');

  // Те же 5 верных, но в одной попытке — ещё не вывод.
  const single = attempt([
    ['q5', 'correct'],
    ['q6', 'correct'],
    ['q7', 'correct'],
    ['q5', 'correct'],
    ['q6', 'correct'],
  ]);
  assert.equal(
    computeProgress([single], runs).topics.find((t) => t.topic === 'Митохондрии')?.level,
    'developing',
  );

  // Последний ответ неверный — не «стабильно», даже при высокой точности.
  const lastWrong = computeProgress(
    [
      one,
      attempt([
        ['q5', 'correct'],
        ['q6', 'correct'],
        ['q7', 'correct'],
        ['q5', 'correct'],
        ['q6', 'correct'],
        ['q7', 'incorrect'],
      ]),
    ],
    runs,
  ).topics.find((t) => t.topic === 'Митохондрии')!;
  assert.ok(lastWrong.accuracy! >= PROGRESS_RULES.strongFrom);
  assert.notEqual(lastWrong.level, 'strong');
});

test('непроверенные ответы не идут в точность; пустой ответ — ошибка; попытка в процессе не считается', () => {
  const progress = computeProgress(
    [
      attempt([
        ['q1', 'pending'],
        ['q2', 'unanswered'],
        ['q3', 'correct'],
      ]),
      attempt([['q1', 'correct']], { status: 'in_progress', results: null, submittedAt: null }),
    ],
    runs,
  );
  const nucleus = progress.topics.find((topic) => topic.topic === 'Ядро')!;
  assert.equal(nucleus.pending, 1);
  assert.equal(nucleus.answered, 2);
  assert.equal(nucleus.incorrect, 1);
  assert.equal(nucleus.accuracy, 0.5);
  assert.equal(progress.totals.completed, 1);
  assert.equal(progress.totals.pending, 1);
  assert.equal(progress.history.length, 2);
});

test('попытки другого запуска или без вопросов в прогресс не попадают', () => {
  const foreign = attempt([['q1', 'incorrect']], { runId: 'gone' });
  const progress = computeProgress([foreign], runs);
  assert.deepEqual(progress.topics, []);
  assert.equal(progress.totals.completed, 0);
});
