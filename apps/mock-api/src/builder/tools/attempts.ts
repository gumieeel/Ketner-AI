/**
 * Попытки прохождения вопросов: создание (в том числе «повторить ошибки»), сохранение ответов,
 * сдача с подсчётом баллов, проверка открытых ответов и прогресс.
 *
 * - Ключи ответов не уходят на сайт, пока попытка не сдана: до сдачи — только вопросы и варианты.
 * - Вопрос с вариантами оценивает код по ключу. Пустой ответ — 0 баллов без модели.
 * - Открытые ответы проверяет операция `grade` через тот же исполнитель запусков: цена до запуска,
 *   подтверждение, ключ идемпотентности, потолок списания в AI Gateway. Итог проверки переносится в
 *   попытку при следующем чтении (идемпотентно).
 * - Всё — только в инструментах владельца: чужая попытка — как несуществующая.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Language } from '../../types.js';
import type { Attempt, AttemptStore, AnswerResult, AnswerValue } from './attempt-store.js';
import type { ToolCaller, ToolError, ToolExecutor, StartInput } from './executor.js';
import { creditsOf, publicQuote } from './executor.js';
import type { RunSource } from './operations.js';
import type { RunStore, ToolRun } from './run-store.js';
import { computeProgress, summarizeAttempt, type RunQuestions } from './study/progress.js';
import {
  VERDICT_SCORE,
  type GradeResult,
  type Question,
  type QuestionSet,
} from './study/questions.js';

/** Операции, результат которых — набор вопросов. */
export const QUESTION_OPERATIONS = { quiz: 'quiz', self_check: 'self_check' } as const;
export const OPEN_ANSWER_CHARS = 2000;

