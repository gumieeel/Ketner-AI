/**
 * Попытки прохождения вопросов (тест, самопроверка): ответы пользователя, проверка и баллы.
 * Postgres (миграция `0010_solution_attempts`) и память. Попытка создаётся только для завершённого
 * запуска самого владельца; запись защищена версией (два одновременных изменения не затирают друг
 * друга); удаление запуска удаляет и его попытки.
 */
import type { SqlRunner } from '../../code/postgres-driver.js';
import type { ToolRun } from './run-store.js';

export type AttemptKind = 'quiz' | 'self_check';
export type AttemptStatus = 'in_progress' | 'submitted' | 'graded';
/** `pending` — открытый ответ ждёт проверки; `unanswered` — ответа нет (0 баллов, без модели). */
export type Verdict = 'correct' | 'partial' | 'incorrect' | 'unanswered' | 'pending';

export interface AnswerValue {
  /** Выбранный вариант (вопрос с вариантами). */
  selected?: number;
  /** Текст ответа (открытый вопрос). */
  text?: string;
}

export interface AnswerResult {
  questionId: string;
  verdict: Verdict;
  /** 1 — верно, 0.5 — частично, 0 — неверно или нет ответа; у `pending` — 0 и не в счёт. */
  score: number;
  feedback?: string;
  missing?: string[];
  /** Части материалов (ref запуска с вопросами), на которые опирается разбор. */
  sources?: string[];
}

export interface Attempt {
  id: string;
  runId: string;
  solutionId: string;
  ownerId: string;
  kind: AttemptKind;
  status: AttemptStatus;
  questionIds: string[];
  answers: Record<string, AnswerValue>;
  results: AnswerResult[] | null;
  /** Набранные баллы по проверенным ответам. */
  score: number | null;
  maxScore: number;
  /** Повторение ошибок: из какой попытки взяты вопросы. */
  retryOf: string | null;
  /** Запуск проверки открытых ответов (операция `grade`). */
  gradeRunId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  gradedAt: string | null;
}

export interface AttemptStore {
  /** null — запуска нет у владельца или он не завершён. */
  create(attempt: Attempt): Promise<Attempt | null>;
  get(ownerId: string, solutionId: string, id: string): Promise<Attempt | null>;
  list(
    ownerId: string,
    solutionId: string,
    options?: { runId?: string; limit?: number },
  ): Promise<Attempt[]>;
  /** Запись при совпадении версии; null — запись изменилась или исчезла. */
  update(attempt: Attempt, expectedVersion: number): Promise<Attempt | null>;
}

const DEFAULT_LIMIT = 200;

export class MemoryAttemptStore implements AttemptStore {
  private readonly items = new Map<string, Attempt>();

  constructor(
    private readonly runOf: (
      ownerId: string,
      solutionId: string,
      id: string,
    ) => Promise<ToolRun | null>,
  ) {}

  /** Как ON DELETE CASCADE: попытки удалённого запуска пропадают. */
  private async prune(ownerId: string): Promise<void> {
    for (const [id, item] of this.items) {
      if (item.ownerId === ownerId && !(await this.runOf(ownerId, item.solutionId, item.runId))) {
        this.items.delete(id);
      }
    }
  }

  async create(attempt: Attempt) {
    const run = await this.runOf(attempt.ownerId, attempt.solutionId, attempt.runId);
    if (!run || run.status !== 'done') return null;
    this.items.set(attempt.id, structuredClone(attempt));
    return structuredClone(attempt);
  }

  async get(ownerId: string, solutionId: string, id: string) {
    await this.prune(ownerId);
    const item = this.items.get(id);
    return item && item.ownerId === ownerId && item.solutionId === solutionId
      ? structuredClone(item)
      : null;
  }

