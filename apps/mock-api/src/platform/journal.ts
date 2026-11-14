/**
 * Журнал исполнений агента — таблицы Slice A (docs/PERSISTENCE_SLICE_A.sql): снимок спецификации
 * версии, включение агента, исполнение, события, эффекты.
 *
 * Метаданные пишутся через `writeJournalSafely` (platform/secrets.ts): очищаются до записи, а
 * сигнальная проверка базы не может потерять строку журнала.
 * Две реализации: Postgres (production) и память (локально без базы, тесты без Postgres).
 */

import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '../code/postgres-driver.js';
import type { AgentSpec } from './agent-spec.js';
import {
  isSecretTripwire,
  sanitizeForJournal,
  TRIPWIRE_PLACEHOLDER,
  writeJournalSafely,
} from './secrets.js';

export type ExecutionStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
export type TriggerKind = 'public_page' | 'manual' | 'chat_message' | 'channel_event' | 'webhook';
export type EventType = 'status' | 'step' | 'authorization' | 'retry' | 'error' | 'cost';

export interface StartExecution {
  id: string;
  userId: string;
  solutionId: string;
  solutionVersion: number;
  deploymentId: string | null;
  triggerKind: TriggerKind;
  triggerRef: string;
  idempotencyKey?: string;
  inputMeta: Record<string, unknown>;
  traceId: string;
}

export interface FinishExecution {
  status: ExecutionStatus;
  stopReason: string;
  costUsd: number;
  creditsUsd: number;
  outputMeta: Record<string, unknown>;
  error: Record<string, unknown> | null;
}

/**
 * Записи исполнения, которые не должны задерживать ответ: пишутся одним пакетом после него
 * (`ExecutionJournal.record`). Эффекты — уже с итогом; `reserved: true` — эффект был зарезервирован
 * заранее (`reserveEffect`, внешнее действие), пакет только закрывает его.
 */
export interface JournalBatch {
  effects: Array<{
    stepKey: string;
    action: string;
    authorizedBy: string;
    usageRunId?: string;
    reserved: boolean;
    outcome: 'committed' | 'failed';
    resultMeta: Record<string, unknown>;
  }>;
  events: Array<{ type: EventType; action: string | null; data: Record<string, unknown> }>;
  finish: FinishExecution;
}

/**
 * Строка проверки для администратора: только итог и счётчики. Ни текста сообщений, ни id диалога
 * или посетителя (`trigger_ref`, `input_meta`) здесь нет.
 */
export interface ExecutionSummary {
  id: string;
  solutionVersion: number | null;
  triggerKind: string;
  status: ExecutionStatus | 'queued' | 'retrying';
  stopReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  steps: number | null;
  toolCalls: Array<{ tool: string; ok: boolean }>;
  finalStep: boolean;
  offerContact: boolean;
  replyChars: number | null;
  costUsd: number;
  creditsUsd: number;
  errorCode: string | null;
  /** Модели шагов по порядку (из эффектов `model-N`). */
  models: string[];
}

/** Поля итога из `output_meta`: только известные счётчики, остальное не выдаётся. */
function summaryFields(output: unknown) {
  const meta = (output && typeof output === 'object' ? output : {}) as Record<string, unknown>;
  const toolCalls = Array.isArray(meta.toolCalls)
    ? meta.toolCalls.flatMap((call) => {
        const item = call as { tool?: unknown; ok?: unknown } | null;
        return typeof item?.tool === 'string'
          ? [{ tool: item.tool.slice(0, 64), ok: item.ok === true }]
          : [];
      })
    : [];
  return {
    steps: typeof meta.steps === 'number' ? meta.steps : null,
    toolCalls,
    finalStep: meta.finalStep === true,
    offerContact: meta.offerContact === true,
    replyChars: typeof meta.chars === 'number' ? meta.chars : null,
  };
}

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;
const duration = (started: string | null, finished: string | null) =>
  started && finished ? Date.parse(finished) - Date.parse(started) : null;

/** Исполнение, которое reaper закрыл как зависшее. */
export interface ReapedExecution {
  id: string;
  userId: string;
  startedAt: string;
}

