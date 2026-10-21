import assert from 'node:assert/strict';
import test from 'node:test';
import { modelRegistry } from '../ai/model-registry.js';
import {
  buildCodeReviewInput,
  buildFixTask,
  extractJsonObject,
  JUDGE_MARKER,
  JudgeStreamSplitter,
  parseAnswerReview,
  parseCodeReview,
  parseJudgeTail,
  runReviewTask,
} from './answer-review.js';
import { dailyReviewLimit, developerOf, pickReviewers } from './review-policy.js';

test('JSON рецензента находится в ограде, после размышлений и с фигурными скобками в строках', () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(
    extractJsonObject('<think>{"x":"черновик"}</think>Итог: {"a":"{не конец}"} спасибо'),
    {
      a: '{не конец}',
    },
  );
  assert.deepEqual(extractJsonObject('{"a":"кавычка \\" внутри","b":{"c":2}}'), {
    a: 'кавычка " внутри',
    b: { c: 2 },
  });
  assert.equal(extractJsonObject('просто текст'), null);
  assert.equal(extractJsonObject('{"оборван": '), null);
  assert.equal(extractJsonObject('[1,2]'), null);
});

test('проверка ответа: цитаты сверяются с ответом, итог согласуется с замечаниями', () => {
  const answer = 'Столица Австралии — Сидней. Население около 26 млн.';
  const parsed = parseAnswerReview(
    JSON.stringify({
      verdict: 'ok',
      summary: 'В целом верно',
      issues: [
        { severity: 'low', quote: 'около 26 млн', problem: 'устарело', fix: '27 млн' },
        { severity: 'high', quote: 'Столица Австралии — Сидней', problem: 'Столица — Канберра' },
        { severity: 'medium', quote: 'выдуманная цитата', problem: 'неточно' },
        { severity: 'low', problem: '' },
      ],
      corrected: 'Столица Австралии — Канберра.',
    }),
    answer,
  );
  assert.equal(parsed.verdict, 'minor', 'ok с серьёзным замечанием не остаётся ok');
  assert.equal(parsed.issues.length, 3, 'пустое замечание отброшено');
  assert.equal(parsed.issues[0].severity, 'high', 'серьёзные замечания первыми');
  assert.equal(parsed.issues[0].quote, 'Столица Австралии — Сидней');
  const invented = parsed.issues.find((issue) => issue.problem.includes('выдуманная'));
  assert.ok(
    invented && !invented.quote,
    'цитата, которой нет в ответе, не показывается как цитата',
  );
  assert.equal(parsed.corrected, undefined, 'исправленный ответ только при major/wrong');

  const wrong = parseAnswerReview('{"verdict":"WRONG","issues":[],"corrected":"Канберра"}', answer);
  assert.equal(wrong.verdict, 'wrong');
  assert.equal(wrong.corrected, 'Канберра');

  const inferred = parseAnswerReview(
    '{"issues":[{"severity":"critical","problem":"ошибка"}]}',
    answer,
  );
  assert.equal(inferred.verdict, 'major', 'итог выводится из замечаний, если не указан');

  const garbage = parseAnswerReview('Ответ выглядит верным, ошибок не вижу.', answer);
  assert.equal(garbage.verdict, 'unknown');
  assert.match(garbage.summary, /ошибок не вижу/);
});

test('ревью кода: строки, файлы и итог; серьёзная ошибка не даёт approve', () => {
  const parsed = parseCodeReview(
    JSON.stringify({
      verdict: 'approve',
      summary: 'Почти готово',
      issues: [
        { severity: 'low', file: 'src/a.ts', line: 3, problem: 'лишний лог' },
        {
          severity: 'high',
          path: 'src/b.ts',
          line: 'десять',
          problem: 'SQL-инъекция',
          fix: 'параметры',
        },
      ],
    }),
  );
  assert.equal(parsed.verdict, 'changes');
  assert.deepEqual(parsed.issues[0], {
    severity: 'high',
    file: 'src/b.ts',
    problem: 'SQL-инъекция',
    fix: 'параметры',
  });
  assert.equal(parsed.issues[1].line, 3);
  assert.equal(parseCodeReview('не JSON').verdict, 'unknown');

  const task = buildFixTask(parsed.issues, 'Claude Sonnet 5.5', 'ru');
  assert.match(task, /Claude Sonnet 5\.5/);
  assert.match(task, /1\. src\/b\.ts — SQL-инъекция Как исправить: параметры/);
  assert.match(task, /2\. src\/a\.ts:3 — лишний лог/);
});

test('ревью кода: правки сверх потолка обрезаются, а не теряются молча', () => {
  const big = '+'.repeat(70_000);
  const input = buildCodeReviewInput(
    'Сделай кнопку',
    'Готово',
    [
      { path: 'a.ts', action: 'modify', additions: 1, deletions: 0, patch: big },
      { path: 'b.ts', action: 'create', additions: 1, deletions: 0, patch: '+x' },
    ],
    'ru',
  );
  assert.ok(input.length < 62_000);
  assert.match(input, /обрезано/);
  assert.match(input, /ещё 1 файлов без diff/);
});

