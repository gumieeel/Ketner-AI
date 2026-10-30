/**
 * Суточный бюджет бесплатных анализов Discovery (решение владельца от 30.10.2026: $5 в сутки).
 *
 * Отдельный бюджет: не связан с расходом чата, Ketner Code, картинок и другими расходами сервиса.
 *
 * - Резерв до запуска. Каждый этап бесплатного сценария резервирует свой потолок цены
 *   (model-policy.ts). Резерв проходит, только если `потрачено + зарезервировано + резерв ≤ лимит`;
 *   в Postgres это одно условие в UPDATE строки суток, поэтому параллельные запросы не превышают лимит.
 * - Расчёт по факту. После этапа резерв закрывается его фактической себестоимостью из шлюза,
 *   остаток возвращается в бюджет.
 * - Сроки. Резерв ещё не начатого этапа возвращается через `HOLD_MS` (пользователь ушёл, не ответив на
 *   вопросы). Начатый этап, не закрытый за `RUNNING_MS` (сервер перезапустился посреди вызова),
 *   закрывается по потолку: бюджет считается консервативно и не уходит в минус.
 * - Исчерпан — новые резервы не проходят до смены суток. На дешёвую модель сервис не переключает.
 */

import type { SqlRunner } from '../code/postgres-driver.js';
import type { StageName } from './model-policy.js';

/** Сколько держится резерв этапа, который ещё не начат. */
export const HOLD_MS = 2 * 60 * 60 * 1000;
/** Сколько ждём закрытия начатого этапа, прежде чем закрыть его по потолку. */
export const RUNNING_MS = 15 * 60 * 1000;

export type ReservationStatus = 'held' | 'running' | 'settled' | 'released';

export interface Reservation {
  id: string;
  day: string;
  analysisId: string;
  stage: StageName;
  capUsd: number;
  actualUsd: number | null;
  status: ReservationStatus;
  expiresAt: string;
}

export interface BudgetDay {
  day: string;
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
}

export interface ReservationRequest {
  id: string;
  analysisId: string;
  stage: StageName;
  capUsd: number;
  expiresAt: string;
}

export interface BudgetStore {
  /** Атомарно: либо все резервы созданы, либо ни одного (бюджета не хватает). */
  reserve(day: string, limitUsd: number, items: ReservationRequest[]): Promise<boolean>;
  /** held → running с новым сроком. */
  start(id: string, expiresAt: string): Promise<boolean>;
  /** held | running → settled по фактической стоимости. */
  settle(id: string, actualUsd: number): Promise<boolean>;
  /** held → released (этап так и не понадобился). */
  release(id: string): Promise<boolean>;
  /** Просроченные: held — вернуть, running — закрыть по потолку. */
  expire(now: string): Promise<number>;
  day(day: string): Promise<BudgetDay | null>;
  forAnalysis(analysisId: string): Promise<Reservation[]>;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

export class MemoryBudgetStore implements BudgetStore {
  private readonly days = new Map<string, BudgetDay>();
  private readonly reservations = new Map<string, Reservation>();

  async reserve(day: string, limitUsd: number, items: ReservationRequest[]) {
    const current = this.days.get(day) ?? { day, limitUsd, spentUsd: 0, reservedUsd: 0 };
    current.limitUsd = limitUsd;
    const amount = round6(items.reduce((sum, item) => sum + item.capUsd, 0));
    if (round6(current.spentUsd + current.reservedUsd + amount) > limitUsd) {
      this.days.set(day, current);
      return false;
    }
    current.reservedUsd = round6(current.reservedUsd + amount);
    this.days.set(day, current);
    for (const item of items) {
      this.reservations.set(item.id, {
        ...item,
        day,
        actualUsd: null,
        status: 'held',
      });
    }
    return true;
  }

  async start(id: string, expiresAt: string) {
    const found = this.reservations.get(id);
    if (!found || found.status !== 'held') return false;
    found.status = 'running';
    found.expiresAt = expiresAt;
    return true;
  }