export interface ExecutionJournal {
  /** Снимок спецификации версии и открытое включение агента на рантайме `agent_gateway`. */
  ensureAgent(input: {
    userId: string;
    solutionId: string;
    version: number;
    spec: AgentSpec;
    activatedBy: string;
  }): Promise<{ deploymentId: string }>;
  /** Новое исполнение; повтор с тем же ключом идемпотентности возвращает `duplicate`. */
  start(input: StartExecution): Promise<{ duplicate: boolean; executionId: string }>;
  event(
    executionId: string,
    userId: string,
    type: EventType,
    action: string | null,
    data: Record<string, unknown>,
  ): Promise<void>;
  /** Резерв шага: `exists` — шаг уже есть (повтор не выполняет его второй раз). */
  reserveEffect(
    executionId: string,
    userId: string,
    stepKey: string,
    action: string,
    authorizedBy: string,
    usageRunId?: string,
  ): Promise<'reserved' | 'exists'>;
  finishEffect(
    executionId: string,
    userId: string,
    stepKey: string,
    outcome: 'committed' | 'failed',
    resultMeta: Record<string, unknown>,
    resultRef?: string,
  ): Promise<void>;
  /** Закрывает только исполнение в статусе `running` (закрытое reaper'ом не переписывается). */
  finish(executionId: string, userId: string, input: FinishExecution): Promise<void>;
  /**
   * Пакет после ответа: эффекты, события и итог. Postgres — два обращения к базе (эффекты должны
   * сначала появиться как `reserved`, затем закрыться — так требует триггер `execution_effects_guard`).
   */
  record(executionId: string, userId: string, batch: JournalBatch): Promise<void>;
  /**
   * Закрывает зависшие исполнения: `running` дольше `olderThanMs` с начала (живой прогон столько не
   * длится — порог больше срока прогона). Не больше `limit` за вызов; статус `failed`, причина `error`,
   * ошибка `{ code: 'reaped_stale_running' }`; незакрытые внутренние эффекты — `failed`.
   */
  reapStale(input: { olderThanMs: number; limit: number }): Promise<ReapedExecution[]>;
  /** Последние исполнения решения, новые первыми (проверка администратором; только чтение). */
  listExecutions(solutionId: string, limit: number): Promise<ExecutionSummary[]>;
}

/** Метаданные пакета после очистки; при срабатывании проверки базы — заглушки. */
function cleanBatch(batch: JournalBatch, placeholder: boolean) {
  const clean = <T>(value: T) =>
    placeholder ? TRIPWIRE_PLACEHOLDER : sanitizeForJournal(value).value;
  const finishMeta = clean({ output: batch.finish.outputMeta, error: batch.finish.error }) as {
    output?: Record<string, unknown>;
    error?: Record<string, unknown> | null;
    redacted?: string;
  };
  return {
    effects: batch.effects.map((effect) => ({ ...effect, resultMeta: clean(effect.resultMeta) })),
    events: batch.events.map((event) => ({ ...event, data: clean(event.data) })),
    output: finishMeta.output ?? (finishMeta.redacted ? { redacted: finishMeta.redacted } : {}),
    error: finishMeta.error ?? null,
  };
}

/**
 * Параметры JSON передаются как `$n::text::jsonb`: строка, объявленная как `jsonb`, драйвер
 * postgres.js кодирует ещё раз, и в базу попадает JSON-строка вместо объекта.
 */

/** Повтор записи пакета с заглушками, если сработала сигнальная проверка секретов базы. */
async function writeBatchSafely(
  batch: JournalBatch,
  write: (clean: ReturnType<typeof cleanBatch>) => Promise<void>,
): Promise<void> {
  try {
    await write(cleanBatch(batch, false));
  } catch (error) {
    if (!isSecretTripwire(error)) throw error;
    console.error(
      '[journal] secret tripwire fired after sanitizing a batch: code and database rules differ',
      {
        constraint: (error as { constraint_name?: string }).constraint_name,
      },
    );
    await write(cleanBatch(batch, true));
  }
}

