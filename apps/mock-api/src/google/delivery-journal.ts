/**
 * Журнал доставки заявок в Google Таблицу (docs/STAGE_F_SHEETS.md, раздел 5.2): исполнение
 * `kind = 'delivery'` на заявку и эффект `sheet.append_row` с машиной состояний базы
 * (триггер `execution_effects_guard`, миграция 0015):
 *
 *   reserved → dispatched → committed | failed (provider_rejected) | unknown
 *   reserved → failed (before_dispatch)
 *   unknown  → committed (resolved_by) | failed (reconciled_not_done)
 *   failed   → reserved (attempts + 1, не больше 4)
 *
 * `unknown → reserved` база не разрешает: у `values.append` нет ключа идемпотентности, неясный
 * исход сначала сверяется по колонке «ID заявки». После 4 попыток — новый шаг
 * `sheet_append_r<n>` (n ≤ 5) по кнопке «повторить».
 *
 * Каждый переход — условный: он проходит, только если шаг всё ещё в том состоянии, в котором его
 * прочитали (статус и номер попытки). Два процесса не выполнят один шаг дважды.
 *
 * В `result_meta` — только коды (`{ http, rows }` или `{ code, retry }`), без данных заявки.
 */

import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '../code/postgres-driver.js';

export const DELIVERY_ACTION = 'sheet.append_row';
export const DELIVERY_STEP = 'sheet_append';
/** Попыток одного шага — столько разрешает база. */
export const MAX_ATTEMPTS = 4;
/** Ручных повторов после 4 неудачных попыток. */
export const MAX_MANUAL_STEPS = 5;
/** Аренда шага: столько один процесс держит его за собой. */
export const LEASE_MS = 2 * 60_000;
/** Паузы перед повтором после попытки 1, 2, 3. */
export const RETRY_PAUSES_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

export type DeliveryStatus = 'reserved' | 'dispatched' | 'committed' | 'failed' | 'unknown';

export interface DeliveryMeta {
  http?: number;
  rows?: number;
  /** Код сбоя: `http_5xx`, `quota`, `invalid_grant`, `not_found`, `trashed`, … */
  code?: string;
  /** Повторять ли автоматически (временный сбой). */
  retry?: boolean;
}

export interface DeliveryEffect {
  executionId: string;
  userId: string;
  solutionId: string | null;
  leadId: string;
  stepKey: string;
  status: DeliveryStatus;
  attempts: number;
  leaseExpiresAt: string | null;
  finishedAt: string | null;
  resultMeta: DeliveryMeta;
}

export const deliveryExecutionId = (leadId: string) => `delivery:${leadId}`;

/** Ключ следующего шага после `stepKey` (`sheet_append` → `sheet_append_r1` → …). */
export function nextStepKey(stepKey: string): string | null {
  const match = /^sheet_append(?:_r(\d+))?$/.exec(stepKey);
  if (!match) return null;
  const n = match[1] ? Number(match[1]) + 1 : 1;
  return n <= MAX_MANUAL_STEPS ? `${DELIVERY_STEP}_r${n}` : null;
}

/** Окончательный ли это сбой (автоматических повторов больше не будет). */
export function isFinalFailure(effect: Pick<DeliveryEffect, 'attempts' | 'resultMeta'>): boolean {
  return effect.resultMeta.retry !== true || effect.attempts >= MAX_ATTEMPTS;
}

