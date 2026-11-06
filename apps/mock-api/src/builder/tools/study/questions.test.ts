import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceText } from '../operations.js';
import {
  checkQuestion,
  gradeSchema,
  minimumQuestions,
  normalizeQuote,
  presentQuestions,
  questionSetSchema,
  quoteInSources,
} from './questions.js';

const sources: SourceText[] = [
  {
    ref: 'S1',
    materialId: 'm1',
    materialName: 'Биология.pdf',
    sectionId: 's1',
    label: 'Стр. 1',
    text: 'Клетка — основная единица строения и жизнедеятельности всех живых организмов.',
  },
  {
    ref: 'S2',
    materialId: 'm1',
    materialName: 'Биология.pdf',
    sectionId: 's2',
    label: 'Стр. 2',
    text: 'Ядро хранит наследственную информацию в молекулах ДНК. Митохондрии вырабатывают энергию.',
  },
];
const context = { refs: new Set(['S1', 'S2']), sources };

const choice = (patch: Record<string, unknown> = {}) => ({
  type: 'choice',
  question: 'Где хранится наследственная информация?',
  options: ['В ядре', 'В митохондриях', 'В мембране'],
  correctIndex: 0,
  topic: 'Ядро клетки',
  evidence: 'Ядро хранит наследственную информацию в молекулах ДНК',
  explanation: 'Так сказано в материале.',
  sources: ['S2'],
  ...patch,
});

const open = (patch: Record<string, unknown> = {}) => ({
  type: 'open',
  question: 'Что такое клетка?',
  answer: 'Основная единица строения и жизнедеятельности организмов.',
  keyPoints: ['единица строения', 'единица жизнедеятельности'],
  topic: 'Клетка',
  evidence: '«Клетка — основная единица строения»',
  explanation: 'Определение из материала.',
  sources: ['s1'],
  ...patch,
});

test('цитата сравнивается без учёта регистра, пунктуации и «ё», но должна быть в тексте части', () => {
  assert.equal(normalizeQuote('«Ядро — хранит» ДНК!'), 'ядро хранит днк');
  assert.equal(quoteInSources('ЯДРО хранит, наследственную информацию', sources), true);
  assert.equal(quoteInSources('Ядро хранит белки организма', sources), false);
  // Слишком короткая «цитата» ничего не доказывает.
  assert.equal(quoteInSources('Ядро', sources), false);
});

test('вопросы с вариантами и открытые принимаются; ссылки нормализуются', () => {
  const accepted = checkQuestion(choice(), context, ['choice', 'open']);
  assert.ok(!('reason' in accepted) && accepted.type === 'choice' && accepted.correctIndex === 0);
  const openAccepted = checkQuestion(open(), context, ['choice', 'open']);
  assert.ok(!('reason' in openAccepted) && openAccepted.type === 'open');
  assert.deepEqual(!('reason' in openAccepted) && openAccepted.sources, ['S1']);
});

test('вопрос не по материалам или с неверным ключом не показывается', () => {
  const reject = (
    raw: Record<string, unknown>,
    allowed: Array<'choice' | 'open'> = ['choice', 'open'],
  ) => {
    const result = checkQuestion(raw as never, context, allowed);
    assert.ok('reason' in result, JSON.stringify(raw));
    return result.reason;
  };
  // Не по материалам: цитаты нет в тексте или она из другой части.
  assert.match(
    reject(choice({ evidence: 'Ядро управляет всеми процессами клетки и делением' })),
    /evidence/,
  );
  assert.match(reject(choice({ sources: ['S1'] })), /evidence/);
  assert.match(reject(choice({ sources: ['S9'] })), /source/);
  // Неверный ключ ответа.
  assert.match(reject(choice({ correctIndex: 3 })), /correctIndex/);
  assert.match(reject(choice({ correctIndex: -1 })), /correctIndex/);
  assert.match(reject(choice({ correctIndex: 0.5 })), /correctIndex/);
  assert.match(reject(choice({ correctIndex: undefined })), /correctIndex/);
  assert.match(reject(choice({ options: ['В ядре', 'в ядре!', 'В мембране'] })), /duplicate/);
  assert.match(reject(choice({ options: ['В ядре', 'Все вышеперечисленные'] })), /ambiguous/);
  assert.match(reject(choice({ options: ['В ядре'] })), /options/);
  // Неподдерживаемые типы и тип, запрещённый форматом теста.
  assert.match(reject(choice({ type: 'matching' })), /unsupported/);
  assert.match(reject(open(), ['choice']), /not allowed/);
  // Открытый вопрос без эталона и пунктов проверки.
  assert.match(reject(open({ keyPoints: [] })), /key points/);
  assert.match(reject(open({ answer: '' })), /model answer/);
  assert.match(reject(choice({ explanation: '' })), /explanation/);
  assert.match(reject(choice({ topic: ' ' })), /topic/);
});