/** Код ошибки зависшего исполнения (журнал, панель владельца). */
export const REAPED_ERROR = { code: 'reaped_stale_running' } as const;

// ─── Память ────────────────────────────────────────────────────────────────────────────────

interface MemoryExecution extends StartExecution {
  status: ExecutionStatus;
  stopReason: string | null;
  costUsd: number;
  creditsUsd: number;
  outputMeta: Record<string, unknown>;
  error: Record<string, unknown> | null;
}

export class MemoryExecutionJournal implements ExecutionJournal {
  readonly specs = new Map<string, AgentSpec>();
  readonly deployments: Array<{
    id: string;
    userId: string;
    solutionId: string;
    version: number;
    endedAt: string | null;
  }> = [];
  readonly executions = new Map<string, MemoryExecution>();
  readonly events: Array<{
    executionId: string;
    seq: number;
    type: EventType;
    action: string | null;
    data: Record<string, unknown>;
  }> = [];
  readonly effects = new Map<
    string,
    {
      executionId: string;
      stepKey: string;
      action: string;
      authorizedBy: string;
      status: 'reserved' | 'committed' | 'failed';
      resultMeta: Record<string, unknown>;
      resultRef: string | null;
      usageRunId: string | null;
    }
  >();

  async ensureAgent(input: Parameters<ExecutionJournal['ensureAgent']>[0]) {
    const specKey = `${input.solutionId}:${input.version}`;
    if (!this.specs.has(specKey)) this.specs.set(specKey, input.spec);
    const open = this.deployments.find((d) => d.solutionId === input.solutionId && !d.endedAt);
    if (open && open.version === input.version) return { deploymentId: open.id };
    if (open) open.endedAt = new Date().toISOString();
    const id = `dep_${randomUUID()}`;
    this.deployments.push({
      id,
      userId: input.userId,
      solutionId: input.solutionId,
      version: input.version,
      endedAt: null,
    });
    return { deploymentId: id };
  }

  async start(input: StartExecution) {
    if (input.idempotencyKey) {
      for (const execution of this.executions.values()) {
        if (
          execution.userId === input.userId &&
          execution.idempotencyKey === input.idempotencyKey
        ) {
          return { duplicate: true, executionId: execution.id };
        }
      }
    }
    await writeJournalSafely(input.inputMeta, async (inputMeta) => {
      this.startedAt.set(input.id, Date.now());
      this.executions.set(input.id, {
        ...input,
        inputMeta: inputMeta as Record<string, unknown>,
        status: 'running',
        stopReason: null,
        costUsd: 0,
        creditsUsd: 0,
        outputMeta: {},
        error: null,
      });
    });
    return { duplicate: false, executionId: input.id };
  }

  async event(
    executionId: string,
    _userId: string,
    type: EventType,
    action: string | null,
    data: Record<string, unknown>,
  ) {
    const seq = this.events.filter((e) => e.executionId === executionId).length + 1;
    await writeJournalSafely(data, async (clean) => {
      this.events.push({ executionId, seq, type, action, data: clean as Record<string, unknown> });
    });
  }

  async reserveEffect(
    executionId: string,
    _userId: string,
    stepKey: string,
    action: string,
    authorizedBy: string,
    usageRunId?: string,
  ) {
    const key = `${executionId}:${stepKey}`;
    if (this.effects.has(key)) return 'exists' as const;
    this.effects.set(key, {
      executionId,
      stepKey,
      action,
      authorizedBy,
      status: 'reserved',
      resultMeta: {},
      resultRef: null,
      usageRunId: usageRunId ?? null,
    });
    return 'reserved' as const;
  }

  async finishEffect(
    executionId: string,
    _userId: string,
    stepKey: string,
    outcome: 'committed' | 'failed',
    resultMeta: Record<string, unknown>,
    resultRef?: string,
  ) {
    const effect = this.effects.get(`${executionId}:${stepKey}`);
    if (!effect || effect.status !== 'reserved') return;
    await writeJournalSafely(resultMeta, async (clean) => {
      effect.status = outcome;
      effect.resultMeta = clean as Record<string, unknown>;
      effect.resultRef = resultRef ?? null;
    });
  }