export interface DeliveryJournal {
  /** Исполнение и первый шаг (`reserved`). Повтор для той же заявки — `created: false`. */
  start(input: {
    userId: string;
    solutionId: string;
    leadId: string;
  }): Promise<{ created: boolean; effect: DeliveryEffect | null }>;
  /** Последний шаг заявки. */
  latest(userId: string, leadId: string): Promise<DeliveryEffect | null>;
  /** Последние шаги заявок аккаунта. */
  latestFor(userId: string, leadIds: string[]): Promise<Map<string, DeliveryEffect>>;
  /** Заявки аккаунта, у которых последний шаг — сбой (для «дописать пропущенные»), старые первыми. */
  failed(userId: string, limit: number): Promise<DeliveryEffect[]>;
  /** Перед запросом к Google: `reserved → dispatched`. */
  dispatch(effect: DeliveryEffect): Promise<DeliveryEffect | null>;
  /** `dispatched → committed` или, со сверкой, `unknown → committed`. */
  commit(
    effect: DeliveryEffect,
    resultRef: string,
    meta: DeliveryMeta,
    resolvedBy?: string,
  ): Promise<DeliveryEffect | null>;
  /**
   * Сбой: из `reserved` — до отправки, из `dispatched` — отказ Google, из `unknown` (со сверкой) —
   * «не записано».
   */
  fail(
    effect: DeliveryEffect,
    meta: DeliveryMeta,
    resolvedBy?: string,
  ): Promise<DeliveryEffect | null>;
  /** Ответа нет после отправки: `dispatched → unknown`. */
  markUnknown(effect: DeliveryEffect): Promise<DeliveryEffect | null>;
  /** Повтор того же шага: `failed → reserved`, попытка + 1 (не больше 4). */
  retry(effect: DeliveryEffect): Promise<DeliveryEffect | null>;
  /** Новый шаг после 4 попыток (кнопка «повторить»). */
  newStep(effect: DeliveryEffect, stepKey: string): Promise<DeliveryEffect | null>;
  /** Шаг `reserved` с истёкшей арендой — новая аренда (процесс, державший шаг, умер до отправки). */
  renewLease(effect: DeliveryEffect): Promise<DeliveryEffect | null>;
  /**
   * Шаги, которые пора продолжить: аренда истекла (`reserved` / `dispatched`), исход неизвестен
   * (`unknown`), временный сбой и пауза прошла (`failed`, попыток меньше 4).
   */
  due(now: number, limit: number): Promise<DeliveryEffect[]>;
}

function pauseAfter(attempts: number): number {
  return RETRY_PAUSES_MS[Math.min(attempts, RETRY_PAUSES_MS.length) - 1] ?? RETRY_PAUSES_MS[0];
}

// ─── Память ────────────────────────────────────────────────────────────────────────────────

interface MemoryExecution {
  id: string;
  userId: string;
  solutionId: string;
  leadId: string;
  status: 'running' | 'succeeded' | 'failed';
  steps: string[];
}

