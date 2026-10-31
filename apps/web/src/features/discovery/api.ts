import { getAuthToken } from '@/features/auth/auth-store';
import { checkSessionInvalid, getGuestId } from '@/features/chat/api';
import { API_BASE } from '@/lib/api-config';
import type { Language } from '@/features/preferences/preferences-store';

/**
 * Клиент API анализа задач (`/api/analyses`, docs/api.md). Гость работает по гостевому id этого
 * браузера; после входа анализ, начатый здесь гостем, сервер переносит в аккаунт.
 */

export type AnalysisMode = 'free' | 'paid' | 'deep';
export type AnalysisStatus = 'analyzing' | 'needs_answers' | 'discovering' | 'ready' | 'failed';
export type StageStatus = 'pending' | 'running' | 'done' | 'failed';
export type FeasibilityStatus = 'ready' | 'needs_setup' | 'needs_integration' | 'not_supported';

export interface Question {
  id: string;
  text: string;
  reason: string;
  optional: boolean;
  kind: 'text' | 'choice';
  options?: string[];
}

export type AnswerRecord = { skipped: true } | { value: string };
export type Answers = Record<string, AnswerRecord>;

export interface StageView {
  status: StageStatus;
  model: { id: string; name: string } | null;
  attempts: number;
  error: { code: string; message: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface FeasibilityItem {
  capability: string;
  label: string;
  /** Что сделать или почему нельзя. */
  hint: string;
  status: FeasibilityStatus;
}

export type Impact =
  | {
      kind: 'estimate';
      hoursPerWeek: [number, number];
      formula: string;
      inputs: Array<{ label: string; value: string; source: 'user' }>;
      assumptions: string[];
      benefit: string;
      note: string;
    }
  | { kind: 'qualitative'; benefit: string; missing: string; note: string };

/** Области карты анализа (сервер: discovery/analysis-map.ts). */
export type AreaId = 'clients' | 'sales' | 'content' | 'documents' | 'routine';
/** Готовые автоматизации; сервер отдаёт только доступные. */
export type RecipeId = 'personal_assistant' | 'customer_bot' | 'weekly_content';

export interface AreaCoverage {
  area: AreaId;
  status: 'found' | 'not_relevant' | 'unclear';
  opportunities: number;
  note: string;
}

export type SiteSourceView =
  { url: string; ok: true; title: string } | { url: string; ok: false; reason: string };

export interface OpportunityView {
  id: string;
  position: number;
  title: string;
  area: AreaId | null;
  recipe: RecipeId | null;
  problem: string;
  solution: string;
  requires: string[];
  otherRequirement: string | null;
  dataNeeded: string[];
  integrationsNeeded: string[];
  effort: 'low' | 'medium' | 'high';
  effortReason: string;
  risks: string[];
  limitations: string[];
  successCriteria: string[];
  firstStep: string;
  feasibilityStatus: FeasibilityStatus;
  feasibility: {
    status: FeasibilityStatus;
    blockers: FeasibilityItem[];
    available: FeasibilityItem[];
  };
  impact: Impact;
  priority: number;
}

export interface AnalysisView {
  id: string;
  status: AnalysisStatus;
  mode: AnalysisMode;
  language: Language;
  guest: boolean;
  inputText: string;
  context: { domain: string; summary: string } | null;
  questions: Question[];
  answers: Answers;
  summary: string | null;
  coverage: AreaCoverage[] | null;
  source: SiteSourceView | null;
  saved: boolean;
  stages: { context: StageView | null; discovery: StageView | null };
  opportunities: OpportunityView[];
  cost: { chargedCredits: number; sponsored: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface RerunQuote {
  model: string;
  typicalCredits: number;
  maxCredits: number;
  loginRequired: boolean;
}

export interface PaidOffer {
  model: string;
  typicalCredits: number;
  maxCredits: number;
  loginRequired: boolean;
}

export type FreeUnavailableReason =
  'daily_limit' | 'ip_limit' | 'disposable_email' | 'budget_exhausted';

export interface Offer {
  free:
    | { available: true; model: string }
    | { available: false; reason: FreeUnavailableReason; resetsAt: string };
  paid: PaidOffer;
  deep: PaidOffer & { confirmationRequired: boolean };
}

/** Ошибка API анализа: код, текст сервера и подробности отказа (цена, причина, время сброса). */
export class DiscoveryApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DiscoveryApiError';
  }
}

async function call<T>(path: string, init: RequestInit = {}, language?: Language): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Guest-Id': getGuestId(),
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (language) headers['Accept-Language'] = language;
  Object.assign(headers, init.headers ?? {});
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/analyses${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new DiscoveryApiError('network_error', '', 0);
  }
  checkSessionInvalid(response);
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string; details?: Record<string, unknown> } }) | null;
  if (!response.ok) {
    throw new DiscoveryApiError(
      body?.error?.code ?? 'unknown_error',
      body?.error?.message ?? '',
      response.status,
      body?.error?.details ?? {},
    );
  }
  return body as T;
}

export function fetchOffer(language: Language): Promise<Offer> {
  return call<Offer>('/offer', {}, language);
}

