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

export interface OpportunityView {
  id: string;
  title: string;
  problem: string;
  solution: string;
  firstStep: string;
  effort: 'low' | 'medium' | 'high';
  feasibilityStatus: FeasibilityStatus;
  impact:
    | { kind: 'estimate'; hoursPerWeek: [number, number]; benefit: string }
    | { kind: 'qualitative'; benefit: string };
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

export interface AnalysisResponse {
  analysis: AnalysisView;
  /** Цена обновления анализа при изменении ответов (только у готового анализа с вопросами). */
  rerun: RerunQuote | null;
  /** Цена повтора упавшего этапа. */
  retry: RetryQuote | null;
}

export function fetchAnalysis(id: string): Promise<AnalysisResponse> {
  return call(`/${encodeURIComponent(id)}`);
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