export class MemoryDeliveryJournal implements DeliveryJournal {
  readonly executions = new Map<string, MemoryExecution>();
  readonly effects = new Map<string, DeliveryEffect & { reservedAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(executionId: string, stepKey: string) {
    return `${executionId}\u0000${stepKey}`;
  }

  private copy(effect: DeliveryEffect): DeliveryEffect {
    const { reservedAt: _at, ...rest } = effect as DeliveryEffect & { reservedAt?: number };
    return { ...rest, resultMeta: { ...rest.resultMeta } };
  }

  private lease(): string {
    return new Date(this.now() + LEASE_MS).toISOString();
  }

  private reserve(execution: MemoryExecution, stepKey: string): DeliveryEffect {
    const effect = {
      executionId: execution.id,
      userId: execution.userId,
      solutionId: execution.solutionId,
      leadId: execution.leadId,
      stepKey,
      status: 'reserved' as const,
      attempts: 1,
      leaseExpiresAt: this.lease(),
      finishedAt: null,
      resultMeta: {},
      reservedAt: this.now(),
    };
    this.effects.set(this.key(execution.id, stepKey), effect);
    execution.steps.push(stepKey);
    execution.status = 'running';
    return this.copy(effect);
  }

  /** Текущий шаг, если он в ожидаемом состоянии. */
  private current(expected: DeliveryEffect, statuses: DeliveryStatus[]) {
    const effect = this.effects.get(this.key(expected.executionId, expected.stepKey));
    if (!effect || effect.userId !== expected.userId) return null;
    if (!statuses.includes(effect.status) || effect.attempts !== expected.attempts) return null;
    if (effect.status !== expected.status) return null;
    return effect;
  }

  private settle(effect: DeliveryEffect) {
    const execution = this.executions.get(effect.executionId);
    if (!execution) return;
    if (effect.status === 'committed') execution.status = 'succeeded';
    else if (effect.status === 'failed' && isFinalFailure(effect)) execution.status = 'failed';
    else execution.status = 'running';
  }

  async start(input: { userId: string; solutionId: string; leadId: string }) {
    const id = deliveryExecutionId(input.leadId);
    let execution = this.executions.get(id);
    if (execution && execution.userId !== input.userId) return { created: false, effect: null };
    if (!execution) {
      execution = { id, ...input, status: 'running', steps: [] };
      this.executions.set(id, execution);
    }
    if (execution.steps.length > 0) {
      return { created: false, effect: await this.latest(input.userId, input.leadId) };
    }
    return { created: true, effect: this.reserve(execution, DELIVERY_STEP) };
  }

  async latest(userId: string, leadId: string) {
    const execution = this.executions.get(deliveryExecutionId(leadId));
    if (!execution || execution.userId !== userId) return null;
    const step = execution.steps.at(-1);
    const effect = step ? this.effects.get(this.key(execution.id, step)) : undefined;
    return effect ? this.copy(effect) : null;
  }

  async latestFor(userId: string, leadIds: string[]) {
    const result = new Map<string, DeliveryEffect>();
    for (const leadId of leadIds) {
      const effect = await this.latest(userId, leadId);
      if (effect) result.set(leadId, effect);
    }
    return result;
  }

  async failed(userId: string, limit: number) {
    const result: DeliveryEffect[] = [];
    for (const execution of this.executions.values()) {
      if (execution.userId !== userId) continue;
      const effect = await this.latest(userId, execution.leadId);
      if (effect?.status === 'failed') result.push(effect);
    }
    return result.slice(0, limit);
  }

  async dispatch(expected: DeliveryEffect) {
    const effect = this.current(expected, ['reserved']);
    if (!effect) return null;
    effect.status = 'dispatched';
    return this.copy(effect);
  }

  async commit(
    expected: DeliveryEffect,
    _resultRef: string,
    meta: DeliveryMeta,
    resolvedBy?: string,
  ) {
    const effect = this.current(expected, resolvedBy ? ['unknown'] : ['dispatched']);
    if (!effect) return null;
    Object.assign(effect, {
      status: 'committed',
      leaseExpiresAt: null,
      finishedAt: new Date(this.now()).toISOString(),
      resultMeta: { ...meta },
    });
    this.settle(effect);
    return this.copy(effect);
  }

  async fail(expected: DeliveryEffect, meta: DeliveryMeta, resolvedBy?: string) {
    const effect = this.current(expected, resolvedBy ? ['unknown'] : ['reserved', 'dispatched']);
    if (!effect) return null;
    Object.assign(effect, {
      status: 'failed',
      leaseExpiresAt: null,
      finishedAt: new Date(this.now()).toISOString(),
      resultMeta: { ...meta },
    });
    this.settle(effect);
    return this.copy(effect);
  }

  async markUnknown(expected: DeliveryEffect) {
    const effect = this.current(expected, ['dispatched']);
    if (!effect) return null;
    Object.assign(effect, {
      status: 'unknown',
      leaseExpiresAt: null,
      finishedAt: new Date(this.now()).toISOString(),
    });
    return this.copy(effect);
  }

  async retry(expected: DeliveryEffect) {
    const effect = this.current(expected, ['failed']);
    if (!effect || effect.attempts >= MAX_ATTEMPTS) return null;
    Object.assign(effect, {
      status: 'reserved',
      attempts: effect.attempts + 1,
      leaseExpiresAt: this.lease(),
      finishedAt: null,
      resultMeta: { ...effect.resultMeta },
    });
    this.settle(effect);
    return this.copy(effect);
  }

  async newStep(expected: DeliveryEffect, stepKey: string) {
    const execution = this.executions.get(expected.executionId);
    if (!execution || execution.userId !== expected.userId) return null;
    if (execution.steps.at(-1) !== expected.stepKey) return null;
    if (!this.current(expected, ['failed'])) return null;
    if (this.effects.has(this.key(execution.id, stepKey))) return null;
    return this.reserve(execution, stepKey);
  }

  async renewLease(expected: DeliveryEffect) {
    const effect = this.current(expected, ['reserved']);
    if (!effect || Date.parse(effect.leaseExpiresAt ?? '') >= this.now()) return null;
    effect.leaseExpiresAt = this.lease();
    return this.copy(effect);
  }

  async due(now: number, limit: number) {
    const due: Array<DeliveryEffect & { reservedAt: number }> = [];
    for (const effect of this.effects.values()) {
      const leaseOver =
        (effect.status === 'reserved' || effect.status === 'dispatched') &&
        Date.parse(effect.leaseExpiresAt ?? '') < now;
      const retryable =
        effect.status === 'failed' &&
        effect.attempts < MAX_ATTEMPTS &&
        effect.resultMeta.retry === true &&
        Date.parse(effect.finishedAt ?? '') + pauseAfter(effect.attempts) <= now;
      if (leaseOver || effect.status === 'unknown' || retryable) due.push(effect);
    }
    return due
      .sort((a, b) => a.reservedAt - b.reservedAt)
      .slice(0, limit)
      .map((effect) => this.copy(effect));
  }
}

// ─── Postgres ──────────────────────────────────────────────────────────────────────────────

interface EffectRow {
  execution_id: string;
  user_id: string;
  solution_id: string | null;
  step_key: string;
  status: DeliveryStatus;
  attempts: number;
  lease_expires_at: Date | string | null;
  finished_at: Date | string | null;
  result_meta: DeliveryMeta | string | null;
}

const isoOrNull = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);