export async function createAnalysis(
  input: { text: string; language: Language; mode?: AnalysisMode; confirm?: boolean },
  idempotencyKey: string,
): Promise<AnalysisView> {
  const body = await call<{ analysis: AnalysisView }>('', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  });
  return body.analysis;
}

export type RetryQuote =
  | { stage: 'context' | 'discovery'; sponsored: true }
  | ({ stage: 'context' | 'discovery'; sponsored: false } & RerunQuote);

export type PlanStepStatus = 'todo' | 'in_progress' | 'done' | 'skipped';

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  doneWhen: string;
  status: PlanStepStatus;
  updatedAt: string | null;
}

export interface PlanView {
  id: string;
  analysisId: string;
  opportunityId: string;
  opportunityTitle: string;
  kind: 'brief' | 'full';
  status: 'generating' | 'ready' | 'failed';
  summary: string | null;
  steps: PlanStep[];
  risks: string[];
  successCriteria: string[];
  model: { id: string; name: string } | null;
  error: { code: string; message: string } | null;
  cost: { chargedCredits: number; sponsored: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface PlansSummary {
  offer: {
    free: { available: true; model: string } | { available: false; usedFor: string | null };
    paid: PaidOffer & { confirmationRequired: boolean };
  };
  items: Array<{
    id: string;
    opportunityId: string;
    kind: 'brief' | 'full';
    status: PlanView['status'];
  }>;
}

export type PlanRetryQuote = { sponsored: true } | ({ sponsored: false } & RerunQuote);

export interface AnalysisResponse {
  analysis: AnalysisView;
  /** Планы внедрения: что составлено и что доступно (только у готового анализа). */
  plans: PlansSummary | null;
  /** Цена обновления анализа при изменении ответов (только у готового анализа с вопросами). */
  rerun: RerunQuote | null;
  /** Цена повтора упавшего этапа. */
  retry: RetryQuote | null;
}

export function fetchAnalysis(id: string): Promise<AnalysisResponse> {
  return call(`/${encodeURIComponent(id)}`);
}

export interface AnalysisListItem {
  id: string;
  status: AnalysisStatus;
  mode: AnalysisMode;
  title: string;
  excerpt: string;
  saved: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listAnalyses(): Promise<AnalysisListItem[]> {
  const body = await call<{ analyses: AnalysisListItem[] }>('');
  return body.analyses;
}

export async function setAnalysisSaved(id: string, saved: boolean): Promise<void> {
  await call(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ saved }) });
}

export async function deleteAnalysis(id: string): Promise<void> {
  await call(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

const planPath = (analysisId: string, planId: string) =>
  `/${encodeURIComponent(analysisId)}/plans/${encodeURIComponent(planId)}`;

export async function createPlan(
  analysisId: string,
  opportunityId: string,
  confirm = false,
): Promise<PlanView> {
  const body = await call<{ plan: PlanView }>(
    `/${encodeURIComponent(analysisId)}/opportunities/${encodeURIComponent(opportunityId)}/plan`,
    { method: 'POST', body: JSON.stringify(confirm ? { confirm: true } : {}) },
  );
  return body.plan;
}

export function fetchPlan(
  analysisId: string,
  planId: string,
): Promise<{ plan: PlanView; retry: PlanRetryQuote | null }> {
  return call(planPath(analysisId, planId));
}

export async function setPlanStepStatus(
  analysisId: string,
  planId: string,
  stepId: string,
  status: PlanStepStatus,
): Promise<PlanView> {
  const body = await call<{ plan: PlanView }>(
    `${planPath(analysisId, planId)}/steps/${encodeURIComponent(stepId)}`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
  return body.plan;
}

export async function retryPlan(analysisId: string, planId: string, confirm = false) {
  await call(`${planPath(analysisId, planId)}/retry`, {
    method: 'POST',
    body: JSON.stringify(confirm ? { confirm: true } : {}),
  });
}

export async function saveAnswersDraft(id: string, answers: Answers): Promise<void> {
  await call(`/${encodeURIComponent(id)}/answers`, {
    method: 'PUT',
    body: JSON.stringify({ answers }),
  });
}

export async function continueAnalysis(
  id: string,
  answers: Answers,
  confirm = false,
): Promise<{ rerun: boolean }> {
  const body = await call<{ rerun: boolean }>(`/${encodeURIComponent(id)}/continue`, {
    method: 'POST',
    body: JSON.stringify({ answers, ...(confirm ? { confirm: true } : {}) }),
  });
  return { rerun: body.rerun };
}

export async function retryAnalysis(id: string, confirm = false): Promise<void> {
  await call(`/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    body: JSON.stringify(confirm ? { confirm: true } : {}),
  });
}

/** Ключ идемпотентности: повторное нажатие или обрыв сети не создадут второй анализ. */
export function newIdempotencyKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replaceAll('-', '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `an_${random}`.slice(0, 60);
}

/** Совпадают ли ответы по смыслу — так же, как на сервере (discovery/service.ts: sameAnswers). */
export function sameAnswers(a: Answers, b: Answers): boolean {
  const valueOf = (record: AnswerRecord | undefined) =>
    record && 'value' in record ? record.value.trim() : '';
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) {
    if (valueOf(a[id]) !== valueOf(b[id])) return false;
  }
  return true;
}