  async finish(executionId: string, _userId: string, input: FinishExecution) {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'running') return;
    await writeJournalSafely({ output: input.outputMeta, error: input.error }, async (clean) => {
      const meta = clean as {
        output?: Record<string, unknown>;
        error?: Record<string, unknown> | null;
        redacted?: string;
      };
      execution.status = input.status;
      execution.stopReason = input.stopReason;
      execution.costUsd = input.costUsd;
      execution.creditsUsd = input.creditsUsd;
      execution.outputMeta = meta.output ?? (meta.redacted ? { redacted: meta.redacted } : {});
      execution.error = meta.error ?? null;
      this.finishedAt.set(executionId, Date.now());
    });
  }

  /** Время окончания исполнения (память). */
  readonly finishedAt = new Map<string, number>();

  async listExecutions(solutionId: string, limit: number): Promise<ExecutionSummary[]> {
    return [...this.executions.values()]
      .filter((execution) => execution.solutionId === solutionId)
      .reverse()
      .slice(0, limit)
      .map((execution) => {
        const startedAt = iso(
          this.startedAt.has(execution.id) ? new Date(this.startedAt.get(execution.id)!) : null,
        );
        const finishedAt = iso(
          this.finishedAt.has(execution.id) ? new Date(this.finishedAt.get(execution.id)!) : null,
        );
        const models = [...this.effects.values()]
          .filter((e) => e.executionId === execution.id && e.stepKey.startsWith('model-'))
          .flatMap((e) => (typeof e.resultMeta.model === 'string' ? [e.resultMeta.model] : []));
        return {
          id: execution.id,
          solutionVersion: execution.solutionVersion,
          triggerKind: execution.triggerKind,
          status: execution.status,
          stopReason: execution.stopReason,
          startedAt,
          finishedAt,
          durationMs: duration(startedAt, finishedAt),
          ...summaryFields(execution.outputMeta),
          costUsd: execution.costUsd,
          creditsUsd: execution.creditsUsd,
          errorCode: typeof execution.error?.code === 'string' ? execution.error.code : null,
          models,
        };
      });
  }

  async record(executionId: string, userId: string, batch: JournalBatch) {
    for (const effect of batch.effects) {
      if (!effect.reserved) {
        await this.reserveEffect(
          executionId,
          userId,
          effect.stepKey,
          effect.action,
          effect.authorizedBy,
          effect.usageRunId,
        );
      }
      await this.finishEffect(
        executionId,
        userId,
        effect.stepKey,
        effect.outcome,
        effect.resultMeta,
      );
    }
    for (const event of batch.events) {
      await this.event(executionId, userId, event.type, event.action, event.data);
    }
    await this.finish(executionId, userId, batch.finish);
  }

  /** Время начала исполнения (память): тесты reaper'а сдвигают его назад. */
  readonly startedAt = new Map<string, number>();

  async reapStale(input: { olderThanMs: number; limit: number }) {
    const now = Date.now();
    const reaped: ReapedExecution[] = [];
    for (const execution of this.executions.values()) {
      if (reaped.length >= input.limit) break;
      const started = this.startedAt.get(execution.id) ?? now;
      if (execution.status !== 'running' || now - started <= input.olderThanMs) continue;
      execution.status = 'failed';
      execution.stopReason = 'error';
      execution.error = { ...REAPED_ERROR };
      for (const effect of this.effects.values()) {
        if (effect.executionId === execution.id && effect.status === 'reserved') {
          effect.status = 'failed';
          effect.resultMeta = { reaped: true };
        }
      }
      reaped.push({
        id: execution.id,
        userId: execution.userId,
        startedAt: new Date(started).toISOString(),
      });
    }
    return reaped;
  }
}

// ─── Postgres ──────────────────────────────────────────────────────────────────────────────

export class PostgresExecutionJournal implements ExecutionJournal {
  constructor(private readonly sql: SqlRunner) {}

