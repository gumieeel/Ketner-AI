import type { CatalogItem, PricingConfig } from './catalog.js';
import type { EstimateResult, Range } from './engine.js';
import type { MonthlyCosts } from './usage.js';

/** Версия коммерческих настроек и каталога: каждое изменение администратора — новая версия. */
export interface PricingVersion {
  version: number;
  config: PricingConfig;
  catalog: CatalogItem[];
  note: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Сохранённая смета. Поколение (`generation`) — набор смет одного анализа, посчитанный по одним
 * входным данным; при изменении возможностей или профиля появляется новое поколение, прежние
 * остаются как были (на них могут ссылаться заявки).
 */
export interface StoredEstimate {
  id: string;
  analysisId: string;
  generation: number;
  scope: 'opportunity' | 'combined';
  /** `opp:<id>` или `combined`. */
  scopeKey: string;
  opportunityIds: string[];
  pricingVersion: number;
  /** Отпечаток входных данных (возможности, работы, профиль). */
  fingerprint: string;
  opportunityTitles: Record<string, string>;
  result: EstimateResult;
  monthly: MonthlyCosts;
  createdAt: string;
}

export const REQUEST_STATUSES = [
  'new',
  'reviewing',
  'clarification_needed',
  'technical_review',
  'proposal_preparing',
  'proposal_sent',
  'approved',
  'in_progress',
  'testing',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Заявка можно отменить клиенту, пока работа не началась. */
export const CUSTOMER_CANCELLABLE: readonly RequestStatus[] = [
  'new',
  'reviewing',
  'clarification_needed',
  'technical_review',
  'proposal_preparing',
  'proposal_sent',
];

/** Смета, проверенная администратором. `approved` — официальное коммерческое предложение. */
export interface ReviewedEstimate {
  priceKzt: Range;
  /** Часы, центичасы; null — не уточнялись. */
  hours: Range | null;
  workingDays: [number, number];
  /** Пояснение для клиента. */
  customerNote: string;
  approved: boolean;
  reviewedBy: string;
  reviewedAt: string;
  approvedAt: string | null;
}

/** Фактические данные завершённого проекта — основа калибровки. */
export interface ProjectActuals {
  /** Центичасы. */
  actualHours: number;
  actualDirectKzt: number;
  finalPriceKzt: number;
  actualMonthlyUsageKzt: number | null;
  scopeChanges: string;
  difficulties: string;
  deviationReasons: string;
  recordedBy: string;
  recordedAt: string;
}

export interface InternalNote {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export interface RequestContact {
  name: string;
  phone: string;
  email: string | null;
}

export interface ImplementationRequest {
  id: string;
  userId: string;
  analysisId: string | null;
  estimateId: string;
  scope: 'opportunity' | 'combined';
  opportunityIds: string[];
  customerMessage: string;
  contact: RequestContact;
  status: RequestStatus;
  /** Смета ровно в том виде, в каком её видел клиент. Никогда не пересчитывается. */
  snapshot: StoredEstimate;
  /** Отрасль из профиля на момент заявки (для калибровки по отраслям). */
  industry: string | null;
  reviewed: ReviewedEstimate | null;
  assignedAdminId: string | null;
  internalNotes: InternalNote[];
  actuals: ProjectActuals | null;
  idempotencyKey: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  entityType: 'pricing_version' | 'estimate' | 'request';
  entityId: string;
  /** id администратора; `admin-key` — запрос по ключу администратора без входа. */
  actorId: string;
  action: string;
  previous: unknown;
  next: unknown;
  reason: string;
  createdAt: string;
}