function toEffect(row: EffectRow): DeliveryEffect {
  const meta =
    typeof row.result_meta === 'string'
      ? (JSON.parse(row.result_meta) as DeliveryMeta)
      : (row.result_meta ?? {});
  return {
    executionId: row.execution_id,
    userId: row.user_id,
    solutionId: row.solution_id,
    leadId: row.execution_id.replace(/^delivery:/, ''),
    stepKey: row.step_key,
    status: row.status,
    attempts: Number(row.attempts),
    leaseExpiresAt: isoOrNull(row.lease_expires_at),
    finishedAt: isoOrNull(row.finished_at),
    resultMeta: meta,
  };
}

const EFFECT_COLUMNS = `e.execution_id, e.user_id, x.solution_id, e.step_key, e.status, e.attempts,
  e.lease_expires_at, e.finished_at, e.result_meta`;

/** Статус исполнения по новому состоянию шага — одним запросом с переходом шага. */
const SETTLE_EXECUTION = `
  UPDATE executions AS x
     SET status = CASE
           WHEN u.status = 'committed' THEN 'succeeded'
           WHEN u.status = 'failed' AND ((u.result_meta ->> 'retry') IS DISTINCT FROM 'true' OR u.attempts >= ${MAX_ATTEMPTS})
             THEN 'failed'
           ELSE 'running' END,
         finished_at = CASE
           WHEN u.status = 'committed'
             OR (u.status = 'failed' AND ((u.result_meta ->> 'retry') IS DISTINCT FROM 'true' OR u.attempts >= ${MAX_ATTEMPTS}))
             THEN now() ELSE NULL END,
         stop_reason = CASE
           WHEN u.status = 'failed' AND ((u.result_meta ->> 'retry') IS DISTINCT FROM 'true' OR u.attempts >= ${MAX_ATTEMPTS})
             THEN 'failures' ELSE NULL END,
         updated_at = now(), version = x.version + 1
    FROM u
   WHERE x.id = u.execution_id AND x.user_id = u.user_id AND x.kind = 'delivery'`;

export class PostgresDeliveryJournal implements DeliveryJournal {
  constructor(private readonly sql: SqlRunner) {}

  /** Переход шага `UPDATE … SET <set> WHERE <условие>`; с `settle` — и статус исполнения. */
  private async transition(
    expected: DeliveryEffect,
    statuses: DeliveryStatus[],
    set: string,
    params: unknown[],
    settle: boolean,
    extraWhere = '',
  ): Promise<DeliveryEffect | null> {
    const base = [expected.executionId, expected.userId, expected.stepKey, expected.attempts];
    const where = `e.execution_id = $1 AND e.user_id = $2 AND e.step_key = $3 AND e.attempts = $4
      AND e.status IN (${statuses.map((status) => `'${status}'`).join(', ')})${extraWhere}`;
    const rows = await this.sql.query<EffectRow>(
      `WITH u AS (
         UPDATE execution_effects AS e SET ${set} WHERE ${where}
         RETURNING e.*
       )${settle ? `, s AS (${SETTLE_EXECUTION} RETURNING x.id)` : ''}
       SELECT u.execution_id, u.user_id, x.solution_id, u.step_key, u.status, u.attempts,
              u.lease_expires_at, u.finished_at, u.result_meta
         FROM u JOIN executions x ON x.id = u.execution_id AND x.user_id = u.user_id`,
      [...base, ...params],
    );
    return rows[0] ? toEffect(rows[0]) : null;
  }