  async list(
    ownerId: string,
    solutionId: string,
    options: { runId?: string; limit?: number } = {},
  ) {
    await this.prune(ownerId);
    return [...this.items.values()]
      .filter(
        (item) =>
          item.ownerId === ownerId &&
          item.solutionId === solutionId &&
          (!options.runId || item.runId === options.runId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, options.limit ?? DEFAULT_LIMIT)
      .map((item) => structuredClone(item));
  }

  async update(attempt: Attempt, expectedVersion: number) {
    const current = this.items.get(attempt.id);
    if (!current || current.ownerId !== attempt.ownerId || current.version !== expectedVersion) {
      return null;
    }
    const next = { ...structuredClone(attempt), version: expectedVersion + 1 };
    this.items.set(attempt.id, next);
    return structuredClone(next);
  }
}

interface AttemptRow {
  id: string;
  run_id: string;
  solution_id: string;
  user_id: string;
  kind: AttemptKind;
  status: AttemptStatus;
  question_ids: unknown;
  answers: unknown;
  results: unknown;
  score: number | string | null;
  max_score: number | string;
  retry_of: string | null;
  grade_run_id: string | null;
  version: number | string;
  created_at: string | Date;
  updated_at: string | Date;
  submitted_at: string | Date | null;
  graded_at: string | Date | null;
}

const COLUMNS = `id, run_id, solution_id, user_id, kind, status, question_ids, answers, results,
  score, max_score, retry_of, grade_run_id, version, created_at, updated_at, submitted_at, graded_at`;

function parse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

const iso = (value: string | Date | null) =>
  value === null ? null : new Date(value).toISOString();

function toAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    runId: row.run_id,
    solutionId: row.solution_id,
    ownerId: row.user_id,
    kind: row.kind,
    status: row.status,
    questionIds: parse<string[]>(row.question_ids, []),
    answers: parse<Attempt['answers']>(row.answers, {}),
    results: parse<Attempt['results']>(row.results, null),
    score: row.score === null ? null : Number(row.score),
    maxScore: Number(row.max_score),
    retryOf: row.retry_of,
    gradeRunId: row.grade_run_id,
    version: Number(row.version),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    submittedAt: iso(row.submitted_at),
    gradedAt: iso(row.graded_at),
  };
}

export class PostgresAttemptStore implements AttemptStore {
  constructor(private readonly db: SqlRunner) {}

  async create(attempt: Attempt) {
    const rows = await this.db.query<AttemptRow>(
      `INSERT INTO solution_attempts (${COLUMNS})
       SELECT $1, $2, $3, $4, $5, $6, $7::text::jsonb, $8::text::jsonb, $9::text::jsonb, $10, $11,
              $12, $13, $14, $15::timestamptz, $16::timestamptz, $17::timestamptz, $18::timestamptz
       WHERE EXISTS (SELECT 1 FROM solution_runs
                     WHERE id = $2 AND solution_id = $3 AND user_id = $4 AND status = 'done')
       RETURNING ${COLUMNS}`,
      [
        attempt.id,
        attempt.runId,
        attempt.solutionId,
        attempt.ownerId,
        attempt.kind,
        attempt.status,
        JSON.stringify(attempt.questionIds),
        JSON.stringify(attempt.answers),
        JSON.stringify(attempt.results),
        attempt.score,
        attempt.maxScore,
        attempt.retryOf,
        attempt.gradeRunId,
        attempt.version,
        attempt.createdAt,
        attempt.updatedAt,
        attempt.submittedAt,
        attempt.gradedAt,
      ],
    );
    return rows[0] ? toAttempt(rows[0]) : null;
  }

  async get(ownerId: string, solutionId: string, id: string) {
    const rows = await this.db.query<AttemptRow>(
      `SELECT ${COLUMNS} FROM solution_attempts WHERE id = $1 AND user_id = $2 AND solution_id = $3`,
      [id, ownerId, solutionId],
    );
    return rows[0] ? toAttempt(rows[0]) : null;
  }

  async list(
    ownerId: string,
    solutionId: string,
    options: { runId?: string; limit?: number } = {},
  ) {
    const rows = await this.db.query<AttemptRow>(
      `SELECT ${COLUMNS} FROM solution_attempts
       WHERE user_id = $1 AND solution_id = $2 AND ($3::text IS NULL OR run_id = $3)
       ORDER BY created_at DESC, id DESC LIMIT $4`,
      [ownerId, solutionId, options.runId ?? null, options.limit ?? DEFAULT_LIMIT],
    );
    return rows.map(toAttempt);
  }

  async update(attempt: Attempt, expectedVersion: number) {
    const rows = await this.db.query<AttemptRow>(
      `UPDATE solution_attempts SET status = $4, answers = $5::text::jsonb, results = $6::text::jsonb,
         score = $7, grade_run_id = $8, updated_at = $9::timestamptz,
         submitted_at = $10::timestamptz, graded_at = $11::timestamptz, version = version + 1
       WHERE id = $1 AND user_id = $2 AND version = $3
       RETURNING ${COLUMNS}`,
      [
        attempt.id,
        attempt.ownerId,
        expectedVersion,
        attempt.status,
        JSON.stringify(attempt.answers),
        JSON.stringify(attempt.results),
        attempt.score,
        attempt.gradeRunId,
        attempt.updatedAt,
        attempt.submittedAt,
        attempt.gradedAt,
      ],
    );
    return rows[0] ? toAttempt(rows[0]) : null;
  }
}