  async ensureAgent(input: Parameters<ExecutionJournal['ensureAgent']>[0]) {
    await this.sql.query(
      `INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
       VALUES ($1, $2, $3, $4::text::jsonb) ON CONFLICT (solution_id, version_number) DO NOTHING`,
      [input.solutionId, input.version, input.userId, JSON.stringify(input.spec)],
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const open = await this.sql.query<{ id: string; agent_version: number }>(
        `SELECT id, agent_version FROM agent_deployments WHERE solution_id = $1 AND ended_at IS NULL`,
        [input.solutionId],
      );
      if (open[0] && open[0].agent_version === input.version) return { deploymentId: open[0].id };
      if (open[0]) {
        await this.sql.query(
          `UPDATE agent_deployments SET state = 'ended', ended_at = now(), end_reason = 'new_version'
           WHERE id = $1 AND ended_at IS NULL`,
          [open[0].id],
        );
      }
      const id = `dep_${randomUUID()}`;
      try {
        await this.sql.query(
          `INSERT INTO agent_deployments (id, user_id, solution_id, agent_version, runtime, state, activated_by)
           VALUES ($1, $2, $3, $4, 'agent_gateway', 'active', $5)`,
          [id, input.userId, input.solutionId, input.version, input.activatedBy],
        );
        return { deploymentId: id };
      } catch (error) {
        // Другой процесс открыл включение одновременно: перечитываем.
        if ((error as { code?: string }).code !== '23505') throw error;
      }
    }
    throw new Error(`agent deployment for ${input.solutionId} could not be opened`);
  }

