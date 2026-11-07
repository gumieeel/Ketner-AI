/**
 * Хранилище смет: версии настроек и каталога, сметы анализов, заявки на внедрение и журнал
 * действий администраторов. Postgres — таблицы миграции `0012_implementation_pricing`; без базы
 * (локально, тесты) — та же логика в памяти.
 *
 * Доступ клиента к сметам идёт только через проверенный анализ (сначала анализ владельца, потом
 * его сметы), к заявкам — по `user_id` в каждом запросе. Чужая запись не видна.
 */

import type { SqlRunner } from '../code/postgres-driver.js';
import type {
  AuditEntry,
  ImplementationRequest,
  PricingVersion,
  RequestStatus,
  StoredEstimate,
} from './types.js';

export interface RequestFilter {
  userId?: string;
  status?: RequestStatus;
  limit: number;
}

export interface EstimateListItem {
  estimate: StoredEstimate;
  ownerId: string | null;
}

export interface PricingStore {
  activeVersion(): Promise<PricingVersion | null>;
  getVersion(version: number): Promise<PricingVersion | null>;
  listVersions(limit: number): Promise<PricingVersion[]>;
  /** Новая версия = последняя + 1; если последняя уже другая — null (одновременная правка). */
  createVersion(next: PricingVersion): Promise<PricingVersion | null>;

  /** Сметы последнего поколения анализа. */
  latestEstimates(analysisId: string): Promise<StoredEstimate[]>;
  /** Записать поколение; уже записанное (одновременный запрос) не дублируется. */
  insertEstimates(rows: StoredEstimate[]): Promise<StoredEstimate[]>;
  getEstimate(id: string): Promise<StoredEstimate | null>;
  listEstimates(limit: number): Promise<EstimateListItem[]>;

  /** Создать; при повторе ключа идемпотентности пользователя — вернуть созданную. */
  createRequest(
    request: ImplementationRequest,
  ): Promise<{ request: ImplementationRequest; duplicate: boolean }>;
  getRequest(id: string): Promise<ImplementationRequest | null>;
  listRequests(filter: RequestFilter): Promise<ImplementationRequest[]>;
  /** Записать, только если версия — `expectedVersion`; иначе null. */
  updateRequest(
    request: ImplementationRequest,
    expectedVersion: number,
  ): Promise<ImplementationRequest | null>;