  private async insertStep(executionId: string, userId: string, stepKey: string) {
    const rows = await this.sql.query<{ step_key: string }>(
      `INSERT INTO execution_effects (execution_id, user_id, step_key, action, external, status,
         authorized_by, provider_supports_idempotency, lease_expires_at)
       VALUES ($1, $2, $3, '${DELIVERY_ACTION}', true, 'reserved', 'risk_low', false,
         now() + make_interval(secs => ${LEASE_MS / 1000}))
       ON CONFLICT (execution_id, step_key) DO NOTHING RETURNING step_key`,
      [executionId, userId, stepKey],
    );
    return rows.length === 1;
  }

  async start(input: { userId: string; solutionId: string; leadId: string }) {
    const id = deliveryExecutionId(input.leadId);
    await this.sql.query(
      `INSERT INTO executions (id, user_id, solution_id, kind, runtime, agent_deployment_id,
         trigger_kind, trigger_ref, status, started_at, idempotency_key, trace_id)
       VALUES ($1, $2, $3, 'delivery', NULL, NULL, 'lead_created', $4, 'running', now(), $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        id,
        input.userId,
        input.solutionId,
        `lead:${input.leadId}`,
        `sheet:${input.leadId}`,
        randomUUID(),
      ],
    );
    // Шаг — отдельно и тоже без повторов: если исполнение уже было, но шаг не записался, он появится.
    const owned = await this.sql.query<{ n: number | string }>(
      `SELECT count(*) AS n FROM execution_effects WHERE execution_id = $1 AND user_id = $2`,
      [id, input.userId],
    );
    if (Number(owned[0]?.n ?? 0) > 0) {
      return { created: false, effect: await this.latest(input.userId, input.leadId) };
    }
    const exists = await this.sql.query(
      `SELECT 1 FROM executions WHERE id = $1 AND user_id = $2 AND kind = 'delivery'`,
      [id, input.userId],
    );
    if (exists.length === 0) return { created: false, effect: null };
    const created = await this.insertStep(id, input.userId, DELIVERY_STEP);
    return { created, effect: await this.latest(input.userId, input.leadId) };
  }

  async latest(userId: string, leadId: string) {
    return (await this.latestFor(userId, [leadId])).get(leadId) ?? null;
  }

  async latestFor(userId: string, leadIds: string[]) {
    const result = new Map<string, DeliveryEffect>();
    if (leadIds.length === 0) return result;
    const rows = await this.sql.query<EffectRow>(
      `SELECT DISTINCT ON (e.execution_id) ${EFFECT_COLUMNS}
         FROM execution_effects e JOIN executions x ON x.id = e.execution_id AND x.user_id = e.user_id
        WHERE e.user_id = $1 AND x.kind = 'delivery' AND e.execution_id = ANY($2::text[])
        ORDER BY e.execution_id, e.reserved_at DESC, e.step_key DESC`,
      [userId, leadIds.map(deliveryExecutionId)],
    );
    for (const row of rows) {
      const effect = toEffect(row);
      result.set(effect.leadId, effect);
    }
    return result;
  }

  async failed(userId: string, limit: number) {
    const rows = await this.sql.query<EffectRow>(
      `SELECT * FROM (
         SELECT DISTINCT ON (e.execution_id) ${EFFECT_COLUMNS}, x.started_at
           FROM execution_effects e JOIN executions x ON x.id = e.execution_id AND x.user_id = e.user_id
          WHERE e.user_id = $1 AND x.kind = 'delivery'
          ORDER BY e.execution_id, e.reserved_at DESC, e.step_key DESC
       ) latest WHERE status = 'failed' ORDER BY started_at LIMIT $2`,
      [userId, limit],
    );
    return rows.map(toEffect);
  }

  async dispatch(effect: DeliveryEffect) {
    return this.transition(
      effect,
      ['reserved'],
      `status = 'dispatched', dispatched_at = now()`,
      [],
      false,
    );
  }

  async commit(effect: DeliveryEffect, resultRef: string, meta: DeliveryMeta, resolvedBy?: string) {
    return this.transition(
      effect,
      resolvedBy ? ['unknown'] : ['dispatched'],
      `status = 'committed', finished_at = now(), result_ref = $5, result_meta = $6::text::jsonb,
       resolved_by = $7`,
      [resultRef || null, JSON.stringify(meta), resolvedBy ?? null],
      true,
    );
  }

  async fail(effect: DeliveryEffect, meta: DeliveryMeta, resolvedBy?: string) {
    const stage = resolvedBy
      ? 'reconciled_not_done'
      : effect.status === 'reserved'
        ? 'before_dispatch'
        : 'provider_rejected';
    return this.transition(
      effect,
      [resolvedBy ? 'unknown' : effect.status === 'reserved' ? 'reserved' : 'dispatched'],
      `status = 'failed', finished_at = now(), failure_stage = $5, result_meta = $6::text::jsonb,
       resolved_by = $7`,
      [stage, JSON.stringify(meta), resolvedBy ?? null],
      true,
    );
  }

  async markUnknown(effect: DeliveryEffect) {
    return this.transition(
      effect,
      ['dispatched'],
      `status = 'unknown', finished_at = now()`,
      [],
      false,
    );
  }

  async retry(effect: DeliveryEffect) {
    if (effect.attempts >= MAX_ATTEMPTS) return null;
    return this.transition(
      effect,
      ['failed'],
      `status = 'reserved', attempts = e.attempts + 1,
       lease_expires_at = now() + make_interval(secs => ${LEASE_MS / 1000})`,
      [],
      true,
    );
  }

  async newStep(effect: DeliveryEffect, stepKey: string) {
    const latest = await this.latest(effect.userId, effect.leadId);
    if (
      !latest ||
      latest.stepKey !== effect.stepKey ||
      latest.status !== 'failed' ||
      latest.attempts !== effect.attempts
    ) {
      return null;
    }
    if (!(await this.insertStep(effect.executionId, effect.userId, stepKey))) return null;
    await this.sql.query(
      `UPDATE executions SET status = 'running', finished_at = NULL, stop_reason = NULL,
              updated_at = now(), version = version + 1
        WHERE id = $1 AND user_id = $2 AND kind = 'delivery'`,
      [effect.executionId, effect.userId],
    );
    return this.latest(effect.userId, effect.leadId);
  }

  async renewLease(effect: DeliveryEffect) {
    return this.transition(
      effect,
      ['reserved'],
      `lease_expires_at = now() + make_interval(secs => ${LEASE_MS / 1000})`,
      [],
      false,
      ' AND e.lease_expires_at < now()',
    );
  }

  async due(now: number, limit: number) {
    const rows = await this.sql.query<EffectRow>(
      `SELECT ${EFFECT_COLUMNS}
         FROM execution_effects e JOIN executions x ON x.id = e.execution_id AND x.user_id = e.user_id
        WHERE x.kind = 'delivery' AND e.action = '${DELIVERY_ACTION}' AND (
              (e.status IN ('reserved', 'dispatched') AND e.lease_expires_at < $1::timestamptz)
           OR e.status = 'unknown'
           OR (e.status = 'failed' AND e.attempts < ${MAX_ATTEMPTS}
               AND (e.result_meta ->> 'retry') = 'true'
               AND e.finished_at + CASE e.attempts
                     WHEN 1 THEN make_interval(secs => ${RETRY_PAUSES_MS[0] / 1000})
                     WHEN 2 THEN make_interval(secs => ${RETRY_PAUSES_MS[1] / 1000})
                     ELSE make_interval(secs => ${RETRY_PAUSES_MS[2] / 1000}) END <= $1::timestamptz))
        ORDER BY e.reserved_at
        LIMIT $2`,
      [new Date(now).toISOString(), limit],
    );
    return rows.map(toEffect);
  }
}
