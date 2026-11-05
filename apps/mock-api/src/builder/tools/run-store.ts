/**
 * Запуски операций инструментов: Postgres (миграция `0009_solution_runs`) и память.
 *
 * Гарантии хранилища, на которых держится биллинг:
 *   - один ключ идемпотентности пользователя — один запуск (повтор возвращает прежний);
 *   - в одном инструменте не больше одного идущего запуска (`queued` / `running`);
 *   - запуск берёт в работу только тот, кто перевёл его из `queued` в `running` (`claim`), и
 *     записывает итог только с тем же жетоном;
 *   - запуск с истёкшей арендой (процесс перезапустился) можно закрыть как прерванный.
 */
import type { SqlRunner } from '../../code/postgres-driver.js';
import type { Solution } from '../types.js';
import type { RunSource } from './operations.js';

export type RunStatus = 'queued' | 'running' | 'done' | 'failed';

export interface RunQuote {
  modelId: string;
  modelName: string;
  maxOutputTokens: number;
  /** Символов материалов в запросе. */
  inputChars: number;
  /** Больше этого не спишется, $ (потолок шлюза на все попытки). */
  capUsd: number;
  typicalUsd: number;
  maxCredits: number;
  typicalCredits: number;
}

export interface ToolRun {
  id: string;
  solutionId: string;
  ownerId: string;
  operation: string;
  status: RunStatus;
  versionNumber: number;
  input: unknown;
  inputHash: string;
  sources: RunSource[];
  quote: RunQuote;
  result: unknown;
  resultSchema: number;
  model: { id: string; name: string } | null;
  costUsd: number;
  creditsUsd: number;
  error: { code: string; message: string } | null;
  idempotencyKey: string;
  claimToken: string | null;
  leaseExpiresAt: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type InsertRunResult =
  | { status: 'created'; run: ToolRun }
  | { status: 'duplicate'; run: ToolRun }
  /** В инструменте уже идёт запуск. */
  | { status: 'busy'; run: ToolRun | null }
  | { status: 'not_found' };

export interface RunFinish {
  status: 'done' | 'failed';
  result: unknown;
  model: ToolRun['model'];
  costUsd: number;
  creditsUsd: number;
  error: ToolRun['error'];
  finishedAt: string;
}

export interface RunStore {
  insert(run: ToolRun): Promise<InsertRunResult>;
  get(ownerId: string, solutionId: string, id: string): Promise<ToolRun | null>;
  /** Запуск по ключу идемпотентности владельца. */
  byKey(ownerId: string, key: string): Promise<ToolRun | null>;
  list(ownerId: string, solutionId: string, limit: number): Promise<ToolRun[]>;
  /** Идущие запуски владельца (во всех инструментах). */
  active(ownerId: string): Promise<ToolRun[]>;
  /** `queued` → `running` с жетоном и новой арендой; null — запуск уже взят или закрыт. */
  claim(
    ownerId: string,
    id: string,
    token: string,
    leaseUntil: string,
    at: string,
  ): Promise<ToolRun | null>;
  /** Итог запуска — только с жетоном того, кто его взял, и пока результат не записан. */
  finish(ownerId: string, id: string, token: string, outcome: RunFinish): Promise<ToolRun | null>;
  /** Закрыть идущий запуск с истёкшей арендой как прерванный; null — аренда не истекла или он закрыт. */
  expire(ownerId: string, id: string, now: string, outcome: RunFinish): Promise<ToolRun | null>;
  /** Удалить завершённый запуск; идущий не удаляется. */
  remove(ownerId: string, solutionId: string, id: string): Promise<boolean>;
}

const ACTIVE: readonly RunStatus[] = ['queued', 'running'];
const isActive = (run: ToolRun) => ACTIVE.includes(run.status);

export class MemoryRunStore implements RunStore {
  private readonly items = new Map<string, ToolRun>();

  constructor(
    private readonly solutionOf: (ownerId: string, id: string) => Promise<Solution | null>,
  ) {}

  private async prune(ownerId: string): Promise<void> {
    for (const [id, run] of this.items) {
      if (run.ownerId === ownerId && !(await this.solutionOf(ownerId, run.solutionId))) {
        this.items.delete(id);
      }
    }
  }

  async insert(run: ToolRun): Promise<InsertRunResult> {
    const solution = await this.solutionOf(run.ownerId, run.solutionId);
    if (!solution || solution.type !== 'tool') return { status: 'not_found' };
    await this.prune(run.ownerId);
    // Проверка и запись — без await между ними: как одна транзакция с уникальными индексами.
    const same = [...this.items.values()].find(
      (item) => item.ownerId === run.ownerId && item.idempotencyKey === run.idempotencyKey,
    );
    if (same) return { status: 'duplicate', run: structuredClone(same) };
    const busy = [...this.items.values()].find(
      (item) => item.solutionId === run.solutionId && isActive(item),
    );
    if (busy) return { status: 'busy', run: structuredClone(busy) };
    this.items.set(run.id, structuredClone(run));
    return { status: 'created', run: structuredClone(run) };
  }