  appendAudit(entry: AuditEntry): Promise<void>;
  audit(entityType: AuditEntry['entityType'], entityId: string): Promise<AuditEntry[]>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryPricingStore implements PricingStore {
  private readonly versions: PricingVersion[] = [];
  private readonly estimates = new Map<string, StoredEstimate>();
  private readonly requests = new Map<string, ImplementationRequest>();
  private readonly entries: AuditEntry[] = [];

  constructor(private readonly ownerOf: (analysisId: string) => string | null = () => null) {}

  async activeVersion() {
    const last = this.versions.at(-1);
    return last ? clone(last) : null;
  }

  async getVersion(version: number) {
    const found = this.versions.find((item) => item.version === version);
    return found ? clone(found) : null;
  }

  async listVersions(limit: number) {
    return [...this.versions].reverse().slice(0, limit).map(clone);
  }

  async createVersion(next: PricingVersion) {
    const last = this.versions.at(-1)?.version ?? 0;
    if (next.version !== last + 1) return null;
    this.versions.push(clone(next));
    return clone(next);
  }

  async latestEstimates(analysisId: string) {
    const rows = [...this.estimates.values()].filter((item) => item.analysisId === analysisId);
    const generation = Math.max(0, ...rows.map((item) => item.generation));
    return rows
      .filter((item) => item.generation === generation)
      .sort((a, b) => a.scopeKey.localeCompare(b.scopeKey))
      .map(clone);
  }

  async insertEstimates(rows: StoredEstimate[]) {
    const first = rows[0];
    if (!first) return [];
    const taken = [...this.estimates.values()].some(
      (item) => item.analysisId === first.analysisId && item.generation === first.generation,
    );
    if (!taken) for (const row of rows) this.estimates.set(row.id, clone(row));
    return this.latestEstimates(first.analysisId);
  }

  async getEstimate(id: string) {
    const found = this.estimates.get(id);
    return found ? clone(found) : null;
  }

  async listEstimates(limit: number) {
    return [...this.estimates.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((estimate) => ({
        estimate: clone(estimate),
        ownerId: this.ownerOf(estimate.analysisId),
      }));
  }

  async createRequest(request: ImplementationRequest) {
    if (request.idempotencyKey) {
      const existing = [...this.requests.values()].find(
        (item) => item.userId === request.userId && item.idempotencyKey === request.idempotencyKey,
      );
      if (existing) return { request: clone(existing), duplicate: true };
    }
    this.requests.set(request.id, clone(request));
    return { request: clone(request), duplicate: false };
  }

  async getRequest(id: string) {
    const found = this.requests.get(id);
    return found ? clone(found) : null;
  }

  async listRequests(filter: RequestFilter) {
    return [...this.requests.values()]
      .filter((item) => filter.userId === undefined || item.userId === filter.userId)
      .filter((item) => filter.status === undefined || item.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit)
      .map(clone);
  }

  async updateRequest(request: ImplementationRequest, expectedVersion: number) {
    const current = this.requests.get(request.id);
    if (!current || current.version !== expectedVersion || current.userId !== request.userId)
      return null;
    const next = { ...clone(request), version: expectedVersion + 1 };
    this.requests.set(request.id, next);
    return clone(next);
  }

  async appendAudit(entry: AuditEntry) {
    this.entries.push(clone(entry));
  }

  async audit(entityType: AuditEntry['entityType'], entityId: string) {
    return this.entries
      .filter((item) => item.entityType === entityType && item.entityId === entityId)
      .map(clone);
  }
}

// ─── Postgres ─────────────────────────────────────────────────────────────────

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

const iso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

interface VersionRow {
  version: number | string;
  config: unknown;
  catalog: unknown;
  note: string;
  created_by: string;
  created_at: string | Date;
}

function toVersion(row: VersionRow): PricingVersion {
  return {
    version: Number(row.version),
    config: json(row.config, {} as PricingVersion['config']),
    catalog: json(row.catalog, [] as PricingVersion['catalog']),
    note: row.note,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

interface EstimateRow {
  id: string;
  analysis_id: string;
  generation: number | string;
  scope: StoredEstimate['scope'];
  scope_key: string;
  opportunity_ids: unknown;
  pricing_version: number | string;
  fingerprint: string;
  data: unknown;
  created_at: string | Date;
  owner_id?: string | null;
}

type EstimateData = Pick<StoredEstimate, 'opportunityTitles' | 'result' | 'monthly'>;

function toEstimate(row: EstimateRow): StoredEstimate {
  const data = json<EstimateData>(row.data, {} as EstimateData);
  return {
    ...data,
    id: row.id,
    analysisId: row.analysis_id,
    generation: Number(row.generation),
    scope: row.scope,
    scopeKey: row.scope_key,
    opportunityIds: json<string[]>(row.opportunity_ids, []),
    pricingVersion: Number(row.pricing_version),
    fingerprint: row.fingerprint,
    createdAt: iso(row.created_at),
  };
}

const ESTIMATE_COLUMNS = `id, analysis_id, generation, scope, scope_key, opportunity_ids,
  pricing_version, fingerprint, data, created_at`;

interface RequestRow {
  id: string;
  user_id: string;
  analysis_id: string | null;
  estimate_id: string;
  scope: ImplementationRequest['scope'];
  status: RequestStatus;
  pricing_version: number | string;
  data: unknown;
  idempotency_key: string | null;
  version: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}

type RequestData = Omit<
  ImplementationRequest,
  | 'id'
  | 'userId'
  | 'analysisId'
  | 'estimateId'
  | 'scope'
  | 'status'
  | 'idempotencyKey'
  | 'version'
  | 'createdAt'
  | 'updatedAt'
>;

function requestData(request: ImplementationRequest): string {
  const data: RequestData = {
    opportunityIds: request.opportunityIds,
    customerMessage: request.customerMessage,
    contact: request.contact,
    snapshot: request.snapshot,
    industry: request.industry,
    reviewed: request.reviewed,
    assignedAdminId: request.assignedAdminId,
    internalNotes: request.internalNotes,
    actuals: request.actuals,
  };
  return JSON.stringify(data);
}

function toRequest(row: RequestRow): ImplementationRequest {
  const data = json<RequestData>(row.data, {} as RequestData);
  return {
    ...data,
    id: row.id,
    userId: row.user_id,
    analysisId: row.analysis_id,
    estimateId: row.estimate_id,
    scope: row.scope,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const REQUEST_COLUMNS = `id, user_id, analysis_id, estimate_id, scope, status, pricing_version, data,
  idempotency_key, version, created_at, updated_at`;

interface AuditRow {
  id: string;
  entity_type: AuditEntry['entityType'];
  entity_id: string;
  actor_id: string;
  action: string;
  previous: unknown;
  next: unknown;
  reason: string;
  created_at: string | Date;
}

export class PostgresPricingStore implements PricingStore {
  constructor(private readonly db: SqlRunner) {}

  async activeVersion() {
    const rows = await this.db.query<VersionRow>(
      `SELECT * FROM pricing_versions ORDER BY version DESC LIMIT 1`,
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async getVersion(version: number) {
    const rows = await this.db.query<VersionRow>(
      `SELECT * FROM pricing_versions WHERE version = $1`,
      [version],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async listVersions(limit: number) {
    const rows = await this.db.query<VersionRow>(
      `SELECT * FROM pricing_versions ORDER BY version DESC LIMIT $1`,
      [limit],
    );
    return rows.map(toVersion);
  }

  async createVersion(next: PricingVersion) {
    // Версия на 1 больше последней: PRIMARY KEY не даст записать две одинаковые, а условие —
    // перескочить через версию, которую записал другой администратор.
    const rows = await this.db.query<VersionRow>(
      `INSERT INTO pricing_versions (version, config, catalog, note, created_by, created_at)
       SELECT $1, $2::text::jsonb, $3::text::jsonb, $4, $5, $6::timestamptz
       WHERE COALESCE((SELECT max(version) FROM pricing_versions), 0) = $1 - 1
       ON CONFLICT (version) DO NOTHING
       RETURNING *`,
      [
        next.version,
        JSON.stringify(next.config),
        JSON.stringify(next.catalog),
        next.note,
        next.createdBy,
        next.createdAt,
      ],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async latestEstimates(analysisId: string) {
    const rows = await this.db.query<EstimateRow>(
      `SELECT ${ESTIMATE_COLUMNS} FROM implementation_estimates
       WHERE analysis_id = $1
         AND generation = (SELECT max(generation) FROM implementation_estimates WHERE analysis_id = $1)
       ORDER BY scope_key`,
      [analysisId],
    );
    return rows.map(toEstimate);
  }

  async insertEstimates(rows: StoredEstimate[]) {
    const first = rows[0];
    if (!first) return [];
    // Одним запросом: поколение записывается целиком или (если его уже записал параллельный
    // запрос) не записывается вовсе.
    await this.db.query(
      `INSERT INTO implementation_estimates (${ESTIMATE_COLUMNS})
       SELECT x.id, x.analysis_id, x.generation, x.scope, x.scope_key, x.opportunity_ids,
              x.pricing_version, x.fingerprint, x.data, x.created_at
       FROM jsonb_to_recordset($1::text::jsonb) AS x(
         id text, analysis_id text, generation integer, scope text, scope_key text,
         opportunity_ids jsonb, pricing_version integer, fingerprint text, data jsonb,
         created_at timestamptz)
       WHERE NOT EXISTS (
         SELECT 1 FROM implementation_estimates e
         WHERE e.analysis_id = $2 AND e.generation = $3
       )
       ON CONFLICT (analysis_id, generation, scope_key) DO NOTHING`,
      [
        JSON.stringify(
          rows.map((row) => ({
            id: row.id,
            analysis_id: row.analysisId,
            generation: row.generation,
            scope: row.scope,
            scope_key: row.scopeKey,
            opportunity_ids: row.opportunityIds,
            pricing_version: row.pricingVersion,
            fingerprint: row.fingerprint,
            data: {
              opportunityTitles: row.opportunityTitles,
              result: row.result,
              monthly: row.monthly,
            },
            created_at: row.createdAt,
          })),
        ),
        first.analysisId,
        first.generation,
      ],
    );
    return this.latestEstimates(first.analysisId);
  }

  async getEstimate(id: string) {
    const rows = await this.db.query<EstimateRow>(
      `SELECT ${ESTIMATE_COLUMNS} FROM implementation_estimates WHERE id = $1`,
      [id],
    );
    return rows[0] ? toEstimate(rows[0]) : null;
  }

  async listEstimates(limit: number) {
    const rows = await this.db.query<EstimateRow>(
      `SELECT e.id, e.analysis_id, e.generation, e.scope, e.scope_key, e.opportunity_ids,
              e.pricing_version, e.fingerprint, e.data, e.created_at, a.user_id AS owner_id
       FROM implementation_estimates e
       LEFT JOIN discovery_analyses a ON a.id = e.analysis_id AND a.deleted_at IS NULL
       ORDER BY e.created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({ estimate: toEstimate(row), ownerId: row.owner_id ?? null }));
  }

  async createRequest(request: ImplementationRequest) {
    const rows = await this.db.query<RequestRow>(
      `INSERT INTO implementation_requests (${REQUEST_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9, $10, $11::timestamptz, $12::timestamptz)
       ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${REQUEST_COLUMNS}`,
      [
        request.id,
        request.userId,
        request.analysisId,
        request.estimateId,
        request.scope,
        request.status,
        request.snapshot.pricingVersion,
        requestData(request),
        request.idempotencyKey,
        request.version,
        request.createdAt,
        request.updatedAt,
      ],
    );
    if (rows[0]) return { request: toRequest(rows[0]), duplicate: false };
    const existing = await this.db.query<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM implementation_requests WHERE user_id = $1 AND idempotency_key = $2`,
      [request.userId, request.idempotencyKey],
    );
    if (!existing[0]) throw new Error('pricing: заявка не создана и не найдена');
    return { request: toRequest(existing[0]), duplicate: true };
  }

  async getRequest(id: string) {
    const rows = await this.db.query<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM implementation_requests WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async listRequests(filter: RequestFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.userId !== undefined) {
      params.push(filter.userId);
      where.push(`user_id = $${params.length}`);
    }
    if (filter.status !== undefined) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    params.push(filter.limit);
    const rows = await this.db.query<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM implementation_requests
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(toRequest);
  }

  async updateRequest(request: ImplementationRequest, expectedVersion: number) {
    const rows = await this.db.query<RequestRow>(
      `UPDATE implementation_requests SET status = $3, data = $4::text::jsonb,
         updated_at = $5::timestamptz, version = version + 1
       WHERE id = $1 AND user_id = $2 AND version = $6
       RETURNING ${REQUEST_COLUMNS}`,
      [
        request.id,
        request.userId,
        request.status,
        requestData(request),
        request.updatedAt,
        expectedVersion,
      ],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async appendAudit(entry: AuditEntry) {
    await this.db.query(
      `INSERT INTO pricing_audit_log
         (id, entity_type, entity_id, actor_id, action, previous, next, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::text::jsonb, $7::text::jsonb, $8, $9::timestamptz)`,
      [
        entry.id,
        entry.entityType,
        entry.entityId,
        entry.actorId,
        entry.action,
        JSON.stringify(entry.previous ?? null),
        JSON.stringify(entry.next ?? null),
        entry.reason,
        entry.createdAt,
      ],
    );
  }

  async audit(entityType: AuditEntry['entityType'], entityId: string) {
    const rows = await this.db.query<AuditRow>(
      `SELECT * FROM pricing_audit_log WHERE entity_type = $1 AND entity_id = $2
       ORDER BY created_at`,
      [entityType, entityId],
    );
    return rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorId: row.actor_id,
      action: row.action,
      previous: json(row.previous, null),
      next: json(row.next, null),
      reason: row.reason,
      createdAt: iso(row.created_at),
    }));
  }
}
