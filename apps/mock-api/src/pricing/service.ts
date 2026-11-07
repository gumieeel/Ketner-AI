/**
 * PricingService: сметы анализов, заявки на внедрение, правки администратора и калибровка.
 *
 * Разделение ответственности:
 * - модель (discovery) называет работы, неизвестные и допущения;
 * - engine.ts считает часы, деньги, сроки и уверенность по каталогу и настройкам;
 * - здесь — версии настроек, снимки смет, заявки, журнал и права на переходы статусов.
 *
 * Сметы считаются после готового отчёта, без вызова модели, и сохраняются поколениями: пока
 * возможности и профиль те же, клиент видит ту же смету даже после смены цен администратором.
 */

import { createHash, randomUUID } from 'node:crypto';
import { modelRegistry, type ModelRegistry } from '../ai/model-registry.js';
import { monthlyVolume, profileGaps } from '../discovery/profile.js';
import type { Analysis, Opportunity } from '../discovery/types.js';
import { inferSolutionType } from '../discovery/service.js';
import {
  DEFAULT_CATALOG,
  DEFAULT_PRICING_CONFIG,
  catalogForPrompt,
  catalogItemSchema,
  pricingConfigSchema,
  type CatalogItem,
  type PricingConfig,
} from './catalog.js';
import {
  combinedEstimate,
  deriveWorkItems,
  estimate,
  type OpportunityInput,
  type ProfileSignals,
  type Range,
} from './engine.js';
import type { PricingStore } from './store.js';
import {
  CUSTOMER_CANCELLABLE,
  REQUEST_STATUSES,
  type AuditEntry,
  type ImplementationRequest,
  type PricingVersion,
  type ProjectActuals,
  type RequestContact,
  type RequestStatus,
  type ReviewedEstimate,
  type StoredEstimate,
} from './types.js';
import { monthlyCosts } from './usage.js';

export type Result<T> =
  ({ ok: true } & T) | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string) =>
  ({ ok: false, status, code, message }) as const;

export interface PricingServiceDeps {
  store: PricingStore;
  registry?: ModelRegistry;
  now?: () => Date;
}

/** Статусы, в которых клиенту видно одобренное коммерческое предложение. */
const PROPOSAL_VISIBLE: readonly RequestStatus[] = [
  'proposal_sent',
  'approved',
  'in_progress',
  'testing',
  'completed',
];

/** Факт проекта можно записывать, когда работа идёт или закончена. */
const ACTUALS_ALLOWED: readonly RequestStatus[] = ['in_progress', 'testing', 'completed'];

export class PricingService {
  private readonly registry: ModelRegistry;
  private readonly now: () => Date;
  private seeding: Promise<PricingVersion> | null = null;

  constructor(private readonly deps: PricingServiceDeps) {
    this.registry = deps.registry ?? modelRegistry;
    this.now = deps.now ?? (() => new Date());
  }

  get store(): PricingStore {
    return this.deps.store;
  }

  /** Действующая версия; на пустой базе — первая версия из значений по умолчанию. */
  async active(): Promise<PricingVersion> {
    const current = await this.deps.store.activeVersion();
    if (current) return current;
    this.seeding ??= (async () => {
      const created = await this.deps.store.createVersion({
        version: 1,
        config: DEFAULT_PRICING_CONFIG,
        catalog: DEFAULT_CATALOG,
        note: 'Начальные значения (гипотезы, требуют калибровки)',
        createdBy: 'system',
        createdAt: this.now().toISOString(),
      });
      const result = created ?? (await this.deps.store.activeVersion());
      if (!result) throw new Error('pricing: не удалось создать первую версию настроек');
      return result;
    })().finally(() => {
      this.seeding = null;
    });
    return this.seeding;
  }

  async catalogPrompt(language: 'ru' | 'en'): Promise<string> {
    return catalogForPrompt((await this.active()).catalog, language);
  }

  // ─── Сметы анализа ─────────────────────────────────────────────────────────

