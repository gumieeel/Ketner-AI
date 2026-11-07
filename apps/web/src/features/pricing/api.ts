import { getAuthToken } from '@/features/auth/auth-store';
import { checkSessionInvalid, getGuestId } from '@/features/chat/api';
import { DiscoveryApiError } from '@/features/discovery/api';
import { API_BASE } from '@/lib/api-config';

/**
 * Сметы внедрения и заявки (docs/BUSINESS_DISCOVERY_PRICING_PLAN.md). Все суммы считает сервер;
 * сайт только показывает их и никогда не пересчитывает.
 */

export type Complexity = 'simple' | 'medium' | 'complex';
export type Confidence = 'low' | 'medium' | 'high';
export type SolutionType = 'assistant' | 'tool' | 'workflow';

export interface Range {
  min: number;
  expected: number;
  max: number;
}

export interface Localized {
  ru: string;
  en: string;
}

export interface RecurringCost {
  kind: 'subscription' | 'support';
  amount: { kzt: number | null; usdCents: number | null };
  monthlyCredits?: number;
}

export interface EstimateView {
  id: string;
  scope: 'opportunity' | 'combined';
  scopeKey: string;
  opportunityIds: string[];
  opportunityTitles: Record<string, string>;
  solutionTypes: SolutionType[];
  priceKzt: Range | null;
  pricingDisabled: boolean;
  minimumApplied: boolean;
  sharedSavingsKzt: number | null;
  workingDays: { min: number; max: number } | null;
  externalApproval: boolean;
  confidence: Confidence;
  confidenceReasons: string[];
  requiresManualReview: boolean;
  technicalVerificationRequired: boolean;
  work: Array<{
    capabilityId: string;
    name: Localized;
    category: string;
    complexity: Complexity;
    quantity: number;
    requiresManualReview: boolean;
    shared: boolean;
    includes: string[];
    prerequisites: string[];
  }>;
  projectWork: Localized[];
  excluded: Array<{
    capabilityId: string;
    name: string | null;
    reason: 'unknown_capability' | 'not_offered';
  }>;
  unknownDirectCosts: string[];
  assumptions: string[];
  unknowns: string[];
  exclusions: string[];
  monthly: {
    usdToKztRate: number | null;
    recurring: RecurringCost[];
    usage: {
      status: 'forecast' | 'volume_unknown' | 'not_applicable' | 'model_unknown';
      monthlyRequests: number | null;
      aiUsdCents: Range | null;
      aiKzt: Range | null;
      externalProviderFees: string[];
    };
  };
  calculatedAt: string;
}

export interface EstimatesBlock {
  enabled: boolean;
  items: EstimateView[];
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

export interface RequestView {
  id: string;
  analysisId: string | null;
  scope: 'opportunity' | 'combined';
  status: RequestStatus;
  opportunityTitles: Record<string, string>;
  customerMessage: string;
  contact: { name: string; phone: string; email: string | null };
  preliminary: EstimateView;
  proposal: {
    priceKzt: Range;
    workingDays: [number, number];
    customerNote: string;
    approvedAt: string | null;
  } | null;
  canCancel: boolean;
  canAccept: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessProfileData {
  businessName: string | null;
  industry: string | null;
  subIndustry: string | null;
  city: string | null;
  businessModel: 'b2c' | 'b2b' | 'mixed' | null;
  website: string | null;
  teamSize: '1' | '2_5' | '6_20' | '21_100' | '100_plus' | null;
  customerChannels: string[];
  existingTools: string[];
  monthlyRequests: number | null;
  monthlyOrders: number | null;
  additionalContext: string | null;
  edited?: boolean;
}

export const INDUSTRIES = [
  'online_store',
  'retail',
  'education',
  'services',
  'beauty',
  'auto',
  'agro',
  'manufacturing',
  'food',
  'medical',
  'logistics',
  'other',
] as const;
export const CHANNELS = [
  'whatsapp',
  'instagram',
  'telegram',
  'website',
  'phone',
  'email',
  'marketplace',
  'offline',
  'other',
] as const;
export const TEAM_SIZES = ['1', '2_5', '6_20', '21_100', '100_plus'] as const;

export async function apiCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Guest-Id': getGuestId(),
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  Object.assign(headers, init.headers ?? {});
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new DiscoveryApiError('network_error', '', 0);
  }
  checkSessionInvalid(response);
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok) {
    throw new DiscoveryApiError(
      body?.error?.code ?? 'unknown_error',
      body?.error?.message ?? '',
      response.status,
    );
  }
  return body as T;
}

export async function updateProfile(
  analysisId: string,
  profile: BusinessProfileData,
): Promise<void> {
  const { edited: _edited, ...rest } = profile;
  await apiCall(`/analyses/${encodeURIComponent(analysisId)}/profile`, {
    method: 'PATCH',
    body: JSON.stringify({ profile: rest }),
  });
}

export async function createImplementationRequest(
  analysisId: string,
  input: { scopeKey: string; message: string; contact: { name: string; phone: string } },
  idempotencyKey: string,
): Promise<RequestView> {
  const body = await apiCall<{ request: RequestView }>(
    `/analyses/${encodeURIComponent(analysisId)}/requests`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    },
  );
  return body.request;
}

export async function listMyRequests(): Promise<RequestView[]> {
  return (await apiCall<{ requests: RequestView[] }>('/requests')).requests;
}

export async function fetchMyRequest(id: string): Promise<RequestView> {
  return (await apiCall<{ request: RequestView }>(`/requests/${encodeURIComponent(id)}`)).request;
}

export async function requestAction(id: string, action: 'cancel' | 'accept'): Promise<RequestView> {
  return (
    await apiCall<{ request: RequestView }>(`/requests/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
    })
  ).request;
}

/** «80 000 ₸»: целые тенге с разделителями разрядов. */
export function formatKzt(value: number, language: 'ru' | 'en'): string {
  const number = new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ru-RU', {
    maximumFractionDigits: 0,
  }).format(value);
  return `${number}\u00a0₸`;
}

export function formatKztRange(range: Range, language: 'ru' | 'en'): string {
  if (range.min === range.max) return formatKzt(range.min, language);
  const from = new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ru-RU', {
    maximumFractionDigits: 0,
  }).format(range.min);
  return `${from}–${formatKzt(range.max, language)}`;
}

export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents < 1000 ? 2 : 0)}`;
}