  async start(input: StartExecution) {
    let inserted = false;
    let executionId = input.id;
    await writeJournalSafely(input.inputMeta, async (inputMeta) => {
      const rows = await this.sql.query<{ id: string }>(
        `INSERT INTO executions (id, user_id, solution_id, solution_version, kind, agent_deployment_id, runtime,
           trigger_kind, trigger_ref, status, started_at, idempotency_key, input_meta, trace_id)
         VALUES ($1, $2, $3, $4, 'agent', $5, 'agent_gateway', $6, $7, 'running', now(), $8, $9::text::jsonb, $10)
         ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          input.id,
          input.userId,
          input.solutionId,
          input.solutionVersion,
          input.deploymentId,
          input.triggerKind,
          input.triggerRef,
          input.idempotencyKey ?? null,
          JSON.stringify(inputMeta),
          input.traceId,
        ],
      );
      inserted = rows.length === 1;
    });
    if (!inserted && input.idempotencyKey) {
      const rows = await this.sql.query<{ id: string }>(
        `SELECT id FROM executions WHERE user_id = $1 AND idempotency_key = $2`,
        [input.userId, input.idempotencyKey],
      );
      executionId = rows[0]?.id ?? input.id;
    }
    return { duplicate: !inserted, executionId };
  }

  async event(
    executionId: string,
    userId: string,
    type: EventType,
    action: string | null,
    data: Record<string, unknown>,
  ) {
    await writeJournalSafely(data, async (clean) => {
      await this.sql.query(
        `INSERT INTO execution_events (execution_id, user_id, seq, type, action, data)
         VALUES ($1, $2, (SELECT coalesce(max(seq), 0) + 1 FROM execution_events WHERE execution_id = $1), $3, $4, $5::text::jsonb)`,
        [executionId, userId, type, action, JSON.stringify(clean)],
      );
    });
  }

  async reserveEffect(
    executionId: string,
    userId: string,
    stepKey: string,
    action: string,
    authorizedBy: string,
    usageRunId?: string,
  ) {
    const rows = await this.sql.query(
      `INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, usage_run_id)
       VALUES ($1, $2, $3, $4, false, 'reserved', $5, $6)
       ON CONFLICT (execution_id, step_key) DO NOTHING RETURNING step_key`,
      [executionId, userId, stepKey, action, authorizedBy, usageRunId ?? null],
    );
    return rows.length === 1 ? ('reserved' as const) : ('exists' as const);
  }

  async finishEffect(
    executionId: string,
    userId: string,
    stepKey: string,
    outcome: 'committed' | 'failed',
    resultMeta: Record<string, unknown>,
    resultRef?: string,
  ) {
    await writeJournalSafely(resultMeta, async (clean) => {
      await this.sql.query(
        `UPDATE execution_effects
            SET status = $4, finished_at = now(), result_meta = $5::text::jsonb, result_ref = $6,
                failure_stage = CASE WHEN $4 = 'failed' THEN 'before_dispatch' END
          WHERE execution_id = $1 AND user_id = $2 AND step_key = $3 AND status = 'reserved'`,
        [executionId, userId, stepKey, outcome, JSON.stringify(clean), resultRef ?? null],
      );
    });
  }

  async finish(executionId: string, userId: string, input: FinishExecution) {
    await writeJournalSafely({ output: input.outputMeta, error: input.error }, async (clean) => {
      const meta = clean as {
        output?: Record<string, unknown>;
        error?: Record<string, unknown> | null;
        redacted?: string;
      };
      await this.sql.query(
        `UPDATE executions
            SET status = $3, stop_reason = $4, finished_at = now(), cost_usd = $5, credits_usd = $6,
                output_meta = $7::text::jsonb, error = $8::text::jsonb, updated_at = now(), version = version + 1
          WHERE id = $1 AND user_id = $2 AND status = 'running'`,
        [
          executionId,
          userId,
          input.status,
          input.stopReason,
          input.costUsd,
          input.creditsUsd,
          JSON.stringify(meta.output ?? (meta.redacted ? { redacted: meta.redacted } : {})),
          meta.error ? JSON.stringify(meta.error) : null,
        ],
      );
    });
  }

  async record(executionId: string, userId: string, batch: JournalBatch) {
    await writeBatchSafely(batch, async (clean) => {
      const toReserve = clean.effects.filter((effect) => !effect.reserved);
      // 1. Новые эффекты (как `reserved`) и события — одной командой.
      if (toReserve.length > 0 || clean.events.length > 0) {
        await this.sql.query(
          `WITH reserved AS (
             INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status, authorized_by, usage_run_id)
             SELECT $1, $2, x.step_key, x.action, false, 'reserved', x.authorized_by, x.usage_run_id
               FROM jsonb_to_recordset($3::text::jsonb) AS x(step_key text, action text, authorized_by text, usage_run_id text)
             ON CONFLICT (execution_id, step_key) DO NOTHING
             RETURNING step_key
           ), appended AS (
             INSERT INTO execution_events (execution_id, user_id, seq, type, action, data)
             SELECT $1, $2, base.seq + x.n, x.type, x.action, x.data
               FROM jsonb_to_recordset($4::text::jsonb) AS x(n integer, type text, action text, data jsonb),
                    (SELECT coalesce(max(seq), 0) AS seq FROM execution_events WHERE execution_id = $1) AS base
             RETURNING seq
           )
           SELECT (SELECT count(*) FROM reserved) AS effects, (SELECT count(*) FROM appended) AS events`,
          [
            executionId,
            userId,
            JSON.stringify(
              toReserve.map((effect) => ({
                step_key: effect.stepKey,
                action: effect.action,
                authorized_by: effect.authorizedBy,
                usage_run_id: effect.usageRunId ?? null,
              })),
            ),
            JSON.stringify(
              clean.events.map((event, index) => ({
                n: index + 1,
                type: event.type,
                action: event.action,
                data: event.data,
              })),
            ),
          ],
        );
      }
      // 2. Итог эффектов и исполнения — одной командой. Закрытое reaper'ом исполнение не переписывается.
      await this.sql.query(
        `WITH closed AS (
           UPDATE execution_effects AS e
              SET status = x.outcome, finished_at = now(), result_meta = x.result_meta,
                  failure_stage = CASE WHEN x.outcome = 'failed' THEN 'before_dispatch' END
             FROM jsonb_to_recordset($3::text::jsonb) AS x(step_key text, outcome text, result_meta jsonb)
            WHERE e.execution_id = $1 AND e.user_id = $2 AND e.step_key = x.step_key AND e.status = 'reserved'
           RETURNING e.step_key
         )
         UPDATE executions
            SET status = $4, stop_reason = $5, finished_at = now(), cost_usd = $6, credits_usd = $7,
                output_meta = $8::text::jsonb, error = $9::text::jsonb, updated_at = now(), version = version + 1
          WHERE id = $1 AND user_id = $2 AND status = 'running'
          RETURNING (SELECT count(*) FROM closed) AS effects`,
        [
          executionId,
          userId,
          JSON.stringify(
            clean.effects.map((effect) => ({
              step_key: effect.stepKey,
              outcome: effect.outcome,
              result_meta: effect.resultMeta,
            })),
          ),
          batch.finish.status,
          batch.finish.stopReason,
          batch.finish.costUsd,
          batch.finish.creditsUsd,
          JSON.stringify(clean.output),
          clean.error ? JSON.stringify(clean.error) : null,
        ],
      );
    });
  }

  async reapStale(input: { olderThanMs: number; limit: number }) {
    // Одна команда: выбор (с пропуском заблокированных строк), закрытие эффектов, закрытие исполнений.
    // Внешние эффекты в статусе `dispatched` не трогаются: их исход неизвестен, их сверяют отдельно.
    const rows = await this.sql.query<{ id: string; user_id: string; started_at: Date | string }>(
      `WITH stale AS (
         SELECT id, user_id FROM executions
          WHERE status = 'running' AND kind = 'agent' AND runtime = 'agent_gateway'
            AND started_at < now() - make_interval(secs => $1::double precision / 1000)
          ORDER BY started_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       ), effects AS (
         UPDATE execution_effects AS e
            SET status = 'failed', failure_stage = 'before_dispatch', finished_at = now(),
                result_meta = '{"reaped":true}'::jsonb
           FROM stale
          WHERE e.execution_id = stale.id AND e.user_id = stale.user_id AND e.status = 'reserved'
         RETURNING e.execution_id
       )
       UPDATE executions AS x
          SET status = 'failed', stop_reason = 'error', finished_at = now(),
              error = $3::text::jsonb, updated_at = now(), version = x.version + 1
         FROM stale
        WHERE x.id = stale.id AND x.user_id = stale.user_id AND x.status = 'running'
       RETURNING x.id, x.user_id, x.started_at, (SELECT count(*) FROM effects) AS effects`,
      [input.olderThanMs, input.limit, JSON.stringify(REAPED_ERROR)],
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      startedAt: new Date(row.started_at).toISOString(),
    }));
  }

  async listExecutions(solutionId: string, limit: number): Promise<ExecutionSummary[]> {
    const rows = await this.sql.query<{
      id: string;
      solution_version: number | null;
      trigger_kind: string;
      status: ExecutionSummary['status'];
      stop_reason: string | null;
      started_at: Date | string | null;
      finished_at: Date | string | null;
      cost_usd: number | string;
      credits_usd: number | string;
      output_meta: unknown;
      error_code: string | null;
      models: string[] | null;
    }>(
      `SELECT e.id, e.solution_version, e.trigger_kind, e.status, e.stop_reason, e.started_at, e.finished_at,
              e.cost_usd, e.credits_usd, e.output_meta, e.error ->> 'code' AS error_code,
              ARRAY(SELECT f.result_meta ->> 'model' FROM execution_effects f
                     WHERE f.execution_id = e.id AND f.user_id = e.user_id
                       AND f.step_key LIKE 'model-%' AND f.result_meta ? 'model'
                     ORDER BY length(f.step_key), f.step_key) AS models
         FROM executions e
        WHERE e.solution_id = $1
        ORDER BY e.created_at DESC, e.id
        LIMIT $2`,
      [solutionId, limit],
    );
    return rows.map((row) => {
      const startedAt = iso(row.started_at);
      const finishedAt = iso(row.finished_at);
      return {
        id: row.id,
        solutionVersion: row.solution_version,
        triggerKind: row.trigger_kind,
        status: row.status,
        stopReason: row.stop_reason,
        startedAt,
        finishedAt,
        durationMs: duration(startedAt, finishedAt),
        ...summaryFields(row.output_meta),
        costUsd: Number(row.cost_usd),
        creditsUsd: Number(row.credits_usd),
        errorCode: row.error_code,
        models: (row.models ?? []).filter((model): model is string => typeof model === 'string'),
      };
    });
  }
}