  /**
   * Сметы готового анализа: последнее поколение, если входные данные не изменились, иначе новое.
   * null — анализ ещё не готов.
   */
  async estimatesFor(
    analysis: Analysis,
    opportunities: Opportunity[],
  ): Promise<StoredEstimate[] | null> {
    if (analysis.status !== 'ready' || opportunities.length === 0) return null;
    const inputs = opportunities
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map(toInput);
    const profile = analysis.context?.profile ?? null;
    const signals: ProfileSignals = {
      monthlyRequests: monthlyVolume(profile),
      missing: profileGaps(profile),
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ inputs, signals }))
      .digest('hex');
    const latest = await this.deps.store.latestEstimates(analysis.id);
    if (latest.length > 0 && latest[0]!.fingerprint === fingerprint) return latest;

    const version = await this.active();
    const language = analysis.language;
    const createdAt = this.now().toISOString();
    const generation = (latest[0]?.generation ?? 0) + 1;
    const titles = Object.fromEntries(opportunities.map((item) => [item.id, item.title]));
    const rows: StoredEstimate[] = [];
    const individual = inputs.map((input) => {
      const result = estimate([input], version.catalog, version.config, signals, language);
      rows.push({
        id: randomUUID(),
        analysisId: analysis.id,
        generation,
        scope: 'opportunity',
        scopeKey: `opp:${input.id}`,
        opportunityIds: [input.id],
        pricingVersion: version.version,
        fingerprint,
        opportunityTitles: { [input.id]: input.title },
        result,
        monthly: monthlyCosts(result.lines, signals.monthlyRequests, version.config, this.registry),
        createdAt,
      });
      return { input, result };
    });
    // Общая смета — по возможностям, у которых есть цена; одна такая — общая не нужна.
    const priced = individual.filter((item) => item.result.priceKzt !== null);
    if (priced.length >= 2) {
      const result = combinedEstimate(
        priced.map((item) => item.input),
        priced.map((item) => item.result),
        version.catalog,
        version.config,
        signals,
        language,
      );
      rows.push({
        id: randomUUID(),
        analysisId: analysis.id,
        generation,
        scope: 'combined',
        scopeKey: 'combined',
        opportunityIds: priced.map((item) => item.input.id),
        pricingVersion: version.version,
        fingerprint,
        opportunityTitles: Object.fromEntries(
          priced.map((item) => [item.input.id, titles[item.input.id]!]),
        ),
        result,
        monthly: monthlyCosts(result.lines, signals.monthlyRequests, version.config, this.registry),
        createdAt,
      });
    }
    return this.deps.store.insertEstimates(rows);
  }

  // ─── Заявки клиента ────────────────────────────────────────────────────────

  async createRequest(input: {
    userId: string;
    email: string | null;
    analysis: Analysis;
    opportunities: Opportunity[];
    scopeKey: string;
    message: string;
    contact: Omit<RequestContact, 'email'>;
    idempotencyKey: string | null;
  }): Promise<Result<{ request: ImplementationRequest; duplicate: boolean }>> {
    if (input.analysis.ownerId !== input.userId) return fail(404, 'not_found', 'Анализ не найден');
    const estimates = await this.estimatesFor(input.analysis, input.opportunities);
    if (!estimates) {
      return fail(409, 'analysis_not_ready', 'Смета появится, когда анализ будет готов.');
    }
    const snapshot = estimates.find((item) => item.scopeKey === input.scopeKey);
    if (!snapshot) return fail(404, 'estimate_not_found', 'Такой сметы нет в этом анализе.');
    const at = this.now().toISOString();
    const request: ImplementationRequest = {
      id: randomUUID(),
      userId: input.userId,
      analysisId: input.analysis.id,
      estimateId: snapshot.id,
      scope: snapshot.scope,
      opportunityIds: snapshot.opportunityIds,
      customerMessage: input.message,
      contact: { ...input.contact, email: input.email },
      // Нужна проверка инженером — заявка сразу идёт на техническую проверку.
      status: snapshot.result.technicalVerificationRequired ? 'technical_review' : 'new',
      snapshot,
      industry: input.analysis.context?.profile?.industry ?? null,
      reviewed: null,
      assignedAdminId: null,
      internalNotes: [],
      actuals: null,
      idempotencyKey: input.idempotencyKey,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    const created = await this.deps.store.createRequest(request);
    if (!created.duplicate) {
      await this.audit('request', created.request.id, input.userId, 'created', null, {
        status: created.request.status,
        estimateId: snapshot.id,
        pricingVersion: snapshot.pricingVersion,
      });
    }
    return { ok: true, ...created };
  }

  async ownRequest(userId: string, id: string): Promise<ImplementationRequest | null> {
    const found = await this.deps.store.getRequest(id);
    return found && found.userId === userId ? found : null;
  }

  async customerAction(
    userId: string,
    id: string,
    action: 'cancel' | 'accept',
  ): Promise<Result<{ request: ImplementationRequest }>> {
    const current = await this.ownRequest(userId, id);
    if (!current) return fail(404, 'not_found', 'Заявка не найдена');
    let next: RequestStatus;
    if (action === 'cancel') {
      if (!CUSTOMER_CANCELLABLE.includes(current.status)) {
        return fail(
          409,
          'request_locked',
          'Работа уже идёт: отменить заявку можно через команду Ketner.',
        );
      }
      next = 'cancelled';
    } else {
      if (current.status !== 'proposal_sent' || !current.reviewed?.approved) {
        return fail(409, 'no_proposal', 'Коммерческое предложение ещё не отправлено.');
      }
      next = 'approved';
    }
    const saved = await this.deps.store.updateRequest(
      { ...current, status: next, updatedAt: this.now().toISOString() },
      current.version,
    );
    if (!saved) return fail(409, 'version_conflict', 'Заявка изменилась. Обновите страницу.');
    await this.audit(
      'request',
      id,
      userId,
      `customer_${action}`,
      { status: current.status },
      { status: next },
    );
    return { ok: true, request: saved };
  }

  // ─── Администратор: настройки и каталог ────────────────────────────────────

  async updateConfig(
    actorId: string,
    baseVersion: number,
    config: unknown,
    note: string,
  ): Promise<Result<{ version: PricingVersion }>> {
    const parsed = pricingConfigSchema.safeParse(config);
    if (!parsed.success) return fail(400, 'validation_failed', describe(parsed.error.issues));
    if (!this.registry.get(parsed.data.usage.modelId)) {
      return fail(400, 'validation_failed', `Модели ${parsed.data.usage.modelId} нет в реестре`);
    }
    return this.newVersion(actorId, baseVersion, note, (current) => ({
      config: parsed.data,
      catalog: current.catalog,
      previous: current.config,
      next: parsed.data,
      action: 'config_updated',
    }));
  }

  async upsertCatalogItem(
    actorId: string,
    baseVersion: number,
    id: string,
    item: unknown,
    note: string,
  ): Promise<Result<{ version: PricingVersion }>> {
    const parsed = catalogItemSchema.safeParse(item);
    if (!parsed.success) return fail(400, 'validation_failed', describe(parsed.error.issues));
    if (parsed.data.id !== id)
      return fail(400, 'validation_failed', 'id в адресе и в теле различаются');
    return this.newVersion(actorId, baseVersion, note, (current) => {
      const previous = current.catalog.find((entry) => entry.id === id) ?? null;
      const catalog: CatalogItem[] = previous
        ? current.catalog.map((entry) => (entry.id === id ? parsed.data : entry))
        : [...current.catalog, parsed.data];
      return {
        config: current.config,
        catalog,
        previous,
        next: parsed.data,
        action: previous ? 'catalog_item_updated' : 'catalog_item_created',
      };
    });
  }

  private async newVersion(
    actorId: string,
    baseVersion: number,
    note: string,
    change: (current: PricingVersion) => {
      config: PricingConfig;
      catalog: CatalogItem[];
      previous: unknown;
      next: unknown;
      action: string;
    },
  ): Promise<Result<{ version: PricingVersion }>> {
    const reason = note.trim();
    if (reason.length < 3) return fail(400, 'reason_required', 'Укажите причину изменения.');
    const current = await this.active();
    if (current.version !== baseVersion) {
      return fail(
        409,
        'version_conflict',
        'Настройки уже изменил другой администратор. Обновите страницу.',
      );
    }
    const next = change(current);
    const created = await this.deps.store.createVersion({
      version: current.version + 1,
      config: next.config,
      catalog: next.catalog,
      note: reason.slice(0, 500),
      createdBy: actorId,
      createdAt: this.now().toISOString(),
    });
    if (!created) {
      return fail(
        409,
        'version_conflict',
        'Настройки уже изменил другой администратор. Обновите страницу.',
      );
    }
    await this.audit(
      'pricing_version',
      String(created.version),
      actorId,
      next.action,
      next.previous,
      next.next,
      reason,
    );
    return { ok: true, version: created };
  }

  // ─── Администратор: заявки ─────────────────────────────────────────────────

  async adminUpdateRequest(
    actorId: string,
    id: string,
    change: { status?: RequestStatus; assignedAdminId?: string | null; note?: string },
    reason: string,
  ): Promise<Result<{ request: ImplementationRequest }>> {
    const current = await this.deps.store.getRequest(id);
    if (!current) return fail(404, 'not_found', 'Заявка не найдена');
    if (change.status && !REQUEST_STATUSES.includes(change.status)) {
      return fail(400, 'validation_failed', 'Неизвестный статус');
    }
    if (
      change.status &&
      (change.status === 'proposal_sent' || change.status === 'approved') &&
      !current.reviewed?.approved
    ) {
      return fail(
        409,
        'proposal_not_approved',
        'Сначала проверьте и утвердите смету: без неё предложение не отправляется.',
      );
    }
    const at = this.now().toISOString();
    const next: ImplementationRequest = {
      ...current,
      status: change.status ?? current.status,
      assignedAdminId:
        change.assignedAdminId === undefined ? current.assignedAdminId : change.assignedAdminId,
      internalNotes: change.note?.trim()
        ? [
            ...current.internalNotes,
            {
              id: randomUUID(),
              authorId: actorId,
              text: change.note.trim().slice(0, 2000),
              createdAt: at,
            },
          ]
        : current.internalNotes,
      updatedAt: at,
    };
    const saved = await this.deps.store.updateRequest(next, current.version);
    if (!saved) return fail(409, 'version_conflict', 'Заявка изменилась. Обновите страницу.');
    await this.audit(
      'request',
      id,
      actorId,
      'admin_update',
      { status: current.status, assignedAdminId: current.assignedAdminId },
      {
        status: saved.status,
        assignedAdminId: saved.assignedAdminId,
        note: change.note ? true : undefined,
      },
      reason,
    );
    return { ok: true, request: saved };
  }

  /** Проверенная администратором смета; `approve` — официальное коммерческое предложение. */
  async reviewEstimate(
    actorId: string,
    id: string,
    input: {
      priceKzt: Range;
      hours: Range | null;
      workingDays: [number, number];
      customerNote: string;
      approve: boolean;
    },
    reason: string,
  ): Promise<Result<{ request: ImplementationRequest }>> {
    if (reason.trim().length < 3) return fail(400, 'reason_required', 'Укажите причину изменения.');
    const { min, expected, max } = input.priceKzt;
    if (
      ![min, expected, max].every((v) => Number.isSafeInteger(v) && v >= 0) ||
      !(min <= expected && expected <= max)
    ) {
      return fail(400, 'validation_failed', 'Цена: целые тенге, от ≤ ожидаемая ≤ до.');
    }
    if (!(input.workingDays[0] <= input.workingDays[1])) {
      return fail(400, 'validation_failed', 'Сроки: от ≤ до.');
    }
    const current = await this.deps.store.getRequest(id);
    if (!current) return fail(404, 'not_found', 'Заявка не найдена');
    if (current.status === 'cancelled' || current.status === 'rejected') {
      return fail(409, 'request_closed', 'Заявка закрыта.');
    }
    const at = this.now().toISOString();
    const reviewed: ReviewedEstimate = {
      priceKzt: input.priceKzt,
      hours: input.hours,
      workingDays: input.workingDays,
      customerNote: input.customerNote.trim().slice(0, 2000),
      approved: input.approve,
      reviewedBy: actorId,
      reviewedAt: at,
      approvedAt: input.approve ? at : null,
    };
    const saved = await this.deps.store.updateRequest(
      {
        ...current,
        reviewed,
        status:
          input.approve &&
          ['new', 'reviewing', 'technical_review', 'clarification_needed'].includes(current.status)
            ? 'proposal_preparing'
            : current.status,
        updatedAt: at,
      },
      current.version,
    );
    if (!saved) return fail(409, 'version_conflict', 'Заявка изменилась. Обновите страницу.');
    await this.audit(
      'estimate',
      current.estimateId,
      actorId,
      input.approve ? 'estimate_approved' : 'estimate_adjusted',
      current.reviewed ?? { priceKzt: current.snapshot.result.priceKzt, source: 'automatic' },
      reviewed,
      reason.trim(),
    );
    return { ok: true, request: saved };
  }

  async recordActuals(
    actorId: string,
    id: string,
    input: Omit<ProjectActuals, 'recordedBy' | 'recordedAt'>,
    reason: string,
  ): Promise<Result<{ request: ImplementationRequest }>> {
    const current = await this.deps.store.getRequest(id);
    if (!current) return fail(404, 'not_found', 'Заявка не найдена');
    if (!ACTUALS_ALLOWED.includes(current.status)) {
      return fail(
        409,
        'request_not_started',
        'Факт записывается, когда работа идёт или завершена.',
      );
    }
    const actuals: ProjectActuals = {
      ...input,
      recordedBy: actorId,
      recordedAt: this.now().toISOString(),
    };
    const saved = await this.deps.store.updateRequest(
      { ...current, actuals, updatedAt: actuals.recordedAt },
      current.version,
    );
    if (!saved) return fail(409, 'version_conflict', 'Заявка изменилась. Обновите страницу.');
    await this.audit('request', id, actorId, 'actuals_recorded', current.actuals, actuals, reason);
    return { ok: true, request: saved };
  }

  private async audit(
    entityType: AuditEntry['entityType'],
    entityId: string,
    actorId: string,
    action: string,
    previous: unknown,
    next: unknown,
    reason = '',
  ): Promise<void> {
    await this.deps.store.appendAudit({
      id: randomUUID(),
      entityType,
      entityId,
      actorId,
      action,
      previous,
      next,
      reason: reason.slice(0, 500),
      createdAt: this.now().toISOString(),
    });
  }

  /** Заявка открыта клиенту: видно ли ему одобренное предложение. */
  static proposalVisible(request: ImplementationRequest): boolean {
    return Boolean(request.reviewed?.approved) && PROPOSAL_VISIBLE.includes(request.status);
  }
}

function toInput(opportunity: Opportunity): OpportunityInput {
  const fromModel = opportunity.workItems ?? [];
  const derived = fromModel.length === 0;
  return {
    id: opportunity.id,
    title: opportunity.title,
    solutionType:
      opportunity.solutionType ?? inferSolutionType(opportunity.recipe, opportunity.requires),
    workItems: derived ? deriveWorkItems(opportunity.requires) : fromModel,
    unknowns: opportunity.unknowns ?? [],
    assumptions: opportunity.assumptions ?? [],
    derived,
  };
}

function describe(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || 'тело'}: ${issue.message}`)
    .join('; ');
}
