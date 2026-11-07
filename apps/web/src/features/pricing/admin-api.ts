import { apiCall, type Range, type RequestStatus } from './api';

/**
 * Админка смет (`/api/admin/pricing`). Права проверяет сервер; ключ администратора из localStorage
 * (как у основной админки) передаётся только если он задан.
 */

export interface CatalogItem {
  id: string;
  name: { ru: string; en: string };
  description: { ru: string; en: string };
  category: string;
  status: 'available' | 'custom' | 'planned' | 'disabled';
  hoursMin: number;
  hoursExpected: number;
  hoursMax: number;
  complexityRange: [string, string];
  defaultComplexity: string;
  maxQuantity: number;
  directSetupCostKzt: number | null;
  externalLeadDays: [number, number];
  requiresManualReview: boolean;
  prerequisites: string[];
  exclusions: string[];
  includes: string[];
}

export interface PricingConfig {
  currency: 'KZT';
  enabled: boolean;
  billableHourlyRateKzt: number;
  complexityMultipliers: { simple: number; medium: number; complex: number };
  riskReservePercent: number;
  testingPercent: number;
  uncertaintyPercentPerUnknown: number;
  uncertaintyMaxPercent: number;
  minimumImplementationPriceKzt: number;
  roundingIncrementKzt: number;
  workingHoursPerDay: number;
  customerFeedbackDays: [number, number];
  supportMonthlyKzt: number | null;
  usdToKztRate: number | null;
  usage: {
    modelId: string;
    inputTokensPerRequest: [number, number, number];
    outputTokensPerRequest: [number, number, number];
    callsPerRequest: [number, number, number];
  };
  calibrationMinSamples: number;
}

