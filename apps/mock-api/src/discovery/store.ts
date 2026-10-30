/**
 * Хранилище анализов и возможностей.
 *
 * В production — Postgres (таблицы из миграции `0001_discovery`): запись подтверждается до ответа
 * API, каждый запрос привязан к владельцу (`user_id` в WHERE), чужая запись не видна. Локально без
 * DATABASE_URL и в тестах — та же логика в памяти.
 */

import type { SqlRunner } from '../code/postgres-driver.js';
import type { Analysis, Opportunity } from './types.js';

export interface AnalysisCountFilter {
  ownerId?: string;
  ipHash?: string;
  budgetDay?: string;
  mode?: Analysis['mode'];
  ipLimited?: boolean;
}

export interface DiscoveryStore {
  /** Создать; при повторе того же `idempotencyKey` владельца вернуть уже созданный. */
  create(analysis: Analysis): Promise<{ analysis: Analysis; duplicate: boolean }>;
  get(ownerId: string, id: string): Promise<Analysis | null>;
  list(ownerId: string, limit: number): Promise<Analysis[]>;
  /** Записать, только если версия в хранилище — `expectedVersion`; иначе null (запись изменилась). */
  update(analysis: Analysis, expectedVersion: number): Promise<Analysis | null>;
  setOpportunities(ownerId: string, analysisId: string, items: Opportunity[]): Promise<void>;
  opportunities(ownerId: string, analysisId: string): Promise<Opportunity[]>;
  count(filter: AnalysisCountFilter): Promise<number>;
  /** Перенос анализа гостя этого браузера в аккаунт после входа. */
  claimGuest(userId: string, guestId: string, analysisId: string): Promise<boolean>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryDiscoveryStore implements DiscoveryStore {
  private readonly analyses = new Map<string, Analysis>();
  private readonly opportunityMap = new Map<string, Opportunity[]>();

  async create(analysis: Analysis) {
    if (analysis.idempotencyKey) {
      const existing = [...this.analyses.values()].find(
        (item) =>
          item.ownerId === analysis.ownerId && item.idempotencyKey === analysis.idempotencyKey,
      );
      if (existing) return { analysis: clone(existing), duplicate: true };
    }
    this.analyses.set(analysis.id, clone(analysis));
    return { analysis: clone(analysis), duplicate: false };
  }

  async get(ownerId: string, id: string) {
    const found = this.analyses.get(id);
    return found && found.ownerId === ownerId ? clone(found) : null;
  }

  async list(ownerId: string, limit: number) {
    return [...this.analyses.values()]
      .filter((item) => item.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async update(analysis: Analysis, expectedVersion: number) {
    const current = this.analyses.get(analysis.id);
    if (!current || current.ownerId !== analysis.ownerId || current.version !== expectedVersion) {
      return null;
    }
    const next = { ...clone(analysis), version: expectedVersion + 1 };
    this.analyses.set(analysis.id, next);
    return clone(next);
  }

  async setOpportunities(ownerId: string, analysisId: string, items: Opportunity[]) {
    const owner = this.analyses.get(analysisId);
    if (!owner || owner.ownerId !== ownerId) return;
    this.opportunityMap.set(analysisId, clone(items));
  }

  async opportunities(ownerId: string, analysisId: string) {
    const owner = this.analyses.get(analysisId);
    if (!owner || owner.ownerId !== ownerId) return [];
    return clone(this.opportunityMap.get(analysisId) ?? []).sort((a, b) => a.position - b.position);
  }

  async count(filter: AnalysisCountFilter) {
    return [...this.analyses.values()].filter(
      (item) =>
        (filter.ownerId === undefined || item.ownerId === filter.ownerId) &&
        (filter.ipHash === undefined || item.ipHash === filter.ipHash) &&
        (filter.budgetDay === undefined || item.budgetDay === filter.budgetDay) &&
        (filter.mode === undefined || item.mode === filter.mode) &&
        (filter.ipLimited === undefined || item.ipLimited === filter.ipLimited),
    ).length;
  }

  async claimGuest(userId: string, guestId: string, analysisId: string) {
    const found = this.analyses.get(analysisId);
    if (!found) return false;
    if (found.ownerId === userId) return true;
    if (found.ownerId !== guestId) return false;
    this.analyses.set(analysisId, {
      ...found,
      ownerId: userId,
      guest: false,
      version: found.version + 1,
    });
    const items = this.opportunityMap.get(analysisId);
    if (items)
      this.opportunityMap.set(
        analysisId,
        items.map((item) => ({ ...item, ownerId: userId })),
      );
    return true;
  }
}

// ─── Postgres ─────────────────────────────────────────────────────────────────

interface AnalysisRow {
  id: string;
  user_id: string;
  guest: boolean;
  ip_hash: string | null;
  ip_limited: boolean;
  mode: Analysis['mode'];
  language: Analysis['language'];
  status: Analysis['status'];
  input_text: string;
  context: unknown;
  questions: unknown;
  answers: unknown;
  summary: string | null;
  stage_runs: unknown;
  budget_day: string | Date;
  idempotency_key: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  version: number | string;
}

interface OpportunityRow {
  id: string;
  analysis_id: string;
  user_id: string;
  position: number | string;
  title: string;
  feasibility_status: Opportunity['feasibilityStatus'];
  priority: number | string;
  data: unknown;
  created_at: string | Date;
}

function json<T>(value: unknown, fallback: T): T {
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

const iso = (value: string | Date): string => new Date(value).toISOString();

function day(value: string | Date): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function toAnalysis(row: AnalysisRow): Analysis {
  return {
    id: row.id,
    ownerId: row.user_id,
    guest: row.guest,
    ipHash: row.ip_hash,
    ipLimited: row.ip_limited,
    mode: row.mode,
    language: row.language,
    status: row.status,
    inputText: row.input_text,
    context: json(row.context, null),
    questions: json(row.questions, []),
    answers: json(row.answers, {}),
    summary: row.summary,
    stages: json(row.stage_runs, {}),
    budgetDay: day(row.budget_day),
    idempotencyKey: row.idempotency_key,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    version: Number(row.version),
  };
}

type OpportunityData = Omit<
  Opportunity,
  | 'id'
  | 'analysisId'
  | 'ownerId'
  | 'position'
  | 'title'
  | 'feasibilityStatus'
  | 'priority'
  | 'createdAt'
>;

function toOpportunity(row: OpportunityRow): Opportunity {
  const data = json<OpportunityData>(row.data, {} as OpportunityData);
  return {
    ...data,
    id: row.id,
    analysisId: row.analysis_id,
    ownerId: row.user_id,
    position: Number(row.position),
    title: row.title,
    feasibilityStatus: row.feasibility_status,
    priority: Number(row.priority),
    createdAt: iso(row.created_at),
  };
}

const ANALYSIS_COLUMNS = `id, user_id, guest, ip_hash, ip_limited, mode, language, status, input_text,
  context, questions, answers, summary, stage_runs, budget_day, idempotency_key, created_at,
  updated_at, version`;

export class PostgresDiscoveryStore implements DiscoveryStore {
  constructor(private readonly db: SqlRunner) {}

  async create(analysis: Analysis) {
    const rows = await this.db.query<AnalysisRow>(
      `INSERT INTO discovery_analyses (${ANALYSIS_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text::jsonb, $11::text::jsonb, $12::text::jsonb, $13,
               $14::text::jsonb, $15::date, $16, $17::timestamptz, $18::timestamptz, $19)
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${ANALYSIS_COLUMNS}`,
      [
        analysis.id,
        analysis.ownerId,
        analysis.guest,
        analysis.ipHash,
        analysis.ipLimited,
        analysis.mode,
        analysis.language,
        analysis.status,
        analysis.inputText,
        JSON.stringify(analysis.context),
        JSON.stringify(analysis.questions),
        JSON.stringify(analysis.answers),
        analysis.summary,
        JSON.stringify(analysis.stages),
        analysis.budgetDay,
        analysis.idempotencyKey,
        analysis.createdAt,
        analysis.updatedAt,
        analysis.version,
      ],
    );
    if (rows[0]) return { analysis: toAnalysis(rows[0]), duplicate: false };
    const existing = await this.db.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLUMNS} FROM discovery_analyses WHERE user_id = $1 AND idempotency_key = $2`,
      [analysis.ownerId, analysis.idempotencyKey],
    );
    if (!existing[0]) throw new Error('discovery: запись не создана и не найдена');
    return { analysis: toAnalysis(existing[0]), duplicate: true };
  }

  async get(ownerId: string, id: string) {
    const rows = await this.db.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLUMNS} FROM discovery_analyses WHERE id = $1 AND user_id = $2`,
      [id, ownerId],
    );
    return rows[0] ? toAnalysis(rows[0]) : null;
  }

  async list(ownerId: string, limit: number) {
    const rows = await this.db.query<AnalysisRow>(
      `SELECT ${ANALYSIS_COLUMNS} FROM discovery_analyses WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [ownerId, limit],
    );
    return rows.map(toAnalysis);
  }

  async update(analysis: Analysis, expectedVersion: number) {
    const rows = await this.db.query<AnalysisRow>(
      `UPDATE discovery_analyses SET
         status = $3, context = $4::text::jsonb, questions = $5::text::jsonb, answers = $6::text::jsonb,
         summary = $7, stage_runs = $8::text::jsonb, updated_at = $9::timestamptz, version = version + 1
       WHERE id = $1 AND user_id = $2 AND version = $10
       RETURNING ${ANALYSIS_COLUMNS}`,
      [
        analysis.id,
        analysis.ownerId,
        analysis.status,
        JSON.stringify(analysis.context),
        JSON.stringify(analysis.questions),
        JSON.stringify(analysis.answers),
        analysis.summary,
        JSON.stringify(analysis.stages),
        analysis.updatedAt,
        expectedVersion,
      ],
    );
    return rows[0] ? toAnalysis(rows[0]) : null;
  }

  async setOpportunities(ownerId: string, analysisId: string, items: Opportunity[]) {
    await this.db.query(
      `DELETE FROM discovery_opportunities WHERE analysis_id = $1 AND user_id = $2`,
      [analysisId, ownerId],
    );
    for (const item of items) {
      const {
        id,
        analysisId: _a,
        ownerId: _o,
        position,
        title,
        feasibilityStatus,
        priority,
        createdAt,
        ...data
      } = item;
      await this.db.query(
        `INSERT INTO discovery_opportunities
           (id, analysis_id, user_id, position, title, feasibility_status, priority, data, created_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9::timestamptz
         WHERE EXISTS (SELECT 1 FROM discovery_analyses WHERE id = $2 AND user_id = $3)`,
        [
          id,
          analysisId,
          ownerId,
          position,
          title,
          feasibilityStatus,
          priority,
          JSON.stringify(data),
          createdAt,
        ],
      );
    }
  }

  async opportunities(ownerId: string, analysisId: string) {
    const rows = await this.db.query<OpportunityRow>(
      `SELECT id, analysis_id, user_id, position, title, feasibility_status, priority, data, created_at
       FROM discovery_opportunities WHERE analysis_id = $1 AND user_id = $2 ORDER BY position`,
      [analysisId, ownerId],
    );
    return rows.map(toOpportunity);
  }

  async count(filter: AnalysisCountFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (filter.ownerId !== undefined) add('user_id = ?', filter.ownerId);
    if (filter.ipHash !== undefined) add('ip_hash = ?', filter.ipHash);
    if (filter.budgetDay !== undefined) add('budget_day = ?::date', filter.budgetDay);
    if (filter.mode !== undefined) add('mode = ?', filter.mode);
    if (filter.ipLimited !== undefined) add('ip_limited = ?', filter.ipLimited);
    const rows = await this.db.query<{ n: number | string }>(
      `SELECT count(*) AS n FROM discovery_analyses${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`,
      params,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async claimGuest(userId: string, guestId: string, analysisId: string) {
    const rows = await this.db.query<{ user_id: string }>(
      `UPDATE discovery_analyses SET user_id = $1, guest = false, version = version + 1
       WHERE id = $3 AND user_id = $2 RETURNING user_id`,
      [userId, guestId, analysisId],
    );
    if (rows[0]) {
      await this.db.query(
        `UPDATE discovery_opportunities SET user_id = $1 WHERE analysis_id = $3 AND user_id = $2`,
        [userId, guestId, analysisId],
      );
      return true;
    }
    const own = await this.db.query(
      `SELECT 1 FROM discovery_analyses WHERE id = $1 AND user_id = $2`,
      [analysisId, userId],
    );
    return own.length > 0;
  }
}
