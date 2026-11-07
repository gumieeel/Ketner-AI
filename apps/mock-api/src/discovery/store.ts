/**
 * Хранилище анализов и возможностей.
 *
 * В production — Postgres (таблицы из миграции `0001_discovery`): запись подтверждается до ответа
 * API, каждый запрос привязан к владельцу (`user_id` в WHERE), чужая запись не видна. Локально без
 * DATABASE_URL и в тестах — та же логика в памяти.
 */

import type { SqlRunner } from '../code/postgres-driver.js';
import type { Analysis, Opportunity, Plan } from './types.js';

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
  /**
   * Перенос анализа гостя этого браузера в аккаунт после входа. `createdAfter` — анализ гостя,
   * созданный раньше, уже истёк и не переносится.
   */
  claimGuest(
    userId: string,
    guestId: string,
    analysisId: string,
    createdAfter?: string,
  ): Promise<boolean>;
  /** Перенос всех живых анализов гостя (созданных не раньше `createdAfter`) в аккаунт. */
  claimAllGuest(userId: string, guestId: string, createdAfter: string): Promise<number>;
  /**
   * Стереть анализы гостей, созданные раньше `before` и так и не перенесённые в аккаунт: как
   * `remove` — содержимое стирается, скрытая запись остаётся для суточных лимитов.
   */
  expireGuests(before: string, at: string): Promise<number>;
  /**
   * Удалить: содержимое стирается, возможности удаляются, запись остаётся скрытой — она нужна
   * суточным лимитам (`count` её учитывает). Чужой или уже удалённый — false.
   */
  remove(ownerId: string, id: string, at: string): Promise<boolean>;
  /** Создать план; если план этой возможности уже есть — вернуть его (`duplicate`). */
  createPlan(plan: Plan): Promise<{ plan: Plan; duplicate: boolean } | null>;
  getPlan(ownerId: string, planId: string): Promise<Plan | null>;
  plans(ownerId: string, analysisId: string): Promise<Plan[]>;
  /** Записать, только если версия — `expectedVersion`; иначе null. */
  updatePlan(plan: Plan, expectedVersion: number): Promise<Plan | null>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryDiscoveryStore implements DiscoveryStore {
  private readonly analyses = new Map<string, Analysis>();
  private readonly deleted = new Set<string>();
  private readonly planMap = new Map<string, Plan>();

  /** Как ON DELETE CASCADE в Postgres: планы исчезнувших возможностей удаляются. */
  private dropOrphanPlans(analysisId: string): void {
    const alive = new Set((this.opportunityMap.get(analysisId) ?? []).map((item) => item.id));
    for (const [id, plan] of this.planMap) {
      if (plan.analysisId === analysisId && !alive.has(plan.opportunityId)) this.planMap.delete(id);
    }
  }

  async createPlan(plan: Plan) {
    const analysis = this.analyses.get(plan.analysisId);
    const opportunity = (this.opportunityMap.get(plan.analysisId) ?? []).find(
      (item) => item.id === plan.opportunityId,
    );
    if (!analysis || analysis.ownerId !== plan.ownerId || this.deleted.has(analysis.id))
      return null;
    if (!opportunity) return null;
    const existing = [...this.planMap.values()].find(
      (item) => item.opportunityId === plan.opportunityId,
    );
    if (existing) return { plan: clone(existing), duplicate: true };
    this.planMap.set(plan.id, clone(plan));
    return { plan: clone(plan), duplicate: false };
  }

  async getPlan(ownerId: string, planId: string) {
    const found = this.planMap.get(planId);
    return found && found.ownerId === ownerId ? clone(found) : null;
  }

  async plans(ownerId: string, analysisId: string) {
    return [...this.planMap.values()]
      .filter((item) => item.ownerId === ownerId && item.analysisId === analysisId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async updatePlan(plan: Plan, expectedVersion: number) {
    const current = this.planMap.get(plan.id);
    if (!current || current.ownerId !== plan.ownerId || current.version !== expectedVersion) {
      return null;
    }
    const next = { ...clone(plan), version: expectedVersion + 1 };
    this.planMap.set(plan.id, next);
    return clone(next);
  }
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
    return found && found.ownerId === ownerId && !this.deleted.has(id) ? clone(found) : null;
  }

  async list(ownerId: string, limit: number) {
    return [...this.analyses.values()]
      .filter((item) => item.ownerId === ownerId && !this.deleted.has(item.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async update(analysis: Analysis, expectedVersion: number) {
    const current = this.analyses.get(analysis.id);
    if (
      !current ||
      this.deleted.has(analysis.id) ||
      current.ownerId !== analysis.ownerId ||
      current.version !== expectedVersion
    ) {
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
    this.dropOrphanPlans(analysisId);
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

  async remove(ownerId: string, id: string, at: string) {
    const found = this.analyses.get(id);
    if (!found || found.ownerId !== ownerId || this.deleted.has(id)) return false;
    this.deleted.add(id);
    this.analyses.set(id, {
      ...found,
      inputText: '',
      context: null,
      questions: [],
      answers: {},
      summary: null,
      coverage: null,
      source: null,
      saved: false,
      updatedAt: at,
      version: found.version + 1,
    });
    this.opportunityMap.delete(id);
    this.dropOrphanPlans(id);
    return true;
  }

  async claimGuest(userId: string, guestId: string, analysisId: string, createdAfter?: string) {
    const found = this.analyses.get(analysisId);
    if (!found || this.deleted.has(analysisId)) return false;
    if (found.ownerId === userId) return true;
    if (found.ownerId !== guestId) return false;
    if (createdAfter !== undefined && found.createdAt < createdAfter) return false;
    this.analyses.set(analysisId, {
      ...found,
      ownerId: userId,
      guest: false,
      version: found.version + 1,
    });
    for (const [planId, plan] of this.planMap) {
      if (plan.analysisId === analysisId) this.planMap.set(planId, { ...plan, ownerId: userId });
    }
    const items = this.opportunityMap.get(analysisId);
    if (items)
      this.opportunityMap.set(
        analysisId,
        items.map((item) => ({ ...item, ownerId: userId })),
      );
    return true;
  }

  async claimAllGuest(userId: string, guestId: string, createdAfter: string) {
    const ids = [...this.analyses.values()]
      .filter((item) => item.ownerId === guestId && item.createdAt >= createdAfter)
      .map((item) => item.id);
    let claimed = 0;
    for (const id of ids) {
      if (await this.claimGuest(userId, guestId, id, createdAfter)) claimed += 1;
    }
    return claimed;
  }

  async expireGuests(before: string, at: string) {
    const expired = [...this.analyses.values()].filter(
      (item) => item.guest && item.createdAt < before && !this.deleted.has(item.id),
    );
    for (const item of expired) await this.remove(item.ownerId, item.id, at);
    return expired.length;
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
  coverage: unknown;
  source: unknown;
  stage_runs: unknown;
  budget_day: string | Date;
  idempotency_key: string | null;
  saved: boolean;
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
    coverage: json(row.coverage, null),
    source: json(row.source, null),
    stages: json(row.stage_runs, {}),
    budgetDay: day(row.budget_day),
    idempotencyKey: row.idempotency_key,
    saved: Boolean(row.saved),
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

interface PlanRow {
  id: string;
  analysis_id: string;
  opportunity_id: string;
  user_id: string;
  kind: Plan['kind'];
  mode: Plan['mode'];
  sponsored: boolean;
  status: Plan['status'];
  data: unknown;
  version: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}

type PlanData = Pick<
  Plan,
  'opportunityTitle' | 'summary' | 'steps' | 'risks' | 'successCriteria' | 'run'
>;

const PLAN_COLUMNS = `id, analysis_id, opportunity_id, user_id, kind, mode, sponsored, status, data,
  version, created_at, updated_at`;

function planData(plan: Plan): string {
  const data: PlanData = {
    opportunityTitle: plan.opportunityTitle,
    summary: plan.summary,
    steps: plan.steps,
    risks: plan.risks,
    successCriteria: plan.successCriteria,
    run: plan.run,
  };
  return JSON.stringify(data);
}

function toPlan(row: PlanRow): Plan {
  const data = json<PlanData>(row.data, {} as PlanData);
  return {
    ...data,
    id: row.id,
    analysisId: row.analysis_id,
    opportunityId: row.opportunity_id,
    ownerId: row.user_id,
    kind: row.kind,
    mode: row.mode,
    sponsored: row.sponsored,
    status: row.status,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const ANALYSIS_COLUMNS = `id, user_id, guest, ip_hash, ip_limited, mode, language, status, input_text,
  context, questions, answers, summary, stage_runs, budget_day, idempotency_key, created_at,
  updated_at, version, coverage, source`;

/** Колонки чтения: те же плюс `saved` (при создании — значение по умолчанию). */
const SELECT_COLUMNS = `${ANALYSIS_COLUMNS}, saved`;
const ALIVE = 'deleted_at IS NULL';

export class PostgresDiscoveryStore implements DiscoveryStore {
  constructor(private readonly db: SqlRunner) {}

  async create(analysis: Analysis) {
    const rows = await this.db.query<AnalysisRow>(
      `INSERT INTO discovery_analyses (${ANALYSIS_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text::jsonb, $11::text::jsonb, $12::text::jsonb, $13,
               $14::text::jsonb, $15::date, $16, $17::timestamptz, $18::timestamptz, $19,
               $20::text::jsonb, $21::text::jsonb)
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
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
        JSON.stringify(analysis.coverage ?? null),
        JSON.stringify(analysis.source ?? null),
      ],
    );
    if (rows[0]) return { analysis: toAnalysis(rows[0]), duplicate: false };
    const existing = await this.db.query<AnalysisRow>(
      `SELECT ${SELECT_COLUMNS} FROM discovery_analyses WHERE user_id = $1 AND idempotency_key = $2`,
      [analysis.ownerId, analysis.idempotencyKey],
    );
    if (!existing[0]) throw new Error('discovery: запись не создана и не найдена');
    return { analysis: toAnalysis(existing[0]), duplicate: true };
  }

  async get(ownerId: string, id: string) {
    const rows = await this.db.query<AnalysisRow>(
      `SELECT ${SELECT_COLUMNS} FROM discovery_analyses WHERE id = $1 AND user_id = $2 AND ${ALIVE}`,
      [id, ownerId],
    );
    return rows[0] ? toAnalysis(rows[0]) : null;
  }

  async list(ownerId: string, limit: number) {
    const rows = await this.db.query<AnalysisRow>(
      `SELECT ${SELECT_COLUMNS} FROM discovery_analyses WHERE user_id = $1 AND ${ALIVE}
       ORDER BY created_at DESC LIMIT $2`,
      [ownerId, limit],
    );
    return rows.map(toAnalysis);
  }

  async update(analysis: Analysis, expectedVersion: number) {
    const rows = await this.db.query<AnalysisRow>(
      `UPDATE discovery_analyses SET
         status = $3, context = $4::text::jsonb, questions = $5::text::jsonb, answers = $6::text::jsonb,
         summary = $7, stage_runs = $8::text::jsonb, updated_at = $9::timestamptz, saved = $11,
         coverage = $12::text::jsonb, source = $13::text::jsonb, version = version + 1
       WHERE id = $1 AND user_id = $2 AND version = $10 AND ${ALIVE}
       RETURNING ${SELECT_COLUMNS}`,
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
        analysis.saved,
        JSON.stringify(analysis.coverage ?? null),
        JSON.stringify(analysis.source ?? null),
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

  async claimGuest(userId: string, guestId: string, analysisId: string, createdAfter?: string) {
    const rows = await this.db.query<{ user_id: string }>(
      `UPDATE discovery_analyses SET user_id = $1, guest = false, version = version + 1
       WHERE id = $3 AND user_id = $2 AND ${ALIVE}
         AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz) RETURNING user_id`,
      [userId, guestId, analysisId, createdAfter ?? null],
    );
    if (rows[0]) {
      await this.db.query(
        `UPDATE discovery_opportunities SET user_id = $1 WHERE analysis_id = $3 AND user_id = $2`,
        [userId, guestId, analysisId],
      );
      await this.db.query(
        `UPDATE discovery_plans SET user_id = $1 WHERE analysis_id = $3 AND user_id = $2`,
        [userId, guestId, analysisId],
      );
      return true;
    }
    const own = await this.db.query(
      `SELECT 1 FROM discovery_analyses WHERE id = $1 AND user_id = $2 AND ${ALIVE}`,
      [analysisId, userId],
    );
    return own.length > 0;
  }

  async claimAllGuest(userId: string, guestId: string, createdAfter: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE discovery_analyses SET user_id = $1, guest = false, version = version + 1
       WHERE user_id = $2 AND ${ALIVE} AND created_at >= $3::timestamptz RETURNING id`,
      [userId, guestId, createdAfter],
    );
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return 0;
    await this.db.query(
      `UPDATE discovery_opportunities SET user_id = $1
       WHERE analysis_id = ANY($3::text[]) AND user_id = $2`,
      [userId, guestId, ids],
    );
    await this.db.query(
      `UPDATE discovery_plans SET user_id = $1 WHERE analysis_id = ANY($3::text[]) AND user_id = $2`,
      [userId, guestId, ids],
    );
    return ids.length;
  }

  async expireGuests(before: string, at: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE discovery_analyses SET deleted_at = $2::timestamptz, updated_at = $2::timestamptz,
         input_text = '', context = NULL, questions = '[]'::jsonb, answers = '{}'::jsonb,
         summary = NULL, coverage = NULL, source = NULL, saved = false, version = version + 1
       WHERE guest = true AND ${ALIVE} AND created_at < $1::timestamptz RETURNING id`,
      [before, at],
    );
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      await this.db.query(
        `DELETE FROM discovery_opportunities WHERE analysis_id = ANY($1::text[])`,
        [ids],
      );
      // Сметы содержат описание бизнеса — стираются вместе с содержимым анализа (заявки хранят
      // свой снимок и остаются у клиента).
      await this.db.query(
        `DELETE FROM implementation_estimates WHERE analysis_id = ANY($1::text[])`,
        [ids],
      );
    }
    return ids.length;
  }

  async remove(ownerId: string, id: string, at: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE discovery_analyses SET deleted_at = $3::timestamptz, updated_at = $3::timestamptz,
         input_text = '', context = NULL, questions = '[]'::jsonb, answers = '{}'::jsonb,
         summary = NULL, coverage = NULL, source = NULL, saved = false, version = version + 1
       WHERE id = $1 AND user_id = $2 AND ${ALIVE} RETURNING id`,
      [id, ownerId, at],
    );
    if (!rows[0]) return false;
    await this.db.query(`DELETE FROM discovery_opportunities WHERE analysis_id = $1`, [id]);
    await this.db.query(`DELETE FROM implementation_estimates WHERE analysis_id = $1`, [id]);
    return true;
  }

  async createPlan(plan: Plan) {
    // Анализ и возможность — этого владельца и не удалены; иначе null.
    const rows = await this.db.query<PlanRow>(
      `INSERT INTO discovery_plans (${PLAN_COLUMNS})
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb, $10, $11::timestamptz, $12::timestamptz
       WHERE EXISTS (
         SELECT 1 FROM discovery_opportunities o JOIN discovery_analyses a ON a.id = o.analysis_id
         WHERE o.id = $3 AND o.analysis_id = $2 AND a.user_id = $4 AND a.deleted_at IS NULL
       )
       ON CONFLICT (opportunity_id) DO NOTHING
       RETURNING ${PLAN_COLUMNS}`,
      [
        plan.id,
        plan.analysisId,
        plan.opportunityId,
        plan.ownerId,
        plan.kind,
        plan.mode,
        plan.sponsored,
        plan.status,
        planData(plan),
        plan.version,
        plan.createdAt,
        plan.updatedAt,
      ],
    );
    if (rows[0]) return { plan: toPlan(rows[0]), duplicate: false };
    const existing = await this.db.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM discovery_plans WHERE opportunity_id = $1 AND user_id = $2`,
      [plan.opportunityId, plan.ownerId],
    );
    return existing[0] ? { plan: toPlan(existing[0]), duplicate: true } : null;
  }

  async getPlan(ownerId: string, planId: string) {
    const rows = await this.db.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM discovery_plans WHERE id = $1 AND user_id = $2`,
      [planId, ownerId],
    );
    return rows[0] ? toPlan(rows[0]) : null;
  }

  async plans(ownerId: string, analysisId: string) {
    const rows = await this.db.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM discovery_plans WHERE analysis_id = $1 AND user_id = $2
       ORDER BY created_at`,
      [analysisId, ownerId],
    );
    return rows.map(toPlan);
  }

  async updatePlan(plan: Plan, expectedVersion: number) {
    const rows = await this.db.query<PlanRow>(
      `UPDATE discovery_plans SET status = $3, data = $4::text::jsonb, sponsored = $5,
         updated_at = $6::timestamptz, version = version + 1
       WHERE id = $1 AND user_id = $2 AND version = $7
       RETURNING ${PLAN_COLUMNS}`,
      [
        plan.id,
        plan.ownerId,
        plan.status,
        planData(plan),
        plan.sponsored,
        plan.updatedAt,
        expectedVersion,
      ],
    );
    return rows[0] ? toPlan(rows[0]) : null;
  }
}