export interface PricingVersion {
  version: number;
  config: PricingConfig;
  catalog: CatalogItem[];
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface AdminRequestRow {
  id: string;
  userId: string;
  status: RequestStatus;
  scope: string;
  opportunityTitles: Record<string, string>;
  contact: { name: string; phone: string; email: string | null };
  industry: string | null;
  preliminaryPriceKzt: Range | null;
  reviewed: { priceKzt: Range; approved: boolean } | null;
  confidence: string;
  requiresManualReview: boolean;
  assignedAdminId: string | null;
  hasActuals: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateLine {
  capabilityId: string;
  name: { ru: string; en: string };
  quantity: number;
  complexity: string;
  requestedComplexity: string | null;
  multiplierMilli: number;
  hours: Range;
  laborKzt: Range;
  directCostKzt: number | null;
  requiresManualReview: boolean;
  projectTask: boolean;
  reasons: string[];
}

export interface EstimateResult {
  lines: EstimateLine[];
  excluded: Array<{ capabilityId: string; name: string | null; reason: string; note: string }>;
  testingHours: Range;
  hours: Range;
  uncertaintyBp: number;
  laborKzt: Range;
  directKzt: number;
  riskReserveKzt: Range;
  rawTotalKzt: Range;
  priceKzt: Range | null;
  minimumApplied: boolean;
  duration: { workingDaysMin: number; workingDaysMax: number; externalApproval: boolean };
  confidence: string;
  confidenceReasons: string[];
  assumptions: string[];
  unknowns: string[];
  parameters: Record<string, unknown>;
}

export interface AdminRequestDetail {
  request: {
    id: string;
    userId: string;
    analysisId: string | null;
    estimateId: string;
    status: RequestStatus;
    customerMessage: string;
    contact: { name: string; phone: string; email: string | null };
    industry: string | null;
    snapshot: {
      id: string;
      pricingVersion: number;
      opportunityTitles: Record<string, string>;
      result: EstimateResult;
      createdAt: string;
    };
    reviewed: {
      priceKzt: Range;
      hours: Range | null;
      workingDays: [number, number];
      customerNote: string;
      approved: boolean;
      reviewedBy: string;
      reviewedAt: string;
    } | null;
    assignedAdminId: string | null;
    internalNotes: Array<{ id: string; authorId: string; text: string; createdAt: string }>;
    actuals: {
      actualHours: number;
      actualDirectKzt: number;
      finalPriceKzt: number;
      deviationReasons: string;
    } | null;
    createdAt: string;
  };
  audit: Array<{
    id: string;
    action: string;
    actorId: string;
    reason: string;
    previous: unknown;
    next: unknown;
    createdAt: string;
  }>;
}

export interface CalibrationReport {
  projects: number;
  overall: {
    meanAbsHoursErrorPct: number | null;
    medianHoursRatio: number | null;
    meanPriceDeviationPct: number | null;
    meanDirectDeviationKzt: number | null;
  };
  byCapability: Array<{
    key: string;
    projects: number;
    medianHoursRatio: number;
    meanAbsHoursErrorPct: number;
  }>;
  byIndustry: Array<{
    key: string;
    projects: number;
    medianHoursRatio: number;
    meanAbsHoursErrorPct: number;
  }>;
  bySolutionType: Array<{
    key: string;
    projects: number;
    medianHoursRatio: number;
    meanAbsHoursErrorPct: number;
  }>;
  byIntegration: Array<{
    key: string;
    projects: number;
    medianHoursRatio: number;
    meanAbsHoursErrorPct: number;
  }>;
  recommendations: Array<{
    capabilityId: string;
    currentHoursExpected: number;
    suggestedHoursExpected: number;
    projects: number;
    medianHoursRatio: number;
  }>;
}

function adminHeaders(): Record<string, string> {
  try {
    const key = localStorage.getItem('ketner_admin_key');
    return key ? { 'x-admin-key': key } : {};
  } catch {
    return {};
  }
}

const admin = <T>(path: string, init: RequestInit = {}) =>
  apiCall<T>(`/admin/pricing${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...(init.headers as Record<string, string> | undefined) },
  });

export const adminPricing = {
  config: () => admin<{ version: PricingVersion }>('/config'),
  versions: () =>
    admin<{
      versions: Array<{ version: number; note: string; createdBy: string; createdAt: string }>;
    }>('/versions'),
  saveConfig: (baseVersion: number, config: PricingConfig, reason: string) =>
    admin<{ version: PricingVersion }>('/config', {
      method: 'PUT',
      body: JSON.stringify({ baseVersion, config, reason }),
    }),
  saveItem: (baseVersion: number, item: CatalogItem, reason: string) =>
    admin<{ version: PricingVersion }>(`/catalog/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ baseVersion, item, reason }),
    }),
  requests: (status?: RequestStatus) =>
    admin<{ requests: AdminRequestRow[] }>(`/requests${status ? `?status=${status}` : ''}`),
  request: (id: string) => admin<AdminRequestDetail>(`/requests/${encodeURIComponent(id)}`),
  updateRequest: (
    id: string,
    body: { status?: RequestStatus; assignedAdminId?: 'me' | null; note?: string; reason: string },
  ) =>
    admin(`/requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  review: (
    id: string,
    body: {
      priceKzt: Range;
      hours: Range | null;
      workingDays: [number, number];
      customerNote: string;
      approve: boolean;
      reason: string;
    },
  ) =>
    admin(`/requests/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  actuals: (
    id: string,
    body: {
      actualHours: number;
      actualDirectKzt: number;
      finalPriceKzt: number;
      deviationReasons: string;
      scopeChanges: string;
      difficulties: string;
    },
  ) =>
    admin(`/requests/${encodeURIComponent(id)}/actuals`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  estimates: () =>
    admin<{
      estimates: Array<{
        id: string;
        analysisId: string;
        ownerId: string | null;
        scope: string;
        opportunityTitles: Record<string, string>;
        pricingVersion: number;
        priceKzt: Range | null;
        hours: Range;
        confidence: string;
        requiresManualReview: boolean;
        createdAt: string;
      }>;
    }>('/estimates'),
  calibration: () => admin<{ report: CalibrationReport; version: number }>('/calibration'),
};