export const answersBodySchema = z
  .object({
    answers: z
      .record(
        z.string().max(20),
        z
          .object({
            selected: z.number().int().min(0).max(20).optional(),
            text: z.string().max(OPEN_ANSWER_CHARS).optional(),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();

export const createAttemptBodySchema = z
  .object({ retryOf: z.string().trim().min(1).max(100).optional() })
  .strict();

export const gradeBodySchema = z
  .object({
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
    acceptedMaxCredits: z.number().finite().nonnegative(),
    confirm: z.boolean().optional(),
  })
  .strict();

export interface AttemptServiceDeps {
  attempts: AttemptStore;
  runs: RunStore;
  executor: ToolExecutor;
  now?: () => Date;
}

const text = (language: Language, ru: string, en: string) => (language === 'en' ? en : ru);
const round2 = (value: number) => Math.round(value * 100) / 100;

function fail(status: number, code: string, language: Language, ru: string, en: string): ToolError {
  return { ok: false, status, code, message: text(language, ru, en) };
}

/** Вопрос для сайта: до сдачи — без ключей; после — с ключом, объяснением, цитатой и эталоном. */
function questionView(question: Question, reveal: boolean) {
  const base = {
    id: question.id,
    type: question.type,
    question: question.question,
    topic: question.topic,
    sources: question.sources,
    ...(question.type === 'choice' ? { options: question.options } : {}),
  };
  if (!reveal) return base;
  return question.type === 'choice'
    ? {
        ...base,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        evidence: question.evidence,
      }
    : {
        ...base,
        modelAnswer: question.answer,
        keyPoints: question.keyPoints,
        explanation: question.explanation,
        evidence: question.evidence,
      };
}

export class AttemptService {
  private readonly now: () => Date;

  constructor(private readonly deps: AttemptServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Запуск с вопросами (тест или самопроверка), завершённый, у владельца. */
  private async questionRun(
    caller: ToolCaller,
    solutionId: string,
    runId: string,
  ): Promise<{ run: ToolRun; set: QuestionSet } | ToolError> {
    const found = await this.deps.executor.get(caller, solutionId, runId);
    if (!found.ok) return found;
    const { run } = found;
    if (!(run.operation in QUESTION_OPERATIONS)) {
      return fail(
        409,
        'not_a_question_run',
        caller.language,
        'В этом результате нет вопросов.',
        'This result has no questions.',
      );
    }
    if (run.status !== 'done' || !run.result) {
      return fail(
        409,
        'run_not_ready',
        caller.language,
        'Вопросы ещё не готовы.',
        'The questions are not ready yet.',
      );
    }
    return { run, set: run.result as QuestionSet };
  }

  private async load(
    caller: ToolCaller,
    solutionId: string,
    id: string,
  ): Promise<{ attempt: Attempt; run: ToolRun; set: QuestionSet } | ToolError> {
    const attempt = await this.deps.attempts.get(caller.userId, solutionId, id);
    if (!attempt) {
      return fail(
        404,
        'attempt_not_found',
        caller.language,
        'Попытка не найдена.',
        'Attempt not found.',
      );
    }
    const found = await this.questionRun(caller, solutionId, attempt.runId);
    if ('ok' in found) return found;
    const settled = await this.settleGrade(caller, attempt, found.run);
    return { attempt: settled, ...found };
  }

  async create(caller: ToolCaller, solutionId: string, runId: string, body: { retryOf?: string }) {
    const found = await this.questionRun(caller, solutionId, runId);
    if ('ok' in found) return found;
    let questionIds = found.set.questions.map((question) => question.id);
    if (body.retryOf) {
      const previous = await this.load(caller, solutionId, body.retryOf);
      if ('ok' in previous) return previous;
      if (previous.attempt.runId !== runId || previous.attempt.status === 'in_progress') {
        return fail(
          409,
          'cannot_retry',
          caller.language,
          'Повторить можно только сданную попытку этого теста.',
          'Only a submitted attempt of this quiz can be retried.',
        );
      }
      const wrong = new Set(
        (previous.attempt.results ?? [])
          .filter(
            (item) =>
              item.verdict === 'incorrect' ||
              item.verdict === 'partial' ||
              item.verdict === 'unanswered',
          )
          .map((item) => item.questionId),
      );
      questionIds = questionIds.filter((id) => wrong.has(id));
      if (questionIds.length === 0) {
        return fail(
          409,
          'nothing_to_retry',
          caller.language,
          'Ошибок нет — повторять нечего.',
          'No mistakes to retry.',
        );
      }
    }
    const at = this.now().toISOString();
    const attempt: Attempt = {
      id: randomUUID(),
      runId,
      solutionId,
      ownerId: caller.userId,
      kind: found.run.operation === 'quiz' ? 'quiz' : 'self_check',
      status: 'in_progress',
      questionIds,
      answers: {},
      results: null,
      score: null,
      maxScore: questionIds.length,
      retryOf: body.retryOf ?? null,
      gradeRunId: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
      submittedAt: null,
      gradedAt: null,
    };
    const created = await this.deps.attempts.create(attempt);
    if (!created) {
      return fail(
        404,
        'run_not_found',
        caller.language,
        'Вопросы не найдены.',
        'Questions not found.',
      );
    }
    return { ok: true as const, attempt: await this.view(caller, created, found.run, found.set) };
  }

  async get(caller: ToolCaller, solutionId: string, id: string) {
    const loaded = await this.load(caller, solutionId, id);
    if ('ok' in loaded) return loaded;
    return {
      ok: true as const,
      attempt: await this.view(caller, loaded.attempt, loaded.run, loaded.set),
    };
  }

  async list(caller: ToolCaller, solutionId: string, runId?: string) {
    const listed = await this.deps.executor.list(caller, solutionId);
    if (!listed.ok) return listed;
    const attempts = await this.deps.attempts.list(
      caller.userId,
      solutionId,
      runId ? { runId } : {},
    );
    const titles = new Map(
      listed.runs.map((run) => [run.id, (run.result as { title?: string } | null)?.title ?? '']),
    );
    const settled: Attempt[] = [];
    for (const attempt of attempts) {
      const run = await this.deps.runs.get(caller.userId, solutionId, attempt.runId);
      settled.push(run ? await this.settleGrade(caller, attempt, run) : attempt);
    }
    return {
      ok: true as const,
      attempts: settled.map((attempt) =>
        summarizeAttempt(attempt, titles.get(attempt.runId) ?? ''),
      ),
    };
  }

  /** Проверка ответов из тела: только вопросы попытки, вариант — в пределах вариантов вопроса. */
  private cleanAnswers(
    caller: ToolCaller,
    attempt: Attempt,
    set: QuestionSet,
    answers: Record<string, AnswerValue>,
  ): { ok: true; answers: Record<string, AnswerValue> } | ToolError {
    const clean: Record<string, AnswerValue> = {};
    for (const [id, value] of Object.entries(answers)) {
      const question = set.questions.find((item) => item.id === id);
      if (!question || !attempt.questionIds.includes(id)) {
        return fail(
          400,
          'invalid_answers',
          caller.language,
          'Ответ на вопрос, которого нет в попытке.',
          'An answer to a question that is not in the attempt.',
        );
      }
      if (question.type === 'choice') {
        if (
          value.text !== undefined ||
          (value.selected !== undefined && value.selected >= question.options.length)
        ) {
          return fail(
            400,
            'invalid_answers',
            caller.language,
            'Такого варианта ответа нет.',
            'No such option.',
          );
        }
        if (value.selected !== undefined) clean[id] = { selected: value.selected };
      } else {
        if (value.selected !== undefined) {
          return fail(
            400,
            'invalid_answers',
            caller.language,
            'На открытый вопрос отвечают текстом.',
            'An open question takes a text answer.',
          );
        }
        if (value.text !== undefined) clean[id] = { text: value.text };
      }
    }
    return { ok: true, answers: clean };
  }

  private async write(attempt: Attempt, expected: number): Promise<Attempt | null> {
    return this.deps.attempts.update({ ...attempt, updatedAt: this.now().toISOString() }, expected);
  }

  private conflict(language: Language): ToolError {
    return fail(
      409,
      'attempt_conflict',
      language,
      'Попытку изменили в другой вкладке. Обновите страницу.',
      'The attempt was changed in another tab. Reload the page.',
    );
  }

  async saveAnswers(
    caller: ToolCaller,
    solutionId: string,
    id: string,
    answers: Record<string, AnswerValue>,
  ) {
    const loaded = await this.load(caller, solutionId, id);
    if ('ok' in loaded) return loaded;
    if (loaded.attempt.status !== 'in_progress') {
      return fail(
        409,
        'attempt_submitted',
        caller.language,
        'Попытка уже сдана.',
        'The attempt is already submitted.',
      );
    }
    const clean = this.cleanAnswers(caller, loaded.attempt, loaded.set, answers);
    if (!clean.ok) return clean;
    const saved = await this.write(
      { ...loaded.attempt, answers: clean.answers },
      loaded.attempt.version,
    );
    if (!saved) return this.conflict(caller.language);
    return { ok: true as const, attempt: await this.view(caller, saved, loaded.run, loaded.set) };
  }

  /** Сдать: варианты — баллы сразу по ключу, открытые с ответом — ждут проверки, пустые — 0. */
  async submit(
    caller: ToolCaller,
    solutionId: string,
    id: string,
    answers?: Record<string, AnswerValue>,
  ) {
    const loaded = await this.load(caller, solutionId, id);
    if ('ok' in loaded) return loaded;
    const { attempt, run, set } = loaded;
    // Повторная сдача (двойной клик, сеть) ничего не меняет.
    if (attempt.status !== 'in_progress') {
      return { ok: true as const, attempt: await this.view(caller, attempt, run, set) };
    }
    const checked = this.cleanAnswers(caller, attempt, set, answers ?? attempt.answers);
    if (!checked.ok) return checked;
    const clean = checked.answers;
    const results: AnswerResult[] = attempt.questionIds.map((questionId) => {
      const question = set.questions.find((item) => item.id === questionId)!;
      const answer = clean[questionId];
      if (question.type === 'choice') {
        if (answer?.selected === undefined) return { questionId, verdict: 'unanswered', score: 0 };
        const correct = answer.selected === question.correctIndex;
        return {
          questionId,
          verdict: correct ? 'correct' : 'incorrect',
          score: correct ? 1 : 0,
          sources: question.sources,
        };
      }
      if (!answer?.text?.trim())
        return { questionId, verdict: 'unanswered', score: 0, sources: question.sources };
      return { questionId, verdict: 'pending', score: 0 };
    });
    const pending = results.some((item) => item.verdict === 'pending');
    const at = this.now().toISOString();
    const saved = await this.write(
      {
        ...attempt,
        answers: clean,
        results,
        status: pending ? 'submitted' : 'graded',
        score: round2(results.reduce((sum, item) => sum + item.score, 0)),
        submittedAt: at,
        gradedAt: pending ? null : at,
      },
      attempt.version,
    );
    if (!saved) return this.conflict(caller.language);
    return { ok: true as const, attempt: await this.view(caller, saved, run, set) };
  }

  async gradeQuote(caller: ToolCaller, solutionId: string, id: string) {
    const loaded = await this.load(caller, solutionId, id);
    if ('ok' in loaded) return loaded;
    return this.deps.executor.quote(
      caller,
      solutionId,
      'grade',
      { attemptId: id },
      { internal: true },
    );
  }

  /** Запустить проверку открытых ответов: цена принята, ключ идемпотентности, один запуск на попытку. */
  async grade(
    caller: ToolCaller,
    solutionId: string,
    id: string,
    request: Omit<StartInput, 'operation' | 'input'>,
  ) {
    const loaded = await this.load(caller, solutionId, id);
    if ('ok' in loaded) return loaded;
    const started = await this.deps.executor.start(
      caller,
      solutionId,
      { ...request, operation: 'grade', input: { attemptId: id } },
      { internal: true },
    );
    if (!started.ok) return started;
    // Привязать запуск к попытке (повтор с тем же ключом привязывает тот же запуск).
    for (let tries = 0; tries < 3; tries += 1) {
      const current = await this.deps.attempts.get(caller.userId, solutionId, id);
      if (!current) break;
      if (current.gradeRunId === started.run.id) break;
      const saved = await this.write({ ...current, gradeRunId: started.run.id }, current.version);
      if (saved) break;
    }
    return this.get(caller, solutionId, id);
  }

  /**
   * Итог проверки — в попытку: только для ответов, которые ждали проверки; ссылки на части
   * переводятся в ссылки запуска с вопросами. Повторный вызов ничего не меняет.
   */
  private async settleGrade(
    caller: ToolCaller,
    attempt: Attempt,
    questionRun: ToolRun,
  ): Promise<Attempt> {
    if (attempt.status !== 'submitted' || !attempt.gradeRunId) return attempt;
    const found = await this.deps.executor.get(caller, attempt.solutionId, attempt.gradeRunId, {
      internal: true,
    });
    if (!found.ok || found.run.status !== 'done' || !found.run.result) return attempt;
    const gradeRun = found.run;
    const verdicts = new Map(
      (gradeRun.result as GradeResult).results.map((item) => [item.questionId, item]),
    );
    const toQuestionRef = (ref: string): string | null => {
      const source = gradeRun.sources.find((item) => item.ref === ref);
      if (!source) return null;
      return (
        questionRun.sources.find(
          (item) => item.materialId === source.materialId && item.sectionId === source.sectionId,
        )?.ref ?? null
      );
    };
    const results = (attempt.results ?? []).map((item): AnswerResult => {
      const verdict = item.verdict === 'pending' ? verdicts.get(item.questionId) : undefined;
      if (!verdict) return item;
      return {
        questionId: item.questionId,
        verdict: verdict.verdict,
        score: VERDICT_SCORE[verdict.verdict],
        feedback: verdict.feedback,
        missing: verdict.missing,
        sources: verdict.sources.map(toQuestionRef).filter((ref): ref is string => Boolean(ref)),
      };
    });
    const pending = results.some((item) => item.verdict === 'pending');
    const at = this.now().toISOString();
    const saved = await this.write(
      {
        ...attempt,
        results,
        status: pending ? 'submitted' : 'graded',
        score: round2(results.reduce((sum, item) => sum + item.score, 0)),
        gradedAt: pending ? null : at,
      },
      attempt.version,
    );
    // Параллельный читатель уже перенёс итог — берём сохранённое.
    return (
      saved ??
      (await this.deps.attempts.get(caller.userId, attempt.solutionId, attempt.id)) ??
      attempt
    );
  }

  private async view(caller: ToolCaller, attempt: Attempt, run: ToolRun, set: QuestionSet) {
    const reveal = attempt.status !== 'in_progress';
    let grade: {
      status: ToolRun['status'];
      chargedCredits: number;
      error: ToolRun['error'];
      quote: ReturnType<typeof publicQuote>;
    } | null = null;
    if (attempt.gradeRunId) {
      const found = await this.deps.executor.get(caller, attempt.solutionId, attempt.gradeRunId, {
        internal: true,
      });
      if (found.ok) {
        grade = {
          status: found.run.status,
          chargedCredits: creditsOf(found.run.creditsUsd),
          error: found.run.error,
          quote: publicQuote(found.run.quote),
        };
      }
    }
    const questions = attempt.questionIds
      .map((id) => set.questions.find((question) => question.id === id))
      .filter((question): question is Question => Boolean(question))
      .map((question) => questionView(question, reveal));
    return {
      id: attempt.id,
      runId: attempt.runId,
      kind: attempt.kind,
      status: attempt.status,
      title: set.title,
      questions,
      answers: attempt.answers,
      results: reveal ? attempt.results : null,
      score: attempt.score,
      maxScore: attempt.maxScore,
      retryOf: attempt.retryOf,
      grade,
      sources: run.sources as RunSource[],
      createdAt: attempt.createdAt,
      submittedAt: attempt.submittedAt,
      gradedAt: attempt.gradedAt,
    };
  }

  /** Прогресс инструмента по темам — из сданных попыток владельца. */
  async progress(caller: ToolCaller, solutionId: string) {
    const listed = await this.list(caller, solutionId);
    if (!listed.ok) return listed;
    const attempts = await this.deps.attempts.list(caller.userId, solutionId);
    const runs = new Map<string, RunQuestions>();
    for (const runId of new Set(attempts.map((attempt) => attempt.runId))) {
      const run = await this.deps.runs.get(caller.userId, solutionId, runId);
      if (run?.status === 'done' && run.result && run.operation in QUESTION_OPERATIONS) {
        const set = run.result as QuestionSet;
        runs.set(runId, { title: set.title, set, sources: run.sources });
      }
    }
    return { ok: true as const, progress: computeProgress(attempts, runs) };
  }
}