  private close(found: Reservation, status: 'settled' | 'released', actualUsd: number) {
    const budget = this.days.get(found.day);
    found.status = status;
    found.actualUsd = round6(actualUsd);
    if (budget) {
      budget.reservedUsd = round6(Math.max(0, budget.reservedUsd - found.capUsd));
      budget.spentUsd = round6(budget.spentUsd + actualUsd);
    }
  }

  async settle(id: string, actualUsd: number) {
    const found = this.reservations.get(id);
    if (!found || (found.status !== 'held' && found.status !== 'running')) return false;
    this.close(found, 'settled', Math.max(0, actualUsd));
    return true;
  }

  async release(id: string) {
    const found = this.reservations.get(id);
    if (!found || found.status !== 'held') return false;
    this.close(found, 'released', 0);
    return true;
  }

  async expire(now: string) {
    let count = 0;
    for (const found of this.reservations.values()) {
      if (found.expiresAt >= now) continue;
      if (found.status === 'held') {
        this.close(found, 'released', 0);
        count += 1;
      } else if (found.status === 'running') {
        this.close(found, 'settled', found.capUsd);
        count += 1;
      }
    }
    return count;
  }

  async day(day: string) {
    const found = this.days.get(day);
    return found ? { ...found } : null;
  }

  async forAnalysis(analysisId: string) {
    return [...this.reservations.values()]
      .filter((item) => item.analysisId === analysisId)
      .map((item) => ({ ...item }));
  }
}

interface ReservationRow {
  id: string;
  day: string | Date;
  analysis_id: string;
  stage: StageName;
  cap_usd: string | number;
  actual_usd: string | number | null;
  status: ReservationStatus;
  expires_at: string | Date;
}

const dayOf = (value: string | Date): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

export class PostgresBudgetStore implements BudgetStore {
  constructor(private readonly db: SqlRunner) {}

  async reserve(day: string, limitUsd: number, items: ReservationRequest[]) {
    // Строка суток создаётся отдельно: изменения из одной CTE не видны другой в том же запросе.
    await this.db.query(
      `INSERT INTO discovery_budget_days (day, limit_usd) VALUES ($1::date, $2)
       ON CONFLICT (day) DO UPDATE SET limit_usd = EXCLUDED.limit_usd`,
      [day, limitUsd],
    );
    const amount = round6(items.reduce((sum, item) => sum + item.capUsd, 0));
    const rows = await this.db.query<{ id: string }>(
      `WITH upd AS (
         UPDATE discovery_budget_days SET reserved_usd = reserved_usd + $2
         WHERE day = $1::date AND spent_usd + reserved_usd + $2 <= limit_usd
         RETURNING day
       )
       INSERT INTO discovery_budget_reservations (id, day, analysis_id, stage, cap_usd, status, expires_at)
       SELECT r.id, upd.day, r.analysis_id, r.stage, r.cap_usd, 'held', r.expires_at
       FROM upd, jsonb_to_recordset($3::text::jsonb)
         AS r(id text, analysis_id text, stage text, cap_usd numeric, expires_at timestamptz)
       RETURNING id`,
      [
        day,
        amount,
        JSON.stringify(
          items.map((item) => ({
            id: item.id,
            analysis_id: item.analysisId,
            stage: item.stage,
            cap_usd: item.capUsd,
            expires_at: item.expiresAt,
          })),
        ),
      ],
    );
    return rows.length === items.length && rows.length > 0;
  }

  async start(id: string, expiresAt: string) {
    const rows = await this.db.query(
      `UPDATE discovery_budget_reservations SET status = 'running', expires_at = $2::timestamptz
       WHERE id = $1 AND status = 'held' RETURNING id`,
      [id, expiresAt],
    );
    return rows.length > 0;
  }

