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
import { writeJournalSafely } from './secrets.js';

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
  finish(executionId: string, userId: string, input: FinishExecution): Promise<void>;
}

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
    if (!execution) return;
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
    });
  }
}

// ─── Postgres ──────────────────────────────────────────────────────────────────────────────

export class PostgresExecutionJournal implements ExecutionJournal {
  constructor(private readonly sql: SqlRunner) {}

  async ensureAgent(input: Parameters<ExecutionJournal['ensureAgent']>[0]) {
    await this.sql.query(
      `INSERT INTO solution_version_specs (solution_id, version_number, user_id, spec)
       VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (solution_id, version_number) DO NOTHING`,
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
         VALUES ($1, $2, $3, $4, 'agent', $5, 'agent_gateway', $6, $7, 'running', now(), $8, $9::jsonb, $10)
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
         VALUES ($1, $2, (SELECT coalesce(max(seq), 0) + 1 FROM execution_events WHERE execution_id = $1), $3, $4, $5::jsonb)`,
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
            SET status = $4, finished_at = now(), result_meta = $5::jsonb, result_ref = $6,
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
                output_meta = $7::jsonb, error = $8::jsonb, updated_at = now(), version = version + 1
          WHERE id = $1 AND user_id = $2`,
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
}