test('судья: маркер, разрезанный между порциями, не попадает в ответ', () => {
  const splitter = new JudgeStreamSplitter();
  const full = `Итог: Канберра.\n${JUDGE_MARKER}\n{"agreement":"partial","consensus":["Австралия"],"disputes":[{"topic":"Столица","positions":[{"model":"A","claim":"Сидней"},{"model":"B","claim":"Канберра"}],"resolution":"Канберра"}]}`;
  let shown = '';
  for (let index = 0; index < full.length; index += 3)
    shown += splitter.push(full.slice(index, index + 3));
  shown += splitter.flush();
  assert.equal(shown, 'Итог: Канберра.\n');
  assert.equal(splitter.content, 'Итог: Канберра.');
  const tail = parseJudgeTail(splitter.tailText);
  assert.equal(tail.agreement, 'partial');
  assert.equal(tail.disputes[0].positions.length, 2);
  assert.equal(tail.disputes[0].resolution, 'Канберра');

  const noMarker = new JudgeStreamSplitter();
  const visible = noMarker.push('Ответ без маркера <<<') + noMarker.flush();
  assert.equal(visible, 'Ответ без маркера <<<', 'придержанный хвост отдаётся в конце');
  assert.deepEqual(parseJudgeTail(''), { agreement: 'unknown', consensus: [], disputes: [] });
});

test('рецензент — модель другой компании; лимит проверок растёт с тарифом', () => {
  const plus = pickReviewers('plus', ['claude-haiku-5.5'], modelRegistry);
  assert.ok(plus.length > 0);
  assert.ok(plus.every((candidate) => candidate.developer !== 'Anthropic'));

  const pro = pickReviewers('pro', ['gpt-6.1-sol'], modelRegistry);
  assert.equal(pro[0].entry.id, 'claude-sonnet-5.5');
  assert.ok(pro.every((candidate) => candidate.developer !== 'OpenAI'));

  const free = pickReviewers('free', ['ketner-mini'], modelRegistry);
  assert.notEqual(free[0].developer, developerOf(modelRegistry.get('ketner-mini')!));

  // Все компании списка уже среди авторов: проверка всё равно возможна.
  const everyone = pickReviewers(
    'free',
    ['ketner-mini', 'nemotron-ultra', 'north-mini-code'],
    modelRegistry,
  );
  assert.ok(everyone.length > 0);

  assert.ok(dailyReviewLimit('free') < dailyReviewLimit('plus'));
  assert.ok(dailyReviewLimit('plus') < dailyReviewLimit('pro'));
  assert.ok(dailyReviewLimit('pro') < dailyReviewLimit('ultra'));
});

test('вызов рецензента: недоступная модель уступает следующей, лимит частоты — нет', async () => {
  const candidates = pickReviewers('pro', ['gpt-6.1-sol'], modelRegistry).slice(0, 3);
  const asked: string[] = [];
  const gateway = {
    stream: async (
      req: { modelId: string; task?: { kind: string } },
      callbacks: {
        onDelta: (d: string) => void;
        onDone: (r: { finishReason: 'stop'; selectedModel: { id: string; name: string } }) => void;
        onError: (e: { code: string; message: string }) => void;
      },
    ) => {
      asked.push(req.modelId);
      assert.equal(req.task?.kind, 'review');
      if (asked.length === 1) {
        callbacks.onError({ code: 'model_unavailable', message: 'нет квоты' });
        return;
      }
      callbacks.onDelta('{"verdict":"ok"}');
      callbacks.onDone({
        finishReason: 'stop',
        selectedModel: { id: req.modelId, name: req.modelId },
      });
    },
  };
  const base = {
    caller: { userId: 'u', plan: 'pro' as const, isVip: false },
    candidates,
    reviewId: 'r',
    systemPrompt: 's',
    userContent: 'c',
    templateOutput: 't',
    language: 'ru' as const,
  };
  const ok = await runReviewTask({ ...base, gateway: gateway as never });
  assert.ok(ok.ok);
  assert.deepEqual(asked, [candidates[0].entry.id, candidates[1].entry.id]);
  if (ok.ok) assert.equal(ok.reviewer.modelId, candidates[1].entry.id);

  asked.length = 0;
  const limited = await runReviewTask({
    ...base,
    gateway: {
      stream: async (req: { modelId: string }, callbacks: { onError: (e: object) => void }) => {
        asked.push(req.modelId);
        callbacks.onError({ code: 'rate_limited', message: 'слишком часто' });
      },
    } as never,
  });
  assert.equal(limited.ok, false);
  assert.equal(asked.length, 1, 'лимит частоты одинаков для всех моделей: дальше не пробуем');
});