  private async close(
    id: string,
    from: ReservationStatus[],
    status: 'settled' | 'released',
    actual: number | null,
  ) {
    const rows = await this.db.query(
      `WITH r AS (
         UPDATE discovery_budget_reservations
         SET status = $3, actual_usd = COALESCE($4::numeric, 0)
         WHERE id = $1 AND status = ANY($2::text[])
         RETURNING day, cap_usd, actual_usd
       )
       UPDATE discovery_budget_days d
       SET reserved_usd = GREATEST(0, d.reserved_usd - r.cap_usd), spent_usd = d.spent_usd + r.actual_usd
       FROM r WHERE d.day = r.day
       RETURNING d.day`,
      [id, from, status, actual],
    );
    return rows.length > 0;
  }

  settle(id: string, actualUsd: number) {
    return this.close(id, ['held', 'running'], 'settled', round6(Math.max(0, actualUsd)));
  }

  release(id: string) {
    return this.close(id, ['held'], 'released', 0);
  }

  async expire(now: string) {
    const rows = await this.db.query<{ n: string | number }>(
      `WITH r AS (
         UPDATE discovery_budget_reservations
         SET status = CASE WHEN status = 'running' THEN 'settled' ELSE 'released' END,
             actual_usd = CASE WHEN status = 'running' THEN cap_usd ELSE 0 END
         WHERE status IN ('held', 'running') AND expires_at < $1::timestamptz
         RETURNING day, cap_usd, actual_usd
       ), s AS (
         SELECT day, sum(cap_usd) AS cap, sum(actual_usd) AS actual FROM r GROUP BY day
       )
       , d AS (
         UPDATE discovery_budget_days d
         SET reserved_usd = GREATEST(0, d.reserved_usd - s.cap), spent_usd = d.spent_usd + s.actual
         FROM s WHERE d.day = s.day
         RETURNING d.day
       )
       SELECT count(*) AS n FROM r`,
      [now],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async day(day: string) {
    const rows = await this.db.query<{
      day: string | Date;
      limit_usd: string | number;
      spent_usd: string | number;
      reserved_usd: string | number;
    }>(
      `SELECT day, limit_usd, spent_usd, reserved_usd FROM discovery_budget_days WHERE day = $1::date`,
      [day],
    );
    const row = rows[0];
    return row
      ? {
          day: dayOf(row.day),
          limitUsd: Number(row.limit_usd),
          spentUsd: Number(row.spent_usd),
          reservedUsd: Number(row.reserved_usd),
        }
      : null;
  }

  async forAnalysis(analysisId: string) {
    const rows = await this.db.query<ReservationRow>(
      `SELECT id, day, analysis_id, stage, cap_usd, actual_usd, status, expires_at
       FROM discovery_budget_reservations WHERE analysis_id = $1`,
      [analysisId],
    );
    return rows.map((row) => ({
      id: row.id,
      day: dayOf(row.day),
      analysisId: row.analysis_id,
      stage: row.stage,
      capUsd: Number(row.cap_usd),
      actualUsd: row.actual_usd === null ? null : Number(row.actual_usd),
      status: row.status,
      expiresAt: new Date(row.expires_at).toISOString(),
    }));
  }
}

/** Сутки бюджета в заданном поясе: `YYYY-MM-DD`. */
export function budgetDayOf(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Когда начнутся следующие сутки бюджета (момент сброса). */
export function nextBudgetReset(now: Date, timeZone: string): Date {
  const today = budgetDayOf(now, timeZone);
  // Поясов со сдвигом больше суток нет: ищем первый час, где сутки сменились, затем минуту.
  let probe = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  for (let i = 0; i < 27 && budgetDayOf(probe, timeZone) === today; i += 1) {
    probe = new Date(probe.getTime() + 3_600_000);
  }
  let low = probe.getTime() - 3_600_000;
  let high = probe.getTime();
  while (high - low > 60_000) {
    const mid = low + Math.floor((high - low) / 2);
    if (budgetDayOf(new Date(mid), timeZone) === today) low = mid;
    else high = mid;
  }
  // Смена суток выровнена по минутам: нижняя минута интервала — и есть момент сброса.
  return new Date(Math.floor(high / 60_000) * 60_000);
}