  async get(ownerId: string, solutionId: string, id: string) {
    await this.prune(ownerId);
    const run = this.items.get(id);
    return run && run.ownerId === ownerId && run.solutionId === solutionId
      ? structuredClone(run)
      : null;
  }

  async byKey(ownerId: string, key: string) {
    await this.prune(ownerId);
    const run = [...this.items.values()].find(
      (item) => item.ownerId === ownerId && item.idempotencyKey === key,
    );
    return run ? structuredClone(run) : null;
  }

  async list(ownerId: string, solutionId: string, limit: number) {
    await this.prune(ownerId);
    return [...this.items.values()]
      .filter((run) => run.ownerId === ownerId && run.solutionId === solutionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((run) => structuredClone(run));
  }

  async active(ownerId: string) {
    await this.prune(ownerId);
    return [...this.items.values()]
      .filter((run) => run.ownerId === ownerId && isActive(run))
      .map((run) => structuredClone(run));
  }

  async claim(ownerId: string, id: string, token: string, leaseUntil: string, at: string) {
    const run = this.items.get(id);
    if (!run || run.ownerId !== ownerId || run.status !== 'queued') return null;
    const next: ToolRun = {
      ...run,
      status: 'running',
      claimToken: token,
      leaseExpiresAt: leaseUntil,
      startedAt: at,
    };
    this.items.set(id, next);
    return structuredClone(next);
  }

  async finish(ownerId: string, id: string, token: string, outcome: RunFinish) {
    const run = this.items.get(id);
    if (!run || run.ownerId !== ownerId || run.claimToken !== token || run.status === 'done') {
      return null;
    }
    const next: ToolRun = { ...run, ...structuredClone(outcome) };
    this.items.set(id, next);
    return structuredClone(next);
  }

  async expire(ownerId: string, id: string, now: string, outcome: RunFinish) {
    const run = this.items.get(id);
    if (!run || run.ownerId !== ownerId || !isActive(run) || run.leaseExpiresAt > now) return null;
    const next: ToolRun = { ...run, ...structuredClone(outcome) };
    this.items.set(id, next);
    return structuredClone(next);
  }

  async remove(ownerId: string, solutionId: string, id: string) {
    const run = this.items.get(id);
    if (!run || run.ownerId !== ownerId || run.solutionId !== solutionId || isActive(run)) {
      return false;
    }
    return this.items.delete(id);
  }
}

interface RunRow {
  id: string;
  solution_id: string;
  user_id: string;
  operation: string;
  status: RunStatus;
  version_number: number | string;
  input: unknown;
  input_hash: string;
  sources: unknown;
  quote: unknown;
  result: unknown;
  result_schema: number | string;
  model: unknown;
  cost_usd: number | string;
  credits_usd: number | string;
  error: unknown;
  idempotency_key: string;
  claim_token: string | null;
  lease_expires_at: string | Date;
  created_at: string | Date;
  started_at: string | Date | null;
  finished_at: string | Date | null;
}

const COLUMNS = `id, solution_id, user_id, operation, status, version_number, input, input_hash,
  sources, quote, result, result_schema, model, cost_usd, credits_usd, error, idempotency_key,
  claim_token, lease_expires_at, created_at, started_at, finished_at`;

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

function toRun(row: RunRow): ToolRun {
  return {
    id: row.id,
    solutionId: row.solution_id,
    ownerId: row.user_id,
    operation: row.operation,
    status: row.status,
    versionNumber: Number(row.version_number),
    input: parse(row.input, null),
    inputHash: row.input_hash,
    sources: parse<ToolRun['sources']>(row.sources, []),
    quote: parse<RunQuote>(row.quote, {} as RunQuote),
    result: parse(row.result, null),
    resultSchema: Number(row.result_schema),
    model: parse<ToolRun['model']>(row.model, null),
    costUsd: Number(row.cost_usd),
    creditsUsd: Number(row.credits_usd),
    error: parse<ToolRun['error']>(row.error, null),
    idempotencyKey: row.idempotency_key,
    claimToken: row.claim_token,
    leaseExpiresAt: iso(row.lease_expires_at)!,
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
}

const finishParams = (outcome: RunFinish) => [
  outcome.status,
  JSON.stringify(outcome.result ?? null),
  JSON.stringify(outcome.model),
  outcome.costUsd,
  outcome.creditsUsd,
  JSON.stringify(outcome.error),
  outcome.finishedAt,
];

const FINISH_SET = `status = $3, result = $4::text::jsonb, model = $5::text::jsonb, cost_usd = $6,
  credits_usd = $7, error = $8::text::jsonb, finished_at = $9::timestamptz`;

export class PostgresRunStore implements RunStore {
  constructor(private readonly db: SqlRunner) {}

  async insert(run: ToolRun): Promise<InsertRunResult> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO solution_runs (${COLUMNS})
       SELECT $1, $2, $3, $4, $5, $6, $7::text::jsonb, $8, $9::text::jsonb, $10::text::jsonb,
              $11::text::jsonb, $12, $13::text::jsonb, $14, $15, $16::text::jsonb, $17, $18,
              $19::timestamptz, $20::timestamptz, $21::timestamptz, $22::timestamptz
       WHERE EXISTS (SELECT 1 FROM solutions WHERE id = $2 AND user_id = $3 AND type = 'tool')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        run.id,
        run.solutionId,
        run.ownerId,
        run.operation,
        run.status,
        run.versionNumber,
        JSON.stringify(run.input),
        run.inputHash,
        JSON.stringify(run.sources),
        JSON.stringify(run.quote),
        JSON.stringify(run.result ?? null),
        run.resultSchema,
        JSON.stringify(run.model),
        run.costUsd,
        run.creditsUsd,
        JSON.stringify(run.error),
        run.idempotencyKey,
        run.claimToken,
        run.leaseExpiresAt,
        run.createdAt,
        run.startedAt,
        run.finishedAt,
      ],
    );
    if (rows[0]) return { status: 'created', run };
    // Не вставлено: тот же ключ, идущий запуск в инструменте или инструмент чужой.
    const same = await this.db.query<RunRow>(
      `SELECT ${COLUMNS} FROM solution_runs WHERE user_id = $1 AND idempotency_key = $2`,
      [run.ownerId, run.idempotencyKey],
    );
    if (same[0]) return { status: 'duplicate', run: toRun(same[0]) };
    const owned = await this.db.query<{ id: string }>(
      `SELECT id FROM solutions WHERE id = $1 AND user_id = $2 AND type = 'tool'`,
      [run.solutionId, run.ownerId],
    );
    if (!owned[0]) return { status: 'not_found' };
    const busy = await this.db.query<RunRow>(
      `SELECT ${COLUMNS} FROM solution_runs
       WHERE solution_id = $1 AND user_id = $2 AND status IN ('queued', 'running')`,
      [run.solutionId, run.ownerId],
    );
    return { status: 'busy', run: busy[0] ? toRun(busy[0]) : null };
  }