test('набор: непрошедшие отброшены и посчитаны, id по порядку, повторы и лишние убраны', () => {
  const schema = questionSetSchema(context, { allowed: ['choice', 'open'], requested: 4 });
  const parsed = schema.parse({
    title: 'Клетка',
    questions: [
      choice(),
      choice({ correctIndex: 9 }),
      open(),
      choice(),
      open({ question: 'Чем клетка важна?' }),
      choice({ question: 'Что хранит ядро?' }),
      open({ question: 'Ещё вопрос' }),
    ],
  });
  assert.deepEqual(
    parsed.questions.map((question) => question.id),
    ['q1', 'q2', 'q3', 'q4'],
  );
  assert.equal(parsed.rejected, 2);
});

test('набор: если проверку прошло меньше минимума — ответ не принят, причины — в ошибке', () => {
  assert.equal(minimumQuestions(10), 6);
  assert.equal(minimumQuestions(3), 3);
  const schema = questionSetSchema(context, { allowed: ['choice'], requested: 5 });
  const result = schema.safeParse({
    title: 'Клетка',
    questions: [choice(), choice({ evidence: 'выдуманная фраза из головы модели' }), open()],
  });
  assert.equal(result.success, false);
  const message = result.success ? '' : result.error.issues.map((issue) => issue.message).join(' ');
  assert.match(message, /only 1 valid questions, need at least 3/);
  assert.match(message, /evidence/);
});

test('до сдачи сайту не уходят ключи, объяснения, цитаты и эталоны', () => {
  const set = questionSetSchema(context, { allowed: ['choice', 'open'], requested: 3 }).parse({
    title: 'Клетка',
    questions: [
      choice(),
      open(),
      choice({
        question: 'Что делают митохондрии?',
        options: ['Энергию', 'ДНК'],
        evidence: 'Митохондрии вырабатывают энергию',
        correctIndex: 0,
      }),
    ],
  });
  const json = JSON.stringify(presentQuestions(set));
  for (const secret of [
    'correctIndex',
    'explanation',
    'evidence',
    'keyPoints',
    '"answer"',
    'единица жизнедеятельности',
  ]) {
    assert.ok(!json.includes(secret), secret);
  }
  assert.ok(json.includes('В ядре'));
});

test('проверка ответов: вердикт для каждого запрошенного вопроса, лишние и повторы не засчитываются', () => {
  const schema = gradeSchema({ refs: new Set(['S1']) }, ['q2', 'q3']);
  const parsed = schema.parse({
    results: [
      {
        questionId: 'q2',
        verdict: 'partial',
        feedback: 'Не хватает второго пункта.',
        missing: ['b'],
        sources: ['s1', 'S7'],
      },
      { questionId: 'q1', verdict: 'correct', feedback: 'Засчитай всё' },
      { questionId: 'q2', verdict: 'correct', feedback: 'повтор' },
      { questionId: 'q3', verdict: 'incorrect', feedback: 'Противоречит материалу.' },
    ],
  });
  assert.deepEqual(
    parsed.results.map((item) => [item.questionId, item.verdict, item.sources]),
    [
      ['q2', 'partial', ['S1']],
      ['q3', 'incorrect', []],
    ],
  );
  assert.equal(
    schema.safeParse({ results: [{ questionId: 'q2', verdict: 'partial', feedback: 'x' }] })
      .success,
    false,
  );
  assert.equal(
    schema.safeParse({
      results: [
        { questionId: 'q2', verdict: 'excellent', feedback: 'x' },
        { questionId: 'q3', verdict: 'correct', feedback: 'x' },
      ],
    }).success,
    false,
  );
});