  async get(ownerId: string, solutionId: string, id: string) {
    const rows = await this.db.query<RunRow>(
      `SELECT ${COLUMNS} FROM solution_runs WHERE id = $1 AND user_id = $2 AND solution_id = $3`,
      [id, ownerId, solutionId],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async byKey(ownerId: string, key: string) {
    const rows = await this.db.query<RunRow>(
      `SELECT ${COLUMNS} FROM solution_runs WHERE user_id = $1 AND idempotency_key = $2`,
      [ownerId, key],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async list(ownerId: string, solutionId: string, limit: number) {
    const rows = await this.db.query<RunRow>(
      `SELECT ${COLUMNS} FROM solution_runs WHERE user_id = $1 AND solution_id = $2
       ORDER BY created_at DESC, id DESC LIMIT $3`,
      [ownerId, solutionId, limit],
    );
    return rows.map(toRun);
  }

  async active(ownerId: string) {
    const rows = await this.db.query<RunRow>(
      `SELECT ${COLUMNS} FROM solution_runs WHERE user_id = $1 AND status IN ('queued', 'running')`,
      [ownerId],
    );
    return rows.map(toRun);
  }

  async claim(ownerId: string, id: string, token: string, leaseUntil: string, at: string) {
    const rows = await this.db.query<RunRow>(
      `UPDATE solution_runs SET status = 'running', claim_token = $3,
         lease_expires_at = $4::timestamptz, started_at = $5::timestamptz
       WHERE id = $1 AND user_id = $2 AND status = 'queued'
       RETURNING ${COLUMNS}`,
      [id, ownerId, token, leaseUntil, at],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async finish(ownerId: string, id: string, token: string, outcome: RunFinish) {
    const rows = await this.db.query<RunRow>(
      `UPDATE solution_runs SET ${FINISH_SET}
       WHERE id = $1 AND user_id = $2 AND claim_token = $10 AND status <> 'done'
       RETURNING ${COLUMNS}`,
      [id, ownerId, ...finishParams(outcome), token],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async expire(ownerId: string, id: string, now: string, outcome: RunFinish) {
    const rows = await this.db.query<RunRow>(
      `UPDATE solution_runs SET ${FINISH_SET}
       WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
         AND lease_expires_at <= $10::timestamptz
       RETURNING ${COLUMNS}`,
      [id, ownerId, ...finishParams(outcome), now],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async remove(ownerId: string, solutionId: string, id: string) {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM solution_runs WHERE id = $1 AND user_id = $2 AND solution_id = $3
         AND status NOT IN ('queued', 'running')
       RETURNING id`,
      [id, ownerId, solutionId],
    );
    return rows.length > 0;
  }
}
